// demuxer.js — mp4box.js 래핑, 프레임 인덱스(유일한 시간 기준) 구축
// 워커/메인 스레드 어디서든 사용할 수 있도록 DOM에 의존하지 않는다.
// mp4box.js는 전역(self.MP4Box)으로 로드되어 있어야 한다.

/**
 * ArrayBuffer를 파싱하여 { videoTrack, frameIndex, codecString, description, samplesGetter } 반환.
 * 파싱 실패(=ISO BMFF가 아니거나 손상) 시 reject한다 (트랙 B/C 판정용).
 */
export function parseWithMp4Box(arrayBuffer) {
  return new Promise((resolve, reject) => {
    if (typeof MP4Box === 'undefined') {
      reject(new Error('mp4box.js가 로드되지 않았습니다.'));
      return;
    }
    const mp4boxfile = MP4Box.createFile();
    let resolved = false;

    mp4boxfile.onError = (e) => {
      if (!resolved) { resolved = true; reject(new Error('mp4box 파싱 실패: ' + e)); }
    };

    const sampleStore = []; // 트랙의 전체 샘플(디코딩용 데이터 포함)

    mp4boxfile.onReady = (info) => {
      const vTrack = info.tracks.find(t => t.type === 'video' || t.video);
      if (!vTrack) {
        if (!resolved) { resolved = true; reject(new Error('비디오 트랙을 찾을 수 없습니다.')); }
        return;
      }

      // 코덱 description(avcC/hvcC) 추출
      let description;
      try {
        const trak = mp4boxfile.getTrackById(vTrack.id);
        const entry = trak.mdia.minf.stbl.stsd.entries[0];
        const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
        if (box) {
          const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
          box.write(stream);
          description = new Uint8Array(stream.buffer, 8); // 박스 헤더(8바이트) 제외
        }
      } catch (e) { /* description 없이 진행, isConfigSupported가 걸러줌 */ }

      // 전체 샘플을 추출하도록 설정
      mp4boxfile.setExtractionOptions(vTrack.id, null, { nbSamples: 100000 });

      mp4boxfile.onSamples = (id, user, samples) => {
        for (const s of samples) sampleStore.push(s);
      };

      mp4boxfile.start();

      // extraction은 비동기이므로 flush 이후 완료를 감지
      const finalize = () => {
        if (resolved) return;
        resolved = true;

        sampleStore.sort((a, b) => a.cts - b.cts);

        const frameIndex = sampleStore.map((s, idx) => ({
          index: idx,
          cts: s.cts,
          timescale: s.timescale,
          t: s.cts / s.timescale,
          isKey: !!s.is_sync
        }));

        resolve({
          videoTrack: vTrack,
          codecString: vTrack.codec,
          description,
          frameIndex,
          getSampleData: (idx) => sampleStore[idx] ? sampleStore[idx].data : null,
          getSampleDuration: (idx) => {
            const s = sampleStore[idx];
            return s ? (s.duration / s.timescale) : 0;
          },
          durationSec: vTrack.duration && vTrack.timescale ? vTrack.duration / vTrack.timescale : 0,
          width: vTrack.video ? vTrack.video.width : vTrack.track_width,
          height: vTrack.video ? vTrack.video.height : vTrack.track_height
        });
      };

      // mp4box는 스트리밍 파서라 flush 후 짧은 지연을 두고 완료로 간주한다.
      mp4boxfile.flush();
      setTimeout(finalize, 30);
    };

    arrayBuffer.fileStart = 0;
    mp4boxfile.appendBuffer(arrayBuffer);
    mp4boxfile.flush();
  });
}

/** 추정 FPS = (프레임 수 − 1) / (마지막 t − 첫 t) */
export function estimateFps(frameIndex) {
  if (frameIndex.length < 2) return 0;
  const first = frameIndex[0].t;
  const last = frameIndex[frameIndex.length - 1].t;
  if (last <= first) return 0;
  return (frameIndex.length - 1) / (last - first);
}

/** 프레임 간격 편차(%) — 5% 이상이면 VFR 안내 문구를 띄운다 */
export function frameIntervalDeviationPct(frameIndex) {
  if (frameIndex.length < 3) return 0;
  const deltas = [];
  for (let i = 1; i < frameIndex.length; i++) deltas.push(frameIndex[i].t - frameIndex[i - 1].t);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (mean <= 0) return 0;
  const maxDev = Math.max(...deltas.map(d => Math.abs(d - mean)));
  return (maxDev / mean) * 100;
}
