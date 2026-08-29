// source.js — 메인 스레드가 쓰는 프레임 소스 인터페이스(워커 백엔드)
// fallback.js 가 같은 모양의 인터페이스를 제공한다.

export class WorkerSource {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.seq = 0;
    this.pending = new Map();     // reqId -> {resolve, reject, onFrame, onProgress}
    this.trackHandlers = null;
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => this._failAll(new Error('영상 처리 작업에서 오류가 발생했습니다: ' + e.message));
  }

  get isPrecise() { return true; }

  _id() { return ++this.seq; }

  _failAll(err) {
    for (const [, p] of this.pending) p.reject?.(err);
    this.pending.clear();
    if (this.trackHandlers?.onError) this.trackHandlers.onError(err);
  }

  _onMessage(m) {
    switch (m.type) {
      case 'configured': {
        const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p?.resolve();
        break;
      }
      case 'resized': {
        const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p?.resolve();
        break;
      }
      case 'frame': {
        const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p?.resolve(m.bitmap);
        break;
      }
      case 'cachedFrame': {
        const p = this.pending.get(m.reqId);
        p?.onFrame?.(m.frame, m.bitmap);
        p?.onProgress?.(m.done, m.total);
        break;
      }
      case 'cacheDone': {
        const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p?.resolve({ done: m.done, total: m.total });
        break;
      }
      case 'trackPoint': this.trackHandlers?.onPoint?.(m); break;
      case 'trackPaused': this.trackHandlers?.onPaused?.(m); break;
      case 'trackDone': {
        const h = this.trackHandlers; this.trackHandlers = null; h?.onDone?.(m);
        break;
      }
      case 'error': {
        const err = new Error(m.message);
        if (m.reqId != null && this.pending.has(m.reqId)) {
          const p = this.pending.get(m.reqId); this.pending.delete(m.reqId); p.reject(err);
        } else {
          this._failAll(err);
        }
        break;
      }
    }
  }

  configure({ config, frameIndex, samples, analysisWidth, analysisHeight, rotation = 0  }) {
    const reqId = this._id();
    const slim = frameIndex.map(f => ({ index: f.index, t: f.t, isKey: f.isKey, decodeIndex: f.decodeIndex }));
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({
        type: 'configure', reqId, config, frameIndex: slim, samples, analysisWidth, analysisHeight, rotation
      }, [samples.buffer]);
    });
  }

  // 회전 추가 수정 전 원본
  // resize(analysisWidth, analysisHeight) {
  //   const reqId = this._id();
  //   return new Promise((resolve, reject) => {
  //     this.pending.set(reqId, { resolve, reject });
  //     this.worker.postMessage({ type: 'resize', reqId, analysisWidth, analysisHeight });
  //   });
  // }

  // 회전 추가
  resize(analysisWidth, analysisHeight, rotation) {
    const reqId = this._id();
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({ type: 'resize', reqId, analysisWidth, analysisHeight, rotation });
    });
  }

  getFrame(frame) {
    const reqId = this._id();
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({ type: 'getFrame', reqId, frame });
    });
  }

  cacheRange(start, end, { onFrame, onProgress } = {}) {
    const reqId = this._id();
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject, onFrame, onProgress });
      this.worker.postMessage({ type: 'cacheRange', reqId, start, end });
    });
  }

  track(opts, handlers) {
    this.trackHandlers = handlers;
    this.worker.postMessage({ type: 'track', reqId: this._id(), ...opts });
  }

  resume(px, py) { this.worker.postMessage({ type: 'trackResume', px, py }); }
  abort() { this.worker.postMessage({ type: 'trackAbort' }); }
  dispose() { try { this.worker.terminate(); } catch { } }
}
