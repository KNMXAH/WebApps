// loader.js — 파일 업로드, 3-트랙 분기, 호환성 판정(§3)
// 트랙 A: 변환 없이 바로 처리 (대부분)
// 트랙 B: 컨테이너만 문제 → -c copy 리먹싱
// 트랙 C: 코덱까지 지원 불가 → H.264 재인코딩
// FFmpeg 는 트랙 B/C 에 들어간 순간에만 동적으로 불러온다.

import { demux } from './demuxer.js';

export const LIMITS = { MAX_SECONDS: 20, MAX_HEIGHT: 1080 };

export function webCodecsSupported() {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

async function isSupportedConfig(config) {
  try {
    const r = await VideoDecoder.isConfigSupported(config);
    return !!r.supported;
  } catch { return false; }
}

/* ---------------- FFmpeg (지연 로딩) ---------------- */
let ffmpegPromise = null;

/** UMD 번들을 <script> 태그로 불러 전역 FFmpegWASM 을 얻는다. (mp4box 와 같은 방식) */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('스크립트를 불러오지 못했습니다: ' + src));
    document.head.appendChild(s);
  });
}

async function getFFmpeg(onStatus) {
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    onStatus?.('영상 변환기를 준비하고 있습니다…');
    const base = new URL('../vendor/ffmpeg/', import.meta.url).href;

    if (!globalThis.FFmpegWASM?.FFmpeg) {
      // 파일 이름을 그대로 뒀든 .min 을 붙였든 모두 받아준다
      let loaded = false;
      for (const name of ['ffmpeg.js', 'ffmpeg.min.js']) {
        try { await loadScript(base + name); loaded = true; break; } catch { }
      }
      if (!loaded || !globalThis.FFmpegWASM?.FFmpeg) {
        throw new Error('영상 변환기를 불러오지 못했습니다. vendor/ffmpeg 폴더를 확인해 주세요.');
      }
    }

    const ff = new globalThis.FFmpegWASM.FFmpeg();
    // 워커 청크는 번들이 자기 위치를 기준으로 알아서 찾는다.
    // 폴더를 옮겨 경로가 틀어진 경우를 대비해 명시 경로로 한 번 더 시도한다.
    const opts = { coreURL: base + 'ffmpeg-core.js', wasmURL: base + 'ffmpeg-core.wasm' };
    try {
      await ff.load(opts);
    } catch (err) {
      await ff.load({ ...opts, classWorkerURL: base + '814.ffmpeg.js' });
    }
    return ff;
  })();
  return ffmpegPromise;
}

const ffmpegLog = [];

async function runFFmpeg(arrayBuffer, args, inName, outName, { onStatus, onProgress }) {
  const ff = await getFFmpeg(onStatus);
  const onProg = ({ progress }) => onProgress?.(Math.max(0, Math.min(progress || 0, 1)));
  const onLog = ({ message }) => {
    ffmpegLog.push(message);
    if (ffmpegLog.length > 200) ffmpegLog.shift();
  };
  ff.on?.('progress', onProg);
  ff.on?.('log', onLog);
  try {
    await ff.writeFile(inName, new Uint8Array(arrayBuffer));
    const code = await ff.exec(args);
    if (code !== 0 && code !== undefined) {
      throw new Error('FFmpeg 종료 코드 ' + code);
    }
    const data = await ff.readFile(outName);
    if (!data || !data.byteLength) throw new Error('변환 결과가 비어 있습니다.');
    const buf = data.buffer ? data.buffer.slice(0) : data;
    return buf;
  } finally {
    // 정리 실패는 무시한다. 다음 실행에서 어차피 덮어쓴다.
    for (const name of [inName, outName]) {
      try { await ff.deleteFile(name); } catch { }
    }
    ff.off?.('progress', onProg);
    ff.off?.('log', onLog);
  }
}

/** 실패했을 때 원인을 콘솔에만 남긴다. 사용자에게는 수식도 영어도 보이지 않는다. */
function reportFFmpegFailure(err) {
  console.error('[FFmpeg 실패]', err);
  if (ffmpegLog.length) console.error('[FFmpeg 로그]\n' + ffmpegLog.slice(-40).join('\n'));
}

/* ---------------- 본 처리 ---------------- */

/**
 * @returns {Promise<{demuxed, track:'A'|'B'|'C'}>}
 */
export async function loadVideo(file, { onStatus, onProgress } = {}) {
  onStatus?.('영상을 읽고 있습니다…');
  onProgress?.(0.05);
  const original = await file.arrayBuffer();

  // ── 트랙 A ──
  let demuxed = null;
  try {
    demuxed = await demux(original);
    if (await isSupportedConfig(demuxed.config)) {
      onProgress?.(1);
      return { demuxed, track: 'A' };
    }
    // 파싱은 됐지만 코덱 미지원 → 트랙 C
    return { demuxed: await transcode(original, file, { onStatus, onProgress }), track: 'C' };
  } catch (parseErr) {
    console.warn('[트랙 A 실패] mp4box 파싱 단계:', parseErr);
    // ── 트랙 B ──
    onStatus?.('영상 형식을 변환하고 있습니다…');
    onProgress?.(0.1);
    try {
      const remuxed = await runFFmpeg(
        original,
        ['-i', 'input.bin', '-c', 'copy', '-an', '-movflags', '+faststart', 'output.mp4'],
        'input.bin', 'output.mp4',
        { onStatus, onProgress: (p) => onProgress?.(0.1 + p * 0.7) }
      );
      const d2 = await demux(remuxed);
      if (await isSupportedConfig(d2.config)) {
        onProgress?.(1);
        return { demuxed: d2, track: 'B' };
      }
    } catch (remuxErr) {
      console.warn('[트랙 B 실패] 리먹싱 단계:', remuxErr);
    }

    // ── 트랙 C ──
    return { demuxed: await transcode(original, file, { onStatus, onProgress }), track: 'C' };
  }
}

async function transcode(arrayBuffer, file, { onStatus, onProgress }) {
  onStatus?.('영상 형식을 변환하고 있습니다. 조금 오래 걸릴 수 있습니다…');
  const out = await runFFmpeg(
    arrayBuffer,
    ['-i', 'input.bin', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'output.mp4'],
    'input.bin', 'output.mp4',
    { onStatus, onProgress: (p) => onProgress?.(0.1 + p * 0.85) }
  ).catch((err) => {
    reportFFmpegFailure(err);
    throw new Error('이 영상 파일을 읽을 수 없습니다. 다른 영상으로 시도해 주세요.');
  });

  const d = await demux(out).catch((err) => {
    console.error('[트랙 C 실패] 변환은 됐지만 다시 읽지 못했습니다:', err);
    throw new Error('이 영상 파일을 읽을 수 없습니다. 다른 영상으로 시도해 주세요.');
  });
  if (!(await isSupportedConfig(d.config))) {
    throw new Error('이 영상 파일을 읽을 수 없습니다. 다른 영상으로 시도해 주세요.');
  }
  onProgress?.(1);
  return d;
}

/** §3.5 크기 제한 안내 문구 (없으면 null) */
export function sizeWarnings({ duration, srcHeight }) {
  const msgs = [];
  if (duration > LIMITS.MAX_SECONDS) msgs.push('영상이 깁니다. 분석 구간을 20초 이내로 선택해 주세요.');
  if (srcHeight > LIMITS.MAX_HEIGHT) msgs.push('영상이 매우 큽니다. 분석할 때 화면 크기를 자동으로 줄여서 처리합니다.');
  return msgs.length ? msgs.join(' ') : null;
}
