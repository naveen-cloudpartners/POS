import type { CSSProperties, ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  hoverable?: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  id?: string;
}

export default function Card({ title, subtitle, action, footer, children, padded = true, hoverable = false, delay = 0, className = '', style, id }: CardProps) {
  const hasHead = title !== undefined || action !== undefined;
  const cls = hoverable ? `ch-card hoverable reveal ${className}`.trim() : `ch-card reveal ${className}`.trim();
  return (
    <section
      className={cls}
      id={id}
      style={{ '--d': `${delay}ms`, ...style } as CSSProperties}
    >
      {hasHead && (
        <div className="ch-card-head">
          <div style={{ minWidth: 0 }}>
            {title !== undefined && <h3 className="ch-card-title">{title}</h3>}
            {subtitle !== undefined && <p className="ch-card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={padded ? 'ch-card-body' : undefined}>{children}</div>
      {footer !== undefined && <div className="ch-card-foot">{footer}</div>}
    </section>
  );
}
