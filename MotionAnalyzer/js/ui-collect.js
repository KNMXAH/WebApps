// ui-collect.js — 수집 화면 UI (1~8단계)

import { PHASE, guideFor, blockReason } from './state.js';
import { drawRuler, drawBox, drawTrackPoints } from './canvas.js';
import { computePhysics } from './physics.js';

const $ = (id) => document.getElementById(id);

/* ================================================================== */
/* 초기화                                                              */
/* ================================================================== */
export function initCollect(app) {
  const s = app.state;

  /* --- 1단계: 파일 --- */
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) app.startNewVideo(f);
  });

  /* --- 3단계: FPS --- */
  $('fpsInput').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    s.video.displayFps = isFinite(v) ? v : s.video.estimatedFps;   // 표시 전용
  });
  $('rotLeft').addEventListener('click', () => app.setRotation(-90));
  $('rotRight').addEventListener('click', () => app.setRotation(90));
  $('fpsNext').addEventListener('click', () => app.setPhase(PHASE.RULER));

  /* --- 4단계: 기준자 --- */
  $('rulerLen').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    s.ruler.realLength = isFinite(v) && v > 0 ? v : 0;
    updateScale(app);
    app.render();
  });
  $('rulerReset').addEventListener('click', () => {
    s.ruler.p1 = null; s.ruler.p2 = null; s.ruler.scale = 0;
    beginRulerAim(app); app.render();
  });
  $('rulerNext').addEventListener('click', () => {
    if (blockReason(s)) return;
    app.stage.stopAim();
    app.stage.interaction = null;
    s.range.startFrame = 0;
    s.range.endFrame = Math.min(s.video.frameIndex.length - 1, s.range.endFrame || s.video.frameIndex.length - 1);
    app.setPhase(PHASE.RANGE);
  });

  /* --- 5단계: 구간 --- */
  const startR = $('startRange'), endR = $('endRange');
  let dragTimer = null;
  const onSliderInput = (which) => {
    const a = parseInt(startR.value, 10), b = parseInt(endR.value, 10);
    s.range.startFrame = a; s.range.endFrame = b;
    app.showPreviewFrame(which === 'end' ? b : a);   // 드래그 중에는 <video> 미리보기
    app.render();
  };
  const onSliderDone = (which) => {
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => {
      app.showFrame(s.range.startFrame);             // 손을 떼면 '분석 시작' 프레임으로 되돌린다
    }, 150);
  };
  startR.addEventListener('input', () => onSliderInput('start'));
  endR.addEventListener('input', () => onSliderInput('end'));
  for (const el of [startR, endR]) {
    el.addEventListener('change', () => onSliderDone());
    el.addEventListener('pointerup', () => onSliderDone());
  }
  $('rangeNext').addEventListener('click', () => app.prepareRange());

  /* --- 6단계: 질량 + 초기 위치 --- */
  $('massInput').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    s.object.mass = isFinite(v) && v > 0 ? v : 0;
    app.render();
  });
  $('initReset').addEventListener('click', () => {
    s.object.initPoint = null;
    beginInitAim(app); app.render();
  });
  $('initNext').addEventListener('click', () => {
    if (blockReason(s)) return;
    app.stage.stopAim(); app.stage.interaction = null;
    app.setPhase(PHASE.TRACKING);
  });

  /* --- 7단계: 추적 --- */
  $('trackStart').addEventListener('click', () => app.startTracking());
  $('trackAbort').addEventListener('click', () => app.source?.abort());

  /* --- 8단계: 검토 --- */
  $('toAnalyze').addEventListener('click', () => app.goAnalyze());
  $('retrackFrom').addEventListener('click', () => app.retrackFromSelected());
  $('undoBtn').addEventListener('click', () => app.undo());
}

/* ================================================================== */
/* 캔버스 상호작용                                                      */
/* ================================================================== */

export function beginRulerAim(app) {
  const s = app.state, stage = app.stage;
  stage.interaction = null;
  if (!s.ruler.p1) {
    stage.startAim(null, (p) => { s.ruler.p1 = p; app.render(); beginRulerAim(app); }, '첫 번째 끝점 확인');
  } else if (!s.ruler.p2) {
    stage.startAim(null, (p) => { s.ruler.p2 = p; updateScale(app); app.render(); beginRulerAim(app); }, '두 번째 끝점 확인');
  } else {
    stage.stopAim();
    enableRulerDrag(app);
  }
}

function enableRulerDrag(app) {
  const s = app.state, stage = app.stage;
  let holding = null;
  const hit = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < Math.max(18, stage.W * 0.02);
  stage.interaction = {
    onDown: (p) => {
      if (hit(p, s.ruler.p1)) { holding = 'p1'; return true; }
      if (hit(p, s.ruler.p2)) { holding = 'p2'; return true; }
      return false;
    },
    onMove: (p) => {
      if (!holding) return false;
      s.ruler[holding] = p; updateScale(app); app.render(); return true;
    },
    onUp: () => { if (holding) { holding = null; return true; } return false; }
  };
}

function updateScale(app) {
  const r = app.state.ruler;
  if (!r.p1 || !r.p2 || !(r.realLength > 0)) { r.scale = 0; return; }
  const dpx = Math.hypot(r.p2.x - r.p1.x, r.p2.y - r.p1.y);
  r.scale = dpx > 0 ? r.realLength / dpx : 0;
}

export function beginInitAim(app) {
  const s = app.state, stage = app.stage;
  stage.interaction = null;
  if (!s.object.initPoint) {
    stage.startAim(null, (p) => {
      s.object.initPoint = p;
      const d = Math.max(24, Math.round(stage.W * 0.06));
      s.object.box = { w: d, h: d };
      app.render();
      enableBoxDrag(app);
    }, '공 위치 확인');
  } else {
    stage.stopAim();
    enableBoxDrag(app);
  }
}

function enableBoxDrag(app) {
  const s = app.state, stage = app.stage;
  let mode = null, startBox = null, startPt = null;
  const handleR = Math.max(12, stage.W * 0.018);

  stage.interaction = {
    onDown: (p) => {
      const c = s.object.initPoint, b = s.object.box;
      if (!c) return false;
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [sx, sy] of corners) {
        const hx = c.x + sx * b.w / 2, hy = c.y + sy * b.h / 2;
        if (Math.hypot(p.x - hx, p.y - hy) < handleR) {
          mode = 'resize'; startBox = { ...b }; startPt = p; return true;
        }
      }
      if (Math.abs(p.x - c.x) < b.w / 2 && Math.abs(p.y - c.y) < b.h / 2) {
        mode = 'move'; startBox = { ...c }; startPt = p; return true;
      }
      return false;
    },
    onMove: (p) => {
      if (!mode) return false;
      const c = s.object.initPoint;
      if (mode === 'move') {
        c.x = startBox.x + (p.x - startPt.x);
        c.y = startBox.y + (p.y - startPt.y);
      } else {
        s.object.box.w = Math.max(16, Math.min(stage.W * 0.5, 2 * Math.abs(p.x - c.x)));
        s.object.box.h = Math.max(16, Math.min(stage.H * 0.5, 2 * Math.abs(p.y - c.y)));
      }
      app.render();
      return true;
    },
    onUp: () => { if (mode) { mode = null; return true; } return false; }
  };
}

/* ================================================================== */
/* 오버레이                                                            */
/* ================================================================== */
export function collectOverlay(app, ctx, stage) {
  const s = app.state;
  if (s.ruler.p1) {
    // 두 번째 끝점을 정하는 중이면 조준점(또는 마우스)까지 선이 따라온다
    const live = (!s.ruler.p2 && s.phase === PHASE.RULER)
      ? (stage.aim?.point || stage.hoverPoint)
      : null;
    drawRuler(ctx, s.ruler.p1, s.ruler.p2 || live, stage.W);
  }

  if ((s.phase === PHASE.INIT_POINT) && s.object.initPoint) {
    drawBox(ctx, s.object.initPoint.x, s.object.initPoint.y, s.object.box.w, s.object.box.h, stage.W);
  }

  if (s.track.data.length) {
    const cur = s.track.data.findIndex(d => d.frame === s.view.currentFrame);
    drawTrackPoints(ctx, s.track.data, stage.W, { current: cur, highlight: s.view.hoveredRow });
  }
}

/* ================================================================== */
/* 화면 갱신                                                           */
/* ================================================================== */
const PANEL_BY_PHASE = {
  [PHASE.IDLE]: 'p-upload',
  [PHASE.LOADING]: 'p-loading',
  [PHASE.FPS_CONFIRM]: 'p-fps',
  [PHASE.RULER]: 'p-ruler',
  [PHASE.RANGE]: 'p-range',
  [PHASE.INIT_POINT]: 'p-init',
  [PHASE.TRACKING]: 'p-track',
  [PHASE.TRACK_PAUSED]: 'p-track',
  [PHASE.REVIEW]: 'p-review',
  [PHASE.ANALYZE]: 'p-analyze'
};

export function renderCollect(app) {
  const s = app.state;

  // 안내 문구는 상태에서 파생
  $('guide').textContent = guideFor(s);

  const shown = PANEL_BY_PHASE[s.phase];
  for (const id of new Set(Object.values(PANEL_BY_PHASE))) {
    $(id)?.classList.toggle('hidden', id !== shown);
  }
  $('restartBtn').classList.toggle('hidden', s.phase === PHASE.IDLE || s.phase === PHASE.LOADING);
  $('legend').classList.toggle('hidden', s.phase !== PHASE.ANALYZE);

  const reason = blockReason(s);
  const setNext = (id) => {
    const b = $(id); if (!b) return;
    b.disabled = !!reason;
    b.title = reason || '';
  };

  // 기준자
  if (s.ruler.p1 && s.ruler.p2) {
    const dpx = Math.hypot(s.ruler.p2.x - s.ruler.p1.x, s.ruler.p2.y - s.ruler.p1.y);
    $('rulerPx').classList.remove('hidden');
    $('rulerPx').textContent = `화면에서 잰 길이: ${dpx.toFixed(1)} 칸`;
    const short = dpx < 20;
    $('rulerWarn').classList.toggle('hidden', !short);
    if (short) $('rulerWarn').textContent = '기준자가 너무 짧습니다. 더 긴 물체를 사용하면 정확해집니다.';
  } else {
    $('rulerPx').classList.add('hidden');
    $('rulerWarn').classList.add('hidden');
  }
  setNext('rulerNext');

  // 구간
  const n = s.video.frameIndex.length;
  if (n) {
    const startR = $('startRange'), endR = $('endRange');
    startR.max = String(n - 1); endR.max = String(n - 1);
    startR.value = String(s.range.startFrame); endR.value = String(s.range.endFrame);
    const ft = (i) => s.video.frameIndex[i] ? s.video.frameIndex[i].t.toFixed(3) : '—';
    $('startLabel').textContent = `${s.range.startFrame}번 (${ft(s.range.startFrame)}초)`;
    $('endLabel').textContent = `${s.range.endFrame}번 (${ft(s.range.endFrame)}초)`;
    const rr = blockReason({ ...s, phase: PHASE.RANGE });
    $('rangeWarn').classList.toggle('hidden', !rr);
    if (rr) $('rangeWarn').textContent = rr;
    setNext('rangeNext');
  }

  // 초기 위치
  if (s.object.initPoint) {
    $('boxInfo').classList.remove('hidden');
    $('boxInfo').textContent = `추적 네모 크기: ${Math.round(s.object.box.w)} × ${Math.round(s.object.box.h)} 칸`;
  } else $('boxInfo').classList.add('hidden');
  setNext('initNext');

  // 추적
  $('trackCount').textContent = `${s.track.progress} / ${s.track.total} 프레임`;
  const pct = s.track.total ? (s.track.progress / s.track.total * 100) : 0;
  $('trackBar').style.width = pct.toFixed(1) + '%';
  $('trackPaused').classList.toggle('hidden', s.phase !== PHASE.TRACK_PAUSED);
  const running = s.phase === PHASE.TRACKING && s.track.progress > 0;
  $('trackAbort').classList.toggle('hidden', !running);
  $('trackStart').classList.toggle('hidden', s.phase !== PHASE.TRACKING || running);

  // 검토
  if (s.phase === PHASE.REVIEW) renderTable(app);
  $('reviewActions').classList.toggle('hidden', s.track.editingRow < 0 && s.view.hoveredRow < 0);
  $('undoBtn').disabled = s.history.length === 0;
  setNext('toAnalyze');
}

/* ---------------- 데이터 표 ---------------- */
let tableSignature = '';

function renderTable(app) {
  const s = app.state;
  const phys = computePhysics({
    data: s.track.data, scale: s.ruler.scale, mass: s.object.mass || 1,
    analysisHeight: s.video.analysisHeight, smoothing: false, baselineDrop: 0
  });

  const sig = s.track.data.map(d => `${d.frame}:${d.px.toFixed(2)}:${d.py.toFixed(2)}:${d.edited ? 1 : 0}`).join('|');
  if (sig === tableSignature) { highlightRows(app); return; }
  tableSignature = sig;

  const body = $('dataBody');
  body.innerHTML = '';
  s.track.data.forEach((d, i) => {
    const r = phys?.real[i];
    const tr = document.createElement('tr');
    tr.dataset.row = String(i);
    if (d.edited) tr.classList.add('edited');
    tr.innerHTML = `
      <td>${d.frame}</td>
      <td>${(d.t - s.track.data[0].t).toFixed(3)}</td>
      <td>${r ? r.x.toFixed(3) : '—'}</td>
      <td>${r ? r.y.toFixed(3) : '—'}</td>
      <td><button class="edit-btn" type="button" title="이 줄 고치기">✏️</button></td>`;

    tr.addEventListener('mouseenter', () => { s.view.hoveredRow = i; app.render(); });
    tr.addEventListener('mouseleave', () => { s.view.hoveredRow = -1; app.render(); });
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.edit-btn')) return;
      s.view.hoveredRow = (s.view.hoveredRow === i) ? -1 : i;   // 터치: 탭으로 켜고 끄기
      app.render();
    });
    tr.querySelector('.edit-btn').addEventListener('click', () => app.beginEditRow(i));
    body.appendChild(tr);
  });
  highlightRows(app);
}

function highlightRows(app) {
  const s = app.state;
  const body = $('dataBody');
  for (const tr of body.children) {
    const i = parseInt(tr.dataset.row, 10);
    tr.classList.toggle('hl', i === s.view.hoveredRow);
    tr.classList.toggle('selected', i === s.track.editingRow);
  }
}

export function invalidateTable() { tableSignature = ''; }
