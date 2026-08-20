// fallback.js — WebCodecs 를 못 쓰는 브라우저용 대체 경로(§3.4)
// <video> 탐색을 쓰므로 정밀도가 떨어진다. 화면에 반드시 그 사실을 표시한다.

import { Tracker, toGray, TRACK_CONST } from './tracker.js';

const raf = () => new Promise(r => requestAnimationFrame(r));

/** 영상을 잠깐 재생해 프레임 간격을 추정하고, 그 값으로 프레임 인덱스를 만든다. */
export async function probeVideo(objectURL) {
  const v = document.createElement('video');
  v.src = objectURL; v.muted = true; v.playsInline = true; v.preload = 'auto';

  await new Promise((res, rej) => {
    v.onloadedmetadata = res;
    v.onerror = () => rej(new Error('이 영상 파일을 읽을 수 없습니다. 다른 영상으로 시도해 주세요.'));
  });

  const duration = v.duration;
  const srcWidth = v.videoWidth, srcHeight = v.videoHeight;

  let fps = 30;
  if (typeof v.requestVideoFrameCallback === 'function') {
    const times = [];
    await new Promise(async (res) => {
      const stop = setTimeout(finish, 2000);
      function tick(_now, meta) {
        times.push(meta.mediaTime);
        if (times.length > 90) return finish();
        v.requestVideoFrameCallback(tick);
      }
      function finish() { clearTimeout(stop); try { v.pause(); } catch { } res(); }
      v.requestVideoFrameCallback(tick);
      try { await v.play(); } catch { finish(); }
    });
    const diffs = [];
    for (let i = 1; i < times.length; i++) {
      const d = times[i] - times[i - 1];
      if (d > 1e-4 && d < 0.5) diffs.push(d);
    }
    if (diffs.length >= 5) {
      diffs.sort((a, b) => a - b);
      const med = diffs[Math.floor(diffs.length / 2)];
      if (med > 0) fps = 1 / med;
    }
    v.currentTime = 0;
  }

  const count = Math.max(2, Math.floor(duration * fps));
  const timescale = Math.round(fps * 1000);
  const frameIndex = [];
  for (let i = 0; i < count; i++) {
    const t = i / fps;
    frameIndex.push({ index: i, cts: Math.round(t * timescale), timescale, t, isKey: true, decodeIndex: i });
  }

  return { video: v, frameIndex, srcWidth, srcHeight, duration, estimatedFps: fps };
}

export class FallbackSource {
  constructor(videoEl) {
    this.v = videoEl;
    this.AW = 0; this.AH = 0;
    this.cvs = null; this.ctx = null;
    this.frameIndex = null;
    this.fps = 30;
    this._abort = false;
    this._resume = null;
    this._queue = Promise.resolve();
  }

  get isPrecise() { return false; }

  async configure({ frameIndex, analysisWidth, analysisHeight, estimatedFps }) {
    this.frameIndex = frameIndex;
    this.AW = analysisWidth; this.AH = analysisHeight;
    this.fps = estimatedFps || 30;
    this.cvs = document.createElement('canvas');
    this.cvs.width = this.AW; this.cvs.height = this.AH;
    this.ctx = this.cvs.getContext('2d', { willReadFrequently: true });
  }

  async resize(analysisWidth, analysisHeight) {
    this.AW = analysisWidth; this.AH = analysisHeight;
    this.cvs.width = this.AW; this.cvs.height = this.AH;
  }

  /** 프레임 표시 구간의 한가운데로 탐색해 경계값 오차를 피한다. */
  async _seekDraw(n) {
    const v = this.v;
    const fi = this.frameIndex;
    const half = (n + 1 < fi.length ? (fi[n + 1].t - fi[n].t) : 1 / this.fps) / 2;
    const target = Math.min(Math.max(fi[n].t + half, 0), Math.max(v.duration - 1e-3, 0));

    await new Promise((res) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; res(); } };
      const onSeeked = async () => {
        v.removeEventListener('seeked', onSeeked);
        if (typeof v.requestVideoFrameCallback === 'function') {
          v.requestVideoFrameCallback(() => done());
          setTimeout(done, 250);
        } else {
          await raf(); await raf(); done();
        }
      };
      v.addEventListener('seeked', onSeeked);
      v.currentTime = target;
      setTimeout(done, 1200);
    });

    this.ctx.drawImage(v, 0, 0, this.AW, this.AH);
  }

  // 탐색 요청은 하나씩 순서대로 처리한다
  _serial(fn) {
    const p = this._queue.then(fn, fn);
    this._queue = p.catch(() => { });
    return p;
  }

  getFrame(n) {
    return this._serial(async () => {
      await this._seekDraw(n);
      return await createImageBitmap(this.cvs);
    });
  }

  async cacheRange(start, end, { onFrame, onProgress } = {}) {
    this._abort = false;
    const total = end - start + 1;
    let done = 0;
    for (let i = start; i <= end; i++) {
      if (this._abort) break;
      await this._seekDraw(i);
      const bmp = await createImageBitmap(this.cvs);
      done++;
      onFrame?.(i, bmp);
      onProgress?.(done, total);
    }
    return { done, total };
  }

  async track(opts, handlers) {
    const { end, seedFrame, seedPoint, box, prev } = opts;
    this._abort = false;
    const tracker = new Tracker();
    const history = (prev || []).map(p => ({ t: p.t, px: p.px, py: p.py }));
    let seeded = false;

    try {
      for (let i = seedFrame; i <= end; i++) {
        if (this._abort) break;
        await this._seekDraw(i);
        const img = this.ctx.getImageData(0, 0, this.AW, this.AH);
        const t = this.frameIndex[i].t;

        if (!seeded) {
          tracker.setTemplate(img, seedPoint.x, seedPoint.y, box.w, box.h);
          history.push({ t, px: seedPoint.x, py: seedPoint.y });
          handlers.onPoint?.({ frame: i, t, px: seedPoint.x, py: seedPoint.y, confidence: 1, seed: true });
          seeded = true;
          continue;
        }

        const gray = toGray(img);
        const r = tracker.step(img, gray, history, t);

        if (r.confidence < TRACK_CONST.CONFIDENCE_THRESHOLD) {
          handlers.onPaused?.({ frame: i, t, confidence: r.confidence });
          const answer = await new Promise(res => { this._resume = res; });
          if (!answer || this._abort) break;
          tracker.setTemplate(img, answer.px, answer.py, box.w, box.h);
          history.push({ t, px: answer.px, py: answer.py });
          handlers.onPoint?.({ frame: i, t, px: answer.px, py: answer.py, confidence: 1, edited: true });
          continue;
        }

        tracker.updateTemplate(img, r.px, r.py);
        history.push({ t, px: r.px, py: r.py });
        handlers.onPoint?.({ frame: i, t, px: r.px, py: r.py, confidence: r.confidence });
      }
      handlers.onDone?.({ aborted: this._abort });
    } catch (err) {
      handlers.onError?.(err);
    }
  }

  resume(px, py) { const r = this._resume; this._resume = null; r?.({ px, py }); }
  abort() { this._abort = true; const r = this._resume; this._resume = null; r?.(null); }
  dispose() { }
}
