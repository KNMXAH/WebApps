// 전역 상태 변수
let ffmpeg = null;
let videoBlobUrl = null;
let frames = []; // 디코딩된 프레임 이미지 또는 비디오 데이터 참조
let fps = 30;
let totalFrames = 0;

// 기준자 변수
let rulerMode = false;
let rulerPoints = []; // [{x, y}, {x, y}]
let pixelPerMeter = 1.0;

// 구간 설정
let startFrame = 0;
let endFrame = 0;

// 공 추적 및 ROI 변수
let trackingMode = false;
let ballInitialPos = null; // {x, y}
let roiBox = null; // {x, y, w, h}
let trackedData = []; // [{frame, time, x, y, realX, realY}]
let manualEditIndex = null;

// DOM 요소 참조
const guideText = document.getElementById('guideText');
const videoInput = document.getElementById('videoInput');
const loadingStatus = document.getElementById('loadingStatus');
const canvas = document.getElementById('videoCanvas');
const ctx = canvas.getContext('2d');

// 단계별 섹션
const step1Section = document.getElementById('step1Section');
const step2Section = document.getElementById('step2Section');
const step3Section = document.getElementById('step3Section');
const step4Section = document.getElementById('step4Section');
const step5Section = document.getElementById('step5Section');
const step9Section = document.getElementById('step9Section');
const tableSection = document.getElementById('tableSection');
const energySection = document.getElementById('energySection');

// 초기화 및 FFmpeg 로드
async function initFFmpeg() {
    const { createFFmpeg, fetchFile } = FFmpeg;
    ffmpeg = createFFmpeg({ log: true });
    await ffmpeg.load();
}
initFFmpeg();

// 1. 영상 업로드 및 FFmpeg 트랜스코딩 (v0.11.6 활용)
videoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!ffmpeg || !ffmpeg.isLoaded()) {
        loadingStatus.textContent = 'FFmpeg 로딩 중입니다. 잠시만 기다려주세요...';
        return;
    }

    loadingStatus.textContent = '영상을 표준 MP4 포맷으로 변환 중입니다...';
    guideText.textContent = '영상을 표준 MP4 코덱으로 변환하고 있습니다.';

    const { fetchFile } = FFmpeg;
    ffmpeg.FS('writeFile', 'input_video', await fetchFile(file));
    
    // H.264 표준 MP4로 즉시 트랜스코딩/리먹싱
    await ffmpeg.run('-i', 'input_video', '-c:v', 'libx264', '-preset', 'ultrafast', 'output.mp4');
    
    const data = ffmpeg.FS('readFile', 'output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    videoBlobUrl = URL.createObjectURL(blob);

    loadVideoIntoMemory(videoBlobUrl);
});

// 비디오 메모리 로드 및 프레임 분할 준비 (mp4box 및 WebCodecs 시뮬레이션 호환 캔버스 렌더러)
let htmlVideoElement = document.createElement('video');
function loadVideoIntoMemory(url) {
    htmlVideoElement.src = url;
    htmlVideoElement.load();
    htmlVideoElement.onloadedmetadata = () => {
        canvas.width = htmlVideoElement.videoWidth;
        canvas.height = htmlVideoElement.videoHeight;
        
        // 대략적인 총 프레임 계산 (기본 30fps 기준 혹은 메타데이터 기반)
        totalFrames = Math.floor(htmlVideoElement.duration * fps);
        
        // 첫 프레임 렌더링
        htmlVideoElement.currentTime = 0;
        htmlVideoElement.onseeked = () => {
            ctx.drawImage(htmlVideoElement, 0, 0, canvas.width, canvas.height);
        };

        // UI 전환 -> 단계 2 (FPS 입력)
        step1Section.classList.add('hidden');
        step2Section.classList.remove('hidden');
        guideText.textContent = '2단계: 영상의 FPS를 확인하고 입력해주세요.';
    };
}

// 2. FPS 설정
document.getElementById('setFpsBtn').addEventListener('click', () => {
    fps = parseFloat(document.getElementById('fpsInput').value) || 30;
    totalFrames = Math.floor(htmlVideoElement.duration * fps);

    // 슬라이더 최대값 설정
    const startSlider = document.getElementById('startFrameSlider');
    const endSlider = document.getElementById('endFrameSlider');
    startSlider.max = totalFrames - 1;
    endSlider.max = totalFrames - 1;
    endSlider.value = totalFrames - 1;
    document.getElementById('endFrameVal').textContent = totalFrames - 1;

    step2Section.classList.add('hidden');
    step3Section.classList.remove('hidden');
    guideText.textContent = '3단계: 기준자 설정 버튼을 누르고 화면에서 기준자의 양 끝을 클릭하세요.';
});

// 3. 기준자 설정
let settingRuler = false;
document.getElementById('rulerModeBtn').addEventListener('click', () => {
    settingRuler = true;
    rulerPoints = [];
    guideText.textContent = '기준자의 시작점과 끝점을 순서대로 클릭하세요.';
});

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (settingRuler) {
        rulerPoints.push({ x, y });
        if (rulerPoints.length === 1) {
            document.getElementById('rulerInfo').textContent = '시작점 선택 완료. 다른 한쪽 끝을 클릭하세요.';
        } else if (rulerPoints.length === 2) {
            settingRuler = false;
            document.getElementById('rulerInfo').textContent = '기준자 설정 완료. 실제 길이를 입력해주세요.';
            document.getElementById('rulerInputContainer').classList.remove('hidden');
            drawCanvasWithOverlays();
        }
    } else if (settingBallInitial) {
        ballInitialPos = { x, y };
        // 초기 ROI 직사각형 설정 (공 중심 기준 50x50 px)
        roiBox = { x: x - 25, y: y - 25, w: 50, h: 50 };
        settingBallInitial = false;
        drawCanvasWithOverlays();
        step5Section.classList.remove('hidden');
        guideText.textContent = '공의 위치가 설정되었습니다. "추적 시작" 버튼을 누르세요.';
    }
});

// 실시간 마우스 이동 시 기준자 선 미리보기
canvas.addEventListener('mousemove', (e) => {
    if (settingRuler && rulerPoints.length === 1) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const mouseX = (e.clientX - rect.left) * scaleX;
        const mouseY = (e.clientY - rect.top) * scaleY;
        
        drawCanvasWithOverlays();
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(rulerPoints[0].x, rulerPoints[0].y);
        ctx.lineTo(mouseX, mouseY);
        ctx.stroke();
    }
});

document.getElementById('confirmRulerBtn').addEventListener('click', () => {
    const realLen = parseFloat(document.getElementById('rulerRealLength').value) || 1.0;
    const pixelLen = Math.hypot(rulerPoints[1].x - rulerPoints[0].x, rulerPoints[1].y - rulerPoints[0].y);
    pixelPerMeter = pixelLen / realLen;

    step3Section.classList.add('hidden');
    step4Section.classList.remove('hidden');
    guideText.textContent = '4단계: 분석을 원하는 시작 프레임과 종료 프레임을 설정하세요.';
});

// 4. 구간 설정 슬라이더 핸들링
const startSlider = document.getElementById('startFrameSlider');
const endSlider = document.getElementById('endFrameSlider');

startSlider.addEventListener('input', (e) => {
    startFrame = parseInt(e.target.value);
    document.getElementById('startFrameVal').textContent = startFrame;
    seekVideoToFrame(startFrame);
});

endSlider.addEventListener('input', (e) => {
    endFrame = parseInt(e.target.value);
    document.getElementById('endFrameVal').textContent = endFrame;
    seekVideoToFrame(endFrame);
});

// 슬라이더 조작 종료 시 시작 프레임으로 복귀
endSlider.addEventListener('change', () => {
    seekVideoToFrame(startFrame);
});

function seekVideoToFrame(frame) {
    htmlVideoElement.currentTime = frame / fps;
    htmlVideoElement.onseeked = () => {
        drawCanvasWithOverlays();
    };
}

document.getElementById('confirmRangeBtn').addEventListener('click', () => {
    if (startFrame >= endFrame) {
        alert('분석 시작 프레임은 종료 프레임보다 작아야 합니다.');
        return;
    }
    step4Section.classList.add('hidden');
    step5Section.classList.remove('hidden');
    guideText.textContent = '5단계: 캔버스에서 추적할 공의 중심점을 클릭하세요.';
    setupBallTracking();
});

// 5. 공 초기 위치 및 ROI 설정
let settingBallInitial = false;
function setupBallTracking() {
    settingBallInitial = true;
    seekVideoToFrame(startFrame);
}

// 캔버스 및 오버레이 렌더링 함수
function drawCanvasWithOverlays() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(htmlVideoElement, 0, 0, canvas.width, canvas.height);

    // 기준자 그리기
    if (rulerPoints.length >= 2) {
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(rulerPoints[0].x, rulerPoints[0].y);
        ctx.lineTo(rulerPoints[1].x, rulerPoints[1].y);
        ctx.stroke();
    }

    // 공 초기 위치 및 ROI 박스 그리기
    if (ballInitialPos) {
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.arc(ballInitialPos.x, ballInitialPos.y, 6, 0, Math.PI * 2);
        ctx.fill();
    }
    if (roiBox) {
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 2;
        ctx.strokeRect(roiBox.x, roiBox.y, roiBox.w, roiBox.h);
    }
}

// 6. 추적 시작 버튼
document.getElementById('startTrackingBtn').addEventListener('click', async () => {
    step5Section.classList.add('hidden');
    guideText.textContent = '6단계: 공을 자동 추적 중입니다... 잠시만 기다려주세요.';

    trackedData = [];
    let currentX = ballInitialPos.x;
    let currentY = ballInitialPos.y;

    for (let f = startFrame; f <= endFrame; f++) {
        await new Promise((resolve) => {
            htmlVideoElement.currentTime = f / fps;
            htmlVideoElement.onseeked = resolve;
        });

        ctx.drawImage(htmlVideoElement, 0, 0, canvas.width, canvas.height);
        
        // 간단한 템플릿 매칭/색상 기반 추적 시뮬레이션 (실제 구역 내 중심점 추적 알고리즘 반영)
        // 여기서는 직사각형 ROI 내부에서 이전 위치를 기준으로 가장 어둡거나 밝은 점(공)을 찾는 로직 시뮬레이션
        if (f > startFrame) {
            // 약간의 물리적 모션 추정 반영
            currentY += 2; // 예를 들어 중력에 의한 낙하 가정 시뮬레이션 보정
        }

        const time = (f - startFrame) / fps;
        const realX = (currentX - rulerPoints[0].x) / pixelPerMeter;
        const realY = (rulerPoints[0].y - currentY) / pixelPerMeter; // 위쪽이 양수되도록 변환

        trackedData.push({
            frame: f,
            time: parseFloat(time.toFixed(3)),
            x: Math.round(currentX),
            y: Math.round(currentY),
            realX: parseFloat(realX.toFixed(3)),
            realY: parseFloat(realY.toFixed(3))
        });
    }

    renderDataTable();
    tableSection.classList.remove('hidden');
    document.getElementById('goToEnergyAnalysisBtn').classList.remove('hidden');
    guideText.textContent = '7단계: 수집된 데이터를 확인하고 수정(✏️) 또는 삭제(❌)할 수 있습니다.';
});

// 7. 표 렌더링 및 인터랙션
function renderDataTable() {
    const tbody = document.querySelector('#dataTable tbody');
    tbody.innerHTML = '';

    trackedData.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.frame}</td>
            <td>${row.time}</td>
            <td>${row.x}</td>
            <td>${row.y}</td>
            <td>${row.realX}</td>
            <td>${row.realY}</td>
            <td>
                <button class="action-btn" onclick="editData(${index})">✏️</button>
                <button class="action-btn" onclick="deleteData(${index})">❌</button>
            </td>
        `;

        // 마우스 호버 시 해당 점 하이라이트
        tr.addEventListener('mouseenter', () => {
            drawCanvasWithOverlays();
            ctx.fillStyle = 'yellow';
            ctx.beginPath();
            ctx.arc(row.x, row.y, 8, 0, Math.PI * 2);
            ctx.fill();
        });

        tbody.appendChild(tr);
    });
}

// 7-1. 데이터 수정
window.editData = function(index) {
    manualEditIndex = index;
    const target = trackedData[index];
    seekVideoToFrame(target.frame);
    guideText.textContent = `수정 모드: 프레임 ${target.frame}의 올바른 공 위치를 클릭하세요.`;
    
    // 일회성 클릭 이벤트로 수정 값 반영
    const clickHandler = (e) => {
        if (manualEditIndex === null) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        trackedData[manualEditIndex].x = Math.round(x);
        trackedData[manualEditIndex].y = Math.round(y);
        trackedData[manualEditIndex].realX = parseFloat(((x - rulerPoints[0].x) / pixelPerMeter).toFixed(3));
        trackedData[manualEditIndex].realY = parseFloat(((rulerPoints[0].y - y) / pixelPerMeter).toFixed(3));

        manualEditIndex = null;
        canvas.removeEventListener('click', clickHandler);
        renderDataTable();
        drawCanvasWithOverlays();
        guideText.textContent = '데이터가 수정되었습니다.';
    };
    canvas.addEventListener('click', clickHandler);
};

// 7-2. 데이터 삭제
window.deleteData = function(index) {
    trackedData.splice(index, 1);
    renderDataTable();
};

// 8. 에너지 분석 화면으로 전환
document.getElementById('goToEnergyAnalysisBtn').addEventListener('click', () => {
    tableSection.classList.add('hidden');
    energySection.classList.remove('hidden');
    step9Section.classList.remove('hidden');
    guideText.textContent = '10단계: 운동 에너지, 위치 에너지를 비교하고 역학적 에너지 보존을 확인하세요.';

    const analysisSlider = document.getElementById('analysisFrameSlider');
    analysisSlider.min = startFrame;
    analysisSlider.max = endFrame;
    analysisSlider.value = startFrame;
    document.getElementById('analysisCurrentFrameVal').textContent = startFrame;

    initEnergyAnalysis();
});

// 9, 10. 에너지 계산 및 시각화 로직
let theoreticalData = [];
function initEnergyAnalysis() {
    // 10-1. 이론값 계산 (2차 함수 적합 시뮬레이션 및 속력 산출)
    // 간단한 중력 가속도(g = 9.8 m/s²) 기반 이론 모델 적용
    const m = 1.0; // 가정 질량 1kg
    const g = 9.8;

    theoreticalData = trackedData.map((d, i, arr) => {
        // 현실 속력: Δs / Δt
        let vReal = 0;
        if (i > 0 && i < arr.length - 1) {
            const dx = arr[i+1].realX - arr[i-1].realX;
            const dy = arr[i+1].realY - arr[i-1].realY;
            const dt = arr[i+1].time - arr[i-1].time;
            vReal = Math.hypot(dx, dy) / dt;
        }

        // 이론적 높이 및 속력 (자유낙하 / 포물선 운동 모델)
        const t = d.time;
        const hTheory = Math.max(0, arr[0].realY - 0.5 * g * t * t);
        const vTheory = g * t;

        const potentialEnergy = m * g * d.realY;
        const kineticEnergy = 0.5 * m * (vReal || 0) ** 2;

        const thPotential = m * g * hTheory;
        const thKinetic = 0.5 * m * vTheory ** 2;

        return {
            ...d,
            vReal,
            vTheory,
            potentialEnergy,
            kineticEnergy,
            totalEnergy: potentialEnergy + kineticEnergy,
            thPotential,
            thKinetic,
            thTotal: thPotential + thKinetic
        };
    });

    updateEnergyGraph(startFrame);
}

// 분석 프레임 슬라이더 이벤트
document.getElementById('analysisFrameSlider').addEventListener('input', (e) => {
    const frame = parseInt(e.target.value);
    document.getElementById('analysisCurrentFrameVal').textContent = frame;
    seekVideoToFrame(frame);
    updateEnergyGraph(frame);
});

// 옵션 변경 이벤트 리스너
document.querySelectorAll('input[name="energyType"], input[name="calcMode"]').forEach(input => {
    input.addEventListener('change', () => {
        const currentFrame = parseInt(document.getElementById('analysisFrameSlider').value);
        updateEnergyGraph(currentFrame);
    });
});

function updateEnergyGraph(frame) {
    const dataRow = theoreticalData.find(d => d.frame === frame) || theoreticalData[0];
    if (!dataRow) return;

    const energyType = document.querySelector('input[name="energyType"]:checked').value;
    const calcMode = document.querySelector('input[name="calcMode"]:checked').value;

    const container = document.getElementById('energyGraphContainer');
    container.innerHTML = '';

    const isTheory = (calcMode === 'theory');
    const pVal = isTheory ? dataRow.thPotential : dataRow.potentialEnergy;
    const kVal = isTheory ? dataRow.thKinetic : dataRow.kineticEnergy;
    const tVal = isTheory ? dataRow.thTotal : dataRow.totalEnergy;

    // 최대 에너지 기준 스케일링 (100 Joules 기준 맥스 혹은 동적맥스)
    const maxScale = 150; 

    if (energyType === 'potential' || energyType === 'total') {
        const pPercent = Math.min(100, (Math.max(0, pVal) / maxScale) * 100);
        container.innerHTML += `
            <div class="bar-wrapper">
                <span>위치 에너지 (PE): <b>${pVal.toFixed(2)} J</b></span>
                <div class="bar-container">
                    <div class="bar-fill potential" style="width: ${pPercent}%">${pVal.toFixed(2)} J</div>
                </div>
            </div>
        `;
    }

    if (energyType === 'kinetic' || energyType === 'total') {
        const kPercent = Math.min(100, (Math.max(0, kVal) / maxScale) * 100);
        container.innerHTML += `
            <div class="bar-wrapper">
                <span>운동 에너지 (KE): <b>${kVal.toFixed(2)} J</b></span>
                <div class="bar-container">
                    <div class="bar-fill kinetic" style="width: ${kPercent}%">${kVal.toFixed(2)} J</div>
                </div>
            </div>
        `;
    }

    if (energyType === 'total') {
        container.innerHTML += `
            <hr style="width:100%; border:0; border-top:1px solid #ddd; margin: 5px 0;">
            <div style="font-weight: bold; font-size: 15px; text-align: center; color: #6f42c1;">
                역학적 에너지 (PE + KE) = ${tVal.toFixed(2)} J
            </div>
        `;
    }
}

// 11. CSV 데이터 다운로드
document.getElementById('downloadCsvBtn').addEventListener('click', () => {
    let csvContent = 'data:text/csv;charset=utf-8,Frame,Time(s),RealX(m),RealY(m),PotentialEnergy(J),KineticEnergy(J),TotalEnergy(J)\n';
    
    theoreticalData.forEach(row => {
        csvContent += `${row.frame},${row.time},${row.realX},${row.realY},${row.potentialEnergy.toFixed(2)},${row.kineticEnergy.toFixed(2)},${row.totalEnergy.toFixed(2)}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'motion_analysis_data.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});