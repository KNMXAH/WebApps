// ui-analyze.js — 분석 화면 UI (9~11단계)

import { PHASE } from './state.js';
import { drawTrackPoints, drawTheoryCurve, drawBaseline } from './canvas.js';
import { theoryCurvePixels, baselinePixelY } from './physics.js';
import { drawBars, drawLines } from './chart.js';
import { downloadCsv } from './export.js';

const $ = (id) => document.getElementById(id);

export function initAnalyze(app) {
  const s = app.state;

  $('analyzeRange').addEventListener('input', (e) => {
    const i = parseInt(e.target.value, 10);
    const d = s.track.data[i];
    if (d) { s.view.currentFrame = d.frame; app.showFrame(d.frame); }
    app.render();
  });

  for (const el of document.querySelectorAll('input[name="energyType"]')) {
    el.addEventListener('change', () => { s.view.energyType = el.value; app.render(); });
  }
  for (const el of document.querySelectorAll('input[name="dataType"]')) {
    el.addEventListener('change', () => { s.view.dataType = el.value; app.render(); });
  }
  $('smoothChk').addEventListener('change', (e) => {
    s.view.smoothing = e.target.checked;
    app.recompute(); app.render();
  });
  $('massInput2').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (isFinite(v) && v > 0) { s.object.mass = v; app.recompute(); app.render(); }
  });
  $('baseRange').addEventListener('input', (e) => {
    const frac = parseInt(e.target.value, 10) / 100;
    s.view.baselineDrop = frac * (app.maxBaselineDrop || 0);
    app.recompute(); app.render();
  });

  $('backToReview').addEventListener('click', () => app.setPhase(PHASE.REVIEW));
  $('downloadCsv').addEventListener('click', () => {
    if (!downloadCsv(s)) app.notify('데이터를 만들지 못했습니다. 표를 다시 확인해 주세요.');
  });
}

/** 분석 화면에서 기준면을 캔버스에서 직접 끌어 내릴 수 있게 한다. */
export function enableBaselineDrag(app) {
  const s = app.state, stage = app.stage;
  let dragging = false;
  stage.interaction = {
    onDown: (p) => {
      const y = baselinePixelY(s.physics, s.ruler.scale, s.video.analysisHeight);
      if (y == null) return false;
      if (Math.abs(p.y - y) < Math.max(16, stage.H * 0.03)) { dragging = true; return true; }
      return false;
    },
    onMove: (p) => {
      if (!dragging || !s.physics) return false;
      const yPhys = (s.video.analysisHeight - p.y) * s.ruler.scale;
      s.view.baselineDrop = Math.max(0, s.physics.y0 - yPhys);   // 위로는 잠긴다
      app.recompute();
      const frac = app.maxBaselineDrop ? s.view.baselineDrop / app.maxBaselineDrop : 0;
      $('baseRange').value = String(Math.round(Math.min(1, frac) * 100));
      app.render();
      return true;
    },
    onUp: () => { if (dragging) { dragging = false; return true; } return false; }
  };
}

export function analyzeOverlay(app, ctx, stage) {
  const s = app.state;
  const phys = s.physics;

  if (phys && phys.theoryUsable) {
    const pts = theoryCurvePixels(phys, s.track.data, s.ruler.scale, s.video.analysisHeight);
    drawTheoryCurve(ctx, pts, stage.W);
  }
  if (phys) {
    drawBaseline(ctx, baselinePixelY(phys, s.ruler.scale, s.video.analysisHeight), stage.W);
  }
  const cur = s.track.data.findIndex(d => d.frame === s.view.currentFrame);
  drawTrackPoints(ctx, s.track.data, stage.W, { current: cur });
}

export function renderAnalyze(app) {
  const s = app.state;
  const phys = s.physics;
  if (s.phase !== PHASE.ANALYZE) return;

  const N = s.track.data.length;
  const slider = $('analyzeRange');
  slider.min = '0'; slider.max = String(Math.max(0, N - 1));
  let idx = s.track.data.findIndex(d => d.frame === s.view.currentFrame);
  if (idx < 0) { idx = 0; s.view.currentFrame = s.track.data[0]?.frame ?? 0; }
  slider.value = String(idx);

  const fi = s.video.frameIndex[s.view.currentFrame];
  $('analyzeLabel').textContent = fi
    ? `${s.view.currentFrame}번 프레임 (${(fi.t - s.video.frameIndex[s.range.startFrame].t).toFixed(3)}초)`
    : '—';

  $('massInput2').value = s.object.mass || '';
  $('smoothChk').checked = s.view.smoothing;

  // g 안전장치 안내
  const warn = $('physWarn');
  if (phys?.warning) {
    warn.textContent = phys.warning.text;
    warn.classList.remove('hidden');
  } else warn.classList.add('hidden');

  // 이론 모드를 못 쓰는 경우 강제로 현실 모드
  const theoryRadio = document.querySelector('input[name="dataType"][value="THEORY"]');
  const realRadio = document.querySelector('input[name="dataType"][value="REAL"]');
  const theoryOk = !!phys?.theoryUsable;
  theoryRadio.disabled = !theoryOk;
  if (!theoryOk && s.view.dataType === 'THEORY') {
    s.view.dataType = 'REAL';
    realRadio.checked = true;
  }

  if (!phys) return;

  const rows = s.view.dataType === 'THEORY' ? phys.theory : phys.real;
  const row = rows[idx];
  if (!row) return;

  drawBars($('barChart'), {
    energyType: s.view.energyType,
    KE: row.KE, PE: row.PE,
    axisMax: phys.energyAxisMax,
    label: (s.view.dataType === 'THEORY' ? '이론' : '현실') + ' · 이 순간의 에너지'
  });

  drawLines($('lineChart'), {
    rows: rows.map(r => ({ t: r.t, KE: r.KE, PE: r.PE, E: r.E })),
    axisMax: phys.energyAxisMax,
    currentIndex: idx
  });
}
