// ==============================================================================
// MQTT 웹소켓 통신 연결 모듈
// ==============================================================================
let mqttClient = null;

function setupMQTTConnection(picoId, onStatusChange, onDataReceived) {
    if (!picoId || picoId.length !== 6) {
        alert('6자리 피코 ID를 정확히 입력하세요.');
        return;
    }

    const topic = `pico/science/${picoId}/data`;

    if (mqttClient) {
        mqttClient.end();
    }

    // 공개 브로커 보안 웹소켓(WSS) 연결
    mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt');

    mqttClient.on('connect', () => {
        console.log(`[MQTT] 피코 토픽 구독 성공: ${topic}`);
        if (onStatusChange) onStatusChange('connected', picoId);
        mqttClient.subscribe(topic);
    });

    mqttClient.on('message', (t, message) => {
        try {
            const payload = JSON.parse(message.toString());
            if (onDataReceived) onDataReceived(payload);
        } catch (err) {
            console.error('[MQTT] JSON 파싱 에러:', err);
        }
    });

    mqttClient.on('error', (err) => {
        console.error('[MQTT] 연결 오류:', err);
        if (onStatusChange) onStatusChange('error', err);
    });

    mqttClient.on('close', () => {
        if (onStatusChange) onStatusChange('closed');
    });
}