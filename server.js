const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
const TrackerServer = require('bittorrent-tracker').Server;

const port = process.env.PORT || 10000;

// 1. 코어 HTTP 서버
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Airoui Nexus: Sovereign Node Active (P2P + Relay + WebTorrent Tracker)\n');
});

// 2. WebTorrent Tracker 코어 (신규 이식)
const tracker = new TrackerServer({
    http: false,
    udp: false,
    ws: true,
    filter: function (infoHash, params, cb) {
        cb(null); // 모든 파일 통신 승인
    }
});
tracker.on('error', (err) => { console.log('Tracker Error: ', err.message); });
tracker.on('warning', (err) => { console.log('Tracker Warning: ', err.message); });

// 3. Y-WebSocket Relay 코어
const wssRelay = new WebSocket.Server({ noServer: true });
wssRelay.on('connection', setupWSConnection);

// 4. Y-WebRTC Signaling 코어 (P2P 신호등)
const wssSignaling = new WebSocket.Server({ noServer: true });
const map = new Map();
wssSignaling.on('connection', (conn) => {
    conn.isAlive = true;
    conn.on('pong', () => { conn.isAlive = true; });
    conn.subscribedTopics = new Set();
    
    conn.on('message', (message) => {
        try {
            const msg = JSON.parse(message);
            if (msg && msg.type) {
                switch (msg.type) {
                    case 'subscribe':
                        (msg.topics || []).forEach(topicName => {
                            let topic = map.get(topicName);
                            if (!topic) {
                                topic = new Set();
                                map.set(topicName, topic);
                            }
                            topic.add(conn);
                            conn.subscribedTopics.add(topicName);
                        });
                        break;
                    case 'unsubscribe':
                        (msg.topics || []).forEach(topicName => {
                            const topic = map.get(topicName);
                            if (topic) { topic.delete(conn); }
                            conn.subscribedTopics.delete(topicName);
                        });
                        break;
                    case 'publish':
                        if (msg.topic) {
                            const receivers = map.get(msg.topic);
                            if (receivers) {
                                const out = JSON.stringify({ type: 'publish', topic: msg.topic, data: msg.data });
                                receivers.forEach(receiver => {
                                    if (receiver !== conn && receiver.readyState === WebSocket.OPEN) {
                                        receiver.send(out);
                                    }
                                });
                            }
                        }
                        break;
                    case 'ping':
                        conn.send(JSON.stringify({ type: 'pong' }));
                        break;
                }
            }
        } catch (err) { console.error(err); }
    });

    conn.on('close', () => {
        conn.subscribedTopics.forEach(topicName => {
            const topic = map.get(topicName);
            if (topic) {
                topic.delete(conn);
                if (topic.size === 0) map.delete(topicName);
            }
        });
    });
});

setInterval(() => {
    wssSignaling.clients.forEach(conn => {
        if (!conn.isAlive) return conn.terminate();
        conn.isAlive = false;
        conn.ping();
    });
}, 30000);

// 5. 통합 라우터 (하나의 서버에서 3개의 통신로 분배)
server.on('upgrade', (request, socket, head) => {
    const pathname = request.url;

    if (pathname === '/tracker') {
        tracker.ws.handleUpgrade(request, socket, head, (ws) => {
            tracker.ws.emit('connection', ws, request);
        });
    } 
    else if (pathname === '/signaling') {
        wssSignaling.handleUpgrade(request, socket, head, (ws) => {
            wssSignaling.emit('connection', ws, request);
        });
    } 
    else if (pathname.startsWith('/relay')) {
        wssRelay.handleUpgrade(request, socket, head, (ws) => {
            wssRelay.emit('connection', ws, request);
        });
    } 
    else {
        socket.destroy();
    }
});

server.listen(port, () => {
    console.log(`[Airoui Nexus] Triple-Core Server activated on port ${port}`);
    console.log(`- Relay Engine: /relay`);
    console.log(`- Signaling Engine: /signaling`);
    console.log(`- Torrent Tracker: /tracker`);
});