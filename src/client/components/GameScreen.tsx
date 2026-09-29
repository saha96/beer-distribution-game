import React, { useState } from 'react';
import type { ServerPlayerView, Role } from '../types.ts';

interface GameScreenProps {
  view: ServerPlayerView;
  onSubmitOrder: (order: number) => void;
  disabled?: boolean;
}

const ROLES: { id: Role; label: string }[] = [
  { id: 'retailer', label: 'Retailer' },
  { id: 'wholesaler', label: 'Wholesaler' },
  { id: 'distributor', label: 'Distributor' },
  { id: 'factory', label: 'Factory' },
];

export const GameScreen: React.FC<GameScreenProps> = ({
  view,
  onSubmitOrder,
  disabled,
}) => {
  const [orderValue, setOrderValue] = useState<string>('4');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (view.hasSubmitted || disabled) return;

    const parsed = Number(orderValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      alert('Order must be an integer of 0 or greater.');
      return;
    }
    onSubmitOrder(parsed);
  };

  return (
    <div>
      {/* Top Banner */}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            Round {view.currentRound} <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/ 20</span>
          </h2>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Role: <strong style={{ color: '#fff', textTransform: 'capitalize' }}>{view.role}</strong>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Cumulative Cost
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--primary)' }}>
            ${view.totalCost.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Metrics Dashboard */}
      <div className="card">
        <h3 className="card-title">Role Dashboard</h3>
        <div className="dashboard-grid">
          <div className="metric-box">
            <div className="metric-label">Current Inventory</div>
            <div className="metric-value" style={{ color: view.inventory > 0 ? '#34d399' : '#f87171' }}>
              {view.inventory}
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Backlog (Unfilled)</div>
            <div className="metric-value" style={{ color: view.backlog > 0 ? '#f87171' : 'inherit' }}>
              {view.backlog}
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Shipment Arrived</div>
            <div className="metric-value">{view.shipmentArrived}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Incoming Order</div>
            <div className="metric-value">{view.incomingOrder}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Last Order Placed</div>
            <div className="metric-value">{view.lastOrderPlaced}</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">Round Cost</div>
            <div className="metric-value" style={{ color: '#fbbf24' }}>
              ${view.roundCost.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Peer Submissions Status */}
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Round Submissions:
          </div>
          <div className="peer-status-container">
            {ROLES.map((r) => {
              const hasSubmitted = view.peerSubmissions[r.id];
              const isYou = view.role === r.id;

              return (
                <div
                  key={r.id}
                  className={`peer-chip ${hasSubmitted ? 'submitted' : 'waiting'}`}
                >
                  <span>{hasSubmitted ? '✓' : '◌'}</span>
                  <span>{r.label}</span>
                  {isYou && <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(You)</span>}
                  <span style={{ fontSize: '0.75rem', marginLeft: '0.2rem' }}>
                    {hasSubmitted ? 'Submitted' : 'Waiting'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Order Submission Form */}
        <div className="order-box">
          {view.hasSubmitted ? (
            <div style={{ textAlign: 'center', padding: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
              ✓ Your order for Round {view.currentRound} has been placed. Waiting for remaining players to submit...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="order-form">
              <div style={{ flex: 1 }}>
                <label htmlFor="order-input" className="form-label">
                  Place Order (Units)
                </label>
                <input
                  id="order-input"
                  type="number"
                  min="0"
                  step="1"
                  className="form-input"
                  value={orderValue}
                  onChange={(e) => setOrderValue(e.target.value)}
                  disabled={disabled || view.hasSubmitted}
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: '0.75rem 1.75rem' }}
                disabled={disabled || view.hasSubmitted}
              >
                Submit Order
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
