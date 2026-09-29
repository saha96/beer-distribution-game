import React, { useState } from 'react';
import type { Role } from '../types.ts';

interface LobbyProps {
  onCreateRoom: (role: Role, customCode?: string) => void;
  onJoinRoom: (roomCode: string, role: Role) => void;
  disabled?: boolean;
}

const ROLES: { id: Role; label: string; desc: string }[] = [
  { id: 'retailer', label: 'Retailer', desc: 'Direct interface with Customer demand' },
  { id: 'wholesaler', label: 'Wholesaler', desc: 'Supplies Retailer, orders from Distributor' },
  { id: 'distributor', label: 'Distributor', desc: 'Supplies Wholesaler, orders from Factory' },
  { id: 'factory', label: 'Factory', desc: 'Supplies Distributor, orders from Unlimited Supplier' },
];

export const Lobby: React.FC<LobbyProps> = ({ onCreateRoom, onJoinRoom, disabled }) => {
  const [tab, setTab] = useState<'create' | 'join'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('room') || params.get('code')) return 'join';
    }
    return 'create';
  });
  const [selectedRole, setSelectedRole] = useState<Role>('retailer');
  const [roomCode, setRoomCode] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return (params.get('room') || params.get('code') || '').toUpperCase();
    }
    return '';
  });
  const [customCode, setCustomCode] = useState('');

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole || disabled) return;
    onCreateRoom(selectedRole, customCode.trim() || undefined);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim() || !selectedRole || disabled) return;
    onJoinRoom(roomCode.trim().toUpperCase(), selectedRole);
  };

  return (
    <div className="card">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'create'}
          className={`tab-btn ${tab === 'create' ? 'active' : ''}`}
          onClick={() => setTab('create')}
        >
          Create New Game
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'join'}
          className={`tab-btn ${tab === 'join' ? 'active' : ''}`}
          onClick={() => setTab('join')}
        >
          Join Existing Game
        </button>
      </div>

      {tab === 'create' ? (
        <form onSubmit={handleCreateSubmit}>
          <div className="form-group">
            <label className="form-label">Select Your Role</label>
            <div className="role-grid">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`role-btn ${selectedRole === r.id ? 'selected' : ''}`}
                  onClick={() => setSelectedRole(r.id)}
                  disabled={disabled}
                >
                  <div>{r.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    {r.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="custom-code" className="form-label">
              Custom Room Code (Optional)
            </label>
            <input
              id="custom-code"
              type="text"
              className="form-input"
              placeholder="e.g. ROOM12 (Leave blank for random code)"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              disabled={disabled}
              maxLength={12}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={disabled || !selectedRole}
          >
            Create Game & Enter Room
          </button>
        </form>
      ) : (
        <form onSubmit={handleJoinSubmit}>
          <div className="form-group">
            <label htmlFor="room-code-input" className="form-label">
              Room Code
            </label>
            <input
              id="room-code-input"
              type="text"
              className="form-input"
              placeholder="Enter room code (e.g. X7K2M9)"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              disabled={disabled}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">Select Role to Claim</label>
            <div className="role-grid">
              {ROLES.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`role-btn ${selectedRole === r.id ? 'selected' : ''}`}
                  onClick={() => setSelectedRole(r.id)}
                  disabled={disabled}
                >
                  <div>{r.label}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    {r.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={disabled || !roomCode.trim() || !selectedRole}
          >
            Join Game Room
          </button>
        </form>
      )}
    </div>
  );
};
