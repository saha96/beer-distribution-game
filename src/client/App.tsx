import React, { useEffect, useRef, useState } from 'react';
import type {
  Role,
  ServerPlayerView,
  ConnectionStatus,
  ErrorMessage as ErrorMessageType,
  ServerMessage,
} from './types.ts';
import { getPlayerId, getStoredSession, saveSession, clearSession } from './storage.ts';
import { GameWebSocketClient } from './websocket.ts';
import { Header } from './components/Header.tsx';
import { ErrorMessage } from './components/ErrorMessage.tsx';
import { Lobby } from './components/Lobby.tsx';
import { WaitingRoom } from './components/WaitingRoom.tsx';
import { GameScreen } from './components/GameScreen.tsx';
import { ResultsScreen } from './components/ResultsScreen.tsx';

export const App: React.FC = () => {
  const [playerId] = useState<string>(() => getPlayerId());
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [view, setView] = useState<ServerPlayerView | null>(null);
  const [error, setError] = useState<ErrorMessageType | null>(null);

  const wsRef = useRef<GameWebSocketClient | null>(null);

  useEffect(() => {
    const handleMessage = (message: ServerMessage) => {
      if (message.type === 'room_state') {
        setView(message.view);
        saveSession(message.view.roomCode, message.view.role);
        setError(null);
      } else if (message.type === 'error') {
        setError(message);
        // If room is not found or player not registered, clear stale local session
        if (message.code === 'ROOM_NOT_FOUND' || message.code === 'PLAYER_NOT_IN_ROOM') {
          clearSession();
          setView(null);
        }
      }
    };

    const handleStatusChange = (newStatus: ConnectionStatus) => {
      setStatus(newStatus);

      // On successful connection, attempt automatic resume if a saved room exists
      if (newStatus === 'connected') {
        const stored = getStoredSession();
        if (stored.roomCode) {
          wsRef.current?.send({
            type: 'resume',
            roomCode: stored.roomCode,
            playerId,
          });
        }
      }
    };

    const client = new GameWebSocketClient({
      onMessage: handleMessage,
      onStatusChange: handleStatusChange,
    });

    wsRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, [playerId]);

  const handleCreateRoom = (role: Role, customCode?: string) => {
    setError(null);
    wsRef.current?.send({
      type: 'create_room',
      playerId,
      role,
      customCode,
    });
  };

  const handleJoinRoom = (roomCode: string, role: Role) => {
    setError(null);
    wsRef.current?.send({
      type: 'join_room',
      roomCode,
      playerId,
      role,
    });
  };

  const handleSubmitOrder = (order: number) => {
    setError(null);
    wsRef.current?.send({
      type: 'place_order',
      order,
    });
  };

  const handleLeaveOrReset = () => {
    clearSession();
    setView(null);
    setError(null);
  };

  // Render appropriate screen based on authoritative state
  const renderCurrentScreen = () => {
    if (!view) {
      return (
        <Lobby
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          disabled={status !== 'connected'}
        />
      );
    }

    if (view.status === 'completed') {
      return <ResultsScreen view={view} onPlayAgain={handleLeaveOrReset} />;
    }

    if (view.roomStatus === 'waiting') {
      return <WaitingRoom view={view} />;
    }

    return (
      <GameScreen
        view={view}
        onSubmitOrder={handleSubmitOrder}
        disabled={status !== 'connected'}
      />
    );
  };

  return (
    <div>
      <Header
        status={status}
        roomCode={view?.roomCode}
        role={view?.role}
        onLeaveRoom={view ? handleLeaveOrReset : undefined}
      />

      <ErrorMessage error={error} onDismiss={() => setError(null)} />

      <main>{renderCurrentScreen()}</main>
    </div>
  );
};
