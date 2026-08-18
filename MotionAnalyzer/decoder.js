// decoder.js — WebCodecs VideoDecoder 래핑
// <video> 탐색을 쓰지 않는 이유는 §4.1 참고: seeked 이벤트는 프레임 합성 완료를
// 보장하지 않고, n/fps 계산은 VFR 영상에서 근본적으로 틀리기 때문이다.
// WebCodecs는 탐색이라는 개념이 없다: 인코딩된 샘플을 순서대로 넣으면
// 디코더가 샘플당 VideoFrame을 정확히 하나씩 반환한다.

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
  let configured = false;

  function nearestKeyframeAtOrBefore(n) {
    for (let i = n; i >= 0; i--) {
      if (demux.frameIndex[i].isKey) return i;
    }
    return 0;
  }

  async function ensureDecoder(config) {
    if (decoder && configured) return;
    decoder = new VideoDecoder({
      output: () => { /* decodeFrame()이 개별적으로 output을 오버라이드함 */ },
      error: (e) => console.error('VideoDecoder error:', e)
    });
    decoder.configure(config);
    configured = true;
  }

  /**
   * 프레임 N을 정확히 디코딩해 VideoFrame 하나를 반환한다.
   * 사용 후 반드시 close()를 호출해야 한다(메모리 누수 방지).
   */
  async function decodeFrame(n, config) {
    await ensureDecoder(config);
    const k = nearestKeyframeAtOrBefore(n);

    return new Promise((resolve, reject) => {
      const collected = [];
      let settled = false;

      decoder.ondequeue = null;
      // output 콜백을 이 호출 전용으로 교체
      decoder.output = (frame) => collected.push(frame);
      decoder.error = (e) => { if (!settled) { settled = true; reject(e); } };

      try {
        // 이전 상태 초기화(랜덤 액세스 준비)
        if (decoder.state !== 'configured') decoder.configure(config);

        for (let i = k; i <= n; i++) {
          const data = demux.getSampleData(i);
          const chunk = new EncodedVideoChunk({
            type: demux.frameIndex[i].isKey ? 'key' : 'delta',
            timestamp: Math.round(demux.frameIndex[i].t * 1e6),
            data
          });
          decoder.decode(chunk);
        }

        decoder.flush().then(() => {
          if (settled) return;
          settled = true;
          // k..n 중 마지막(N)만 사용하고 나머지는 즉시 close
          const target = collected[collected.length - 1] || null;
          for (let i = 0; i < collected.length - 1; i++) {
            try { collected[i].close(); } catch (e) { /* noop */ }
          }
          resolve(target);
        }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * [start, end] 구간을 키프레임부터 순서대로 디코딩하며,
   * onFrame(frame, frameIndexNum)을 매 프레임 호출한다.
   * onFrame 내부에서 frame.close()를 책임지고 호출해야 한다.
   */
  async function decodeRange(start, end, config, onFrame, onProgress) {
    await ensureDecoder(config);
    const k = nearestKeyframeAtOrBefore(start);

    return new Promise((resolve, reject) => {
      let idx = k;
      let settled = false;

      decoder.output = (frame) => {
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
      decoder.error = (e) => { if (!settled) { settled = true; reject(e); } };

      try {
        if (decoder.state !== 'configured') decoder.configure(config);
        for (let i = k; i <= end; i++) {
          const data = demux.getSampleData(i);
          const chunk = new EncodedVideoChunk({
            type: demux.frameIndex[i].isKey ? 'key' : 'delta',
            timestamp: Math.round(demux.frameIndex[i].t * 1e6),
            data
          });
          decoder.decode(chunk);
        }
        decoder.flush().then(() => { if (!settled) { settled = true; resolve(); } }).catch(reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  function close() {
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch (e) { /* noop */ }
    decoder = null;
    configured = false;
  }

  return { decodeFrame, decodeRange, close };
}
