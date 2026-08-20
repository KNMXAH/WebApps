// tracker.js — 공 추적 알고리즘
// ① 등가속도 외삽으로 위치 예측 → ② NCC 템플릿 매칭 → ③ 색 유사도 가중 무게중심으로 서브픽셀 정밀화
// OpenCV.js 는 쓰지 않는다(§9.1).

/** 실제 영상으로 튜닝해야 하는 값은 전부 여기 모아 둔다(§9.2). */
export const TRACK_CONST = {
  CONFIDENCE_THRESHOLD: 0.60,   // NCC 신뢰도 하한. 미만이면 즉시 정지.
  SEARCH_BOX_FACTOR: 0.8,       // 탐색 반경 = max(박스크기 × 이 값, 직전 이동거리 × 아래 값)
  SEARCH_MOVE_FACTOR: 1.5,
  SEARCH_MIN: 14,               // 탐색 반경 하한(px, 분석 좌표계)
  SEARCH_MAX: 140,              // 탐색 반경 상한(px)
  COARSE_STEP: 3,               // 굵은 탐색 간격
  FINE_RADIUS: 4,               // 굵은 탐색 최적점 주변 정밀 탐색 반경
  NCC_SAMPLE_TARGET: 26,        // 템플릿을 몇 칸으로 줄여 상관계수를 계산할지
  TEMPLATE_BLEND_NEW: 0.30,     // 템플릿 갱신 시 새 이미지 비중 (기존 0.70)
  COLOR_DIST_MAX: 100,          // 이 거리 이상이면 공 픽셀이 아니라고 본다(0~441)
  CENTROID_MIN_WEIGHT: 8        // 무게중심을 믿기 위한 최소 가중치 합
};

/** ImageData → 그레이스케일 Float32Array (프레임당 1회) */
export function toGray(imageData) {
  const { data, width, height } = imageData;
  const g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return g;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export class Tracker {
  constructor() {
    this.tpl = null;   // { w,h,gray:Float32Array, sx,sy,sv:Float32Array, smean,sstd, color:{r,g,b} }
  }

  get ready() { return !!this.tpl; }

  /**
   * 현재 프레임에서 (cx, cy) 중심, w×h 크기의 영역을 템플릿으로 삼는다.
   * @param {ImageData} img
   */
  setTemplate(img, cx, cy, w, h) {
    this.tpl = buildTemplate(img, cx, cy, w, h);
  }

  /** 신뢰도가 충분할 때만 템플릿을 부드럽게 갱신한다. */
  updateTemplate(img, cx, cy) {
    if (!this.tpl) return;
    const fresh = buildTemplate(img, cx, cy, this.tpl.w, this.tpl.h);
    const a = TRACK_CONST.TEMPLATE_BLEND_NEW, b = 1 - a;
    const old = this.tpl;
    for (let i = 0; i < old.gray.length; i++) old.gray[i] = b * old.gray[i] + a * fresh.gray[i];
    old.color.r = b * old.color.r + a * fresh.color.r;
    old.color.g = b * old.color.g + a * fresh.color.g;
    old.color.b = b * old.color.b + a * fresh.color.b;
    resample(old);
  }

  /**
   * 다음 프레임의 위치를 찾는다.
   * @param {ImageData} img       현재 프레임
   * @param {Float32Array} gray   toGray(img) 결과
   * @param {Array} prev          지금까지의 [{t, px, py}, ...] (시간 순)
   * @param {number} t            현재 프레임의 시간(초)
   * @returns {{px:number, py:number, confidence:number}}
   */
  step(img, gray, prev, t) {
    const tpl = this.tpl;
    const W = img.width, H = img.height;

    // ① 위치 예측
    let pred, lastMove = 0;
    const n = prev.length;
    if (n >= 2) {
      const p1 = prev[n - 1], p2 = prev[n - 2];
      const dt = p1.t - p2.t;
      if (dt > 1e-9) {
        const vx = (p1.px - p2.px) / dt, vy = (p1.py - p2.py) / dt;
        const h = t - p1.t;
        pred = { x: p1.px + vx * h, y: p1.py + vy * h };
        lastMove = Math.hypot(p1.px - p2.px, p1.py - p2.py);
      } else {
        pred = { x: p1.px, y: p1.py };
      }
    } else if (n === 1) {
      pred = { x: prev[0].px, y: prev[0].py };
    } else {
      pred = { x: W / 2, y: H / 2 };
    }

    const R = clamp(
      Math.max(Math.max(tpl.w, tpl.h) * TRACK_CONST.SEARCH_BOX_FACTOR,
        lastMove * TRACK_CONST.SEARCH_MOVE_FACTOR),
      TRACK_CONST.SEARCH_MIN, TRACK_CONST.SEARCH_MAX);

    // ② NCC 템플릿 매칭 — 굵게 훑고 그 주변을 정밀하게
    let best = { score: -2, x: pred.x, y: pred.y };
    const step = TRACK_CONST.COARSE_STEP;
    for (let dy = -R; dy <= R; dy += step) {
      for (let dx = -R; dx <= R; dx += step) {
        const cx = pred.x + dx, cy = pred.y + dy;
        const s = ncc(gray, W, H, tpl, cx, cy);
        if (s > best.score) best = { score: s, x: cx, y: cy };
      }
    }
    const F = TRACK_CONST.FINE_RADIUS;
    const bx = best.x, by = best.y;
    for (let dy = -F; dy <= F; dy++) {
      for (let dx = -F; dx <= F; dx++) {
        const cx = bx + dx, cy = by + dy;
        const s = ncc(gray, W, H, tpl, cx, cy);
        if (s > best.score) best = { score: s, x: cx, y: cy };
      }
    }

    // ③ 서브픽셀 정밀화 — 템플릿 대표색과의 색 거리로 가중 무게중심
    const refined = centroid(img, tpl, best.x, best.y);

    return {
      px: refined ? refined.x : best.x,
      py: refined ? refined.y : best.y,
      confidence: best.score
    };
  }
}

/* ------------------------------------------------------------------ */

function buildTemplate(img, cx, cy, w, h) {
  const W = img.width, H = img.height, d = img.data;
  w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  const gray = new Float32Array(w * h);

  let rs = 0, gs = 0, bs = 0, cnt = 0;
  const inner = 0.28; // 대표색은 가운데 영역에서만 뽑는다(배경 오염 방지)
  const ix0 = Math.floor(w * inner), ix1 = Math.ceil(w * (1 - inner));
  const iy0 = Math.floor(h * inner), iy1 = Math.ceil(h * (1 - inner));

  for (let y = 0; y < h; y++) {
    const sy = clamp(y0 + y, 0, H - 1);
    for (let x = 0; x < w; x++) {
      const sx = clamp(x0 + x, 0, W - 1);
      const p = (sy * W + sx) * 4;
      const r = d[p], g = d[p + 1], b = d[p + 2];
      gray[y * w + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) { rs += r; gs += g; bs += b; cnt++; }
    }
  }
  cnt = cnt || 1;
  const tpl = { w, h, gray, color: { r: rs / cnt, g: gs / cnt, b: bs / cnt } };
  resample(tpl);
  return tpl;
}

/** NCC 계산용으로 템플릿을 성기게 뽑아 둔다(속도). */
function resample(tpl) {
  const target = TRACK_CONST.NCC_SAMPLE_TARGET;
  const sxStep = Math.max(1, Math.round(tpl.w / target));
  const syStep = Math.max(1, Math.round(tpl.h / target));
  const xs = [], ys = [], vs = [];
  const hx = tpl.w / 2, hy = tpl.h / 2;
  for (let y = 0; y < tpl.h; y += syStep) {
    for (let x = 0; x < tpl.w; x += sxStep) {
      xs.push(x - hx); ys.push(y - hy); vs.push(tpl.gray[y * tpl.w + x]);
    }
  }
  const n = vs.length;
  let sum = 0, sum2 = 0;
  for (let i = 0; i < n; i++) { sum += vs[i]; sum2 += vs[i] * vs[i]; }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(sum2 / n - mean * mean, 1e-6));
  tpl.sx = Float32Array.from(xs);
  tpl.sy = Float32Array.from(ys);
  tpl.sv = Float32Array.from(vs);
  tpl.sn = n; tpl.smean = mean; tpl.sstd = std;
}

/** 정규화 상호상관 (-1 ~ 1). 이 값이 그대로 신뢰도 점수다. */
function ncc(gray, W, H, tpl, cx, cy) {
  const n = tpl.sn, sx = tpl.sx, sy = tpl.sy, sv = tpl.sv;
  let sum = 0, sum2 = 0, cross = 0;
  const cxr = Math.round(cx), cyr = Math.round(cy);
  for (let i = 0; i < n; i++) {
    const x = clamp(cxr + sx[i], 0, W - 1) | 0;
    const y = clamp(cyr + sy[i], 0, H - 1) | 0;
    const v = gray[y * W + x];
    sum += v; sum2 += v * v; cross += v * sv[i];
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(sum2 / n - mean * mean, 1e-6));
  return (cross / n - mean * tpl.smean) / (std * tpl.sstd);
}

/** 색 유사도 가중 무게중심 (서브픽셀). */
function centroid(img, tpl, cx, cy) {
  const W = img.width, H = img.height, d = img.data;
  const w = tpl.w, h = tpl.h;
  const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
  const { r: tr, g: tg, b: tb } = tpl.color;
  const DMAX = TRACK_CONST.COLOR_DIST_MAX;

  let sw = 0, swx = 0, swy = 0;
  for (let y = 0; y < h; y++) {
    const sy = y0 + y; if (sy < 0 || sy >= H) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x; if (sx < 0 || sx >= W) continue;
      const p = (sy * W + sx) * 4;
      const dr = d[p] - tr, dg = d[p + 1] - tg, db = d[p + 2] - tb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist >= DMAX) continue;
      const wgt = 1 - dist / DMAX;
      sw += wgt; swx += wgt * sx; swy += wgt * sy;
    }
  }
  if (sw < TRACK_CONST.CENTROID_MIN_WEIGHT) return null;
  return { x: swx / sw, y: swy / sw };
}
