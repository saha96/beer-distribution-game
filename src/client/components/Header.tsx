import React from 'react';
import type { ConnectionStatus, Role } from '../types.ts';

interface HeaderProps {
  status: ConnectionStatus;
  roomCode?: string;
  role?: Role;
  onLeaveRoom?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  roomCode,
  role,
  onLeaveRoom,
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        return <span className="badge badge-connected">● Connected</span>;
      case 'connecting':
        return <span className="badge badge-connecting">◌ Connecting...</span>;
      case 'reconnecting':
        return <span className="badge badge-connecting">◌ Reconnecting...</span>;
      case 'disconnected':
        return <span className="badge badge-disconnected">✕ Offline</span>;
    }
  };

  return (
    <header className="app-header">
      <div>
        <h1 className="brand-title">The Beer Distribution Game</h1>
      </div>
      <div className="header-status">
        {roomCode && <span className="badge badge-room">Room: {roomCode}</span>}
        {role && <span className="badge badge-role">Role: {role}</span>}
        {getStatusBadge()}
        {roomCode && onLeaveRoom && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.25rem 0.6rem', fontSize: '0.8rem' }}
            onClick={onLeaveRoom}
          >
            Leave
          </button>
        )}
      </div>
    </header>
  );
};
