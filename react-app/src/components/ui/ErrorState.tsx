import { AlertTriangle } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="ch-state">
      <span className="ch-state-icon" aria-hidden="true" style={{ background: 'var(--ch-danger-bg)', color: 'var(--ch-danger)' }}>
        <AlertTriangle size={24} />
      </span>
      <h3 className="ch-state-title">{title}</h3>
      <p className="ch-state-text">{message}</p>
      {onRetry !== undefined && (
        <button type="button" className="ch-btn ch-btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
