// export.js — CSV 생성 및 다운로드(§14)
// 평활화가 켜져 있어도 CSV 에는 언제나 원자료를 기록한다.

import { computePhysics } from './physics.js';

const n6 = (v) => (v == null || !isFinite(v)) ? '' : v.toFixed(6);

function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function buildCsv(state) {
  const s = state;
  // 평활화 여부와 무관하게 원자료로 다시 계산한다
  const raw = computePhysics({
    data: s.track.data,
    scale: s.ruler.scale,
    mass: s.object.mass,
    analysisHeight: s.video.analysisHeight,
    smoothing: false,
    baselineDrop: s.view.baselineDrop
  });
  if (!raw) return null;

  const rulerPx = Math.hypot(s.ruler.p2.x - s.ruler.p1.x, s.ruler.p2.y - s.ruler.p1.y);
  const L = [];
  L.push(`# 파일명, ${s.video.file?.name || ''}`);
  L.push(`# 분석일시, ${new Date().toLocaleString('ko-KR')}`);
  L.push(`# 추정 FPS, ${s.video.estimatedFps.toFixed(2)}`);
  L.push(`# 분석 시작 프레임, ${s.range.startFrame}`);
  L.push(`# 분석 종료 프레임, ${s.range.endFrame}`);
  L.push(`# 기준자 픽셀 길이, ${rulerPx.toFixed(3)}`);
  L.push(`# 기준자 실제 길이(m), ${s.ruler.realLength}`);
  L.push(`# 픽셀 배율(m/px), ${n6(s.ruler.scale)}`);
  L.push(`# 질량(kg), ${s.object.mass}`);
  L.push(`# 회귀 계수 c0, ${n6(raw.fit.c0)}`);
  L.push(`# 회귀 계수 c1, ${n6(raw.fit.c1)}`);
  L.push(`# 회귀 계수 b0, ${n6(raw.fit.b0)}`);
  L.push(`# 회귀 계수 b1, ${n6(raw.fit.b1)}`);
  L.push(`# 회귀 계수 b2, ${n6(raw.fit.b2)}`);
  L.push(`# 회귀 기준 시간 t_bar(s) — 계수는 (t - t_bar) 기준, ${n6(raw.fit.tbar)}`);
  L.push(`# 중력가속도 g (m/s^2), ${n6(raw.g)}`);
  L.push(`# 위치에너지 기준면 y0, ${n6(raw.y0 - raw.baselineDrop)}`);
  L.push(`# 평활화 사용 여부, ${s.view.smoothing ? '켬(화면 표시용, 아래 값은 원자료)' : '끔'}`);
  L.push(`# 분석 좌표계 크기(px), ${s.video.analysisWidth}x${s.video.analysisHeight}`);
  L.push(`# 프레임 정밀도, ${s.engine === 'webcodecs' ? '정밀(WebCodecs)' : '보통(대체 경로)'}`);

  L.push([
    'frame', 't(s)',
    'x_real(m)', 'y_real(m)', 'vx_real(m/s)', 'vy_real(m/s)', 'v_real(m/s)',
    'KE_real(J)', 'PE_real(J)', 'E_real(J)',
    'x_theory(m)', 'y_theory(m)', 'vx_theory(m/s)', 'vy_theory(m/s)', 'v_theory(m/s)',
    'KE_theory(J)', 'PE_theory(J)', 'E_theory(J)',
    'edited'
  ].join(','));

  for (let i = 0; i < raw.real.length; i++) {
    const r = raw.real[i], th = raw.theory[i];
    L.push([
      r.frame, n6(r.t),
      n6(r.x), n6(r.y), n6(r.vx), n6(r.vy), n6(r.v),
      n6(r.KE), n6(r.PE), n6(r.E),
      n6(th.x), n6(th.y), n6(th.vx), n6(th.vy), n6(th.v),
      n6(th.KE), n6(th.PE), n6(th.E),
      r.edited ? 1 : 0
    ].join(','));
  }

  return '\uFEFF' + L.join('\r\n') + '\r\n';   // UTF-8 BOM 필수
}

export function downloadCsv(state) {
  const text = buildCsv(state);
  if (!text) return false;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `motion_analysis_${stamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}
