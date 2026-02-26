// 💥 [Nexus Sovereign Dual-Core Server] 
// WebRTC 시그널링(P2P)과 Y-Websocket 릴레이(중앙 중계)를 동시에 지원하는 궁극의 엔진

const ws = require('ws');
const http = require('http');
const setupWSConnection = require('y-websocket/bin/utils').setupWSConnection;

const port = process.env.PORT || 4444;

// HTTP 서버 생성
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Airoui Dual-Core Node is Online (P2P + Relay).\n');
});

// 웹소켓 서버 (WSS) 엔진 구동
const wss = new ws.Server({ noServer: true });

// WebRTC 시그널링용 메모리 맵
const rooms = new Map();
const pingInterval = 30000;

// 🚀 라우팅 코어: 접속 URL에 따라 P2P 시그널링과 Relay 엔진을 분리하여 처리
server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/relay')) {
    // [Core 1] 대규모 다중 접속 및 비동기 동기화를 위한 중앙 Relay 모드
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request, 'relay');
    });
  } else if (request.url.startsWith('/signaling')) {
    // [Core 2] 1:1 및 소규모 초고속 통신을 위한 순수 P2P 시그널링 모드
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request, 'signaling');
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (conn, req, mode) => {
  conn.isAlive = true;
  conn.on('pong', () => { conn.isAlive = true; });

  // [Core 1 작동] y-websocket 내장 유틸리티로 문서 상태 동기화 위임
  if (mode === 'relay') {
    setupWSConnection(conn, req, { gc: true });
    return;
  }

  // [Core 2 작동] WebRTC 수동 시그널링 로직
  if (mode === 'signaling') {
    const subscribedRooms = new Set();

    conn.on('message', message => {
      try {
        const data = JSON.parse(message);
        if (data && data.type) {
          switch (data.type) {
            case 'subscribe':
              if (data.topics) {
                data.topics.forEach(roomName => {
                  let room = rooms.get(roomName);
                  if (!room) { room = new Set(); rooms.set(roomName, room); }
                  room.add(conn);
                  subscribedRooms.add(roomName);
                });
              }
              break;
            case 'unsubscribe':
              if (data.topics) {
                data.topics.forEach(roomName => {
                  subscribedRooms.delete(roomName);
                  const room = rooms.get(roomName);
                  if (room) {
                    room.delete(conn);
                    if (room.size === 0) rooms.delete(roomName);
                  }
                });
              }
              break;
            case 'publish':
              if (data.topic) {
                const room = rooms.get(data.topic);
                if (room) {
                  const messageToSend = JSON.stringify(data);
                  room.forEach(client => {
                    if (client !== conn && client.readyState === ws.OPEN) {
                      client.send(messageToSend);
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
      } catch (err) {
        console.error('[Signaling Error]:', err.message);
      }
    });

    conn.on('close', () => {
      subscribedRooms.forEach(roomName => {
        const room = rooms.get(roomName);
        if (room) {
          room.delete(conn);
          if (room.size === 0) rooms.delete(roomName);
        }
      });
    });
  }
});

// 좀비 커넥션 청소기
setInterval(() => {
  wss.clients.forEach(conn => {
    if (!conn.isAlive) return conn.terminate();
    conn.isAlive = false;
    conn.ping();
  });
}, pingInterval);

server.listen(port, () => {
  console.log(`[Airoui Nexus] Dual-Core Server activated on port ${port}`);
});