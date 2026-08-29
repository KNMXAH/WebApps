// worker.js — 디코딩과 추적을 메인 스레드에서 분리한다(§5.4).
// 모듈 워커로 실행된다: new Worker(url, { type:'module' })

import { FrameDecoder } from './decoder.js';
import { Tracker, toGray, TRACK_CONST } from './tracker.js';

let dec = null;
let AW = 0, AH = 0;
let ROT = 0;
let cvs = null, ctx = null;
let frameIndex = null;

let resumeResolve = null;
let abortFlag = false;

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

self.onmessage = async (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'configure': return await onConfigure(m);
      case 'getFrame': return await onGetFrame(m);
      case 'cacheRange': return await onCacheRange(m);
      case 'track': return await onTrack(m);
      case 'resize':
        AW = m.analysisWidth; AH = m.analysisHeight;
        if (m.rotation != null) ROT = m.rotation;
        cvs = new OffscreenCanvas(AW, AH);
        ctx = cvs.getContext('2d', { willReadFrequently: true });
        post({ type: 'resized', reqId: m.reqId });
        return;
      case 'trackResume':
        if (resumeResolve) { const r = resumeResolve; resumeResolve = null; r({ px: m.px, py: m.py }); }
        return;
      case 'trackAbort':
        abortFlag = true;
        if (dec) dec.cancel();
        if (resumeResolve) { const r = resumeResolve; resumeResolve = null; r(null); }
        return;
      case 'dispose':
        if (dec) dec.cancel();
        dec = null;
        return;
    }
  } catch (err) {
    post({ type: 'error', reqId: m.reqId, message: (err && err.message) || String(err) });
  }
};

async function onConfigure(m) {
  AW = m.analysisWidth; AH = m.analysisHeight;
  ROT = m.rotation || 0;
  cvs = new OffscreenCanvas(AW, AH);
  ctx = cvs.getContext('2d', { willReadFrequently: true });
  frameIndex = m.frameIndex;
  dec = new FrameDecoder(m.config, m.frameIndex, m.samples);
  post({ type: 'configured', reqId: m.reqId });
}

// 회전 추가 수정 전 원본
// function drawFrame(frame) {
//   ctx.drawImage(frame, 0, 0, AW, AH);
// }

function drawFrame(frame) {
  ctx.save();
  ctx.clearRect(0, 0, AW, AH);
  if (ROT === 90) { ctx.translate(AW, 0); ctx.rotate(Math.PI / 2); }
  else if (ROT === 180) { ctx.translate(AW, AH); ctx.rotate(Math.PI); }
  else if (ROT === 270) { ctx.translate(0, AH); ctx.rotate(-Math.PI / 2); }
  const swap = (ROT === 90 || ROT === 270);
  ctx.drawImage(frame, 0, 0, swap ? AH : AW, swap ? AW : AH);
  ctx.restore();
}

async function onGetFrame(m) {
  if (!dec) throw new Error('디코더가 준비되지 않았습니다.');
  const frame = await dec.getFrame(m.frame);
  if (!frame) { post({ type: 'error', reqId: m.reqId, message: '프레임을 디코딩하지 못했습니다.' }); return; }
  drawFrame(frame);
  frame.close();                                  // VideoFrame 은 즉시 닫는다(§5.3)
  const bmp = await createImageBitmap(cvs);
  post({ type: 'frame', reqId: m.reqId, frame: m.frame, bitmap: bmp }, [bmp]);
}

async function onCacheRange(m) {
  if (!dec) throw new Error('디코더가 준비되지 않았습니다.');
  abortFlag = false;
  const { start, end, reqId } = m;
  const wantCts = new Map();
  for (let i = start; i <= end; i++) wantCts.set(Math.round(frameIndex[i].t * 1e6), i);

  let fails = 0, done = 0;
  const total = end - start + 1;
  try {
    for await (const frame of dec.iterate(start, end)) {
      if (abortFlag) { frame.close(); break; }
      const idx = wantCts.get(Math.round(frame.timestamp));
      if (idx === undefined) { frame.close(); continue; }
      try {
        drawFrame(frame);
        frame.close();
        const bmp = await createImageBitmap(cvs);
        done++;
        post({ type: 'cachedFrame', reqId, frame: idx, bitmap: bmp, done, total }, [bmp]);
        fails = 0;
      } catch (err) {
        try { frame.close(); } catch { }
        if (++fails >= 3) throw new Error('연속으로 프레임을 읽지 못했습니다.');
      }
    }
  } finally {
    dec.cancel();
  }
  post({ type: 'cacheDone', reqId, done, total });
}

async function onTrack(m) {
  if (!dec) throw new Error('디코더가 준비되지 않았습니다.');
  abortFlag = false;

  const { start, end, seedFrame, seedPoint, box, prev, reqId } = m;
  const tracker = new Tracker();
  const history = (prev || []).map(p => ({ t: p.t, px: p.px, py: p.py }));

  const wantCts = new Map();
  for (let i = seedFrame; i <= end; i++) wantCts.set(Math.round(frameIndex[i].t * 1e6), i);

  let seeded = false;
  let fails = 0;

  try {
    for await (const frame of dec.iterate(seedFrame, end)) {
      if (abortFlag) { frame.close(); break; }
      const idx = wantCts.get(Math.round(frame.timestamp));
      if (idx === undefined) { frame.close(); continue; }

      let img;
      try {
        drawFrame(frame);
        frame.close();
        img = ctx.getImageData(0, 0, AW, AH);
        fails = 0;
      } catch (err) {
        try { frame.close(); } catch { }
        if (++fails >= 3) throw new Error('연속으로 프레임을 읽지 못했습니다.');
        continue;
      }

      const t = frameIndex[idx].t;

      if (!seeded) {
        tracker.setTemplate(img, seedPoint.x, seedPoint.y, box.w, box.h);
        history.push({ t, px: seedPoint.x, py: seedPoint.y });
        post({ type: 'trackPoint', frame: idx, t, px: seedPoint.x, py: seedPoint.y, confidence: 1, seed: true });
        seeded = true;
        continue;
      }

      const gray = toGray(img);
      let r = tracker.step(img, gray, history, t);

      if (r.confidence < TRACK_CONST.CONFIDENCE_THRESHOLD) {
        // 신뢰도 미달 → 즉시 정지하고 사용자 클릭을 기다린다(§9.2)
        post({ type: 'trackPaused', frame: idx, t, confidence: r.confidence });
        const answer = await new Promise(res => { resumeResolve = res; });
        if (!answer || abortFlag) break;
        tracker.setTemplate(img, answer.px, answer.py, box.w, box.h);
        history.push({ t, px: answer.px, py: answer.py });
        post({ type: 'trackPoint', frame: idx, t, px: answer.px, py: answer.py, confidence: 1, edited: true });
        continue;
      }

      tracker.updateTemplate(img, r.px, r.py);
      history.push({ t, px: r.px, py: r.py });
      post({ type: 'trackPoint', frame: idx, t, px: r.px, py: r.py, confidence: r.confidence });
    }
  } finally {
    dec.cancel();
  }

  post({ type: 'trackDone', reqId, aborted: abortFlag });
}
