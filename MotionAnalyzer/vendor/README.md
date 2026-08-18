# vendor 라이브러리 설치 안내

빌드 도구 없이 정적 파일로만 동작해야 하므로(§0.2), 아래 두 라이브러리의
**실제 배포 파일**을 직접 받아 이 폴더 구조에 맞게 넣어야 합니다.
(제가 생성한 코드에는 파일을 참조하는 경로만 있고, 라이브러리 바이너리 자체는
포함되어 있지 않습니다 — 이 컨테이너에 인터넷 접근이 없어 직접 내려받을 수
없었습니다.)

## 1. mp4box.js

```
vendor/mp4box.all.min.js
```

받는 방법 (택 1):
```bash
npm pack mp4box@latest
# 압축 해제 후 dist/mp4box.all.min.js 를 vendor/에 복사
```
또는 브라우저에서 아래 CDN 파일을 열어 "다른 이름으로 저장":
```
https://cdn.jsdelivr.net/npm/mp4box@latest/dist/mp4box.all.min.js
```
→ `vendor/mp4box.all.min.js` 로 저장.

## 2. FFmpeg.wasm (0.12.x, 단일 스레드 코어 — SharedArrayBuffer/COOP·COEP 불필요)

```
vendor/ffmpeg/ffmpeg.min.js       ← @ffmpeg/ffmpeg UMD 빌드
vendor/ffmpeg/ffmpeg-core.js      ← @ffmpeg/core (single-thread) 의 코어 JS
vendor/ffmpeg/ffmpeg-core.wasm    ← 같은 패키지의 wasm 바이너리
```

받는 방법:
```bash
npm pack @ffmpeg/ffmpeg@0.12
npm pack @ffmpeg/core@0.12   # single-thread 코어 (core-mt 아님!)
```
압축을 풀어 아래처럼 배치하세요:
- `@ffmpeg/ffmpeg` 패키지의 `dist/umd/ffmpeg.js` → `vendor/ffmpeg/ffmpeg.min.js`
- `@ffmpeg/core` 패키지의 `dist/umd/ffmpeg-core.js` → `vendor/ffmpeg/ffmpeg-core.js`
- `@ffmpeg/core` 패키지의 `dist/umd/ffmpeg-core.wasm` → `vendor/ffmpeg/ffmpeg-core.wasm`

**주의**: `@ffmpeg/core-mt`(멀티스레드)가 아니라 `@ffmpeg/core`(단일 스레드)를
받아야 합니다. 멀티스레드 코어는 SharedArrayBuffer가 필요해 COOP/COEP 헤더를
요구하는데, 요구서 §0.4에 따라 이 프로젝트는 그 헤더를 전역으로 설정하지
않습니다(루트 대시보드와 다른 앱이 깨지기 때문).

`js/loader.js`의 `loadFFmpegIfNeeded()`가 이 파일들을 트랙 B/C 진입 시점에만
동적으로 로드합니다 — 앱 최초 진입 시에는 로드되지 않습니다.

## 확인

두 라이브러리를 넣은 뒤 `vendor/` 디렉토리는 다음과 같아야 합니다:
```
vendor/
├── README.md            (이 파일 — 배포 시 삭제해도 무방)
├── mp4box.all.min.js
└── ffmpeg/
    ├── ffmpeg.min.js
    ├── ffmpeg-core.js
    └── ffmpeg-core.wasm
```
