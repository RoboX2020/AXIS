import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// REST API Health Endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    system: 'AXIS: Airspace eXecution & Intercept System',
    timestamp: new Date().toISOString(),
  });
});

// LAN address so a QR code opened on localhost still works from a phone
app.get('/api/lan', (_req, res) => {
  const ips: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
  res.json({ ips });
});

// Live relay: the host screen (which runs the simulation) publishes state,
// phones in the same room subscribe and render their own cockpit view.
type Room = { host: WebSocket | null; viewers: Set<WebSocket>; last: string | null };
const rooms = new Map<string, Room>();
const wss = new WebSocketServer({ server, path: '/ws' });

function sendJSON(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
  let room: Room | null = null;
  let role: 'host' | 'viewer' | null = null;
  ws.on('message', (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'host' && typeof msg.room === 'string') {
      const code = msg.room.toUpperCase().slice(0, 8);
      room = rooms.get(code) ?? { host: null, viewers: new Set(), last: null };
      rooms.set(code, room);
      room.host = ws; role = 'host';
      sendJSON(ws, { type: 'hosted', viewers: room.viewers.size });
    } else if (msg.type === 'join' && typeof msg.room === 'string') {
      const code = msg.room.toUpperCase().slice(0, 8);
      room = rooms.get(code) ?? null;
      if (!room || !room.host) { sendJSON(ws, { type: 'error', error: 'Room not found. Rescan the QR code on the host screen.' }); return; }
      room.viewers.add(ws); role = 'viewer';
      sendJSON(ws, { type: 'joined' });
      if (room.last) ws.send(room.last);
      sendJSON(room.host, { type: 'viewers', viewers: room.viewers.size });
    } else if (msg.type === 'state' && role === 'host' && room) {
      const out = JSON.stringify({ type: 'state', state: msg.state });
      room.last = out;
      for (const v of room.viewers) if (v.readyState === WebSocket.OPEN) v.send(out);
    }
  });
  ws.on('close', () => {
    if (!room) return;
    if (role === 'viewer') {
      room.viewers.delete(ws);
      if (room.host) sendJSON(room.host, { type: 'viewers', viewers: room.viewers.size });
    } else if (role === 'host') {
      for (const v of room.viewers) sendJSON(v, { type: 'error', error: 'Host screen disconnected.' });
      room.host = null;
    }
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
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`AXIS Server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
