// loader.js — §3. 3-트랙 분기: 모든 파일을 무조건 FFmpeg로 돌리지 않는다.
// FFmpeg 라이브러리/코어는 트랙 B/C 진입 시점에만 동적으로 로드한다.

import { isWebCodecsSupported } from './decoder.js';

let ffmpegInstance = null;

async function loadFFmpegIfNeeded() {
  if (ffmpegInstance) return ffmpegInstance;
  // 트랙 B/C 진입 시점에만 동적 로드 (앱 최초 진입 시 절대 로드하지 않음)
  await import('../vendor/ffmpeg/ffmpeg.min.js');
  const { createFFmpeg } = self.FFmpeg; // UMD 전역
  ffmpegInstance = createFFmpeg({
    corePath: new URL('../vendor/ffmpeg/ffmpeg-core.js', import.meta.url).href,
    log: false
  });
  await ffmpegInstance.load();
  return ffmpegInstance;
}

/** 트랙 B: 컨테이너만 문제인 경우 -c copy 리먹싱 (재인코딩 없음, 빠름) */
export async function remuxContainer(file, onProgress) {
  const ffmpeg = await loadFFmpegIfNeeded();
  const inName = 'in_' + sanitizeName(file.name);
  const outName = 'remuxed.mp4';
  ffmpeg.FS('writeFile', inName, new Uint8Array(await file.arrayBuffer()));
  if (onProgress) ffmpeg.setProgress(({ ratio }) => onProgress(Math.round(ratio * 100)));
  await ffmpeg.run('-i', inName, '-c', 'copy', '-an', outName);
  const data = ffmpeg.FS('readFile', outName);
  ffmpeg.FS('unlink', inName);
  ffmpeg.FS('unlink', outName);
  return data.buffer;
}

/** 트랙 C: 코덱까지 지원 불가한 경우 H.264로 재인코딩, 오디오 완전 제거 */
export async function transcodeToH264(file, onProgress) {
  const ffmpeg = await loadFFmpegIfNeeded();
  const inName = 'in_' + sanitizeName(file.name);
  const outName = 'transcoded.mp4';
  ffmpeg.FS('writeFile', inName, new Uint8Array(await file.arrayBuffer()));
  if (onProgress) ffmpeg.setProgress(({ ratio }) => onProgress(Math.round(Math.max(0, ratio) * 100)));
  await ffmpeg.run(
    '-i', inName,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-an',
    outName
  );
  const data = ffmpeg.FS('readFile', outName);
  ffmpeg.FS('unlink', inName);
  ffmpeg.FS('unlink', outName);
  return data.buffer;
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function checkBrowserSupport() {
  if (!isWebCodecsSupported()) {
    return {
      supported: false,
      message: '이 브라우저에서는 정밀 프레임 분석이 제한됩니다. 크롬 브라우저를 사용하시거나, iPad는 최신 버전으로 업데이트해 주세요.'
    };
  }
  return { supported: true };
}

export function checkFileSizeConstraints(durationSec, width, height) {
  const warnings = [];
  if (durationSec > 20) warnings.push({ code: 'DURATION', message: '분석 구간을 20초 이내로 선택해 주세요.' });
  if (width > 1920 || height > 1920) warnings.push({ code: 'RESOLUTION', message: '1080p를 초과하는 영상입니다. 자동으로 축소되어 처리됩니다.' });
  return warnings;
}

/**
 * 3-트랙 분기 오케스트레이션. worker와의 메시지 교환은 main.js가 담당하고,
 * 이 함수는 "무엇을 시도할지"만 결정한다.
 * @param parsedOk mp4box 파싱 성공 여부(트랙A 1차 조건)
 * @param configSupported VideoDecoder.isConfigSupported 결과
 */
export function decideTrack(parsedOk, configSupported) {
  if (parsedOk && configSupported) return 'A';       // 직접 처리
  if (!parsedOk) return 'B';                          // 리먹싱 시도
  return 'C';                                         // 코덱 트랜스코딩
}
