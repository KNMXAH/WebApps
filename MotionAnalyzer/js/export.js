// export.js — CSV 내보내기 (§14). UTF-8 BOM 필수, 실측/이론을 한 파일에 나란히 배치.

function fmt(n, digits = 6) {
  return (n === null || n === undefined || Number.isNaN(n)) ? '' : n.toFixed(digits);
}

export function buildCsv(appState, physics) {
  const { video, ruler, range, object, view } = appState;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;

  const meta = [
    `# 파일명, 분석일시: motion_analysis_${stamp}.csv, ${now.toISOString()}`,
    `# 추정 FPS, 분석 시작 프레임, 분석 종료 프레임: ${fmt(video.estimatedFps, 2)}, ${range.startFrame}, ${range.endFrame}`,
    `# 기준자 픽셀 길이, 기준자 실제 길이(m), 픽셀 배율(m/px): ${fmt(ruler.pxLength, 3)}, ${fmt(ruler.realLength, 4)}, ${fmt(ruler.scale, 8)}`,
    `# 질량(kg): ${fmt(object.mass, 4)}`,
    `# 회귀 계수 c0, c1, b0, b1, b2: ${fmt(physics.fit.c0)}, ${fmt(physics.fit.c1)}, ${fmt(physics.fit.b0)}, ${fmt(physics.fit.b1)}, ${fmt(physics.fit.b2)}`,
    `# 중력가속도 g (m/s^2): ${fmt(physics.g, 4)}`,
    `# 위치에너지 기준면 y0: ${fmt(physics.y0, 4)}`,
    `# 평활화 사용 여부: ${view.smoothing ? 1 : 0}`
  ];

  const header = [
    'frame', 't(s)',
    'x_real(m)', 'y_real(m)', 'vx_real(m/s)', 'vy_real(m/s)', 'v_real(m/s)',
    'KE_real(J)', 'PE_real(J)', 'E_real(J)',
    'x_theory(m)', 'y_theory(m)', 'vx_theory(m/s)', 'vy_theory(m/s)', 'v_theory(m/s)',
    'KE_theory(J)', 'PE_theory(J)', 'E_theory(J)',
    'edited'
  ].join(',');

  // 평활화가 켜져 있어도 CSV는 항상 원자료(rawPhysical 기반 재계산) 사용
  const rows = physics.rawReal.map((r, i) => {
    const th = physics.rawTheory[i];
    return [
      r.frame, fmt(r.t, 6),
      fmt(r.x), fmt(r.h), fmt(r.vx), fmt(r.vy), fmt(r.v),
      fmt(r.KE), fmt(r.PE), fmt(r.E),
      fmt(th.x), fmt(th.h), fmt(th.vx), fmt(th.vy), fmt(th.v),
      fmt(th.KE), fmt(th.PE), fmt(th.E),
      r.edited ? 1 : 0
    ].join(',');
  });

  const csvBody = [meta.join('\n'), header, ...rows].join('\n');
  return '\uFEFF' + csvBody;
}

export function downloadCsv(csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
