// framecache.js — 분석 구간 확정 이후 그 구간만 캐싱 (§5.3)
// VideoFrame은 GC로 회수되지 않으므로 ImageBitmap 생성 직후 반드시 close() 한다.

/**
 * navigator.deviceMemory와 기기 종류(터치 여부)를 참고해 캐시 상한(프레임 수)을 정한다.
 * 기본 상한 400. 태블릿(터치 기기)은 PC의 60%.
 */
export function decideCacheCap(isTouchDevice) {
  const base = 400;
  let cap = base;
  if (typeof navigator !== 'undefined' && navigator.deviceMemory) {
    // deviceMemory: 0.25~8(GB 근사치). 4GB 미만이면 보수적으로.
    if (navigator.deviceMemory < 4) cap = Math.round(base * 0.5);
  }
  if (isTouchDevice) cap = Math.round(cap * 0.6);
  return Math.max(30, cap);
}

/**
 * VideoFrame → 분석 좌표계 크기의 ImageBitmap 변환.
 * frame은 이 함수 호출 후 close() 되어야 한다(호출자 책임 또는 여기서 처리).
 */
export async function frameToAnalysisBitmap(frame, analysisWidth, analysisHeight) {
  const bmp = await createImageBitmap(frame, {
    resizeWidth: analysisWidth,
    resizeHeight: analysisHeight,
    resizeQuality: 'high'
  });
  return bmp;
}

/**
 * 캐시 Map을 관리하는 얇은 컨트롤러.
 * capMax 초과 시 호출자가 해상도를 낮춰 재시도하도록 overflow 콜백을 제공한다.
 */
export class FrameCache {
  constructor(capMax) {
    this.map = new Map();     // frameIndexNum -> ImageBitmap
    this.capMax = capMax;
  }
  set(idx, bitmap) {
    if (this.map.size >= this.capMax && !this.map.has(idx)) {
      throw new FrameCacheOverflowError(`캐시 상한(${this.capMax}프레임) 초과`);
    }
    this.map.set(idx, bitmap);
  }
  get(idx) { return this.map.get(idx); }
  has(idx) { return this.map.has(idx); }
  clear() {
    for (const bmp of this.map.values()) {
      try { bmp.close(); } catch (e) { /* noop */ }
    }
    this.map.clear();
  }
  get size() { return this.map.size; }
}

export class FrameCacheOverflowError extends Error {}

/** 메모리 부족/상한 초과 시 분석 좌표계 가로를 단계적으로 낮춘다: 원본 → 960 → 720 */
export function nextFallbackWidth(currentWidth) {
  if (currentWidth > 960) return 960;
  if (currentWidth > 720) return 720;
  return null; // 더 낮출 수 없음 → 사용자에게 구간 축소 요청
}
