// ==============================================================================
// 데이터 분석 그래프 (Chart.js) & HTML 표 생성 모듈
// ==============================================================================
let analysisChartInstance = null;

function getSelectedSensorKeys() {
    const checked = document.querySelectorAll('.sensor-chk:checked');
    const selected = [];
    checked.forEach(chk => selected.push(chk.value));
    return selected;
}

function renderAnalysisView(recordedData) {
    const selected = getSelectedSensorKeys();
    const ctxElem = document.getElementById('analysisChart');
    if (!ctxElem) return;

    const ctx = ctxElem.getContext('2d');
    const labels = recordedData.map(d => d.timestamp);

    // 기존 차트 메모리 해제
    if (analysisChartInstance) {
        analysisChartInstance.destroy();
        analysisChartInstance = null;
    }

    if (selected.length === 0) {
        document.getElementById('tableHeader').innerHTML = `<th class="p-2.5">시각</th><th class="p-2.5">데이터</th>`;
        document.getElementById('tableBody').innerHTML = '';
        return;
    }

    // [경우 1] 센서 1개 선택 -> 시간-데이터 꺾은선 그래프
    if (selected.length === 1) {
        const sKey = selected[0];
        const cfg = SENSOR_CONFIG[sKey];

        analysisChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `${cfg.name} (${cfg.unit})`,
                    data: recordedData.map(d => d[sKey]),
                    borderColor: cfg.color,
                    backgroundColor: cfg.color + '22',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8' } } },
                scales: {
                    x: { ticks: { color: '#64748b' }, grid: { color: '#334155' } },
                    y: { ticks: { color: '#64748b' }, grid: { color: '#334155' } }
                }
            }
        });

        document.getElementById('tableHeader').innerHTML = `<th class="p-2.5">시각</th><th class="p-2.5">${cfg.name} (${cfg.unit})</th>`;
        document.getElementById('tableBody').innerHTML = recordedData.map(d => 
            `<tr class="hover:bg-slate-700/40"><td class="p-2.5">${d.timestamp}</td><td class="p-2.5 font-bold text-cyan-400">${d[sKey] ?? '---'}</td></tr>`
        ).join('');

    } 
    // [경우 2] 센서 2개 선택 -> 데이터1-데이터2 관계 분석 (Scatter 산점도)
    else if (selected.length === 2) {
        const k1 = selected[0], k2 = selected[1];
        const c1 = SENSOR_CONFIG[k1], c2 = SENSOR_CONFIG[k2];

        analysisChartInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: `${c1.name} vs ${c2.name}`,
                    data: recordedData.map(d => ({ x: d[k1], y: d[k2] })),
                    backgroundColor: c1.color,
                    borderColor: c2.color,
                    pointRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: '#94a3b8' } } },
                scales: {
                    x: { title: { display: true, text: `${c1.name} (${c1.unit})`, color: '#94a3b8' }, ticks: { color: '#64748b' }, grid: { color: '#334155' } },
                    y: { title: { display: true, text: `${c2.name} (${c2.unit})`, color: '#94a3b8' }, ticks: { color: '#64748b' }, grid: { color: '#334155' } }
                }
            }
        });

        document.getElementById('tableHeader').innerHTML = `<th class="p-2.5">시각</th><th class="p-2.5">${c1.name}</th><th class="p-2.5">${c2.name}</th>`;
        document.getElementById('tableBody').innerHTML = recordedData.map(d => 
            `<tr class="hover:bg-slate-700/40"><td class="p-2.5">${d.timestamp}</td><td class="p-2.5 text-amber-400">${d[k1] ?? '---'}</td><td class="p-2.5 text-cyan-400">${d[k2] ?? '---'}</td></tr>`
        ).join('');
    }
}