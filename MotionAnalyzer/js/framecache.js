// framecache.js — 분석 구간의 ImageBitmap 캐시와 메모리 관리(§5.3)

const BASE_LIMIT = 400;

/** 기기 사정에 맞춘 캐시 상한 프레임 수 */
export function cacheLimit() {
  const mem = navigator.deviceMemory || 4;              // GB, 없으면 4로 가정
  const touch = matchMedia('(pointer: coarse)').matches; // 태블릿/폰
  let limit = Math.round(BASE_LIMIT * Math.min(mem / 4, 2));
  if (touch) limit = Math.round(limit * 0.6);           // 태블릿은 보수적으로
  return Math.max(60, Math.min(limit, 900));
}

/** 원본 가로 → 분석 좌표계 크기(§5.2). 재시도 단계마다 폭을 낮춘다. */
export function analysisSize(srcW, srcH, attempt = 0) {
  const widths = [1280, 960, 720];
  const target = Math.min(srcW, widths[Math.min(attempt, widths.length - 1)]);
  const w = Math.max(160, Math.round(target / 2) * 2);
  const h = Math.max(120, Math.round((srcH * (w / srcW)) / 2) * 2);
  return { width: w, height: h };
}

export class FrameCache {
  constructor() { this.bitmaps = new Map(); }

  set(frame, bitmap) {
    const old = this.bitmaps.get(frame);
    if (old && old !== bitmap) { try { old.close(); } catch { } }
    this.bitmaps.set(frame, bitmap);
  }

  get(frame) { return this.bitmaps.get(frame) || null; }
  has(frame) { return this.bitmaps.has(frame); }
  get size() { return this.bitmaps.size; }

  clear() {
    for (const [, b] of this.bitmaps) { try { b.close(); } catch { } }
    this.bitmaps.clear();
  }
}
