import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  message?: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  icon?: ReactNode;
}

export default function EmptyState({ title, message, action, secondaryAction, icon }: EmptyStateProps) {
  return (
    <div className="ch-state reveal-scale">
      <span className="ch-state-icon" aria-hidden="true">
        {icon ?? <Inbox size={26} />}
      </span>
      <h3 className="ch-state-title">{title}</h3>
      {message !== undefined && <p className="ch-state-text">{message}</p>}
      {(action !== undefined || secondaryAction !== undefined) && (
        <div className="ch-row" style={{ justifyContent: 'center' }}>
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
