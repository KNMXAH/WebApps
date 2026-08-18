// ui-analyze.js — 8~10단계: 에너지 시각화 화면

import { appState, setPhase, notify } from './state.js';
import { runFullPipeline } from './physics.js';
import { drawFrame, drawTrajectoryPoints, drawTheoryCurve, drawBaseline, clientToAnalysis } from './canvas.js';
import { drawEnergyBar, drawEnergyLineChart, LEGEND } from './chart.js';
import { buildCsv, downloadCsv } from './export.js';

let dom = {};
let physicsResult = null;
let draggingBaseline = false;

export function initAnalyzeUI(elements) {
  dom = elements;
  buildLegend();

  dom.energyTypeRadios.forEach(r => r.addEventListener('change', () => { appState.view.energyType = r.value; renderAnalyze(); }));
  dom.dataTypeRadios.forEach(r => r.addEventListener('change', () => { appState.view.dataType = r.value; renderAnalyze(); }));
  dom.smoothingCheckbox.addEventListener('change', (e) => { appState.view.smoothing = e.target.checked; recomputePhysics(); });
  dom.massReinput.addEventListener('change', (e) => {
    const v = parseFloat(e.target.value);
    if (v > 0) { appState.object.mass = v; recomputePhysics(); }
  });
  dom.analyzeSlider.addEventListener('input', (e) => {
    appState.view.currentFrame = parseInt(e.target.value, 10);
    document.dispatchEvent(new CustomEvent('app:previewFrame', { detail: { frame: appState.view.currentFrame, precise: true, forAnalyze: true } }));
  });
  dom.backToReviewBtn.addEventListener('click', () => setPhase('REVIEW'));
  dom.downloadCsvBtn.addEventListener('click', onDownloadCsv);

  dom.analyzeCanvas.addEventListener('pointerdown', onBaselinePointerDown);
  dom.analyzeCanvas.addEventListener('pointermove', onBaselinePointerMove);
  window.addEventListener('pointerup', () => { draggingBaseline = false; });
}

function buildLegend() {
  dom.legendContainer.innerHTML = LEGEND.map(l =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${l.color}"></span>${l.label}</span>`
  ).join('');
}

export function enterAnalyzePhase() {
  dom.analyzeSlider.min = appState.range.startFrame;
  dom.analyzeSlider.max = appState.range.endFrame;
  if (appState.view.currentFrame == null) appState.view.currentFrame = appState.range.startFrame;
  dom.analyzeSlider.value = appState.view.currentFrame;
  dom.massReinput.value = appState.object.mass;
  recomputePhysics();
}

function recomputePhysics() {
  physicsResult = runFullPipeline({
    trackData: appState.track.data,
    scale: appState.ruler.scale,
    analysisHeight: appState.video.analysisHeight,
    mass: appState.object.mass,
    y0Override: appState.physics.y0Override,
    smoothing: appState.view.smoothing
  });
  appState.physics.fit = physicsResult.fit;
  appState.physics.a = physicsResult.a;
  appState.physics.g = physicsResult.g;
  appState.physics.y0 = physicsResult.y0;
  appState.physics.energyAxisMax = physicsResult.energyAxisMax;

  if (physicsResult.gSanity.level !== 'ok') {
    dom.gWarningBox.hidden = false;
    dom.gWarningBox.textContent = physicsResult.gSanity.message;
    dom.gWarningBox.className = 'g-warning ' + physicsResult.gSanity.level;
    dom.theoryRadio && (dom.theoryRadio.disabled = physicsResult.gSanity.level === 'error');
  } else {
    dom.gWarningBox.hidden = true;
  }

  notify();
  renderAnalyze();
}

function onBaselinePointerDown(e) {
  const p = toAnalysisPoint(e);
  const baselineY = appState.video.analysisHeight - (appState.physics.y0 / appState.ruler.scale);
  if (Math.abs(p.y - baselineY) < 10) draggingBaseline = true;
}
function onBaselinePointerMove(e) {
  if (!draggingBaseline) return;
  const p = toAnalysisPoint(e);
  const newY0 = (appState.video.analysisHeight - p.y) * appState.ruler.scale;
  // 위로는 y0Auto에서 잠금(§12.5) — physics.js의 runFullPipeline이 최종적으로 clamp함
  appState.physics.y0Override = Math.min(newY0, physicsResult.y0Auto);
  recomputePhysics();
}
function toAnalysisPoint(e) {
  return clientToAnalysis(dom.analyzeCanvas, e.clientX, e.clientY, appState.video.analysisWidth, appState.video.analysisHeight);
}

export function setAnalyzeBitmap(bitmap) {
  appState.view._analyzeBitmap = bitmap;
  renderAnalyze();
}

export function renderAnalyze() {
  if (!physicsResult) return;
  const s = appState;
  const ctx = dom.analyzeCanvas.getContext('2d');
  drawFrame(ctx, s.view._analyzeBitmap, s.video.analysisWidth, s.video.analysisHeight);

  const frameIdx = s.view.currentFrame - s.range.startFrame;

  // 실측 궤적(전체는 옅게, 현재는 진하게) + 이론 곡선
  const measuredPoints = s.track.data.map(d => ({ px: d.px, py: d.py }));
  drawTrajectoryPoints(ctx, measuredPoints);
  const theoryPoints = physicsResult.theory.map((th, i) => physToPixel(th, s));
  drawTheoryCurve(ctx, theoryPoints);

  const y0PxFromBottom = s.physics.y0 / s.ruler.scale;
  drawBaseline(ctx, s.video.analysisHeight, y0PxFromBottom, s.video.analysisWidth);

  // 현재 프레임 강조점
  if (s.track.data[frameIdx]) {
    ctx.save();
    ctx.fillStyle = '#E23D3D';
    ctx.beginPath();
    ctx.arc(s.track.data[frameIdx].px, s.track.data[frameIdx].py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const series = s.view.dataType === 'THEORY' ? physicsResult.theory : physicsResult.real;
  const point = series[frameIdx] || series[series.length - 1];

  drawEnergyBar(dom.energyBarCanvas, point, s.view.energyType, physicsResult.energyAxisMax);
  drawEnergyLineChart(dom.energyLineCanvas, series, physicsResult.energyAxisMax, point ? point.t : null);
}

function physToPixel(p, s) {
  const px = p.x / s.ruler.scale + s.track.data[0].px;
  const py = s.video.analysisHeight - (p.yRaw / s.ruler.scale);
  return { px, py };
}

function onDownloadCsv() {
  const csv = buildCsv(appState, physicsResult);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  downloadCsv(csv, `motion_analysis_${stamp}.csv`);
}
