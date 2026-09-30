import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react';

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
  const childList = Children.toArray(children);
  const first = childList[0];
  const toolbar = isValidElement<{ className?: string }>(first) && first.props.className?.split(' ').includes('ch-toolbar') ? first : null;
  const hasHead = title !== undefined || action !== undefined || toolbar !== null;
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
            {(title !== undefined || toolbar !== null) && <h3 className="ch-card-title">{title ?? 'Records'}</h3>}
            {subtitle !== undefined && <p className="ch-card-sub">{subtitle}</p>}
          </div>
          {action}
          {toolbar}
        </div>
      )}
      <div className={padded ? 'ch-card-body' : undefined}>{toolbar !== null ? childList.slice(1) : children}</div>
      {footer !== undefined && <div className="ch-card-foot">{footer}</div>}
    </section>
  );
}
