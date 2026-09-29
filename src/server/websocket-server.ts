import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

import type { Role } from '../core/index.ts';
import type { GameService } from './game-service.ts';
import {
  parseClientMessage,
  toErrorMessage,
  ProtocolError,
} from './websocket-protocol.ts';
import type {
  ClientMessage,
  ServerMessage,
  SocketSession,
} from './websocket-types.ts';

export interface RealtimeServerOptions {
  gameService: GameService;
  port?: number;
  server?: HttpServer;
}

/**
 * Realtime WebSocket server coordinating client connections and message dispatch.
 * Enforces strict per-player view projection and prevents identity switching.
 */
export class RealtimeServer {
  public readonly gameService: GameService;
  private readonly configuredPort: number;
  private httpServer?: HttpServer;
  private wss?: WebSocketServer;
  private isOwnedServer = false;

  // Connection registry: roomCode -> playerId -> WebSocket
  private readonly connections = new Map<string, Map<string, WebSocket>>();
  // Socket session mapping: WebSocket -> SocketSession
  private readonly socketSessions = new WeakMap<WebSocket, SocketSession>();

  constructor(options: RealtimeServerOptions) {
    this.gameService = options.gameService;
    this.configuredPort = options.port ?? (Number(process.env.WS_PORT) || 3001);
    if (options.server) {
      this.httpServer = options.server;
      this.isOwnedServer = false;
    }
  }

  /**
   * Starts the WebSocket server.
   * Returns the actual listening port.
   */
  async start(): Promise<number> {
    if (!this.httpServer) {
      this.httpServer = createServer();
      this.isOwnedServer = true;
    }

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupWss(this.wss);

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.configuredPort, () => {
        const address = this.httpServer!.address();
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          resolve(this.configuredPort);
        }
      });

      this.httpServer!.once('error', reject);
    });
  }

  /**
   * Sets up connection event handlers on the WebSocketServer.
   */
  private setupWss(wss: WebSocketServer): void {
    wss.on('connection', (socket: WebSocket) => {
      socket.on('message', (data: RawData) => {
        this.handleMessage(socket, data);
      });

      socket.on('close', () => {
        this.handleClose(socket);
      });

      socket.on('error', (err) => {
        console.error('[WebSocket] Socket error:', err.message);
      });
    });
  }

  /**
   * Dispatches and processes an incoming raw WebSocket message.
   */
  public handleMessage(socket: WebSocket, data: RawData): void {
    try {
      const rawString = typeof data === 'string' ? data : data.toString('utf-8');
      const message = parseClientMessage(rawString);
      this.processClientMessage(socket, message);
    } catch (err) {
      const errorMsg = toErrorMessage(err);
      this.sendToSocket(socket, errorMsg);
    }
  }

  /**
   * Processes a validated ClientMessage intent.
   */
  private processClientMessage(socket: WebSocket, message: ClientMessage): void {
    switch (message.type) {
      case 'create_room': {
        const currentSession = this.socketSessions.get(socket);
        if (currentSession && currentSession.playerId !== message.playerId) {
          throw new ProtocolError(
            'SESSION_ALREADY_ESTABLISHED',
            `Socket is already associated with player "${currentSession.playerId}".`,
          );
        }

        const room = this.gameService.createRoom(message.customCode);
        const view = this.gameService.joinRoom(room.code, message.playerId, message.role);
        this.associateSocket(socket, room.code, message.playerId, message.role);

        this.sendToSocket(socket, { type: 'room_state', view });
        break;
      }

      case 'join_room': {
        const currentSession = this.socketSessions.get(socket);
        if (currentSession && currentSession.playerId !== message.playerId) {
          throw new ProtocolError(
            'SESSION_ALREADY_ESTABLISHED',
            `Socket is already associated with player "${currentSession.playerId}".`,
          );
        }

        this.gameService.joinRoom(message.roomCode, message.playerId, message.role);
        this.associateSocket(socket, message.roomCode, message.playerId, message.role);

        // Broadcast individualized state to everyone in the room
        this.broadcastRoom(message.roomCode);
        break;
      }

      case 'place_order': {
        const session = this.socketSessions.get(socket);
        if (!session) {
          throw new ProtocolError(
            'SESSION_REQUIRED',
            'Must join or resume a room session before placing an order.',
          );
        }

        // Identity-switching protection
        if (message.playerId && message.playerId !== session.playerId) {
          throw new ProtocolError(
            'IDENTITY_MISMATCH',
            `Cannot submit order as "${message.playerId}". Socket identity is "${session.playerId}".`,
          );
        }

        if (message.roomCode && message.roomCode !== session.roomCode) {
          throw new ProtocolError(
            'ROOM_MISMATCH',
            `Room code "${message.roomCode}" does not match active session "${session.roomCode}".`,
          );
        }

        this.gameService.placeOrder(session.roomCode, session.playerId, message.order);

        // Broadcast updated individualized state
        this.broadcastRoom(session.roomCode);
        break;
      }

      case 'resume': {
        const { room, player } = this.gameService.getPlayer(message.roomCode, message.playerId);
        this.associateSocket(socket, room.code, player.id, player.role);

        const view = this.gameService.getPlayerView(room.code, player.id);
        this.sendToSocket(socket, { type: 'room_state', view });
        break;
      }
    }
  }

  /**
   * Associates a WebSocket with a verified player session in a room.
   */
  private associateSocket(
    socket: WebSocket,
    roomCode: string,
    playerId: string,
    role: Role,
  ): void {
    let roomMap = this.connections.get(roomCode);
    if (!roomMap) {
      roomMap = new Map<string, WebSocket>();
      this.connections.set(roomCode, roomMap);
    }

    const previousSocket = roomMap.get(playerId);
    if (previousSocket && previousSocket !== socket) {
      previousSocket.close(1000, 'Replaced by newer connection');
    }

    roomMap.set(playerId, socket);
    this.socketSessions.set(socket, { roomCode, playerId, role });
  }

  /**
   * Cleans up registry mappings on connection drop without altering game state.
   */
  private handleClose(socket: WebSocket): void {
    const session = this.socketSessions.get(socket);
    if (session) {
      const roomMap = this.connections.get(session.roomCode);
      if (roomMap) {
        if (roomMap.get(session.playerId) === socket) {
          roomMap.delete(session.playerId);
        }
        if (roomMap.size === 0) {
          this.connections.delete(session.roomCode);
        }
      }
    }
  }

  /**
   * Broadcasts individualized player-specific projections to all connected players in a room.
   */
  public broadcastRoom(roomCode: string): void {
    const roomMap = this.connections.get(roomCode);
    if (!roomMap) {
      return;
    }

    for (const [playerId, clientSocket] of roomMap.entries()) {
      if (clientSocket.readyState === WebSocket.OPEN) {
        try {
          const view = this.gameService.getPlayerView(roomCode, playerId);
          this.sendToSocket(clientSocket, { type: 'room_state', view });
        } catch (err) {
          console.error(`[WebSocket] Failed to project view for player "${playerId}":`, err);
        }
      }
    }
  }

  /**
   * Sends a typed ServerMessage to a specific socket.
   */
  public sendToSocket(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * Returns list of currently connected player IDs in a room.
   */
  public getConnectedPlayers(roomCode: string): string[] {
    const roomMap = this.connections.get(roomCode);
    if (!roomMap) {
      return [];
    }
    return Array.from(roomMap.keys());
  }

  /**
   * Closes all active client connections and shuts down the server.
   */
  async close(): Promise<void> {
    for (const roomMap of this.connections.values()) {
      for (const clientSocket of roomMap.values()) {
        clientSocket.close(1001, 'Server shutting down');
      }
    }
    this.connections.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
    }

    if (this.isOwnedServer && this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
  }
}
