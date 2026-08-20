// demuxer.js — mp4box.js 래핑, 프레임 인덱스 구축
// 메인 스레드에서 1회만 수행한다. (mp4box 는 UMD 라 모듈 워커에서 안전하게 import 되지 않는다.)

let mp4boxLoaded = null;

function loadMp4Box() {
  if (mp4boxLoaded) return mp4boxLoaded;
  mp4boxLoaded = new Promise((resolve, reject) => {
    if (globalThis.MP4Box) return resolve(globalThis.MP4Box);
    const s = document.createElement('script');
    s.src = new URL('../vendor/mp4box.all.min.js', import.meta.url).href;
    s.onload = () => globalThis.MP4Box
      ? resolve(globalThis.MP4Box)
      : reject(new Error('mp4box.js 를 불러왔지만 MP4Box 전역이 없습니다.'));
    s.onerror = () => reject(new Error('mp4box.js 를 불러오지 못했습니다.'));
    document.head.appendChild(s);
  });
  return mp4boxLoaded;
}

/** avcC / hvcC / vpcC / av1C 박스를 꺼내 VideoDecoder description 으로 만든다. */
function extractDescription(MP4Box, file, trackId) {
  const trak = file.getTrackById(trackId);
  if (!trak) return null;
  const entries = trak.mdia?.minf?.stbl?.stsd?.entries || [];
  for (const entry of entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (!box) continue;
    const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
    box.write(stream);
    // 앞 8바이트는 박스 헤더(size + type)이므로 잘라낸다.
    return new Uint8Array(stream.buffer, 8);
  }
  return null;
}

/**
 * 파일 전체를 파싱해 디코딩에 필요한 모든 것을 만든다.
 * @returns {Promise<{config, frameIndex, samples, srcWidth, srcHeight, duration}>}
 */
export async function demux(arrayBuffer) {
  const MP4Box = await loadMp4Box();

  const file = MP4Box.createFile();
  const info = await new Promise((resolve, reject) => {
    file.onError = (e) => reject(new Error('영상 컨테이너를 읽지 못했습니다: ' + e));
    file.onReady = (i) => resolve(i);
    const buf = arrayBuffer.slice(0); // mp4box 가 소유권을 가져가므로 복사본을 넘긴다
    buf.fileStart = 0;
    file.appendBuffer(buf);
    file.flush();
    // onReady 가 끝내 호출되지 않으면 실패로 본다
    setTimeout(() => reject(new Error('영상 컨테이너를 읽지 못했습니다(시간 초과).')), 15000);
  });

  const vtrack = (info.videoTracks || [])[0];
  if (!vtrack) throw new Error('이 파일에는 영상 트랙이 없습니다.');

  const description = extractDescription(MP4Box, file, vtrack.id);

  // 샘플 전체 추출
  const rawSamples = await new Promise((resolve, reject) => {
    const acc = [];
    file.onSamples = (_id, _user, samples) => {
      for (const s of samples) {
        acc.push({
          cts: s.cts, dts: s.dts, timescale: s.timescale,
          isKey: !!s.is_sync, data: s.data
        });
      }
    };
    file.onError = (e) => reject(new Error('샘플을 읽지 못했습니다: ' + e));
    file.setExtractionOptions(vtrack.id, null, { nbSamples: Number.MAX_SAFE_INTEGER });
    file.start();
    file.flush();
    // onSamples 는 동기적으로 이미 호출되었다
    setTimeout(() => acc.length ? resolve(acc) : reject(new Error('영상에서 프레임을 찾지 못했습니다.')), 0);
  });

  file.stop();
  file.flush();

  // ---- 디코딩 순서(=파일 순서) 자료 만들기 ----
  const n = rawSamples.length;
  const offsets = new Int32Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i++) { offsets[i] = total; total += rawSamples[i].data.byteLength; }
  offsets[n] = total;

  const bytes = new Uint8Array(total);
  const ctsUs = new Float64Array(n);
  const isKey = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const s = rawSamples[i];
    bytes.set(s.data, offsets[i]);
    ctsUs[i] = Math.round(s.cts * 1e6 / s.timescale);
    isKey[i] = s.isKey ? 1 : 0;
    s.data = null; // 참조 해제
  }

  // ---- 표시(composition) 순서로 정렬한 프레임 인덱스 ----
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => ctsUs[a] - ctsUs[b] || a - b);

  const frameIndex = order.map((decodeIndex, k) => {
    const s = rawSamples[decodeIndex];
    return {
      index: k,
      cts: s.cts,
      timescale: s.timescale,
      t: s.cts / s.timescale,
      isKey: !!s.isKey,
      decodeIndex
    };
  });

  if (frameIndex.length < 2) throw new Error('프레임이 너무 적어 분석할 수 없습니다.');

  const codec = vtrack.codec;
  const srcWidth = vtrack.video?.width || vtrack.track_width || info.videoTracks[0].track_width;
  const srcHeight = vtrack.video?.height || vtrack.track_height || info.videoTracks[0].track_height;
  const duration = frameIndex[frameIndex.length - 1].t - frameIndex[0].t;

  return {
    config: {
      codec,
      codedWidth: Math.round(srcWidth),
      codedHeight: Math.round(srcHeight),
      ...(description ? { description } : {})
    },
    frameIndex,
    samples: { buffer: bytes.buffer, offsets, ctsUs, isKey },
    srcWidth: Math.round(srcWidth),
    srcHeight: Math.round(srcHeight),
    duration
  };
}

/** §4.4 FPS 자동 추정 — 표시 전용. */
export function estimateFps(frameIndex) {
  const n = frameIndex.length;
  if (n < 2) return 0;
  const span = frameIndex[n - 1].t - frameIndex[0].t;
  if (span <= 0) return 0;
  return (n - 1) / span;
}

/** 프레임 간격의 상대 표준편차. 5% 이상이면 VFR 로 본다. */
export function frameIntervalDeviation(frameIndex) {
  const n = frameIndex.length;
  if (n < 3) return 0;
  const d = [];
  for (let i = 1; i < n; i++) d.push(frameIndex[i].t - frameIndex[i - 1].t);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  if (mean <= 0) return 0;
  const varr = d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length;
  return Math.sqrt(varr) / mean;
}
