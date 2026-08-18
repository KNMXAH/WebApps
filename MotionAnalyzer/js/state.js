// state.js — 전역 상태 저장소 및 상태 머신 정의
// 이 파일은 앱의 "유일한 진실 공급원(single source of truth)"이다.
// 화면의 안내 문구/버튼 활성 여부는 모두 여기서 파생된다.

export const PHASES = [
  'IDLE', 'LOADING', 'FPS_CONFIRM', 'RULER', 'RANGE',
  'INIT_POINT', 'TRACKING', 'TRACK_PAUSED', 'REVIEW', 'ANALYZE'
];

function freshState() {
  return {
    phase: 'IDLE',

    video: {
      file: null,
      objectURL: null,
      analysisWidth: 0,
      analysisHeight: 0,
      originalWidth: 0,
      originalHeight: 0,
      frameIndex: [],       // [{index, cts, timescale, t, isKey}]
      estimatedFps: null,
      codecInfo: null,
      durationSec: 0
    },

    loading: {
      message: '',
      progress: null        // 0~100 또는 null(불확정)
    },

    ruler: { p1: null, p2: null, realLength: null, scale: null, pxLength: null },

    range: { startFrame: null, endFrame: null },

    object: {
      mass: null,
      initPoint: null,
      box: { w: 0, h: 0 }
    },

    track: {
      data: [],              // [{frame, t, px, py, confidence, edited}]
      template: null,
      progress: { current: 0, total: 0 },
      pausedFrame: null
    },

    physics: {
      fit: null,             // {c0,c1,b0,b1,b2, tMean}
      a: null, g: null, y0: null, y0Auto: null,
      real: [], theory: [],
      energyAxisMax: null
    },

    view: {
      energyType: 'BOTH',    // 'KE' | 'PE' | 'BOTH'
      dataType: 'REAL',      // 'THEORY' | 'REAL'
      smoothing: false,
      currentFrame: null,
      hoveredRow: null,
      editingRow: null
    },

    cache: {
      bitmaps: new Map(),    // frameIndex -> ImageBitmap
      capMax: 400
    },

    history: []               // 되돌리기용 스냅샷 스택
  };
}

export const appState = freshState();

// ---- 구독(pub/sub) ----
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let notifyScheduled = false;
export function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const fn of listeners) fn(appState);
  });
}

// ---- 상태 전이 ----
export function setPhase(next) {
  if (!PHASES.includes(next)) throw new Error(`알 수 없는 상태: ${next}`);
  appState.phase = next;
  notify();
}

export function resetToIdle() {
  // 캐시된 프레임 해제
  for (const bmp of appState.cache.bitmaps.values()) {
    try { bmp.close(); } catch (e) { /* noop */ }
  }
  if (appState.video.objectURL) {
    try { URL.revokeObjectURL(appState.video.objectURL); } catch (e) { /* noop */ }
  }
  const fresh = freshState();
  Object.keys(appState).forEach(k => delete appState[k]);
  Object.assign(appState, fresh);
  notify();
}

// ---- 안내 박스 문구 (상태에서 파생, 하드코딩 분산 금지) ----
export function guidanceText() {
  const s = appState;
  switch (s.phase) {
    case 'IDLE':
      return '분석할 영상을 업로드하세요. 영상은 서버로 전송되지 않고, 이 기기 안에서만 처리됩니다.';
    case 'LOADING':
      return s.loading.message || '영상을 준비하고 있습니다. 잠시만 기다려 주세요.';
    case 'FPS_CONFIRM':
      return `이 영상은 약 ${s.video.estimatedFps != null ? s.video.estimatedFps.toFixed(2) : '?'} 프레임/초입니다. 확인을 누르면 다음 단계로 진행합니다.`;
    case 'RULER':
      if (!s.ruler.p1) return '영상 속에서 실제 길이를 아는 물체(자, 책상 모서리 등)의 한쪽 끝을 클릭하세요.';
      if (!s.ruler.p2) return '이제 반대쪽 끝을 클릭하세요.';
      return '실제 길이를 미터(m) 단위로 입력하세요. 필요하면 끝점을 드래그해 다시 맞출 수 있습니다.';
    case 'RANGE':
      return '분석을 시작할 프레임과 끝낼 프레임을 슬라이더로 선택하세요.';
    case 'INIT_POINT':
      if (!s.object.mass) return '물체의 질량을 kg 단위로 입력하세요. 그램(g)이라면 1000으로 나누어 입력합니다.';
      if (!s.object.initPoint) return '공의 한가운데를 클릭하세요.';
      return '나타난 네모의 크기와 위치를 공에 맞게 조절한 뒤 다음으로 진행하세요.';
    case 'TRACKING':
      return '공을 자동으로 추적하고 있습니다. 잠시만 기다려 주세요.';
    case 'TRACK_PAUSED':
      return '공을 놓쳤습니다. 이 화면에서 공의 한가운데를 클릭해 주세요.';
    case 'REVIEW':
      return '추적된 데이터를 확인하세요. 잘못된 위치가 있다면 ✏️ 버튼으로 수정할 수 있습니다.';
    case 'ANALYZE':
      return '운동에너지, 위치에너지, 역학적에너지의 변화를 확인해 보세요.';
    default:
      return '';
  }
}

// ---- 다음 단계 진입 가능 여부 ----
export function canAdvance() {
  const s = appState;
  switch (s.phase) {
    case 'IDLE': return !!s.video.file;
    case 'LOADING': return s.video.frameIndex.length > 0;
    case 'FPS_CONFIRM': return true;
    case 'RULER': return !!(s.ruler.p1 && s.ruler.p2 && s.ruler.realLength > 0);
    case 'RANGE': return s.range.startFrame != null && s.range.endFrame != null &&
      s.range.startFrame < s.range.endFrame &&
      (s.range.endFrame - s.range.startFrame + 1) >= 5;
    case 'INIT_POINT': return !!(s.object.mass > 0 && s.object.initPoint);
    case 'TRACKING': return s.track.data.length > 0 &&
      s.track.progress.current >= s.track.progress.total;
    case 'TRACK_PAUSED': return false;
    case 'REVIEW': return s.track.data.length > 0;
    case 'ANALYZE': return true;
    default: return false;
  }
}

export function pushHistory() {
  s_clone_push(appState.track.data);
}
function s_clone_push(data) {
  appState.history.push(JSON.parse(JSON.stringify(data)));
  if (appState.history.length > 20) appState.history.shift();
}
export function undoHistory() {
  const prev = appState.history.pop();
  if (prev) {
    appState.track.data = prev;
    notify();
    return true;
  }
  return false;
}
