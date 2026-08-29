// main.js — 진입점, 상태 머신, 화면 전환

import { PHASE, createState } from './state.js';
import { Stage } from './canvas.js';
import { FrameCache, cacheLimit, analysisSize } from './framecache.js';
import { loadVideo, webCodecsSupported, sizeWarnings } from './loader.js';
import { estimateFps, frameIntervalDeviation } from './demuxer.js';
import { WorkerSource } from './source.js';
import { probeVideo, FallbackSource } from './fallback.js';
import { computePhysics } from './physics.js';
import {
  initCollect, renderCollect, collectOverlay,
  beginRulerAim, beginInitAim, invalidateTable
} from './ui-collect.js';
import { initAnalyze, renderAnalyze, analyzeOverlay, enableBaselineDrag } from './ui-analyze.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.state = createState();
    this.cache = new FrameCache();
    this.source = null;
    this.sizeAttempt = 0;
    this.maxBaselineDrop = 0;

    this.stage = new Stage({
      wrap: $('stageWrap'),
      canvas: $('stage'),
      loupe: $('loupe'),
      confirmBtn: $('aimConfirm'),
      badge: $('preciseBadge'),
      msg: $('stageMsg')
    });
    this.stage.setOverlay((ctx, stage) => {
      if (this.state.phase === PHASE.ANALYZE) analyzeOverlay(this, ctx, stage);
      else collectOverlay(this, ctx, stage);
    });

    initCollect(this);
    initAnalyze(this);
    $('restartBtn').addEventListener('click', () => { $('fileInput').value = ''; this.reset(); this.render(); });

    this.checkBrowser();
    this.render();
  }

  /* ---------------- 공통 ---------------- */
  notify(text) {
    const el = $('notice');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  checkBrowser() {
    if (!webCodecsSupported()) {
      this.state.engine = 'fallback';
      $('compatWarn').classList.remove('hidden');
      $('compatWarn').textContent =
        '이 브라우저에서는 정밀 프레임 분석이 제한됩니다. 크롬 브라우저를 사용하시거나, iPad는 최신 버전으로 업데이트해 주세요. ' +
        '지금 상태로도 분석은 되지만 정밀도가 떨어질 수 있습니다.';
    }
  }

  render() {
    renderCollect(this);
    renderAnalyze(this);
    this.stage.redraw();
  }

  setPhase(phase) {
    const s = this.state;
    s.phase = phase;
    this.stage.stopAim();
    this.stage.interaction = null;

    switch (phase) {
      case PHASE.RULER:
        beginRulerAim(this);
        break;
      case PHASE.RANGE:
        this.showFrame(s.range.startFrame);
        break;
      case PHASE.INIT_POINT:
        beginInitAim(this);
        break;
      case PHASE.TRACK_PAUSED:
        this.stage.startAim(null, (p) => {
          this.source.resume(p.x, p.y);
          this.state.phase = PHASE.TRACKING;
          this.render();
        }, '공 위치 확인');
        break;
      case PHASE.REVIEW:
        invalidateTable();
        this.recompute();
        break;
      case PHASE.ANALYZE:
        enableBaselineDrag(this);
        break;
    }
    this.render();
  }

  reset() {
    const s = this.state;
    this.source?.dispose?.();
    this.source = null;
    this.cache.clear();
    if (s.video.objectURL) URL.revokeObjectURL(s.video.objectURL);
    const fresh = createState();
    fresh.engine = webCodecsSupported() ? 'webcodecs' : 'fallback';
    Object.assign(this.state, fresh);
    this.sizeAttempt = 0;
    this.stage.setBitmap(null);
    this.stage.setBadge(false);
    this.stage.setMessage(null);
    this.notify(null);
    invalidateTable();
    $('previewVideo').removeAttribute('src');
  }

  /* ---------------- 1~2단계 ---------------- */
  async startNewVideo(file) {
    this.reset();
    const s = this.state;
    s.video.file = file;
    s.video.objectURL = URL.createObjectURL(file);
    $('previewVideo').src = s.video.objectURL;
    this.setPhase(PHASE.LOADING);

    const onStatus = (t) => { $('loadMsg').textContent = t; };
    const onProgress = (p) => { $('loadBar').style.width = (p * 100).toFixed(1) + '%'; };

    try {
      if (webCodecsSupported()) {
        const { demuxed, track } = await loadVideo(file, { onStatus, onProgress });
        s.engine = 'webcodecs';
        this.sizeAttempt = this.pickInitialAttempt();
        const size = analysisSize(demuxed.srcWidth, demuxed.srcHeight, this.sizeAttempt);
        s.video.analysisWidth = size.width;
        s.video.analysisHeight = size.height;
        s.video.frameIndex = demuxed.frameIndex;
        s.video.srcWidth = demuxed.srcWidth;
        s.video.srcHeight = demuxed.srcHeight;
        s.video.duration = demuxed.duration;

        this.source = new WorkerSource();
        await this.source.configure({
          config: demuxed.config,
          frameIndex: demuxed.frameIndex,
          samples: demuxed.samples,
          analysisWidth: size.width,
          analysisHeight: size.height,
          rotation: s.video.rotation
        });
        if (track !== 'A') onStatus('변환을 마쳤습니다.');
      } else {
        const probe = await probeVideo(s.video.objectURL);
        s.engine = 'fallback';
        this.sizeAttempt = Math.max(1, this.pickInitialAttempt());
        const size = analysisSize(probe.srcWidth, probe.srcHeight, this.sizeAttempt);
        s.video.analysisWidth = size.width;
        s.video.analysisHeight = size.height;
        s.video.frameIndex = probe.frameIndex;
        s.video.srcWidth = probe.srcWidth;
        s.video.srcHeight = probe.srcHeight;
        s.video.duration = probe.duration;

        this.source = new FallbackSource(probe.video);
        await this.source.configure({
          frameIndex: probe.frameIndex,
          analysisWidth: size.width,
          analysisHeight: size.height,
          estimatedFps: probe.estimatedFps,
          rotation: s.video.rotation
        });
        this.notify('이 브라우저에서는 프레임을 정확히 집어내기 어려워 정밀도가 떨어질 수 있습니다.');
      }

      this.stage.setSize(s.video.analysisWidth, s.video.analysisHeight);

      s.video.estimatedFps = estimateFps(s.video.frameIndex);
      s.video.displayFps = s.video.estimatedFps;
      s.range.startFrame = 0;
      s.range.endFrame = s.video.frameIndex.length - 1;

      $('fileInfo').classList.remove('hidden');
      $('fileInfo').textContent =
        `${file.name} · ${s.video.srcWidth}×${s.video.srcHeight} · ${s.video.duration.toFixed(2)}초 · ${s.video.frameIndex.length}장`;
      $('fpsText').textContent = `이 영상은 약 ${s.video.estimatedFps.toFixed(2)} 프레임/초입니다.`;
      $('fpsInput').value = s.video.estimatedFps.toFixed(2);

      const dev = frameIntervalDeviation(s.video.frameIndex);
      const vfr = dev >= 0.05;
      $('vfrNote').classList.toggle('hidden', !vfr);
      if (vfr) $('vfrNote').textContent =
        '이 영상은 프레임 간격이 일정하지 않지만, 실제 시간을 사용하므로 분석은 정확합니다.';

      const warn = sizeWarnings({ duration: s.video.duration, srcHeight: s.video.srcHeight });
      $('lengthNote').classList.toggle('hidden', !warn);
      if (warn) $('lengthNote').textContent = warn;

      await this.showFrame(0);
      this.setPhase(PHASE.FPS_CONFIRM);
    } catch (err) {
      console.error(err);
      this.notify(err.message || '영상을 읽지 못했습니다.');
      this.setPhase(PHASE.IDLE);
    }
  }

  pickInitialAttempt() {
    const mem = navigator.deviceMemory || 4;
    const touch = matchMedia('(pointer: coarse)').matches;
    if (mem <= 2) return 2;
    if (touch || mem <= 4) return 1;
    return 0;
  }

  /* ---------------- 프레임 표시 ---------------- */
  showPreviewFrame(n) {
    const s = this.state;
    const v = $('previewVideo');
    s.view.currentFrame = n;

    // 회전 중에는 <video> 미리보기를 쓸 수 없다(요소를 돌리면 종횡비가 어긋난다).
    if (s.video.rotation !== 0 || !v.src || !s.video.frameIndex[n]) {
      if (this._previewBusy) return;
      this._previewBusy = true;
      this.showFrame(n).finally(() => { this._previewBusy = false; });
      return;
    }
    v.classList.remove('hidden');
    this.stage.setBadge(false);
    try { v.currentTime = s.video.frameIndex[n].t; } catch { }
  }

    /** 회전은 FPS 확인 단계에서만 바꿀 수 있다. 이후 단계에서는 좌표계가 이미 고정된다. */
  async setRotation(delta) {
    const s = this.state;
    if (s.phase !== PHASE.FPS_CONFIRM || !this.source) return;
    s.video.rotation = (((s.video.rotation + delta) % 360) + 360) % 360;

    const size = analysisSize(s.video.srcWidth, s.video.srcHeight, this.sizeAttempt, s.video.rotation);
    s.video.analysisWidth = size.width;
    s.video.analysisHeight = size.height;

    this.cache.clear();
    this.stage.setSize(size.width, size.height);
    await this.source.resize?.(size.width, size.height, s.video.rotation);
    await this.showFrame(s.view.currentFrame || 0);
    this.render();
  }

  async showFrame(n) {
    const s = this.state;
    if (!this.source || !s.video.frameIndex[n]) return;
    $('previewVideo').classList.add('hidden');
    s.view.currentFrame = n;

    const cached = this.cache.get(n);
    if (cached) {
      this.stage.setBitmap(cached);
      this.stage.setBadge(this.source.isPrecise);
      return;
    }
    try {
      const bmp = await this.source.getFrame(n);
      this.stage.setBitmap(bmp);
      try { bmp.close(); } catch { }
      this.stage.setBadge(this.source.isPrecise);
    } catch (err) {
      console.warn(err);
      this.stage.setMessage('이 프레임을 불러오지 못했습니다.');
      setTimeout(() => this.stage.setMessage(null), 1800);
    }
  }

  /* ---------------- 5단계 → 캐싱 ---------------- */
  async prepareRange() {
    const s = this.state;
    const count = s.range.endFrame - s.range.startFrame + 1;
    const limit = cacheLimit();
    if (count > limit) {
      this.notify(`한 번에 다룰 수 있는 양(${limit}장)을 넘었습니다. 분석 구간을 더 짧게 선택해 주세요.`);
      return;
    }
    this.notify(null);
    this.cache.clear();
    this.stage.setMessage('프레임을 준비하고 있습니다… 0%');

    try {
      await this.source.cacheRange(s.range.startFrame, s.range.endFrame, {
        onFrame: (frame, bmp) => this.cache.set(frame, bmp),
        onProgress: (done, total) => {
          this.stage.setMessage(`프레임을 준비하고 있습니다… ${Math.round(done / total * 100)}%`);
        }
      });
      this.stage.setMessage(null);
      await this.showFrame(s.range.startFrame);
      this.setPhase(PHASE.INIT_POINT);
    } catch (err) {
      console.error(err);
      this.stage.setMessage(null);
      if (this.sizeAttempt < 2) {
        this.notify('메모리가 부족해 화면 크기를 줄여 다시 시도합니다.');
        await this.resizeAnalysis(this.sizeAttempt + 1);
        return this.prepareRange();
      }
      this.notify('분석 구간을 더 짧게 선택해 주세요.');
    }
  }

  /** 분석 좌표계 축소 후 저장된 좌표들을 같은 비율로 옮긴다. */
  async resizeAnalysis(attempt) {
    const s = this.state;
    // const size = analysisSize(s.video.srcWidth, s.video.srcHeight, attempt);
        const size = analysisSize(s.video.srcWidth, s.video.srcHeight, attempt, s.video.rotation);
    const k = size.width / s.video.analysisWidth;
    this.sizeAttempt = attempt;
    s.video.analysisWidth = size.width;
    s.video.analysisHeight = size.height;

    const scalePt = (p) => { if (p) { p.x *= k; p.y *= k; } };
    scalePt(s.ruler.p1); scalePt(s.ruler.p2); scalePt(s.object.initPoint);
    s.object.box.w *= k; s.object.box.h *= k;
    for (const d of s.track.data) { d.px *= k; d.py *= k; }
    if (s.ruler.p1 && s.ruler.p2 && s.ruler.realLength > 0) {
      const dpx = Math.hypot(s.ruler.p2.x - s.ruler.p1.x, s.ruler.p2.y - s.ruler.p1.y);
      s.ruler.scale = dpx > 0 ? s.ruler.realLength / dpx : 0;
    }

    this.cache.clear();
    this.stage.setSize(size.width, size.height);
    // await this.source.resize?.(size.width, size.height);
    await this.source.resize?.(size.width, size.height, s.video.rotation);
  }

  /* ---------------- 7단계: 추적 ---------------- */
  startTracking() {
    const s = this.state;
    s.track.data = [];
    s.track.progress = 0;
    s.track.total = s.range.endFrame - s.range.startFrame + 1;
    s.history = [];
    invalidateTable();
    this.runTrack(s.range.startFrame, { ...s.object.initPoint }, []);
  }

  runTrack(seedFrame, seedPoint, prev) {
    const s = this.state;
    s.phase = PHASE.TRACKING;
    this.stage.stopAim();
    this.stage.interaction = null;
    this.render();

    this.source.track(
      {
        start: s.range.startFrame,
        end: s.range.endFrame,
        seedFrame,
        seedPoint,
        box: { ...s.object.box },
        prev
      },
      {
        onPoint: (m) => {
          const rec = {
            frame: m.frame, t: m.t, px: m.px, py: m.py,
            confidence: m.confidence, edited: !!m.edited
          };
          const i = s.track.data.findIndex(d => d.frame === m.frame);
          if (i >= 0) s.track.data[i] = rec; else s.track.data.push(rec);
          s.track.data.sort((a, b) => a.frame - b.frame);
          s.track.progress = s.track.data.length;
          s.view.currentFrame = m.frame;
          const bmp = this.cache.get(m.frame);
          if (bmp) { this.stage.setBitmap(bmp); this.stage.setBadge(this.source.isPrecise); }
          this.render();
        },
        onPaused: (m) => {
          s.track.pausedFrame = m.frame;
          const bmp = this.cache.get(m.frame);
          if (bmp) this.stage.setBitmap(bmp);
          this.setPhase(PHASE.TRACK_PAUSED);
        },
        onDone: () => {
          s.track.pausedFrame = -1;
          this.setPhase(PHASE.REVIEW);
        },
        onError: (err) => {
          console.error(err);
          this.notify('추적 중 문제가 생겼습니다: ' + err.message);
          this.setPhase(PHASE.REVIEW);
        }
      }
    );
  }

  /* ---------------- 8단계: 수정 ---------------- */
  beginEditRow(i) {
    const s = this.state;
    const d = s.track.data[i];
    if (!d) return;
    s.track.editingRow = i;
    this.showFrame(d.frame).then(() => {
      this.stage.startAim({ x: d.px, y: d.py }, (p) => {
        d.px = p.x; d.py = p.y; d.edited = true;
        s.track.editingRow = i;
        invalidateTable();
        this.recompute();
        this.render();
      }, '이 위치로 고치기');
      this.render();
    });
  }

  retrackFromSelected() {
    const s = this.state;
    const i = s.track.editingRow >= 0 ? s.track.editingRow : s.view.hoveredRow;
    if (i < 0 || !s.track.data[i]) { this.notify('먼저 표에서 줄을 하나 고르세요.'); return; }
    const after = s.track.data.length - i - 1;
    if (after <= 0) { this.notify('이 줄 뒤에는 다시 계산할 데이터가 없습니다.'); return; }
    if (!confirm(`이후 ${after}개의 데이터가 다시 계산됩니다. 계속할까요?`)) return;

    s.history.push(s.track.data.map(d => ({ ...d })));
    const seed = s.track.data[i];
    const prev = s.track.data.slice(0, i).map(d => ({ t: d.t, px: d.px, py: d.py }));
    s.track.data = s.track.data.slice(0, i);   // 시드 프레임은 추적기가 다시 기록한다
    s.track.progress = s.track.data.length;
    s.track.editingRow = -1;
    invalidateTable();
    this.runTrack(seed.frame, { x: seed.px, y: seed.py }, prev);
  }

  undo() {
    const s = this.state;
    const snap = s.history.pop();
    if (!snap) return;
    s.track.data = snap;
    s.track.progress = snap.length;
    invalidateTable();
    this.recompute();
    this.render();
  }

  /* ---------------- 9단계 ---------------- */
  recompute() {
    const s = this.state;
    if (s.track.data.length < 3 || !(s.ruler.scale > 0) || !(s.object.mass > 0)) {
      s.physics = null; return;
    }
    s.physics = computePhysics({
      data: s.track.data,
      scale: s.ruler.scale,
      mass: s.object.mass,
      analysisHeight: s.video.analysisHeight,
      smoothing: s.view.smoothing,
      baselineDrop: s.view.baselineDrop
    });
    if (s.physics) {
      const maxH = Math.max(...s.physics.real.map(r => r.y)) - s.physics.baselineDrop;
      this.maxBaselineDrop = Math.max(maxH * 2, 0.01);
    }
  }

  goAnalyze() {
    const s = this.state;
    this.recompute();
    if (!s.physics) { this.notify('데이터가 부족하거나 기준자·질량이 없어 분석할 수 없습니다.'); return; }
    s.view.currentFrame = s.track.data[0].frame;
    this.setPhase(PHASE.ANALYZE);
    this.showFrame(s.view.currentFrame);
  }
}

window.addEventListener('DOMContentLoaded', () => { window.__app = new App(); });
