// canvas.js — 캔버스 렌더링과 좌표 변환을 한 곳에서만 처리한다 (§5.2)
// 분석 좌표계(Analysis Space)가 앱 전체의 유일한 픽셀 좌표계다.

/**
 * 클라이언트 좌표(clientX/Y) → 분석 좌표계 좌표로 변환하는 유일한 유틸.
 * devicePixelRatio가 개입해도 이 변환 하나로 일관되게 처리된다.
 */
export function clientToAnalysis(canvas, clientX, clientY, analysisWidth, analysisHeight) {
  const rect = canvas.getBoundingClientRect();
  const ax = (clientX - rect.left) * (analysisWidth / rect.width);
  const ay = (clientY - rect.top) * (analysisHeight / rect.height);
  return { x: ax, y: ay };
}

/** 분석 좌표 → 캔버스 CSS 좌표(그리기용, 캔버스 내부 해상도 = 분석 좌표계라고 가정) */
export function setupCanvasForAnalysisSpace(canvas, analysisWidth, analysisHeight) {
  canvas.width = analysisWidth;
  canvas.height = analysisHeight;
}

const COLORS = {
  measured: '#E23D3D',      // 빨간 점 = 실제 측정
  measuredTrail: 'rgba(226,61,61,0.35)',
  theory: '#2E6FEE',        // 파란 선 = 이론
  ruler: '#2E6FEE',
  baseline: '#8A97A6',
  trackBox: '#1E9E75',
  highlight: '#F5C34D'
};

export function drawFrame(ctx, bitmap, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (bitmap) ctx.drawImage(bitmap, 0, 0, w, h);
}

export function drawRuler(ctx, p1, p2, tempPoint) {
  ctx.save();
  ctx.strokeStyle = COLORS.ruler;
  ctx.lineWidth = 2;
  ctx.setLineDash(p2 ? [] : [6, 4]);
  ctx.beginPath();
  if (p1) {
    ctx.moveTo(p1.x, p1.y);
    const end = p2 || tempPoint;
    if (end) ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  [p1, p2].forEach(p => {
    if (!p) return;
    ctx.fillStyle = COLORS.ruler;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  ctx.restore();
}

export function drawTrackBox(ctx, cx, cy, w, h) {
  ctx.save();
  ctx.strokeStyle = COLORS.trackBox;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  // 모서리 핸들
  ctx.fillStyle = COLORS.trackBox;
  const handles = [
    [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2],
    [cx - w / 2, cy + h / 2], [cx + w / 2, cy + h / 2]
  ];
  handles.forEach(([hx, hy]) => {
    ctx.fillRect(hx - 5, hy - 5, 10, 10);
  });
  ctx.restore();
}

export function drawTrajectoryPoints(ctx, points, { highlightIndex, currentOnly } = {}) {
  ctx.save();
  points.forEach((p, i) => {
    const isCurrent = currentOnly ? i === points.length - 1 : false;
    ctx.fillStyle = (highlightIndex === i) ? COLORS.highlight : (isCurrent ? COLORS.measured : COLORS.measuredTrail);
    const r = (highlightIndex === i) ? 7 : (isCurrent ? 6 : 3);
    ctx.beginPath();
    ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
    ctx.fill();
    if (highlightIndex === i) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
  ctx.restore();
}

export function drawTheoryCurve(ctx, points) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = COLORS.theory;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.px, p.py) : ctx.lineTo(p.px, p.py); });
  ctx.stroke();
  ctx.restore();
}

export function drawBaseline(ctx, canvasHeight, y0PxFromBottom, width) {
  ctx.save();
  ctx.strokeStyle = COLORS.baseline;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  const yCanvas = canvasHeight - y0PxFromBottom;
  ctx.beginPath();
  ctx.moveTo(0, yCanvas);
  ctx.lineTo(width, yCanvas);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.baseline;
  ctx.font = '12px Pretendard, sans-serif';
  ctx.fillText('위치에너지 기준면 (드래그로 아래로 조정 가능)', 8, yCanvas - 6);
  ctx.restore();
}

/**
 * 돋보기(loupe) — 클릭 지점 주변을 확대. 터치 시 손가락 반대편(위쪽)에 배치.
 */
export function drawLoupe(destCtx, sourceCanvas, centerX, centerY, opts = {}) {
  const { zoom = 3.5, size = 120, placeAbove = true, destCanvas } = opts;
  const w = destCanvas.width, h = destCanvas.height;
  let lx = centerX - size / 2;
  let ly = placeAbove ? centerY - size - 40 : centerY + 40;
  lx = Math.max(4, Math.min(w - size - 4, lx));
  ly = Math.max(4, Math.min(h - size - 4, ly));

  destCtx.save();
  destCtx.beginPath();
  destCtx.rect(lx, ly, size, size);
  destCtx.clip();
  destCtx.fillStyle = '#000';
  destCtx.fillRect(lx, ly, size, size);
  destCtx.drawImage(
    sourceCanvas,
    centerX - size / (2 * zoom), centerY - size / (2 * zoom), size / zoom, size / zoom,
    lx, ly, size, size
  );
  destCtx.restore();

  destCtx.save();
  destCtx.strokeStyle = '#fff';
  destCtx.lineWidth = 2;
  destCtx.strokeRect(lx, ly, size, size);
  // 중앙 십자선
  destCtx.strokeStyle = COLORS.measured;
  destCtx.beginPath();
  destCtx.moveTo(lx + size / 2 - 8, ly + size / 2);
  destCtx.lineTo(lx + size / 2 + 8, ly + size / 2);
  destCtx.moveTo(lx + size / 2, ly + size / 2 - 8);
  destCtx.lineTo(lx + size / 2, ly + size / 2 + 8);
  destCtx.stroke();
  destCtx.restore();
}
