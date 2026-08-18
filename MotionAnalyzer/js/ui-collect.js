// ui-collect.js — 1~7단계(업로드 ~ 검토) 화면 UI

import { appState, setPhase, guidanceText, canAdvance, notify, pushHistory, undoHistory } from './state.js';
import { clientToAnalysis, drawFrame, drawRuler, drawTrackBox, drawTrajectoryPoints, drawLoupe } from './canvas.js';

let dom = {};
let worker = null;
let aimPoint = null;       // "끌어서 조준 → 확정" 방식의 임시 조준점
let dragging = null;       // 드래그 상태(기준자 끝점 / 박스 핸들 / 박스 이동)

export function initCollectUI(elements, workerRef) {
  dom = elements;
  worker = workerRef;
  bindStaticEvents();
}

function bindStaticEvents() {
  dom.fileInput.addEventListener('change', onFileSelected);
  dom.canvas.addEventListener('pointerdown', onPointerDown);
  dom.canvas.addEventListener('pointermove', onPointerMove);
  dom.canvas.addEventListener('pointerup', onPointerUp);
  dom.canvas.style.touchAction = 'none';

  dom.confirmBtn.addEventListener('click', onConfirmAim);
  dom.fpsConfirmBtn.addEventListener('click', () => setPhase('RANGE'));
  dom.rulerLengthInput.addEventListener('input', onRulerLengthInput);
  dom.rangeStartSlider.addEventListener('input', onRangeSliderInput);
  dom.rangeEndSlider.addEventListener('input', onRangeSliderInput);
  dom.rangeEndSlider.addEventListener('change', onRangeSliderCommit);
  dom.rangeStartSlider.addEventListener('change', onRangeSliderCommit);
  dom.massInput.addEventListener('input', onMassInput);
  dom.startTrackingBtn.addEventListener('click', onStartTracking);
  dom.stopTrackingBtn.addEventListener('click', onStopTracking);
  dom.toAnalyzeBtn.addEventListener('click', () => setPhase('ANALYZE'));
  dom.retrackFromRowBtn.addEventListener('click', onRetrackFromRow);
  dom.undoBtn.addEventListener('click', () => { if (undoHistory()) refreshReviewTable(); });
}

// ---------------- 1단계: 업로드 ----------------
async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  appState.video.file = file;
  notify();
  document.dispatchEvent(new CustomEvent('app:fileChosen', { detail: { file } }));
}

// ---------------- 조준 확정(터치/마우스 공통) ----------------
function isTouch(e) { return e.pointerType === 'touch'; }

function onPointerDown(e) {
  const p = toAnalysisPoint(e);
  const phase = appState.phase;

  if (phase === 'RULER') {
    const hit = hitTestRulerHandle(p);
    if (hit) { dragging = { type: 'rulerHandle', which: hit }; return; }
    aimPoint = p;
    renderCurrentPhase();
    return;
  }
  if (phase === 'INIT_POINT') {
    if (appState.object.initPoint) {
      const hit = hitTestBoxHandle(p);
      if (hit) { dragging = { type: 'boxHandle', which: hit }; return; }
      if (hitTestBoxInside(p)) { dragging = { type: 'boxMove', start: p, origin: { ...appState.object.initPoint } }; return; }
    }
    aimPoint = p;
    renderCurrentPhase();
    return;
  }
  if (phase === 'TRACK_PAUSED') {
    aimPoint = p;
    renderCurrentPhase();
    return;
  }
  if (appState.view.editingRow != null) {
    aimPoint = p;
    renderCurrentPhase();
  }
}

function onPointerMove(e) {
  const p = toAnalysisPoint(e);
  if (dragging) {
    if (dragging.type === 'rulerHandle') {
      appState.ruler[dragging.which] = p;
      renderCurrentPhase();
    } else if (dragging.type === 'boxHandle') {
      resizeBoxFromHandle(dragging.which, p);
      renderCurrentPhase();
    } else if (dragging.type === 'boxMove') {
      const dx = p.x - dragging.start.x, dy = p.y - dragging.start.y;
      appState.object.initPoint = { x: dragging.origin.x + dx, y: dragging.origin.y + dy };
      renderCurrentPhase();
    }
    return;
  }
  if (['RULER', 'INIT_POINT', 'TRACK_PAUSED'].includes(appState.phase) || appState.view.editingRow != null) {
    aimPoint = p;
    renderCurrentPhase(e);
  }
}

function onPointerUp() {
  dragging = null;
}

function toAnalysisPoint(e) {
  return clientToAnalysis(dom.canvas, e.clientX, e.clientY, appState.video.analysisWidth, appState.video.analysisHeight);
}

// "끌어서 조준 → 확정 버튼" 확정 처리 (§15.2)
function onConfirmAim() {
  if (!aimPoint) return;
  const phase = appState.phase;

  if (phase === 'RULER') {
    if (!appState.ruler.p1) appState.ruler.p1 = aimPoint;
    else if (!appState.ruler.p2) {
      appState.ruler.p2 = aimPoint;
      const dx = appState.ruler.p2.x - appState.ruler.p1.x;
      const dy = appState.ruler.p2.y - appState.ruler.p1.y;
      appState.ruler.pxLength = Math.hypot(dx, dy);
    }
  } else if (phase === 'INIT_POINT' && !appState.object.initPoint) {
    appState.object.initPoint = aimPoint;
    const defaultBox = Math.max(24, appState.video.analysisWidth * 0.06);
    appState.object.box = { w: defaultBox, h: defaultBox };
  } else if (phase === 'TRACK_PAUSED') {
    document.dispatchEvent(new CustomEvent('app:resumeTrackClick', { detail: { point: aimPoint } }));
  } else if (appState.view.editingRow != null) {
    document.dispatchEvent(new CustomEvent('app:rowEditClick', { detail: { point: aimPoint, row: appState.view.editingRow } }));
  }
  aimPoint = null;
  notify();
  renderCurrentPhase();
}

function onRulerLengthInput(e) {
  const v = parseFloat(e.target.value);
  appState.ruler.realLength = v > 0 ? v : null;
  if (appState.ruler.realLength && appState.ruler.pxLength) {
    if (appState.ruler.pxLength < 20) {
      dom.rulerWarning.textContent = '기준자가 너무 짧습니다. 더 긴 물체를 사용하면 정확해집니다.';
      dom.rulerWarning.hidden = false;
    } else {
      dom.rulerWarning.hidden = true;
    }
    appState.ruler.scale = appState.ruler.realLength / appState.ruler.pxLength;
  }
  notify();
}

function hitTestRulerHandle(p) {
  const R = 14;
  if (appState.ruler.p1 && dist(p, appState.ruler.p1) < R) return 'p1';
  if (appState.ruler.p2 && dist(p, appState.ruler.p2) < R) return 'p2';
  return null;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// ---------------- 4단계: 분석 구간 ----------------
function onRangeSliderInput(e) {
  const isEnd = e.target === dom.rangeEndSlider;
  const frame = parseInt(e.target.value, 10);
  if (isEnd) {
    appState.view.currentFrame = frame; // 조작 중엔 종료 프레임 표시
  } else {
    appState.range.startFrame = frame;
    appState.view.currentFrame = frame;
  }
  document.dispatchEvent(new CustomEvent('app:previewFrame', { detail: { frame, precise: false } }));
}
function onRangeSliderCommit(e) {
  const isEnd = e.target === dom.rangeEndSlider;
  if (isEnd) appState.range.endFrame = parseInt(e.target.value, 10);
  // 손을 떼면 다시 분석 시작 프레임으로 화면 복귀 (§7.1)
  appState.view.currentFrame = appState.range.startFrame;
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('app:previewFrame', { detail: { frame: appState.view.currentFrame, precise: true } }));
  }, 150);
  notify();
}

// ---------------- 5단계: 질량/초기 위치 ----------------
function onMassInput(e) {
  const v = parseFloat(e.target.value);
  appState.object.mass = v > 0 ? v : null;
  notify();
}

function hitTestBoxHandle(p) {
  const { initPoint, box } = appState.object;
  const handles = {
    tl: { x: initPoint.x - box.w / 2, y: initPoint.y - box.h / 2 },
    tr: { x: initPoint.x + box.w / 2, y: initPoint.y - box.h / 2 },
    bl: { x: initPoint.x - box.w / 2, y: initPoint.y + box.h / 2 },
    br: { x: initPoint.x + box.w / 2, y: initPoint.y + box.h / 2 }
  };
  for (const [k, hp] of Object.entries(handles)) if (dist(p, hp) < 14) return k;
  return null;
}
function hitTestBoxInside(p) {
  const { initPoint, box } = appState.object;
  return Math.abs(p.x - initPoint.x) < box.w / 2 && Math.abs(p.y - initPoint.y) < box.h / 2;
}
function resizeBoxFromHandle(which, p) {
  const { initPoint } = appState.object;
  const w = Math.max(24, 2 * Math.abs(p.x - initPoint.x));
  const h = Math.max(24, 2 * Math.abs(p.y - initPoint.y));
  appState.object.box = { w, h };
}

// ---------------- 6단계: 추적 ----------------
function onStartTracking() {
  document.dispatchEvent(new CustomEvent('app:startTracking'));
}
function onStopTracking() {
  document.dispatchEvent(new CustomEvent('app:stopTracking'));
}

// ---------------- 7단계: 검토/수정 ----------------
export function refreshReviewTable() {
  const tbody = dom.reviewTableBody;
  tbody.innerHTML = '';
  appState.track.data.forEach((row, i) => {
    const tr = document.createElement('tr');
    if (row.edited) tr.classList.add('row-edited');
    tr.innerHTML = `
      <td>${row.frame}</td>
      <td>${row.t.toFixed(3)}</td>
      <td>${(row.physX ?? 0).toFixed(3)}</td>
      <td>${(row.physY ?? 0).toFixed(3)}</td>
      <td><button class="btn-edit-row" data-idx="${i}" aria-label="이 행 수정">✏️</button></td>
    `;
    tr.addEventListener('mouseenter', () => { appState.view.hoveredRow = i; renderCurrentPhase(); });
    tr.addEventListener('mouseleave', () => { appState.view.hoveredRow = null; renderCurrentPhase(); });
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('.btn-edit-row')) return;
      appState.view.hoveredRow = (appState.view.hoveredRow === i) ? null : i;
      renderCurrentPhase();
    });
    tr.querySelector('.btn-edit-row').addEventListener('click', () => startRowEdit(i));
    tbody.appendChild(tr);
  });
}

function startRowEdit(i) {
  appState.view.editingRow = i;
  appState.view.currentFrame = appState.track.data[i].frame;
  document.dispatchEvent(new CustomEvent('app:previewFrame', { detail: { frame: appState.track.data[i].frame, precise: true } }));
  notify();
}

function onRetrackFromRow() {
  const i = appState.view.editingRow;
  if (i == null) return;
  pushHistory();
  document.dispatchEvent(new CustomEvent('app:retrackFrom', { detail: { rowIndex: i } }));
}

// ---------------- 렌더 ----------------
export function renderCurrentPhase() {
  const s = appState;
  dom.guidanceBox.textContent = guidanceText();
  dom.advanceBtn.disabled = !canAdvance();

  const ctx = dom.canvas.getContext('2d');
  const bmp = s.view._currentBitmap;
  drawFrame(ctx, bmp, s.video.analysisWidth, s.video.analysisHeight);

  if (s.phase === 'RULER') {
    drawRuler(ctx, s.ruler.p1, s.ruler.p2, aimPoint);
    if (aimPoint) drawLoupe(ctx, dom.canvas, aimPoint.x, aimPoint.y, { destCanvas: dom.canvas, placeAbove: true });
  }
  if (s.phase === 'INIT_POINT' && s.object.initPoint) {
    drawTrackBox(ctx, s.object.initPoint.x, s.object.initPoint.y, s.object.box.w, s.object.box.h);
  }
  if (s.phase === 'INIT_POINT' && aimPoint && !s.object.initPoint) {
    drawLoupe(ctx, dom.canvas, aimPoint.x, aimPoint.y, { destCanvas: dom.canvas, placeAbove: true });
  }
  if (['TRACKING', 'TRACK_PAUSED', 'REVIEW'].includes(s.phase)) {
    drawTrajectoryPoints(ctx, s.track.data, { highlightIndex: s.view.hoveredRow });
  }
  if (s.phase === 'TRACK_PAUSED' && aimPoint) {
    drawLoupe(ctx, dom.canvas, aimPoint.x, aimPoint.y, { destCanvas: dom.canvas, placeAbove: true });
  }
}
