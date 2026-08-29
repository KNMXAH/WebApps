// state.js — 전역 상태 저장소 및 상태 머신 정의
// 안내 문구와 버튼 활성 여부는 반드시 이 파일의 함수에서 파생시킨다.

export const PHASE = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  FPS_CONFIRM: 'FPS_CONFIRM',
  RULER: 'RULER',
  RANGE: 'RANGE',
  INIT_POINT: 'INIT_POINT',
  TRACKING: 'TRACKING',
  TRACK_PAUSED: 'TRACK_PAUSED',
  REVIEW: 'REVIEW',
  ANALYZE: 'ANALYZE'
};

export function createState() {
  return {
    phase: PHASE.IDLE,

    engine: 'webcodecs',          // 'webcodecs' | 'fallback'
    precise: false,               // 현재 화면이 정밀 프레임인가

    video: {
      file: null, objectURL: null,
      analysisWidth: 0, analysisHeight: 0,
      frameIndex: [],
      estimatedFps: 0,
      displayFps: 0,              // 표시 전용. 계산에 절대 쓰지 않는다.
      rotation: 0,                // 0 | 90 | 180 | 270 (시계 방향)
      duration: 0,
      srcWidth: 0, srcHeight: 0
    },

    ruler: { p1: null, p2: null, realLength: 0, scale: 0 },

    range: { startFrame: 0, endFrame: 0 },

    object: { mass: 0, initPoint: null, box: { w: 0, h: 0 } },

    track: {
      data: [],                   // { frame, t, px, py, confidence, edited }
      pausedFrame: -1,
      progress: 0,
      total: 0,
      editingRow: -1              // REVIEW 단계에서 수정 중인 행 인덱스
    },

    physics: null,                // physics.js 결과 객체

    view: {
      energyType: 'PE',        // ← 여기를 'KE' | 'PE' | 'BOTH' 중 하나로
      dataType: 'THEORY',
      smoothing: false,
      baselineDrop: 0,            // m, 0 이상만 (기준면을 아래로 내린 양)
      currentFrame: 0,
      hoveredRow: -1
    },

    history: []                   // 되돌리기용 track.data 스냅샷
  };
}

/* ------------------------------------------------------------------ */
/* 안내 박스 문구 — 전부 상태에서 파생                                   */
/* ------------------------------------------------------------------ */
export function guideFor(s) {
  switch (s.phase) {
    case PHASE.IDLE:
      return '분석할 영상 파일을 골라 주세요. 떨어뜨리거나 위로 던진 물체를 옆에서 찍은 영상이 좋습니다.';
    case PHASE.LOADING:
      return '영상을 읽고 있습니다. 잠시만 기다려 주세요.';
    case PHASE.FPS_CONFIRM:
      return '이 영상이 1초에 몇 장을 담고 있는지 확인하고 넘어가세요.';
    case PHASE.RULER:
      if (!s.ruler.p1) return '영상 속에서 실제 길이를 아는 물체(자, 책상 모서리 등)의 한쪽 끝을 조준하고 확인을 누르세요.';
      if (!s.ruler.p2) return '이제 그 물체의 반대쪽 끝을 조준하고 확인을 누르세요.';
      if (!(s.ruler.realLength > 0)) return '방금 표시한 물체의 실제 길이를 미터 단위로 적어 주세요.';
      return '기준자가 설정되었습니다. 끝점을 끌어서 다시 맞출 수도 있습니다.';
    case PHASE.RANGE:
      return '분석을 시작할 프레임과 끝낼 프레임을 골라 주세요. 공이 손을 떠난 뒤부터 바닥에 닿기 전까지가 좋습니다.';
    case PHASE.INIT_POINT:
      if (!s.object.initPoint) return '공의 한가운데를 조준하고 확인을 누르세요. 그 다음 나타나는 네모의 크기를 공에 맞게 조절하세요.';
      return '네모의 모서리를 끌어 공이 딱 들어가게 맞추고, 질량을 적은 뒤 다음으로 넘어가세요.';
    case PHASE.TRACKING:
      return '공을 따라가는 중입니다. 화면에서 빨간 점이 공을 잘 따라가는지 지켜보세요.';
    case PHASE.TRACK_PAUSED:
      return '공을 놓쳤습니다. 이 화면에서 공의 한가운데를 조준하고 확인을 누르세요.';
    case PHASE.REVIEW:
      if (s.track.editingRow >= 0) return '공의 올바른 위치를 조준하고 확인을 누르세요.';
      return '표를 살펴보고 이상한 값이 있으면 연필 단추로 고치세요. 다 됐으면 분석을 시작하세요.';
    case PHASE.ANALYZE:
      return '슬라이더를 옮겨 가며 막대의 길이가 어떻게 변하는지 살펴보세요.';
    default:
      return '';
  }
}

/* ------------------------------------------------------------------ */
/* 다음 단계로 못 가는 이유 (null 이면 진행 가능) — 툴팁에 그대로 쓴다     */
/* ------------------------------------------------------------------ */
export function blockReason(s) {
  switch (s.phase) {
    case PHASE.RULER:
      if (!s.ruler.p1 || !s.ruler.p2) return '기준자의 양 끝점을 아직 찍지 않았습니다.';
      if (!(s.ruler.realLength > 0)) return '기준자의 실제 길이를 적어 주세요.';
      return null;
    case PHASE.RANGE: {
      const { startFrame, endFrame } = s.range;
      if (startFrame >= endFrame) return '분석 시작이 분석 종료보다 앞서야 합니다.';
      if (endFrame - startFrame + 1 < 5) return '분석하려면 최소 5프레임 이상 필요합니다.';
      return null;
    }
    case PHASE.INIT_POINT:
      if (!(s.object.mass > 0)) return '물체의 질량을 적어 주세요.';
      if (!s.object.initPoint) return '공의 한가운데를 아직 찍지 않았습니다.';
      return null;
    case PHASE.REVIEW:
      if (s.track.data.length < 5) return '데이터가 5개보다 적어 분석할 수 없습니다.';
      return null;
    default:
      return null;
  }
}

/* 아주 작은 구독 시스템 */
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(s) { for (const fn of listeners) fn(s); }
export function setPhase(s, phase) { s.phase = phase; emit(s); }
