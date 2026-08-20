// decoder.js — WebCodecs VideoDecoder 래핑, 랜덤 액세스 (워커 전용)
//
// VideoDecoder 는 순차 디코딩만 가능하다. 임의 프레임 N 에 접근하려면
// N 이하의 가장 가까운 키프레임부터 순서대로 먹여야 한다(§5.1).
// 여기서는 그것을 async generator 로 감싸 소비자가 필요한 만큼만 당겨쓰게 한다.
// 이렇게 하면 추적 중 사용자 입력을 기다리며 파이프라인을 멈춰 둘 수 있다.

const QUEUE_MAX = 6;      // 미리 디코딩해 둘 프레임 수 (역압)
const DECODE_QUEUE_MAX = 10;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class FrameDecoder {
  /**
   * @param {VideoDecoderConfig} config
   * @param {Array} frameIndex  표시 순서. 각 원소에 decodeIndex 가 있어야 한다.
   * @param {{buffer:ArrayBuffer, offsets:Int32Array, ctsUs:Float64Array, isKey:Uint8Array}} samples
   */
  constructor(config, frameIndex, samples) {
    this.config = config;
    this.frameIndex = frameIndex;
    this.bytes = new Uint8Array(samples.buffer);
    this.offsets = samples.offsets;
    this.ctsUs = samples.ctsUs;
    this.isKey = samples.isKey;
    this._cancel = false;
  }

  static async isSupported(config) {
    if (typeof VideoDecoder === 'undefined') return false;
    try {
      const r = await VideoDecoder.isConfigSupported(config);
      return !!r.supported;
    } catch { return false; }
  }

  chunkData(decodeIndex) {
    const a = this.offsets[decodeIndex], b = this.offsets[decodeIndex + 1];
    return this.bytes.subarray(a, b);
  }

  /** decodeIndex 이하에서 가장 가까운 키프레임의 디코딩 순서 인덱스 */
  keyBefore(decodeIndex) {
    for (let i = decodeIndex; i >= 0; i--) if (this.isKey[i]) return i;
    return 0;
  }

  cancel() { this._cancel = true; }

  /**
   * [startFrame, endFrame] 구간의 VideoFrame 을 표시 순서대로 하나씩 넘긴다.
   * 소비자가 반드시 frame.close() 를 호출해야 한다.
   */
  async *iterate(startFrame, endFrame) {
    this._cancel = false;
    const fi = this.frameIndex;
    const startCts = Math.round(fi[startFrame].t * 1e6);
    const endCts = Math.round(fi[endFrame].t * 1e6);
    const startDec = this.keyBefore(fi[startFrame].decodeIndex);

    // 표시 순서 endFrame 보다 뒤에 디코딩되는 샘플이 있을 수 있으므로
    // 구간 안 모든 프레임의 decodeIndex 중 최댓값까지 먹인다.
    let endDec = fi[endFrame].decodeIndex;
    for (let k = startFrame; k <= endFrame; k++) {
      if (fi[k].decodeIndex > endDec) endDec = fi[k].decodeIndex;
    }

    const q = [];
    let pushWake = null, pullWake = null, finished = false, error = null;

    const wakePull = () => { if (pullWake) { const f = pullWake; pullWake = null; f(); } };
    const wakePush = () => { if (pushWake) { const f = pushWake; pushWake = null; f(); } };

    const dec = new VideoDecoder({
      output: (frame) => { q.push(frame); wakePull(); },
      error: (e) => { error = e; wakePull(); wakePush(); }
    });
    dec.configure(this.config);

    const feeder = (async () => {
      try {
        for (let k = startDec; k <= endDec; k++) {
          if (this._cancel || error) break;
          while (q.length > QUEUE_MAX && !this._cancel && !error) {
            await new Promise(r => { pushWake = r; });
          }
          if (this._cancel || error) break;
          while (dec.decodeQueueSize > DECODE_QUEUE_MAX && !error) await sleep(0);
          dec.decode(new EncodedVideoChunk({
            type: this.isKey[k] ? 'key' : 'delta',
            timestamp: this.ctsUs[k],
            data: this.chunkData(k)
          }));
        }
        if (!this._cancel && !error) { try { await dec.flush(); } catch { /* 무시 */ } }
      } catch (e) {
        error = e;
      } finally {
        finished = true;
        wakePull();
      }
    })();

    try {
      while (true) {
        if (error) throw error;
        if (q.length === 0) {
          if (finished) break;
          await new Promise(r => { pullWake = r; });
          continue;
        }
        const frame = q.shift();
        wakePush();
        const ts = frame.timestamp;
        if (ts >= startCts - 1 && ts <= endCts + 1) {
          yield frame;                 // 소비자가 close() 책임
          if (this._cancel) break;
        } else {
          frame.close();
        }
      }
    } finally {
      this._cancel = true;
      wakePush();
      for (const f of q) { try { f.close(); } catch { } }
      q.length = 0;
      try { if (dec.state !== 'closed') dec.close(); } catch { }
      try { await feeder; } catch { }
    }
  }

  /** 단일 프레임. 소비자가 close() 책임. */
  async getFrame(n) {
    for await (const frame of this.iterate(n, n)) {
      this.cancel();
      return frame;
    }
    return null;
  }
}
