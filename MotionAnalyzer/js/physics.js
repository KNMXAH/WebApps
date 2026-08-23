// physics.js — §12 의 정의를 그대로 구현한다.
// 규칙: Δt 는 언제나 실제 타임스탬프 차이, y 는 위쪽이 +, g 는 피팅에서 얻은 |a|.

/** 작은 정방 연립방정식 해법 (부분 피벗 가우스 소거) */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

/** 3점 이동평균. 양 끝점은 원본 유지(§12.6) */
function movingAverage3(arr) {
  if (arr.length < 3) return arr.slice();
  const out = arr.slice();
  for (let i = 1; i < arr.length - 1; i++) out[i] = (arr[i - 1] + arr[i] + arr[i + 1]) / 3;
  return out;
}

/**
 * 세 점 (t0,f0), (t1,f1), (t2,f2) 를 지나는 2차식의 at 지점 미분값.
 * 프레임 간격이 일정하지 않아도 정확하다(VFR 대응).
 */
function lagrangeDeriv3(t0, t1, t2, f0, f1, f2, at) {
  const d01 = t0 - t1, d02 = t0 - t2, d12 = t1 - t2;
  if (Math.abs(d01) < 1e-12 || Math.abs(d02) < 1e-12 || Math.abs(d12) < 1e-12) return 0;
  return f0 * ((at - t1) + (at - t2)) / (d01 * d02)
    + f1 * ((at - t0) + (at - t2)) / (-d01 * d12)
    + f2 * ((at - t0) + (at - t1)) / (d02 * d12);
}

/**
 * 속도 계산.
 * 내부 점은 중앙차분, 양 끝은 3점 한쪽차분을 쓴다.
 *
 * 단순 전진차분 (x1-x0)/(t1-t0) 은 구간 '중앙'의 속도를 주므로
 * 0.5·a·dt 만큼 구조적으로 어긋난다. 잡음이 전혀 없는 데이터에서도
 * 양 끝 프레임의 역학적에너지가 몇 퍼센트씩 낮게 나와,
 * 공기저항과 무관한 인공적인 꺾임이 그래프 양 끝에 생긴다.
 * 3점 한쪽차분은 내부 점(중앙차분)과 같은 2차 정확도를 가지며,
 * 평활화가 아니라 여전히 원자료만 쓰는 차분이다.
 */
function centralDiff(vals, t) {
  const n = vals.length;
  const out = new Array(n).fill(0);
  if (n < 2) return out;
  if (n === 2) {
    const v = (vals[1] - vals[0]) / (t[1] - t[0]);
    return [v, v];
  }
  for (let i = 1; i < n - 1; i++) {
    out[i] = (vals[i + 1] - vals[i - 1]) / (t[i + 1] - t[i - 1]);
  }
  out[0] = lagrangeDeriv3(t[0], t[1], t[2], vals[0], vals[1], vals[2], t[0]);
  out[n - 1] = lagrangeDeriv3(t[n - 3], t[n - 2], t[n - 1],
    vals[n - 3], vals[n - 2], vals[n - 1], t[n - 1]);
  return out;
}

/**
 * @param {Object} p
 * @param {Array} p.data            [{frame, t, px, py, edited}] — t 는 영상 절대 시간(초)
 * @param {number} p.scale          m/px
 * @param {number} p.mass           kg
 * @param {number} p.analysisHeight 분석 좌표계 세로 픽셀 수
 * @param {boolean} p.smoothing     화면 표시용 평활화 여부
 * @param {number} p.baselineDrop   기준면을 자동 최저점보다 얼마나 더 내렸는지 (m, 0 이상)
 */
export function computePhysics({ data, scale, mass, analysisHeight, smoothing = false, baselineDrop = 0 }) {
  const N = data.length;
  if (N < 3 || !(scale > 0) || !(mass > 0)) return null;

  // 1. 상대 시간 (분석 시작 프레임이 0초)
  const t0 = data[0].t;
  const t = data.map(d => d.t - t0);

  // 2. 픽셀 → 물리 좌표 (y 는 위쪽이 +)
  const px0 = data[0].px;
  const xRawArr = data.map(d => (d.px - px0) * scale);
  const yRawArr = data.map(d => (analysisHeight - d.py) * scale);

  // 3. 회귀는 언제나 원자료로 한다 (평활화는 화면 표시용)
  const tbar = t.reduce((a, b) => a + b, 0) / N;
  const tau = t.map(v => v - tbar);

  // x = c0 + c1·τ  (τ 의 합이 0 이므로 해가 단순해진다)
  let S2 = 0, S3 = 0, S4 = 0, Sx = 0, Stx = 0, Sy = 0, Sty = 0, St2y = 0;
  for (let i = 0; i < N; i++) {
    const q = tau[i], q2 = q * q;
    S2 += q2; S3 += q2 * q; S4 += q2 * q2;
    Sx += xRawArr[i]; Stx += q * xRawArr[i];
    Sy += yRawArr[i]; Sty += q * yRawArr[i]; St2y += q2 * yRawArr[i];
  }
  const c0 = Sx / N;
  const c1 = S2 > 1e-18 ? Stx / S2 : 0;

  // y = b0 + b1·τ + b2·τ²
  const sol = solve([[N, 0, S2], [0, S2, S3], [S2, S3, S4]], [Sy, Sty, St2y]);
  if (!sol) return null;
  const [b0, b1, b2] = sol;

  // 4. 가속도와 중력가속도 — 9.8 을 쓰지 않는다
  const a = 2 * b2;
  const g = Math.abs(a);

  // 5. 이론 위치·속도
  const xTh = tau.map(q => c0 + c1 * q);
  const yThRaw = tau.map(q => b0 + b1 * q + b2 * q * q);
  const vxTh = tau.map(() => c1);
  const vyTh = tau.map(q => b1 + 2 * b2 * q);

  // 6. 현실 위치 (평활화 옵션은 위치에만 적용)
  const xArr = smoothing ? movingAverage3(xRawArr) : xRawArr.slice();
  const yArr = smoothing ? movingAverage3(yRawArr) : yRawArr.slice();

  // 7. 기준면: 실측과 이론 최저점 중 더 낮은 쪽 (음수 방지)
  const y0 = Math.min(Math.min(...yArr), Math.min(...yThRaw));
  const drop = Math.max(0, baselineDrop);
  const h = yArr.map(v => v - y0 + drop);
  const hTh = yThRaw.map(v => v - y0 + drop);

  // 8. 현실 속도 — 중앙차분
  const vx = centralDiff(xArr, t);
  const vy = centralDiff(yArr, t);

  // 9. 에너지 — 이론과 현실이 같은 g 를 쓴다
  const real = [], theory = [];
  for (let i = 0; i < N; i++) {
    const vR = Math.hypot(vx[i], vy[i]);
    const KEr = 0.5 * mass * vR * vR;
    const PEr = mass * g * h[i];
    real.push({
      frame: data[i].frame, t: t[i],
      x: xArr[i], y: h[i], vx: vx[i], vy: vy[i], v: vR,
      KE: KEr, PE: PEr, E: KEr + PEr,
      edited: !!data[i].edited
    });

    const vT = Math.hypot(vxTh[i], vyTh[i]);
    const KEt = 0.5 * mass * vT * vT;
    const PEt = mass * g * hTh[i];
    theory.push({
      frame: data[i].frame, t: t[i],
      x: xTh[i], y: hTh[i], vx: vxTh[i], vy: vyTh[i], v: vT,
      KE: KEt, PE: PEt, E: KEt + PEt
    });
  }

  // 10. 막대 축 상한 — 전체 구간 최대 역학적에너지로 고정
  let maxE = 0;
  for (let i = 0; i < N; i++) maxE = Math.max(maxE, real[i].E, theory[i].E);
  const energyAxisMax = maxE > 0 ? maxE * 1.05 : 1;

  return {
    fit: { c0, c1, b0, b1, b2, tbar },
    a, g, y0, baselineDrop: drop,
    real, theory, energyAxisMax,
    warning: gWarning(a, g),
    theoryUsable: a < 0
  };
}

/** §12.7 g 안전장치. 정상 범위에서는 아무 말도 하지 않는다. */
function gWarning(a, g) {
  if (a >= 0) return { level: 'error', text: '추적 결과가 물리적으로 이상합니다. 데이터를 다시 확인해 주세요.' };
  if (g < 1.0) return { level: 'error', text: '이 영상은 낙하 운동으로 보이지 않습니다. 위로 던지거나 떨어뜨리는 영상을 사용해 주세요.' };
  if (g < 4.9 || g > 19.6) return { level: 'warn', text: '기준자 길이나 촬영 각도를 확인해 주세요.' };
  return null;
}

/** 이론 궤적을 촘촘히 뽑아 캔버스에 곡선으로 그릴 때 쓴다(§11.1). */
export function theoryCurvePixels(phys, data, scale, analysisHeight, steps = 120) {
  if (!phys || !data.length) return [];
  const { c0, c1, b0, b1, b2, tbar } = phys.fit;
  const t0 = data[0].t;
  const tStart = data[0].t - t0, tEnd = data[data.length - 1].t - t0;
  const px0 = data[0].px;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const tt = tStart + (tEnd - tStart) * (i / steps);
    const q = tt - tbar;
    const x = c0 + c1 * q;
    const yRaw = b0 + b1 * q + b2 * q * q;
    pts.push({ px: x / scale + px0, py: analysisHeight - yRaw / scale });
  }
  return pts;
}

/** 기준면(y=0)의 화면 픽셀 y 좌표 */
export function baselinePixelY(phys, scale, analysisHeight) {
  if (!phys) return null;
  const yLine = phys.y0 - phys.baselineDrop;   // 물리 좌표(임시 원점 기준)
  return analysisHeight - yLine / scale;
}