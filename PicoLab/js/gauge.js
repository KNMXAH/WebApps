// ==============================================================================
// 1. 센서 사양 및 색상 정의
// ==============================================================================
const SENSOR_CONFIG = {
    co2: { name: 'CO₂', unit: 'ppm', min: 0, max: 2000, color: '#10b981', elemId: 'valCO2', canvasId: 'gaugeCO2' },
    temperature: { name: '대기온도', unit: '°C', min: -10, max: 50, color: '#f59e0b', elemId: 'valTemp', canvasId: 'gaugeTemp' },
    humidity: { name: '습도', unit: '%', min: 0, max: 100, color: '#06b6d4', elemId: 'valHumidity', canvasId: 'gaugeHumidity' },
    pressure: { name: '기압', unit: 'hPa', min: 900, max: 1100, color: '#6366f1', elemId: 'valPressure', canvasId: 'gaugePressure' },
    distance: { name: '거리', unit: 'mm', min: 0, max: 1500, color: '#a855f7', elemId: 'valDistance', canvasId: 'gaugeDistance' },
    weight: { name: '무게', unit: 'g', min: 0, max: 1000, color: '#f43f5e', elemId: 'valWeight', canvasId: 'gaugeWeight' },
    water_temp: { name: '수온', unit: '°C', min: -10, max: 50, color: '#14b8a6', elemId: 'valWaterTemp', canvasId: 'gaugeWaterTemp' }
};

// ==============================================================================
// 2. Canvas 반원 게이지 그리기 함수
// ==============================================================================
function drawGaugeArc(canvasId, value, min, max, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h - 15, radius = 65;

    ctx.clearRect(0, 0, w, h);

    // 바탕 회색 트랙
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI, 2 * Math.PI, false);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#334155';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 동적 게이지 채우기
    const valRatio = Math.min(Math.max((value - min) / (max - min), 0), 1);
    const endAngle = Math.PI + (valRatio * Math.PI);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI, endAngle, false);
    ctx.lineWidth = 14;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();
}

// ==============================================================================
// 3. 전체 게이지 초기화 및 센서 수신 데이터 업데이트
// ==============================================================================
function initGauges() {
    Object.keys(SENSOR_CONFIG).forEach(key => {
        const cfg = SENSOR_CONFIG[key];
        drawGaugeArc(cfg.canvasId, cfg.min, cfg.min, cfg.max, cfg.color);
    });
}

function updateGaugeDisplays(sensorsData) {
    if (!sensorsData) return;
    Object.keys(SENSOR_CONFIG).forEach(key => {
        const cfg = SENSOR_CONFIG[key];
        const val = sensorsData[key];
        if (val !== undefined && val !== null) {
            const valElem = document.getElementById(cfg.elemId);
            if (valElem) valElem.innerText = val;
            drawGaugeArc(cfg.canvasId, val, cfg.min, cfg.max, cfg.color);
        }
    });
}