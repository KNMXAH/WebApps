// main.js — 진입점. 상태 머신과 화면 전환, Worker와의 메시지 교환을 담당한다.

import { appState, setPhase, resetToIdle, subscribe, notify, canAdvance, pushHistory } from './state.js';
import { initCollectUI, renderCurrentPhase, refreshReviewTable } from './ui-collect.js';
import { initAnalyzeUI, enterAnalyzePhase, setAnalyzeBitmap, renderAnalyze } from './ui-analyze.js';
import { checkBrowserSupport, checkFileSizeConstraints, decideTrack, remuxContainer, transcodeToH264 } from './loader.js';
import { decideCacheCap } from './framecache.js';
import { pixelsToPhysical } from './physics.js';

const dom = {
  fileInput: document.getElementById('fileInput'),
  canvas: document.getElementById('mainCanvas'),
  guidanceBox: document.getElementById('guidanceBox'),
  advanceBtn: document.getElementById('advanceBtn'),
  confirmBtn: document.getElementById('confirmAimBtn'),
  fpsConfirmBtn: document.getElementById('fpsConfirmBtn'),
  rulerLengthInput: document.getElementById('rulerLengthInput'),
  rulerWarning: document.getElementById('rulerWarning'),
  rangeStartSlider: document.getElementById('rangeStartSlider'),
  rangeEndSlider: document.getElementById('rangeEndSlider'),
  massInput: document.getElementById('massInput'),
  startTrackingBtn: document.getElementById('startTrackingBtn'),
  stopTrackingBtn: document.getElementById('stopTrackingBtn'),
  toAnalyzeBtn: document.getElementById('toAnalyzeBtn'),
  retrackFromRowBtn: document.getElementById('retrackFromRowBtn'),
  undoBtn: document.getElementById('undoBtn'),
  reviewTableBody: document.getElementById('reviewTableBody'),
  trackProgress: document.getElementById('trackProgress'),

  analyzeCanvas: document.getElementById('analyzeCanvas'),
  energyBarCanvas: document.getElementById('energyBarCanvas'),
  energyLineCanvas: document.getElementById('energyLineCanvas'),
  legendContainer: document.getElementById('legendContainer'),
  energyTypeRadios: Array.from(document.querySelectorAll('input[name="energyType"]')),
  dataTypeRadios: Array.from(document.querySelectorAll('input[name="dataType"]')),
  theoryRadio: document.getElementById('dataTypeTheory'),
  smoothingCheckbox: document.getElementById('smoothingCheckbox'),
  massReinput: document.getElementById('massReinput'),
  analyzeSlider: document.getElementById('analyzeSlider'),
  backToReviewBtn: document.getElementById('backToReviewBtn'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  gWarningBox: document.getElementById('gWarningBox'),

  panels: Array.from(document.querySelectorAll('[data-phase-panel]')),
  loadingMessage: document.getElementById('loadingMessage'),
  precisionBadge: document.getElementById('precisionBadge')
};

let worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

initCollectUI(dom, worker);
initAnalyzeUI(dom);

subscribe(() => {
  showPanelForPhase(appState.phase);
  dom.advanceBtn.disabled = !canAdvance();
});

function showPanelForPhase(phase) {
  dom.panels.forEach(p => {
    const list = p.dataset.phasePanel.split(',');
    p.hidden = !list.includes(phase);
  });
}
showPanelForPhase(appState.phase);

// ---------------- 다음 단계 버튼 공통 처리 ----------------
dom.advanceBtn.addEventListener('click', onAdvance);
function onAdvance() {
  const order = ['IDLE', 'LOADING', 'FPS_CONFIRM', 'RULER', 'RANGE', 'INIT_POINT'];
  const idx = order.indexOf(appState.phase);
  if (appState.phase === 'RANGE') {
    // 구간 확정 → 캐시 빌드 후 INIT_POINT로
    buildCacheForRange().then(() => setPhase('INIT_POINT'));
    return;
  }
  if (idx >= 0 && idx < order.length - 1) setPhase(order[idx + 1]);
}

// ---------------- 새 영상 업로드 시 초기화 ----------------
document.getElementById('newVideoBtn')?.addEventListener('click', () => {
  resetToIdle();
  showPanelForPhase(appState.phase);
});

// ---------------- 1단계: 파일 선택 → 3-트랙 분기 ----------------
document.addEventListener('app:fileChosen', async (e) => {
  const file = e.detail.file;
  setPhase('LOADING');
  appState.loading.message = '영상을 확인하고 있습니다...';
  notify();

  const support = checkBrowserSupport();
  if (!support.supported) {
    appState.loading.message = support.message; // 폴백 경로는 §3.4 참고 문서로 대체(간이 구현)
    notify();
  }

  try {
    let arrayBuffer = await file.arrayBuffer();
    let parsed = await parseInWorker(arrayBuffer);

    let track = decideTrack(parsed.ok, parsed.supported);
    if (track === 'B') {
      appState.loading.message = '영상 형식을 변환하고 있습니다...';
      notify();
      try {
        const remuxed = await remuxContainer(file, (pct) => { appState.loading.progress = pct; notify(); });
        parsed = await parseInWorker(remuxed);
        if (!(parsed.ok && parsed.supported)) track = 'C';
      } catch (err) {
        track = 'C';
      }
    }
    if (track === 'C') {
      appState.loading.message = '영상 형식을 변환하고 있습니다...';
      appState.loading.progress = 0;
      notify();
      const transcoded = await transcodeToH264(file, (pct) => { appState.loading.progress = pct; notify(); });
      parsed = await parseInWorker(transcoded);
      if (!(parsed.ok && parsed.supported)) throw new Error('이 영상 파일을 읽을 수 없습니다. 다른 영상으로 시도해 주세요.');
    }

    finalizeParsed(parsed, file);
  } catch (err) {
    appState.loading.message = err.message || '이 영상 파일을 읽을 수 없습니다. 다른 영상으로 시도해 주세요.';
    notify();
  }
});

function parseInWorker(arrayBuffer) {
  return new Promise((resolve) => {
    const handler = (ev) => {
      if (ev.data.type === 'parsed') {
        worker.removeEventListener('message', handler);
        resolve({ ok: true, ...ev.data });
      } else if (ev.data.type === 'error') {
        worker.removeEventListener('message', handler);
        resolve({ ok: false });
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage({ cmd: 'parse', arrayBuffer: arrayBuffer.slice(0) }, []);
  });
}

function finalizeParsed(parsed, file) {
  const originalWidth = parsed.width, originalHeight = parsed.height;
  const analysisWidth = Math.min(originalWidth, 1280);
  const analysisHeight = Math.round(originalHeight * (analysisWidth / originalWidth));

  appState.video.file = file;
  appState.video.objectURL = URL.createObjectURL(file);
  appState.video.frameIndex = parsed.frameIndex;
  appState.video.estimatedFps = parsed.estimatedFps;
  appState.video.originalWidth = originalWidth;
  appState.video.originalHeight = originalHeight;
  appState.video.analysisWidth = analysisWidth;
  appState.video.analysisHeight = analysisHeight;
  appState.video.durationSec = parsed.durationSec;
  appState.cache.capMax = decideCacheCap(isTouchDevice());

  dom.canvas.width = analysisWidth;
  dom.canvas.height = analysisHeight;
  dom.analyzeCanvas.width = analysisWidth;
  dom.analyzeCanvas.height = analysisHeight;

  const warnings = checkFileSizeConstraints(parsed.durationSec, originalWidth, originalHeight);
  if (warnings.length) {
    appState.loading.message = warnings.map(w => w.message).join(' ');
  }
  if (parsed.deviationPct >= 5) {
    appState.loading.vfrNote = '이 영상은 프레임 간격이 일정하지 않지만, 실제 시간을 사용하므로 분석은 정확합니다.';
  }

  dom.rangeStartSlider.min = 0;
  dom.rangeStartSlider.max = parsed.frameIndex.length - 1;
  dom.rangeEndSlider.min = 0;
  dom.rangeEndSlider.max = parsed.frameIndex.length - 1;
  dom.rangeStartSlider.value = 0;
  dom.rangeEndSlider.value = Math.min(parsed.frameIndex.length - 1, 60);
  appState.range.startFrame = 0;
  appState.range.endFrame = Math.min(parsed.frameIndex.length - 1, 60);

  setPhase('FPS_CONFIRM');
  decodeSingleFrame(0, true);
}

function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

// ---------------- 프레임 미리보기 요청 처리 (§7.2 하이브리드 미리보기) ----------------
const previewVideo = document.getElementById('previewVideo');

document.addEventListener('app:previewFrame', (e) => {
  const { frame, precise, forAnalyze } = e.detail;
  if (!precise) {
    // 드래그 중: <video>로 대략적인 그림만 즉시 보여준다. 어떤 데이터도 여기서 추출하지 않는다.
    if (previewVideo.src !== appState.video.objectURL) previewVideo.src = appState.video.objectURL;
    const approxT = appState.video.frameIndex[frame] ? appState.video.frameIndex[frame].t : 0;
    previewVideo.currentTime = approxT;
    const onSeeked = () => {
      previewVideo.removeEventListener('seeked', onSeeked);
      const ctx = dom.canvas.getContext('2d');
      ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
      ctx.drawImage(previewVideo, 0, 0, dom.canvas.width, dom.canvas.height);
      dom.precisionBadge.hidden = true;
    };
    previewVideo.addEventListener('seeked', onSeeked);
    return;
  }
  // 손을 뗀 뒤 약 150ms 후: WebCodecs로 정확히 디코딩(§7.2). 분석에 쓰이는 모든 프레임은 예외 없이 이 경로를 거친다.
  decodeSingleFrame(frame, !forAnalyze, forAnalyze);
  if (!forAnalyze) dom.precisionBadge.hidden = false;
});

function decodeSingleFrame(frameNum, forCollect, forAnalyze) {
  const handler = (ev) => {
    if (ev.data.type === 'decodedSingle' && ev.data.frameNum === frameNum) {
      worker.removeEventListener('message', handler);
      if (forAnalyze) setAnalyzeBitmap(ev.data.bitmap);
      else { appState.view._currentBitmap = ev.data.bitmap; renderCurrentPhase(); }
    }
  };
  worker.addEventListener('message', handler);
  worker.postMessage({
    cmd: 'decodeSingle', frameNum,
    width: appState.video.analysisWidth, height: appState.video.analysisHeight
  });
}

// ---------------- 구간 확정 → 캐시 빌드 ----------------
function buildCacheForRange() {
  return new Promise((resolve, reject) => {
    setPhase('LOADING');
    appState.loading.message = '분석 구간을 준비하고 있습니다...';
    notify();
    const handler = (ev) => {
      if (ev.data.type === 'cacheProgress') {
        appState.loading.progress = Math.round((ev.data.done / ev.data.total) * 100);
        notify();
      } else if (ev.data.type === 'cacheDone') {
        worker.removeEventListener('message', handler);
        resolve();
      } else if (ev.data.type === 'error') {
        worker.removeEventListener('message', handler);
        reject(new Error(ev.data.message));
      }
    };
    worker.addEventListener('message', handler);
    worker.postMessage({
      cmd: 'buildCache',
      startFrame: appState.range.startFrame,
      endFrame: appState.range.endFrame,
      width: appState.video.analysisWidth,
      height: appState.video.analysisHeight
    });
  });
}

// ---------------- 6단계: 추적 시작/재개/중단 ----------------
document.addEventListener('app:startTracking', () => {
  setPhase('TRACKING');
  appState.track.data = [];
  worker.postMessage({
    cmd: 'track',
    startFrame: appState.range.startFrame,
    endFrame: appState.range.endFrame,
    initPoint: appState.object.initPoint,
    boxW: Math.round(appState.object.box.w),
    boxH: Math.round(appState.object.box.h)
  });
});

document.addEventListener('app:resumeTrackClick', (e) => {
  const { point } = e.detail;
  const frame = appState.track.pausedFrame;
  appState.track.data.push({ frame, t: appState.video.frameIndex[frame].t, px: point.x, py: point.y, confidence: 1, edited: false });
  setPhase('TRACKING');
  worker.postMessage({
    cmd: 'track',
    startFrame: frame,
    endFrame: appState.range.endFrame,
    initPoint: point,
    boxW: Math.round(appState.object.box.w),
    boxH: Math.round(appState.object.box.h)
    // resumeTemplateCrop은 worker 내부에서 새 클릭 지점 기반으로 재생성됨
  });
});

document.addEventListener('app:stopTracking', () => {
  worker.postMessage({ cmd: 'stopTrack' });
  setPhase('REVIEW');
  refreshReviewTable();
});

worker.addEventListener('message', (ev) => {
  const d = ev.data;
  if (d.type === 'trackPoint') {
    appState.track.data.push({ frame: d.frame, t: appState.video.frameIndex[d.frame].t, px: d.x, py: d.y, confidence: d.confidence, edited: false });
    attachPhysicalXY();
    notify();
    renderCurrentPhase();
  } else if (d.type === 'trackProgress') {
    appState.track.progress = { current: d.done, total: d.total };
    dom.trackProgress.textContent = `${d.done} / ${d.total} 프레임`;
    notify();
  } else if (d.type === 'trackPaused') {
    appState.track.pausedFrame = d.frame;
    decodeSingleFrame(d.frame, true);
    setPhase('TRACK_PAUSED');
  } else if (d.type === 'trackDone') {
    appState.track.progress.current = appState.track.progress.total;
    setPhase('REVIEW');
    attachPhysicalXY();
    refreshReviewTable();
  } else if (d.type === 'error') {
    console.error('[worker]', d.message, d.context);
    appState.loading.message = d.message;
    notify();
  }
});

function attachPhysicalXY() {
  if (!appState.ruler.scale || appState.track.data.length === 0) return;
  const phys = pixelsToPhysical(appState.track.data, appState.ruler.scale, appState.video.analysisHeight);
  phys.forEach((p, i) => {
    appState.track.data[i].physX = p.x;
    appState.track.data[i].physY = Math.max(0, p.yRaw - Math.min(...phys.map(q => q.yRaw)));
  });
}

// ---------------- 7단계: 행 수정/재추적 ----------------
document.addEventListener('app:rowEditClick', (e) => {
  const { point, row } = e.detail;
  appState.track.data[row].px = point.x;
  appState.track.data[row].py = point.y;
  appState.track.data[row].edited = true;
  attachPhysicalXY();
  appState.view.editingRow = null;
  setPhase('REVIEW');
  refreshReviewTable();
});

document.addEventListener('app:retrackFrom', (e) => {
  const rowIndex = e.detail.rowIndex;
  const remaining = appState.track.data.length - rowIndex - 1;
  if (!confirm(`이후 ${remaining}개의 데이터가 다시 계산됩니다. 계속할까요?`)) return;
  const row = appState.track.data[rowIndex];
  appState.track.data = appState.track.data.slice(0, rowIndex + 1);
  appState.view.editingRow = null;
  setPhase('TRACKING');
  worker.postMessage({
    cmd: 'track',
    startFrame: row.frame,
    endFrame: appState.range.endFrame,
    initPoint: { x: row.px, y: row.py },
    boxW: Math.round(appState.object.box.w),
    boxH: Math.round(appState.object.box.h)
  });
});

// ---------------- ANALYZE 진입 ----------------
subscribe(() => {
  if (appState.phase === 'ANALYZE' && !appState.view._analyzeEntered) {
    appState.view._analyzeEntered = true;
    enterAnalyzePhase();
  }
  if (appState.phase !== 'ANALYZE') appState.view._analyzeEntered = false;
});
