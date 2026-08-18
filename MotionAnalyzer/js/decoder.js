// decoder.js — WebCodecs VideoDecoder 래핑
// <video> 탐색을 쓰지 않는 이유는 §4.1 참고: seeked 이벤트는 프레임 합성 완료를
// 보장하지 않고, n/fps 계산은 VFR 영상에서 근본적으로 틀리기 때문이다.
// WebCodecs는 탐색이라는 개념이 없다: 인코딩된 샘플을 순서대로 넣으면
// 디코더가 샘플당 VideoFrame을 정확히 하나씩 반환한다.
//
// 주의(중요): VideoDecoder의 output/error 콜백은 생성자에 넘긴 시점에 내부적으로
// 고정된다. `decoder.output = fn`처럼 나중에 속성을 재할당해도 실제 디코딩
// 파이프라인은 그 새 함수를 호출하지 않는다(단순히 사용되지 않는 프로퍼티가
// 추가될 뿐). 이 파일은 그 문제를 피하기 위해, 생성자에서 한 번만 콜백을 등록하고
// 그 콜백이 "현재 등록된 핸들러"를 간접 호출하는 디스패처 패턴을 쓴다.

export function isWebCodecsSupported() {
  return typeof VideoDecoder !== 'undefined';
}

export async function checkConfigSupported({ codec, codedWidth, codedHeight, description }) {
  if (!isWebCodecsSupported()) return false;
  try {
    const result = await VideoDecoder.isConfigSupported({ codec, codedWidth, codedHeight, description });
    return !!result.supported;
  } catch (e) {
    return false;
  }
}

/**
 * demux 결과를 받아, 임의의 프레임 N에 랜덤 액세스로 접근할 수 있는
 * 디코더 컨트롤러를 만든다.
 * 원칙(§5.1): N 이하 가장 가까운 키프레임 K부터 K..N까지 순서대로 decode()하고,
 * N 이전 프레임은 즉시 close()하여 버린다.
 */
export function createRandomAccessDecoder(demux) {
  let decoder = null;

  // 현재 활성 핸들러 — decodeFrame/decodeRange 호출마다 교체된다.
  // 아무도 등록하지 않은 상태(기본값)에서 프레임이 나오면 즉시 close()해 누수를 막는다.
  let currentOutput = (frame) => { try { frame.close(); } catch (e) { /* noop */ } };
  let currentError = (e) => console.error('VideoDecoder error:', e);

  function nearestKeyframeAtOrBefore(n) {
    for (let i = n; i >= 0; i--) {
      if (demux.frameIndex[i].isKey) return i;
    }
    return 0;
  }

  function ensureDecoder(config) {
    if (decoder) return;
    // 콜백은 여기서 딱 한 번만 등록한다. 실제 동작은 항상 currentOutput/currentError를
    // 간접 호출하므로, 아래 decodeFrame/decodeRange는 이 변수만 바꿔치기하면 된다.
    decoder = new VideoDecoder({
      output: (frame) => currentOutput(frame),
      error: (e) => currentError(e)
    });
    decoder.configure(config);
  }

  function feedSamples(fromIdx, toIdx) {
    for (let i = fromIdx; i <= toIdx; i++) {
      const data = demux.getSampleData(i);
      const chunk = new EncodedVideoChunk({
        type: demux.frameIndex[i].isKey ? 'key' : 'delta',
        timestamp: Math.round(demux.frameIndex[i].t * 1e6),
        data
      });
      decoder.decode(chunk);
    }
  }

  /**
   * 프레임 N을 정확히 디코딩해 VideoFrame 하나를 반환한다.
   * 사용 후 반드시 close()를 호출해야 한다(메모리 누수 방지).
   */
  async function decodeFrame(n, config) {
    ensureDecoder(config);
    if (decoder.state !== 'configured') decoder.configure(config);
    const k = nearestKeyframeAtOrBefore(n);

    return new Promise((resolve, reject) => {
      const collected = [];
      let settled = false;

      const closeAllCollected = () => {
        for (const f of collected) { try { f.close(); } catch (e) { /* noop */ } }
      };

      currentOutput = (frame) => collected.push(frame);
      currentError = (e) => {
        if (settled) return;
        settled = true;
        closeAllCollected();
        reject(e);
      };

      try {
        feedSamples(k, n);
        decoder.flush().then(() => {
          if (settled) return;
          settled = true;
          // k..n 중 마지막(N)만 사용하고 나머지는 즉시 close
          const target = collected[collected.length - 1] || null;
          for (let i = 0; i < collected.length - 1; i++) {
            try { collected[i].close(); } catch (e) { /* noop */ }
          }
          resolve(target);
        }).catch((e) => {
          if (settled) return;
          settled = true;
          closeAllCollected();
          reject(e);
        });
      } catch (e) {
        if (!settled) { settled = true; closeAllCollected(); reject(e); }
      }
    });
  }

  /**
   * [start, end] 구간을 키프레임부터 순서대로 디코딩하며,
   * onFrame(frame, frameIndexNum)을 매 프레임 호출한다.
   * onFrame 내부에서 frame.close()를 책임지고 호출해야 한다.
   */
  async function decodeRange(start, end, config, onFrame, onProgress) {
    ensureDecoder(config);
    if (decoder.state !== 'configured') decoder.configure(config);
    const k = nearestKeyframeAtOrBefore(start);

    return new Promise((resolve, reject) => {
      let idx = k;
      let settled = false;

      currentOutput = (frame) => {
        const currentIdx = idx;
        idx++;
        if (currentIdx < start) {
          // 시작 이전 프레임은 즉시 폐기
          try { frame.close(); } catch (e) { /* noop */ }
        } else {
          onFrame(frame, currentIdx);
          if (onProgress) onProgress(currentIdx - start + 1, end - start + 1);
        }
      };
      currentError = (e) => { if (!settled) { settled = true; reject(e); } };

      try {
        feedSamples(k, end);
        decoder.flush().then(() => { if (!settled) { settled = true; resolve(); } }).catch((e) => {
          if (!settled) { settled = true; reject(e); }
        });
      } catch (e) {
        if (!settled) { settled = true; reject(e); }
      }
    });
  }

  function close() {
    currentOutput = (frame) => { try { frame.close(); } catch (e) { /* noop */ } };
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch (e) { /* noop */ }
    decoder = null;
  }

  return { decodeFrame, decodeRange, close };
}
