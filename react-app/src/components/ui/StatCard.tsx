import type { CSSProperties, ReactNode } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'flat';
  icon: ReactNode;
  iconBg?: string;
  iconColor?: string;
  spark?: Array<number>;
  delay?: number;
}

export default function StatCard({
  label,
  value,
  delta,
  deltaTone = 'flat',
  icon,
  iconBg = 'var(--ch-primary-soft)',
  iconColor = 'var(--ch-primary-dark)',
  spark,
  delay = 0,
}: StatCardProps) {
  const Icon = deltaTone === 'up' ? TrendingUp : deltaTone === 'down' ? TrendingDown : Minus;
  const max = spark !== undefined && spark.length > 0 ? Math.max(...spark, 1) : 1;
  return (
    <div className="ch-stat" style={{ '--d': `${delay}ms`, animationDelay: `${delay}ms` } as CSSProperties}>
      <span className="ch-stat-icon" style={{ background: iconBg, color: iconColor }} aria-hidden="true">
        {icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ch-stat-label">{label}</div>
        <div className="ch-stat-value">{value}</div>
        {delta !== undefined && (
          <div className={`ch-stat-delta ${deltaTone}`}>
            <Icon size={12} aria-hidden="true" />
            {delta}
          </div>
        )}
        {spark !== undefined && spark.length > 0 && (
          <div className="ch-stat-spark" aria-hidden="true">
            {spark.map((v, i) => (
              <i key={i} style={{ height: `${Math.max(12, Math.round((v / max) * 100))}%` }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
