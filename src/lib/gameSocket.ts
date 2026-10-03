import { PlayerControlInput, PlayerPlane } from '../types/gameTypes';

type MessageHandler = (data: any) => void;

class GameSocketClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnecting: boolean = false;
  private reconnectTimer: number | null = null;
  public isConnected: boolean = false;
  public roomId: string = 'sky-arena-1';
  public playerId: string | null = null;
  public role: 'host' | 'player' = 'player';

  public connect(role: 'host' | 'player', roomId: string = 'sky-arena-1', playerId?: string, callsign?: string, color?: string) {
    this.role = role;
    this.roomId = roomId;
    if (playerId) this.playerId = playerId;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        // Send join packet
        this.send({
          type: 'join',
          role: this.role,
          roomId: this.roomId,
          playerId: this.playerId,
          callsign,
          color,
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'joined') {
            this.playerId = data.playerId;
          }
          this.messageHandlers.forEach((handler) => handler(data));
        } catch (err) {
          console.error('Failed to parse WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('Game WebSocket error:', err);
        this.ws?.close();
      };
    } catch (err) {
      console.warn('Could not establish WebSocket connection:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected) {
        this.connect(this.role, this.roomId, this.playerId || undefined);
      }
    }, 2000);
  }

  public send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public sendControl(input: PlayerControlInput) {
    this.send({
      type: 'control',
      roomId: this.roomId,
      playerId: this.playerId,
      input,
    });
  }

  public spawnBot() {
    this.send({
      type: 'spawn_bot',
      roomId: this.roomId,
    });
  }

  public resetRoom() {
    this.send({
      type: 'reset_room',
      roomId: this.roomId,
    });
  }

  public onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  public disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}

export const gameSocket = new GameSocketClient();
