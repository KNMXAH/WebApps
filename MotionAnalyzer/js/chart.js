// chart.js — 외부 차트 라이브러리 없이 Canvas 2D로 직접 구현 (§13)
// 색맹 학생도 구분 가능하도록 파랑(KE)/주황(PE) 조합을 쓰고, 색상만으로 구분하지 않는다(범례 병기).

export const KE_COLOR = '#2E6FEE';
export const PE_COLOR = '#E8871E';
export const E_LINE_COLOR = '#16202A';

/**
 * §13.1~13.3 가로 막대그래프.
 * energyType: 'KE' | 'PE' | 'BOTH'
 * point: { KE, PE, E }
 * axisMax: §13.2 고정 상한(전체 구간 최대 E * 1.05), 프레임/옵션 변경에도 불변
 */
export function drawEnergyBar(canvas, point, energyType, axisMax) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!point || !axisMax) return;

  const marginLeft = 8, marginRight = 90;
  const barAreaW = w - marginLeft - marginRight;
  const barH = energyType === 'BOTH' ? 40 : 48;
  const barY = energyType === 'BOTH' ? h / 2 - barH / 2 - 14 : h / 2 - barH / 2;

  const scaleX = (val) => (val / axisMax) * barAreaW;

  function drawSegment(x0, value, color, label) {
    const segW = scaleX(value);
    ctx.fillStyle = color;
    ctx.fillRect(marginLeft + x0, barY, segW, barH);
    const text = `${value.toFixed(3)} J`;
    ctx.font = '600 13px Pretendard, sans-serif';
    const textW = ctx.measureText(text).width;
    if (textW + 10 < segW) {
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, marginLeft + x0 + segW / 2 - textW / 2, barY + barH / 2);
    } else {
      ctx.fillStyle = '#16202A';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, marginLeft + x0 + segW + 6, barY + barH / 2);
    }
    return segW;
  }

  // 축 배경
  ctx.fillStyle = '#EEF1F5';
  ctx.fillRect(marginLeft, barY, barAreaW, barH);

  if (energyType === 'KE') {
    drawSegment(0, point.KE, KE_COLOR, '운동에너지');
  } else if (energyType === 'PE') {
    drawSegment(0, point.PE, PE_COLOR, '위치에너지');
  } else {
    const keW = drawSegment(0, point.KE, KE_COLOR);
    drawSegment(keW, point.PE, PE_COLOR);
    // 역학적에너지 합계 표기
    ctx.fillStyle = '#16202A';
    ctx.font = '700 14px Pretendard, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`역학적 에너지: ${point.E.toFixed(3)} J`, marginLeft, barY + barH + 26);
  }
}

/**
 * §13.4 꺾은선 그래프: KE, PE, E 세 개 선. x축=시간, y축 상한은 막대와 동일.
 * series: [{t, KE, PE, E}], currentT: 세로 표시선 위치
 */
export function drawEnergyLineChart(canvas, series, axisMax, currentT) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!series || series.length < 2) return;

  const margin = { top: 16, right: 16, bottom: 30, left: 46 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  const tMin = series[0].t, tMax = series[series.length - 1].t;
  const xOf = (t) => margin.left + ((t - tMin) / (tMax - tMin || 1)) * plotW;
  const yOf = (v) => margin.top + plotH - (v / axisMax) * plotH;

  // 축
  ctx.strokeStyle = '#C7CFD8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  ctx.fillStyle = '#5C6B7A';
  ctx.font = '11px Pretendard, sans-serif';
  ctx.fillText('0', margin.left - 14, margin.top + plotH + 4);
  ctx.fillText(axisMax.toFixed(2) + 'J', 2, margin.top + 8);
  ctx.fillText(tMax.toFixed(2) + 's', margin.left + plotW - 24, margin.top + plotH + 20);

  function drawLine(key, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    series.forEach((p, i) => {
      const x = xOf(p.t), y = yOf(p[key]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  drawLine('KE', KE_COLOR);
  drawLine('PE', PE_COLOR);
  drawLine('E', E_LINE_COLOR);

  if (currentT != null) {
    const x = xOf(currentT);
    ctx.strokeStyle = '#8A97A6';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** 범례를 별도 DOM에 그리기 위한 텍스트/색 메타 (색상만으로 구분하지 않기 위함) */
export const LEGEND = [
  { label: '운동에너지', color: KE_COLOR },
  { label: '위치에너지', color: PE_COLOR },
  { label: '역학적에너지', color: E_LINE_COLOR }
];
