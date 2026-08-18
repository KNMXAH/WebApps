// physics.js — 물리 계산 (§12). 이 절의 규칙을 절대 임의로 바꾸지 않는다.

/** §12.2 픽셀 → 물리 좌표 변환. y축은 위로 갈 때 증가(부호 반전 필수). */
export function pixelsToPhysical(track, scale, analysisHeight) {
  const px0 = track[0].px;
  return track.map(p => ({
    frame: p.frame,
    t: p.t,
    x: (p.px - px0) * scale,
    yRaw: (analysisHeight - p.py) * scale,
    edited: !!p.edited
  }));
}

/** 최소제곱 1차 회귀: y = c0 + c1*x */
function linearFit(xs, ys) {
  const n = xs.length;
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - xMean) * (ys[i] - yMean); sxx += (xs[i] - xMean) ** 2; }
  const c1 = sxx !== 0 ? sxy / sxx : 0;
  const c0 = yMean - c1 * xMean;
  return { c0, c1 };
}

/** 최소제곱 2차 회귀: y = b0 + b1*x + b2*x^2 (정규방정식, x는 이미 중심화됨) */
function quadraticFit(xs, ys) {
  const n = xs.length;
  let S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0;
  let T0 = 0, T1 = 0, T2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    const x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
    S1 += x; S2 += x2; S3 += x3; S4 += x4;
    T0 += y; T1 += x * y; T2 += x2 * y;
  }
  // [S0 S1 S2][b0]   [T0]
  // [S1 S2 S3][b1] = [T1]
  // [S2 S3 S4][b2]   [T2]
  const A = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  const B = [T0, T1, T2];
  const sol = solve3x3(A, B);
  return { b0: sol[0], b1: sol[1], b2: sol[2] };
}

function solve3x3(A, B) {
  // 가우스 소거법
  const M = A.map((row, i) => [...row, B[i]]);
  for (let col = 0; col < 3; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivot = M[col][col] || 1e-12;
    for (let c = col; c < 4; c++) M[col][c] /= pivot;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c < 4; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

/**
 * §12.3 회귀: 시간을 중심화한 뒤 x는 1차, y는 2차로 회귀한다.
 * physical: [{t, x, yRaw}]
 */
export function fitRegression(physical) {
  const ts = physical.map(p => p.t);
  const tMean = ts.reduce((a, b) => a + b, 0) / ts.length;
  const taus = ts.map(t => t - tMean);

  const { c0, c1 } = linearFit(taus, physical.map(p => p.x));
  const { b0, b1, b2 } = quadraticFit(taus, physical.map(p => p.yRaw));

  return { c0, c1, b0, b1, b2, tMean };
}

/** §12.4 이론 데이터 생성 */
export function theoreticalSeries(physical, fit) {
  const a = 2 * fit.b2;
  const g = Math.abs(a);
  const theory = physical.map(p => {
    const tau = p.t - fit.tMean;
    const xTh = fit.c0 + fit.c1 * tau;
    const yThRaw = fit.b0 + fit.b1 * tau + fit.b2 * tau * tau;
    const vxTh = fit.c1;
    const vyTh = fit.b1 + 2 * fit.b2 * tau;
    return { frame: p.frame, t: p.t, x: xTh, yRaw: yThRaw, vx: vxTh, vy: vyTh, v: Math.hypot(vxTh, vyTh) };
  });
  return { a, g, theory };
}

/** §12.5 위치에너지 기준면(y0) — 실측·이론 최저점 중 더 낮은 쪽 */
export function computeY0(realPhysical, theoryPhysical) {
  const minReal = Math.min(...realPhysical.map(p => p.yRaw));
  const minTheory = Math.min(...theoryPhysical.map(p => p.yRaw));
  return Math.min(minReal, minTheory);
}

/** §12.6 현실 속도: 중앙차분(내부점), 전진/후진차분(끝점) */
export function centralDifferenceVelocity(physical) {
  const n = physical.length;
  const out = physical.map(p => ({ ...p }));
  for (let i = 0; i < n; i++) {
    let vx, vy;
    if (i === 0) {
      const dt = physical[1].t - physical[0].t;
      vx = (physical[1].x - physical[0].x) / dt;
      vy = (physical[1].yRaw - physical[0].yRaw) / dt;
    } else if (i === n - 1) {
      const dt = physical[n - 1].t - physical[n - 2].t;
      vx = (physical[n - 1].x - physical[n - 2].x) / dt;
      vy = (physical[n - 1].yRaw - physical[n - 2].yRaw) / dt;
    } else {
      const dt = physical[i + 1].t - physical[i - 1].t;
      vx = (physical[i + 1].x - physical[i - 1].x) / dt;
      vy = (physical[i + 1].yRaw - physical[i - 1].yRaw) / dt;
    }
    out[i].vx = vx; out[i].vy = vy; out[i].v = Math.hypot(vx, vy);
  }
  return out;
}

/** §12.6 선택적 평활화: 위치에 3점 이동평균(양 끝점은 원본 유지). 속도에는 직접 적용하지 않는다. */
export function smoothPositions(physical) {
  const n = physical.length;
  const out = physical.map(p => ({ ...p }));
  for (let i = 1; i < n - 1; i++) {
    out[i].x = (physical[i - 1].x + physical[i].x + physical[i + 1].x) / 3;
    out[i].yRaw = (physical[i - 1].yRaw + physical[i].yRaw + physical[i + 1].yRaw) / 3;
  }
  return out;
}

/** §12.7 에너지 계산. g는 반드시 §12.4에서 피팅한 |a|를 사용(9.8 하드코딩 금지). */
export function computeEnergies(series, mass, g, y0) {
  return series.map(p => {
    const h = Math.max(0, p.yRaw - y0);
    const KE = 0.5 * mass * p.v * p.v;
    const PE = mass * g * h;
    return { ...p, h, KE, PE, E: KE + PE };
  });
}

/** §12.7 g 안전장치 판정 */
export function checkGSanity(a, g) {
  if (a >= 0) return { level: 'error', code: 'A_NONNEGATIVE', message: '추적 결과가 물리적으로 이상합니다. 데이터를 다시 확인해 주세요.' };
  if (g < 1.0) return { level: 'error', code: 'NOT_FALLING', message: '이 영상은 낙하 운동으로 보이지 않습니다. 위로 던지거나 떨어뜨리는 영상을 사용해 주세요.' };
  if (g < 4.9 || g > 19.6) return { level: 'warning', code: 'OUT_OF_RANGE', message: '기준자 길이나 촬영 각도를 확인해 주세요.' };
  return { level: 'ok', code: 'OK', message: '' };
}

/**
 * §12.8 계산 순서 요약을 따르는 파이프라인.
 * appState.track.data, ruler.scale, video.analysisHeight, object.mass, y0Override(드래그 조정) 사용
 */
export function runFullPipeline({ trackData, scale, analysisHeight, mass, y0Override, smoothing }) {
  const rawPhysical = pixelsToPhysical(trackData, scale, analysisHeight);

  const fit = fitRegression(rawPhysical);
  const { a, g, theory: theoryRawSeries } = theoreticalSeries(rawPhysical, fit);

  const y0Auto = computeY0(rawPhysical, theoryRawSeries);
  const y0 = (y0Override != null && y0Override <= y0Auto) ? y0Override : y0Auto;
  // §12.5: 위로는 y0(자동 최저점)에서 잠금 → y0Override는 y0Auto보다 클 수 없다.
  const y0Effective = Math.min(y0Override != null ? y0Override : y0Auto, y0Auto);

  const positionSource = smoothing ? smoothPositions(rawPhysical) : rawPhysical;
  const realWithVelocity = centralDifferenceVelocity(positionSource);

  const gSanity = checkGSanity(a, g);

  const real = computeEnergies(realWithVelocity, mass, g, y0Effective);
  const theory = computeEnergies(theoryRawSeries, mass, g, y0Effective);

  // CSV는 평활화 여부와 무관하게 항상 원자료를 기록한다 (§12.6, §14.3)
  const rawReal = computeEnergies(centralDifferenceVelocity(rawPhysical), mass, g, y0Effective);
  const rawTheory = theory; // 이론값은 회귀식 자체가 원자료 기반이라 평활화 대상이 아님

  // §13.2: 축 상한은 전체 구간 최대 역학적에너지 * 1.05, real/theory 공통, 옵션 변경에 불변
  const maxE = Math.max(...real.map(p => p.E), ...theory.map(p => p.E));
  const energyAxisMax = maxE * 1.05;

  return {
    fit, a, g, y0: y0Effective, y0Auto,
    real, theory, energyAxisMax, gSanity,
    rawReal, rawTheory,
    rawPhysical // CSV용 비평활화 원자료 접근에 사용
  };
}
