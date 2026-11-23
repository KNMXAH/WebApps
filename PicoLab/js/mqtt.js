// ==============================================================================
// MQTT 웹소켓 통신 연결 모듈
// ==============================================================================
let mqttClient = null;
let connectionSeq = 0;

function setupMQTTConnection(picoId, onStatusChange, onDataReceived) {
    if (!picoId || picoId.length !== 6) {
        alert('6자리 피코 ID를 정확히 입력하세요.');
        return;
    }

    const currentSeq = ++connectionSeq;
    const topic = `pico/science/${picoId}/data`;

    if (mqttClient) {
        const prevClient = mqttClient;
        mqttClient = null;
        prevClient.removeAllListeners();
        prevClient.end(true);
    }

    const client = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');
    mqttClient = client;

    client.on('connect', () => {
        if (currentSeq !== connectionSeq) return;
        console.log(`[MQTT] 피코 토픽 구독 성공: ${topic}`);
        if (onStatusChange) onStatusChange('connected', picoId);
        client.subscribe(topic);
    });

    client.on('message', (t, message) => {
        if (currentSeq !== connectionSeq) return;
        try {
            const payload = JSON.parse(message.toString());
            if (onDataReceived) onDataReceived(payload);
        } catch (err) {
            console.error('[MQTT] JSON 파싱 에러:', err);
        }
    });

    client.on('error', (err) => {
        if (currentSeq !== connectionSeq) return;
        console.error('[MQTT] 연결 오류:', err);
        if (onStatusChange) onStatusChange('error', err);
    });

    client.on('close', () => {
        if (currentSeq !== connectionSeq) return;
        if (onStatusChange) onStatusChange('closed');
    });
}