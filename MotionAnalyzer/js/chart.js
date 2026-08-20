// chart.js — 에너지 막대그래프, 꺾은선 그래프 (외부 라이브러리 없음)
// 색은 색맹 학생도 구분 가능한 파랑/주황 조합. 빨강-초록은 쓰지 않는다(§13.5).

export const COLOR = {
  KE: '#4da3ff',
  PE: '#ff8a3d',
  E: '#e8edf6',
  grid: '#2c3850',
  text: '#9fb0c9',
  bright: '#e8edf6'
};

const FONT = '13px system-ui, -apple-system, sans-serif';

function prepare(canvas, cssHeight) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssWidth = canvas.clientWidth || canvas.width;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return { ctx, w: cssWidth, h: cssHeight };
}

const fmt = (v) => v.toFixed(3) + ' J';

/**
 * 가로 막대그래프. 가로축이 에너지, 세로축에는 의미가 없다(§13.1).
 * @param {Object} o {energyType:'KE'|'PE'|'BOTH', KE, PE, axisMax, label}
 */
export function drawBars(canvas, o) {
  const H = o.energyType === 'BOTH' ? 150 : 120;
  const { ctx, w, h } = prepare(canvas, H);
  const padL = 12, padR = 12, padT = 26;
  const barH = 46;
  const plotW = w - padL - padR;
  const max = o.axisMax > 0 ? o.axisMax : 1;
  const toW = (v) => Math.max(0, Math.min(v / max, 1)) * plotW;

  ctx.font = FONT;
  ctx.fillStyle = COLOR.text;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(o.label || '', padL, 16);

  // 축 배경
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fillRect(padL, padT, plotW, barH);

  const segs = [];
  if (o.energyType === 'KE') segs.push({ v: o.KE, c: COLOR.KE, name: '운동' });
  else if (o.energyType === 'PE') segs.push({ v: o.PE, c: COLOR.PE, name: '위치' });
  else { segs.push({ v: o.KE, c: COLOR.KE, name: '운동' }); segs.push({ v: o.PE, c: COLOR.PE, name: '위치' }); }

  let x = padL;
  for (const s of segs) {
    const bw = toW(s.v);
    ctx.fillStyle = s.c;
    ctx.fillRect(x, padT, bw, barH);

    const text = fmt(s.v);
    const tw = ctx.measureText(text).width;
    ctx.textBaseline = 'middle';
    if (bw > tw + 16) {                       // 막대 안에 넣을 수 있을 때
      ctx.fillStyle = '#08131f';
      ctx.fillText(text, x + 8, padT + barH / 2);
    } else {                                   // 짧으면 바깥 오른쪽에
      ctx.fillStyle = s.c;
      ctx.fillText(text, Math.min(x + bw + 6, w - tw - 4), padT + barH / 2);
    }
    x += bw;
  }

  // 축 눈금 (0 과 상한)
  ctx.strokeStyle = COLOR.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT + barH + 1); ctx.lineTo(padL + plotW, padT + barH + 1); ctx.stroke();
  ctx.fillStyle = COLOR.text; ctx.textBaseline = 'top';
  ctx.fillText('0', padL, padT + barH + 6);
  const maxLabel = max.toFixed(3) + ' J';
  ctx.fillText(maxLabel, padL + plotW - ctx.measureText(maxLabel).width, padT + barH + 6);

  if (o.energyType === 'BOTH') {
    ctx.fillStyle = COLOR.bright;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('역학적 에너지: ' + fmt(o.KE + o.PE), padL, padT + barH + 26);
  }
}

/**
 * 시간-에너지 꺾은선. 세로축 상한은 막대그래프와 같은 값을 쓴다(§13.4).
 * @param {Object} o {rows:[{t,KE,PE,E}], axisMax, currentIndex}
 */
export function drawLines(canvas, o) {
  const { ctx, w, h } = prepare(canvas, 260);
  const padL = 48, padR = 14, padT = 14, padB = 34;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const rows = o.rows || [];
  if (rows.length < 2) return;

  const tMin = rows[0].t, tMax = rows[rows.length - 1].t;
  const span = Math.max(tMax - tMin, 1e-6);
  const max = o.axisMax > 0 ? o.axisMax : 1;
  const X = (t) => padL + (t - tMin) / span * plotW;
  const Y = (v) => padT + plotH - Math.max(0, Math.min(v / max, 1)) * plotH;

  ctx.font = FONT;

  // 눈금
  ctx.strokeStyle = COLOR.grid; ctx.lineWidth = 1; ctx.fillStyle = COLOR.text;
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4, y = Y(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    const lab = v.toFixed(2);
    ctx.fillText(lab, padL - 8 - ctx.measureText(lab).width, y);
  }
  ctx.textBaseline = 'top';
  ctx.fillText(tMin.toFixed(2) + ' 초', padL, padT + plotH + 8);
  const tl = tMax.toFixed(2) + ' 초';
  ctx.fillText(tl, padL + plotW - ctx.measureText(tl).width, padT + plotH + 8);

  const line = (key, color, width) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    rows.forEach((r, i) => { const x = X(r.t), y = Y(r[key]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  };
  line('KE', COLOR.KE, 2);
  line('PE', COLOR.PE, 2);
  line('E', COLOR.E, 2.5);

  // 현재 프레임 세로 표시선
  const ci = o.currentIndex;
  if (ci >= 0 && ci < rows.length) {
    const x = X(rows[ci].t);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    ctx.setLineDash([]);
    for (const [key, color] of [['KE', COLOR.KE], ['PE', COLOR.PE], ['E', COLOR.E]]) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, Y(rows[ci][key]), 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}
