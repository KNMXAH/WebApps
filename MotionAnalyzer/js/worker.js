// worker.js — 무거운 연산(디코딩, 추적)을 메인 스레드에서 분리한다 (§5.4).
// module worker로 로드되어 ES import를 그대로 사용할 수 있다.
// 주의: module worker에서는 importScripts()를 쓸 수 없으므로, UMD 형태인
// mp4box.all.min.js는 fetch 후 평가하여 self.MP4Box로 등록한다.
async function loadMp4Box() {
  if (typeof MP4Box !== 'undefined') return;
  const res = await fetch(new URL('../vendor/mp4box.all.min.js', import.meta.url));
  const code = await res.text();
  (0, eval)(code); // UMD 스크립트: self(=this)에 MP4Box를 등록한다
}
const mp4boxReady = loadMp4Box();

import { parseWithMp4Box, estimateFps, frameIntervalDeviationPct } from './demuxer.js';
import { createRandomAccessDecoder, checkConfigSupported } from './decoder.js';
import { frameToAnalysisBitmap } from './framecache.js';
import { trackOneFrame, blendTemplate, predictNextPosition, searchRadius, cropImageData, TRACKER_CONFIG } from './tracker.js';

let demux = null;
let config = null;
let analysisWidth = 0, analysisHeight = 0;
let bitmapCache = new Map(); // frameIndex -> ImageBitmap (분석 좌표계)
let offscreen = new OffscreenCanvas(64, 64);
let offCtx = offscreen.getContext('2d', { willReadFrequently: true });

function post(type, payload, transfer) {
  self.postMessage({ type, ...payload }, transfer || []);
}

self.onmessage = async (ev) => {
  const { cmd } = ev.data;
  try {
    if (cmd === 'parse') await handleParse(ev.data);
    else if (cmd === 'buildCache') await handleBuildCache(ev.data);
    else if (cmd === 'track') await handleTrack(ev.data);
    else if (cmd === 'decodeSingle') await handleDecodeSingle(ev.data);
  } catch (err) {
    post('error', { message: err.message || String(err), context: cmd });
  }
};

async function handleParse({ arrayBuffer }) {
  await mp4boxReady;
  const result = await parseWithMp4Box(arrayBuffer);
  demux = result;
  const fps = estimateFps(result.frameIndex);
  const deviationPct = frameIntervalDeviationPct(result.frameIndex);

  const supported = await checkConfigSupported({
    codec: result.codecString,
    codedWidth: result.width,
    codedHeight: result.height,
    description: result.description
  });

  post('parsed', {
    ok: true,
    supported,
    codecString: result.codecString,
    width: result.width,
    height: result.height,
    frameIndex: result.frameIndex,
    estimatedFps: fps,
    deviationPct,
    durationSec: result.durationSec
  });
}

async function handleDecodeSingle({ frameNum, width, height }) {
  config = { codec: demux.codecString, codedWidth: demux.width, codedHeight: demux.height, description: demux.description };
  const dec = createRandomAccessDecoder(demux);
  const frame = await dec.decodeFrame(frameNum, config);
  if (!frame) { post('decodedSingle', { frameNum, bitmap: null }); dec.close(); return; }
  const bmp = await frameToAnalysisBitmap(frame, width, height);
  frame.close();
  dec.close();
  post('decodedSingle', { frameNum, bitmap: bmp }, [bmp]);
}

async function handleBuildCache({ startFrame, endFrame, width, height }) {
  analysisWidth = width; analysisHeight = height;
  bitmapCache.clear();
  config = { codec: demux.codecString, codedWidth: demux.width, codedHeight: demux.height, description: demux.description };
  const dec = createRandomAccessDecoder(demux);

  await dec.decodeRange(startFrame, endFrame, config, async (frame, idx) => {
    const bmp = await frameToAnalysisBitmap(frame, width, height);
    frame.close();
    bitmapCache.set(idx, bmp);
  }, (done, total) => {
    post('cacheProgress', { done, total });
  });

  dec.close();
  post('cacheDone', { count: bitmapCache.size });
}

function getImageDataForFrame(idx) {
  const bmp = bitmapCache.get(idx);
  if (!bmp) return null;
  if (offscreen.width !== analysisWidth || offscreen.height !== analysisHeight) {
    offscreen = new OffscreenCanvas(analysisWidth, analysisHeight);
    offCtx = offscreen.getContext('2d', { willReadFrequently: true });
  }
  offCtx.clearRect(0, 0, analysisWidth, analysisHeight);
  offCtx.drawImage(bmp, 0, 0);
  return offCtx.getImageData(0, 0, analysisWidth, analysisHeight);
}

async function handleTrack({ startFrame, endFrame, initPoint, boxW, boxH, resumeTemplateCrop }) {
  const history = []; // {frame, t, x, y}
  let template = resumeTemplateCrop || null;

  if (!template) {
    const img0 = getImageDataForFrame(startFrame);
    template = cropImageData(img0, Math.round(initPoint.x - boxW / 2), Math.round(initPoint.y - boxH / 2), boxW, boxH);
    history.push({ frame: startFrame, t: demux.frameIndex[startFrame].t, x: initPoint.x, y: initPoint.y });
    post('trackPoint', { frame: startFrame, x: initPoint.x, y: initPoint.y, confidence: 1, resumed: false });
  }

  let lastMoveDist = 0;
  const total = endFrame - startFrame;

  for (let i = startFrame + 1; i <= endFrame; i++) {
    const img = getImageDataForFrame(i);
    if (!img) { post('error', { message: `프레임 ${i} 캐시 없음`, context: 'track' }); return; }

    const predicted = predictNextPosition(history, demux.frameIndex[i].t) || history[history.length - 1];
    const radius = searchRadius(Math.max(boxW, boxH), lastMoveDist);

    const result = trackOneFrame(img, template, predicted, boxW, boxH, radius);

    if (result.confidence < TRACKER_CONFIG.CONFIDENCE_THRESHOLD) {
      post('trackPaused', { frame: i, done: i - startFrame, total, templateSnapshot: template });
      return; // 사용자가 클릭 후 'track' 명령을 다시 보내 재개
    }

    const prev = history[history.length - 1];
    lastMoveDist = Math.hypot(result.x - prev.x, result.y - prev.y);

    if (result.confidence >= TRACKER_CONFIG.MIN_UPDATE_CONFIDENCE && result.matchedCrop) {
      template = blendTemplate(template, result.matchedCrop);
    }

    history.push({ frame: i, t: demux.frameIndex[i].t, x: result.x, y: result.y });
    post('trackPoint', { frame: i, x: result.x, y: result.y, confidence: result.confidence, resumed: false });
    post('trackProgress', { done: i - startFrame, total });
  }

  post('trackDone', {});
}
