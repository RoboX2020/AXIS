import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerPlane, PlayerControlInput, GameRoomState } from './src/types/gameTypes';
import { updatePlanePhysics, updateBotAI, computeClashWarning, CALLSIGNS, COLORS } from './src/lib/gamePhysics';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const port = 3000;

app.use(express.json());

// In-memory Game Rooms
interface ServerRoom {
  roomId: string;
  players: Record<string, PlayerPlane>;
  playerInputs: Record<string, PlayerControlInput>;
  sockets: Map<string, WebSocket>;
  hostSocket: WebSocket | null;
  lastTick: number;
}

const rooms: Record<string, ServerRoom> = {};

function getOrCreateRoom(roomId: string): ServerRoom {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      roomId,
      players: {},
      playerInputs: {},
      sockets: new Map(),
      hostSocket: null,
      lastTick: Date.now(),
    };

    // Pre-populate with 2 default aircraft for an exciting airspace right out of the box
    const plane1: PlayerPlane = {
      id: 'bot-1',
      callsign: 'VIPER-01',
      color: '#06b6d4',
      position: { x: -6, y: -4, z: 12000 },
      velocity: { x: 0.1, y: 0.1, z: 0 },
      heading: 45,
      pitch: 0,
      roll: 0,
      speed: 380,
      verticalSpeed: 0,
      throttle: 75,
      health: 100,
      isBot: true,
      score: 0,
      lastPing: Date.now(),
      history: [{ x: -6, y: -4, z: 12000 }],
    };

    const plane2: PlayerPlane = {
      id: 'bot-2',
      callsign: 'PHANTOM-02',
      color: '#f59e0b',
      position: { x: 6, y: 4, z: 12000 },
      velocity: { x: -0.1, y: -0.1, z: 0 },
      heading: 225,
      pitch: 0,
      roll: 0,
      speed: 400,
      verticalSpeed: 0,
      throttle: 80,
      health: 100,
      isBot: true,
      score: 0,
      lastPing: Date.now(),
      history: [{ x: 6, y: 4, z: 12000 }],
    };

    rooms[roomId].players[plane1.id] = plane1;
    rooms[roomId].players[plane2.id] = plane2;
  }
  return rooms[roomId];
}

// WebSocket Server for Real-Time Multiplayer Flights
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket, _req) => {
  let clientRoomId = 'sky-arena-1';
  let clientPlayerId = '';
  let clientRole: 'host' | 'player' = 'player';

  ws.on('message', (messageRaw: string) => {
    try {
      const msg = JSON.parse(messageRaw.toString());

      if (msg.type === 'join') {
        clientRoomId = msg.roomId || 'sky-arena-1';
        clientRole = msg.role || 'player';
        const room = getOrCreateRoom(clientRoomId);

        if (clientRole === 'host') {
          room.hostSocket = ws;
          // Send initial state to host
          ws.send(
            JSON.stringify({
              type: 'room_state',
              roomId: room.roomId,
              players: room.players,
            })
          );
        } else {
          // Mobile Player Join
          clientPlayerId = msg.playerId || `pilot-${Math.random().toString(36).substring(2, 7)}`;
          const assignedCallsign =
            msg.callsign || CALLSIGNS[Object.keys(room.players).length % CALLSIGNS.length];
          const assignedColor =
            msg.color || COLORS[Object.keys(room.players).length % COLORS.length];

          // Spawn near arena center with random offset
          const spawnAngle = Math.random() * Math.PI * 2;
          const spawnDist = 4 + Math.random() * 4;
          const spawnX = Math.cos(spawnAngle) * spawnDist;
          const spawnY = Math.sin(spawnAngle) * spawnDist;
          const spawnHeading = Math.round(((Math.atan2(-spawnY, -spawnX) * 180) / Math.PI + 360) % 360);

          const newPlayer: PlayerPlane = {
            id: clientPlayerId,
            callsign: assignedCallsign,
            color: assignedColor,
            position: { x: Number(spawnX.toFixed(2)), y: Number(spawnY.toFixed(2)), z: 10000 + Math.random() * 4000 },
            velocity: { x: 0, y: 0, z: 0 },
            heading: spawnHeading,
            pitch: 0,
            roll: 0,
            speed: 360,
            verticalSpeed: 0,
            throttle: 70,
            health: 100,
            isBot: false,
            score: 0,
            lastPing: Date.now(),
            history: [{ x: spawnX, y: spawnY, z: 12000 }],
          };

          room.players[clientPlayerId] = newPlayer;
          room.playerInputs[clientPlayerId] = {
            pitchInput: 0,
            rollInput: 0,
            yawInput: 0,
            throttleInput: 70,
          };
          room.sockets.set(clientPlayerId, ws);

          // Confirm join back to player
          ws.send(
            JSON.stringify({
              type: 'joined',
              playerId: clientPlayerId,
              callsign: assignedCallsign,
              color: assignedColor,
              roomId: clientRoomId,
            })
          );
        }
      } else if (msg.type === 'control') {
        const room = rooms[clientRoomId];
        if (room && clientPlayerId && msg.input) {
          room.playerInputs[clientPlayerId] = msg.input;
          if (room.players[clientPlayerId]) {
            room.players[clientPlayerId].lastPing = Date.now();
          }
        }
      } else if (msg.type === 'spawn_bot') {
        const room = getOrCreateRoom(clientRoomId);
        const botId = `bot-${Date.now().toString(36)}`;
        const botCallsign = CALLSIGNS[Object.keys(room.players).length % CALLSIGNS.length];
        const botColor = COLORS[Object.keys(room.players).length % COLORS.length];

        const spawnAngle = Math.random() * Math.PI * 2;
        const spawnDist = 5 + Math.random() * 5;
        const spawnX = Math.cos(spawnAngle) * spawnDist;
        const spawnY = Math.sin(spawnAngle) * spawnDist;

        const newBot: PlayerPlane = {
          id: botId,
          callsign: botCallsign,
          color: botColor,
          position: { x: Number(spawnX.toFixed(2)), y: Number(spawnY.toFixed(2)), z: 11000 + Math.random() * 3000 },
          velocity: { x: 0, y: 0, z: 0 },
          heading: Math.round(Math.random() * 360),
          pitch: 0,
          roll: 0,
          speed: 360,
          verticalSpeed: 0,
          throttle: 75,
          health: 100,
          isBot: true,
          score: 0,
          lastPing: Date.now(),
          history: [{ x: spawnX, y: spawnY, z: 12000 }],
        };

        room.players[botId] = newBot;
      } else if (msg.type === 'reset_room') {
        const room = rooms[clientRoomId];
        if (room) {
          // Retain human pilots but reset their positions
          Object.keys(room.players).forEach((pid) => {
            const p = room.players[pid];
            p.position = { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8, z: 12000 };
            p.heading = Math.round(Math.random() * 360);
            p.speed = 360;
            p.pitch = 0;
            p.roll = 0;
            p.history = [{ ...p.position }];
          });
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    const room = rooms[clientRoomId];
    if (room) {
      if (clientRole === 'host') {
        room.hostSocket = null;
      } else if (clientPlayerId) {
        room.sockets.delete(clientPlayerId);
        delete room.players[clientPlayerId];
        delete room.playerInputs[clientPlayerId];
      }
    }
  });
});

// 25Hz Server-Authoritative Physics & Broadcast Loop
setInterval(() => {
  const now = Date.now();

  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    const dtSec = (now - room.lastTick) / 1000;
    room.lastTick = now;

    if (dtSec <= 0 || dtSec > 0.5) continue;

    const allPlanesArray = Object.values(room.players);

    // 1. Update Physics for All Aircraft in Room
    for (const plane of allPlanesArray) {
      let input: PlayerControlInput;

      if (plane.isBot) {
        input = updateBotAI(plane, allPlanesArray, dtSec);
      } else {
        input = room.playerInputs[plane.id] || {
          pitchInput: 0,
          rollInput: 0,
          yawInput: 0,
          throttleInput: 70,
        };
      }

      room.players[plane.id] = updatePlanePhysics(plane, input, dtSec);
    }

    // 2. Broadcast Room State to Host Screen
    const payload = JSON.stringify({
      type: 'room_state',
      roomId: room.roomId,
      players: room.players,
      timestamp: now,
    });

    if (room.hostSocket && room.hostSocket.readyState === WebSocket.OPEN) {
      room.hostSocket.send(payload);
    }

    // 3. Send Individual Telemetry & Clash Warnings to Each Phone Controller
    for (const [playerId, sock] of room.sockets.entries()) {
      if (sock.readyState === WebSocket.OPEN && room.players[playerId]) {
        const ownPlane = room.players[playerId];
        const clashWarning = computeClashWarning(ownPlane, allPlanesArray);

        sock.send(
          JSON.stringify({
            type: 'player_telemetry',
            ownPlane,
            allPlanes: room.players,
            clashWarning,
            timestamp: now,
          })
        );
      }
    }
  }
}, 40); // 25Hz

// REST API Health Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeRooms: Object.keys(rooms).length,
    timestamp: new Date().toISOString(),
  });
});

// Mount Vite in Dev Mode or Serve Dist in Prod
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
