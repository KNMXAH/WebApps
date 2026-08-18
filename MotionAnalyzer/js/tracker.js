// tracker.js — 공 추적 알고리즘 (§9)
// OpenCV.js를 쓰지 않고 직접 구현한다: 로딩 비용 대비 이 규모에서는 더 가볍다.
// 3단계 혼합 방식: ① 등가속도 위치 예측 → ② NCC 템플릿 매칭(신뢰도) → ③ 서브픽셀 무게중심 정밀화

// ---- 튜닝 가능한 상수(한 곳에서 조정) ----
export const TRACKER_CONFIG = {
  CONFIDENCE_THRESHOLD: 0.6,     // NCC 신뢰도 임계값 — 미만이면 TRACK_PAUSED
  SEARCH_RADIUS_BOX_FACTOR: 0.8, // 탐색 반경 = max(박스*0.8, 직전이동거리*1.5)
  SEARCH_RADIUS_MOTION_FACTOR: 1.5,
  TEMPLATE_BLEND_NEW: 0.3,       // 템플릿 갱신 시 신규 비율
  TEMPLATE_BLEND_OLD: 0.7,
  MIN_UPDATE_CONFIDENCE: 0.6     // 이 미만이면 템플릿 갱신하지 않음
};

/** 등가속도 외삽으로 다음 위치 예측 (§9.1 ①) */
export function predictNextPosition(history, tCurr) {
  const n = history.length;
  if (n < 2) return n >= 1 ? { x: history[n - 1].x, y: history[n - 1].y } : null;
  const p1 = history[n - 2], p2 = history[n - 1];
  const dt = p2.t - p1.t;
  if (dt <= 0) return { x: p2.x, y: p2.y };
  const vx = (p2.x - p1.x) / dt;
  const vy = (p2.y - p1.y) / dt;
  const dtNext = tCurr - p2.t;
  return { x: p2.x + vx * dtNext, y: p2.y + vy * dtNext };
}

export function searchRadius(boxSize, lastMoveDist) {
  return Math.max(
    boxSize * TRACKER_CONFIG.SEARCH_RADIUS_BOX_FACTOR,
    (lastMoveDist || 0) * TRACKER_CONFIG.SEARCH_RADIUS_MOTION_FACTOR,
    boxSize * 0.5
  );
}

// ---- 그레이스케일 변환 유틸 ----
function toGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, width, height };
}

/**
 * 정규화 상호상관(NCC)으로 템플릿(tGray, tw, th)을 검색영역(sGray, sw, sh) 안에서 찾는다.
 * 반환: { x, y, score }  x,y는 검색영역 내 매칭된 좌상단 좌표, score는 -1~1
 */
function nccSearch(sGray, sw, sh, tGray, tw, th) {
  // 템플릿 평균/표준편차
  let tMean = 0;
  for (let i = 0; i < tGray.length; i++) tMean += tGray[i];
  tMean /= tGray.length;
  let tVar = 0;
  for (let i = 0; i < tGray.length; i++) { const d = tGray[i] - tMean; tVar += d * d; }
  const tStd = Math.sqrt(tVar) || 1e-6;

  let best = { x: 0, y: 0, score: -Infinity };

  const maxY = sh - th, maxX = sw - tw;
  // 계산량을 줄이기 위해 2px 스텝의 성긴 탐색 후 주변을 1px로 정밀화
  const coarseStep = (maxX > 24 || maxY > 24) ? 2 : 1;

  const scoreAt = (sx, sy) => {
    let sMean = 0;
    for (let y = 0; y < th; y++) {
      const rowBase = (sy + y) * sw + sx;
      for (let x = 0; x < tw; x++) sMean += sGray[rowBase + x];
    }
    sMean /= (tw * th);

    let num = 0, sVar = 0;
    for (let y = 0; y < th; y++) {
      const rowBase = (sy + y) * sw + sx;
      const tRowBase = y * tw;
      for (let x = 0; x < tw; x++) {
        const sv = sGray[rowBase + x] - sMean;
        const tv = tGray[tRowBase + x] - tMean;
        num += sv * tv;
        sVar += sv * sv;
      }
    }
    const sStd = Math.sqrt(sVar) || 1e-6;
    return num / (sStd * tStd * tw * th);
  };

  for (let sy = 0; sy <= maxY; sy += coarseStep) {
    for (let sx = 0; sx <= maxX; sx += coarseStep) {
      const score = scoreAt(sx, sy);
      if (score > best.score) best = { x: sx, y: sy, score };
    }
  }
  if (coarseStep > 1) {
    const refineRadius = coarseStep;
    for (let sy = Math.max(0, best.y - refineRadius); sy <= Math.min(maxY, best.y + refineRadius); sy++) {
      for (let sx = Math.max(0, best.x - refineRadius); sx <= Math.min(maxX, best.x + refineRadius); sx++) {
        const score = scoreAt(sx, sy);
        if (score > best.score) best = { x: sx, y: sy, score };
      }
    }
  }
  return best;
}

/** 템플릿의 대표 색상과 색 거리로 공 픽셀을 분리해 밝기(색 유사도) 가중 무게중심 계산 (§9.1 ③) */
function subpixelCentroid(rgbaData, w, h, templateColor) {
  const { r: tr, g: tg, b: tb } = templateColor;
  let sw = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = rgbaData[i], g = rgbaData[i + 1], b = rgbaData[i + 2];
      const dist = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
      const weight = Math.max(0, 1 - dist / 180); // 색 거리가 가까울수록 가중치↑
      sw += weight; sx += weight * x; sy += weight * y;
    }
  }
  if (sw < 1e-6) return { x: w / 2, y: h / 2 };
  return { x: sx / sw, y: sy / sw };
}

function averageColor(rgbaData, w, h) {
  let r = 0, g = 0, b = 0, n = w * h;
  for (let i = 0; i < rgbaData.length; i += 4) { r += rgbaData[i]; g += rgbaData[i + 1]; b += rgbaData[i + 2]; }
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * 한 프레임에서 템플릿을 추적한다.
 * @param frameImageData 분석 좌표계 전체 프레임의 ImageData
 * @param templateImageData 현재 템플릿의 ImageData (박스 크기)
 * @param predicted {x,y} 예측 중심 좌표(분석 좌표계)
 * @param boxW, boxH 템플릿 박스 크기
 * @param radius 탐색 반경(px)
 * @returns { x, y, confidence, templateImageData(갱신용 크롭), templateColor }
 */
export function trackOneFrame(frameImageData, templateImageData, predicted, boxW, boxH, radius) {
  const fullW = frameImageData.width, fullH = frameImageData.height;

  const searchX0 = Math.max(0, Math.floor(predicted.x - boxW / 2 - radius));
  const searchY0 = Math.max(0, Math.floor(predicted.y - boxH / 2 - radius));
  const searchX1 = Math.min(fullW, Math.ceil(predicted.x + boxW / 2 + radius));
  const searchY1 = Math.min(fullH, Math.ceil(predicted.y + boxH / 2 + radius));
  const sw = searchX1 - searchX0, sh = searchY1 - searchY0;
  if (sw < boxW || sh < boxH) {
    return { x: predicted.x, y: predicted.y, confidence: -1 };
  }

  // 검색영역 픽셀 잘라내기
  const searchData = cropImageData(frameImageData, searchX0, searchY0, sw, sh);

  const { gray: sGray } = toGray(searchData);
  const { gray: tGray } = toGray(templateImageData);

  const match = nccSearch(sGray, sw, sh, tGray, boxW, boxH);

  const matchGlobalX0 = searchX0 + match.x;
  const matchGlobalY0 = searchY0 + match.y;

  const matchedCrop = cropImageData(frameImageData, matchGlobalX0, matchGlobalY0, boxW, boxH);
  const templateColor = averageColor(templateImageData.data, boxW, boxH);
  const centroid = subpixelCentroid(matchedCrop.data, boxW, boxH, templateColor);

  return {
    x: matchGlobalX0 + centroid.x,
    y: matchGlobalY0 + centroid.y,
    confidence: match.score,
    matchedCrop
  };
}

export function cropImageData(imageData, x0, y0, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const srcW = imageData.width;
  for (let y = 0; y < h; y++) {
    const srcRow = (y0 + y) * srcW + x0;
    const srcOffset = srcRow * 4;
    const dstOffset = y * w * 4;
    out.set(imageData.data.subarray(srcOffset, srcOffset + w * 4), dstOffset);
  }
  return { data: out, width: w, height: h };
}

/** 템플릿 가중 혼합 갱신 (신뢰도가 낮으면 호출하지 않을 것) */
export function blendTemplate(oldTemplate, newCrop) {
  const out = new Uint8ClampedArray(oldTemplate.data.length);
  const NEW = TRACKER_CONFIG.TEMPLATE_BLEND_NEW, OLD = TRACKER_CONFIG.TEMPLATE_BLEND_OLD;
  for (let i = 0; i < out.length; i++) {
    out[i] = oldTemplate.data[i] * OLD + newCrop.data[i] * NEW;
  }
  return { data: out, width: oldTemplate.width, height: oldTemplate.height };
}
