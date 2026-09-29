import React from 'react';
import type { ServerPlayerView, Role } from '../types.ts';

interface ResultsScreenProps {
  view: ServerPlayerView;
  onPlayAgain: () => void;
}

const ROLES: { id: Role; label: string }[] = [
  { id: 'retailer', label: 'Retailer' },
  { id: 'wholesaler', label: 'Wholesaler' },
  { id: 'distributor', label: 'Distributor' },
  { id: 'factory', label: 'Factory' },
];

export const ResultsScreen: React.FC<ResultsScreenProps> = ({ view, onPlayAgain }) => {
  const finalCosts = view.finalCosts || {
    retailer: 0,
    wholesaler: 0,
    distributor: 0,
    factory: 0,
  };
  const totalCost = view.overallTotalCost ?? Object.values(finalCosts).reduce((a, b) => a + b, 0);

  return (
    <div className="card">
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#fff' }}>Game Complete!</h2>
        <p style={{ color: 'var(--text-muted)' }}>
          20 rounds completed. Final supply-chain cost breakdown:
        </p>
      </div>

      <div style={{ textAlign: 'center', padding: '1.25rem', backgroundColor: '#0f172a', borderRadius: 'var(--radius)', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Total Supply Chain Cost
        </div>
        <div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--primary)' }}>
          ${totalCost.toFixed(1)}
        </div>
      </div>

      <table className="results-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Player</th>
            <th style={{ textAlign: 'right' }}>Final Cost</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((r) => {
            const isYou = view.role === r.id;
            const cost = finalCosts[r.id] ?? 0;

            return (
              <tr key={r.id}>
                <td>
                  <strong>{r.label}</strong>
                </td>
                <td>
                  {isYou ? (
                    <span className="badge badge-role">You</span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Peer</span>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>
                  ${cost.toFixed(1)}
                </td>
              </tr>
            );
          })}
          <tr className="total-row">
            <td colSpan={2}>Supply Chain Total</td>
            <td style={{ textAlign: 'right' }}>${totalCost.toFixed(1)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: '1.5rem' }}>
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={onPlayAgain}
        >
          Return to Lobby / New Game
        </button>
      </div>
    </div>
  );
};
