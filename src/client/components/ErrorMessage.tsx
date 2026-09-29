import React from 'react';
import type { ErrorMessage as ServerErrorMessage } from '../types.ts';

interface ErrorMessageProps {
  error: ServerErrorMessage | null;
  onDismiss: () => void;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ error, onDismiss }) => {
  if (!error) return null;

  return (
    <div className="error-banner" role="alert">
      <div>
        <strong>[{error.code}]</strong> {error.message}
      </div>
      <button
        type="button"
        className="error-close-btn"
        aria-label="Dismiss error"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  );
};
