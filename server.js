// 💥 [Nexus Sovereign Signaling Server] 
// Dependencies: npm install ws (웹소켓 라이브러리)

const ws = require('ws');
const http = require('http');

// 환경 변수 포트 설정 (클라우드 배포 시 자동 할당됨)
const port = process.env.PORT || 4444;

// HTTP 서버 생성 (Websocket 업그레이드용 기본 판)
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('Airoui Sovereign Signaling Node is Online.\n');
});

// 웹소켓 서버 (WSS) 엔진 구동
const wss = new ws.Server({ noServer: true });

// 서버 업그레이드 핸들링
server.on('upgrade', (request, socket, head) => {
  // CORS 처리 등의 보안 로직 추가 가능
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});

// 방(Room) 단위로 접속자(Peers)를 관리하는 메모리 맵
// 구조: Map<RoomName, Set<WebSocket>>
const rooms = new Map();

// 핑(Ping) 간격 (죽은 연결(Zombie)을 주기적으로 청소하기 위함)
const pingInterval = 30000;

wss.on('connection', (conn, req) => {
  conn.isAlive = true;
  
  // 클라이언트가 퐁(Pong)으로 응답하면 연결 상태 유지
  conn.on('pong', () => {
    conn.isAlive = true;
  });

  // 클라이언트가 구독 중인 방 목록
  const subscribedRooms = new Set();

  conn.on('message', message => {
    try {
      // Y-WebRTC의 메시지 규격 파싱
      const data = JSON.parse(message);

      if (data && data.type) {
        switch (data.type) {
          
          // 1. 방 접속 (Subscribe)
          case 'subscribe':
            if (data.topics) {
              data.topics.forEach(roomName => {
                let room = rooms.get(roomName);
                if (!room) {
                  room = new Set();
                  rooms.set(roomName, room);
                }
                room.add(conn);
                subscribedRooms.add(roomName);
              });
            }
            break;

          // 2. 방 퇴장 (Unsubscribe)
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

          // 3. 시그널링 메시지 중계 (Publish / Broadcast)
          case 'publish':
            if (data.topic) {
              const room = rooms.get(data.topic);
              if (room) {
                const messageToSend = JSON.stringify(data);
                room.forEach(client => {
                  // 나 자신을 제외한 같은 방의 모든 사람에게 메시지(SDP, ICE) 전달
                  if (client !== conn && client.readyState === ws.OPEN) {
                    client.send(messageToSend);
                  }
                });
              }
            }
            break;

          // 4. 생존 신호 (Ping)
          case 'ping':
            conn.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      }
    } catch (err) {
      console.error('[Engine] Message Parsing Error:', err.message);
    }
  });

  // 연결 종료 시 가비지 컬렉션(청소)
  conn.on('close', () => {
    subscribedRooms.forEach(roomName => {
      const room = rooms.get(roomName);
      if (room) {
        room.delete(conn);
        if (room.size === 0) rooms.delete(roomName);
      }
    });
  });
});

// 주기적으로 죽은 연결(Zombie connection)을 찾아 강제 종료 (메모리 누수 방지)
setInterval(() => {
  wss.clients.forEach(conn => {
    if (!conn.isAlive) return conn.terminate();
    conn.isAlive = false;
    conn.ping();
  });
}, pingInterval);

server.listen(port, () => {
  console.log(`[Airoui Nexus] Sovereign Signaling Server activated on port ${port}`);
});