import React from 'react';
import type { ServerPlayerView, Role } from '../types.ts';

interface WaitingRoomProps {
  view: ServerPlayerView;
}

const ROLES: { id: Role; label: string }[] = [
  { id: 'retailer', label: 'Retailer' },
  { id: 'wholesaler', label: 'Wholesaler' },
  { id: 'distributor', label: 'Distributor' },
  { id: 'factory', label: 'Factory' },
];

export const WaitingRoom: React.FC<WaitingRoomProps> = ({ view }) => {
  const occupiedCount = Object.values(view.assignedRoles).filter(Boolean).length;
  const remainingCount = 4 - occupiedCount;

  return (
    <div className="card">
      <h2 className="card-title">Room Waiting Lobby</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Share room code <strong>{view.roomCode}</strong> with other players (or open in additional browser tabs).
      </p>

      <div className="room-roles-list">
        {ROLES.map((r) => {
          const isOccupied = view.assignedRoles[r.id];
          const isYou = view.role === r.id;

          return (
            <div key={r.id} className="room-role-row">
              <div>
                <strong>{r.label}</strong>
                {isYou && (
                  <span
                    className="badge badge-role"
                    style={{ marginLeft: '0.5rem', fontSize: '0.75rem' }}
                  >
                    You
                  </span>
                )}
              </div>
              <div className="role-badge-status">
                {isOccupied ? (
                  <span style={{ color: 'var(--success)' }}>✓ Occupied</span>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>— Waiting for player</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          textAlign: 'center',
          padding: '1rem',
          backgroundColor: '#0f172a',
          borderRadius: 'var(--radius)',
          color: 'var(--warning)',
          fontWeight: 600,
        }}
      >
        Waiting for {remainingCount} more player{remainingCount === 1 ? '' : 's'} to join...
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          Game starts automatically as soon as all four roles are filled.
        </div>
      </div>
    </div>
  );
};
