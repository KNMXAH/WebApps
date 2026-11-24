// ==============================================================================
// 애플리케이션 상태 및 제어 메인 로직
// ==============================================================================
let isRecording = false;
let recordedData = [];
let currentPicoId = '';

let _analysisRenderTimer = null;
const ANALYSIS_RENDER_INTERVAL_MS = 400;

function scheduleAnalysisRender() {
    if (_analysisRenderTimer !== null) return;
    _analysisRenderTimer = setTimeout(() => {
        _analysisRenderTimer = null;
        if (!document.getElementById('analysisView').classList.contains('hidden')) {
            renderAnalysisView(recordedData);
        }
    }, ANALYSIS_RENDER_INTERVAL_MS);
}

function clearPendingAnalysisRender() {
    if (_analysisRenderTimer !== null) {
        clearTimeout(_analysisRenderTimer);
        _analysisRenderTimer = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. 게이지 초기화
    initGauges();

    // 2. 이벤트 버튼 바인딩
    document.getElementById('btnConnect').addEventListener('click', handleConnectClick);
    document.getElementById('btnRec').addEventListener('click', toggleRecording);
    document.getElementById('tabDash').addEventListener('click', () => switchTab('dashboard'));
    document.getElementById('tabAnalysis').addEventListener('click', () => switchTab('analysis'));
    document.getElementById('btnDownload').addEventListener('click', downloadCSV);

    // 3. 센서 체크박스 2개 제한 이벤트 지정
    document.querySelectorAll('.sensor-chk').forEach(chk => {
        chk.addEventListener('change', (e) => {
            const selected = getSelectedSensorKeys();
            if (selected.length > 2) {
                e.target.checked = false;
                alert('센서는 최대 2개까지만 선택 가능합니다.');
                return;
            }
            renderAnalysisView(recordedData);
        });
    });
});

// ------------------------------------------------------------------------------
// 연결 및 통신 처리
// ------------------------------------------------------------------------------
function handleConnectClick() {
    const inputVal = document.getElementById('picoIdInput').value.trim().toLowerCase();
    currentPicoId = inputVal;

    if (!inputVal || inputVal.length !== 6) {
        alert('6자리 피코 ID를 정확히 입력하세요.');
        return;
    }

    // 새 기기 연결 시 이전 수집 기록 초기화
    clearPendingAnalysisRender();
    recordedData = [];
    document.getElementById('recCount').innerText = '기록된 데이터: 0개';
    if (!document.getElementById('analysisView').classList.contains('hidden')) {
        renderAnalysisView(recordedData);
    }

    setupMQTTConnection(
        currentPicoId,
        (status, details) => {
            const badge = document.getElementById('statusBadge');
            if (status === 'connected') {
                badge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> 연결됨: ${details}`;
            } else if (status === 'closed' || status === 'error') {
                badge.className = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20';
                badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span> 연결 해제됨`;
            }
        },
        (packet) => {
            // 게이지 화면 업데이트
            updateGaugeDisplays(packet.sensors);

            // 데이터 수집 중일 경우 백그라운드 배열 저장
            if (isRecording) {
                const row = { timestamp: packet.timestamp || new Date().toLocaleTimeString(), ...(packet.sensors || {}) };
                recordedData.push(row);
                document.getElementById('recCount').innerText = `기록된 데이터: ${recordedData.length}개`;
                
                // 현재 분석 화면이 열려있다면 일정 간격(400ms)으로 그래프와 표 갱신 예약
                if (!document.getElementById('analysisView').classList.contains('hidden')) {
                    scheduleAnalysisRender();
                }
            }
        }
    );
}

// ------------------------------------------------------------------------------
// UI 제어 (수집 시작/정지, 탭 전환)
// ------------------------------------------------------------------------------
function toggleRecording() {
    isRecording = !isRecording;
    const btn = document.getElementById('btnRec');
    if (isRecording) {
        btn.className = 'bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition';
        btn.innerHTML = '⏸ 수집 일시정지';
    } else {
        btn.className = 'bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition';
        btn.innerHTML = '▶ 데이터 수집 시작';
    }
}

function switchTab(tab) {
    const dashView = document.getElementById('dashboardView');
    const analysisView = document.getElementById('analysisView');
    const tabDashBtn = document.getElementById('tabDash');
    const tabAnalysisBtn = document.getElementById('tabAnalysis');

    if (tab === 'dashboard') {
        dashView.classList.remove('hidden');
        dashView.classList.add('grid');
        analysisView.classList.add('hidden');
        tabDashBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white';
        tabAnalysisBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200';
    } else {
        dashView.classList.add('hidden');
        dashView.classList.remove('grid');
        analysisView.classList.remove('hidden');
        analysisView.classList.add('grid');
        tabDashBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200';
        tabAnalysisBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 text-white';
        clearPendingAnalysisRender();
        renderAnalysisView(recordedData);
    }
}

// ------------------------------------------------------------------------------
// CSV 데이터 익스포트
// ------------------------------------------------------------------------------
function escapeCSVField(val) {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function downloadCSV() {
    if (recordedData.length === 0) {
        alert('다운로드할 수집 데이터가 없습니다.');
        return;
    }

    const keys = ['timestamp', 'co2', 'BMP temperature', 'SCD temperature', 'humidity', 'pressure', 'distance', 'weight', 'water_temp'];
    const lines = [keys.map(escapeCSVField).join(',')];

    recordedData.forEach(row => {
        const line = keys.map(k => escapeCSVField(row[k])).join(',');
        lines.push(line);
    });

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pico_science_data_${currentPicoId || 'export'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}