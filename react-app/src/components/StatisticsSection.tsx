import React from 'react';
import { ReceiptText, ShieldCheck, RefreshCw, Lock } from 'lucide-react';
import { useReveal, useCountUp } from '../hooks/useReveal';

const STATS = [
  { label: 'Orders Processed', value: '10,000+', icon: ReceiptText },
  { label: 'System Uptime', value: '99.9%', icon: ShieldCheck },
  { label: 'Inventory Tracking', value: 'Real-Time', icon: RefreshCw },
  { label: 'Security', value: 'Enterprise', icon: Lock },
];

function formatCount(raw: number, decimals: number, suffix: string) {
  return `${raw.toFixed(decimals)}${suffix}`;
}

const StatCard: React.FC<{ label: string; value: string; icon: React.ElementType; index: number }> = ({
  label,
  value,
  icon: Icon,
  index,
}) => {
  const { ref, visible } = useReveal<HTMLDivElement>();
  const match = value.match(/^([\d.]+)(.*)$/);
  const target = match ? parseFloat(match[1]) : NaN;
  const decimals = match ? (match[1].split('.')[1]?.length ?? 0) : 0;
  const suffix = match ? match[2] : '';
  const current = useCountUp(target, visible);

  return (
    <div
      ref={ref}
      className="stat-card reveal-item"
      style={
        {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          '--reveal-delay': `${index * 120}ms`,
        } as React.CSSProperties
      }
    >
      <div style={{ color: 'var(--primary)', marginBottom: '1rem', opacity: 0.8 }}>
        <Icon size={28} />
      </div>
      <div className="stat-value" style={{ fontSize: '2rem', fontWeight: 800 }}>
        {Number.isNaN(target) ? value : formatCount(current, decimals, suffix)}
      </div>
      <div className="text-muted" style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
    </div>
  );
};

const StatisticsSection: React.FC = () => {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section
      ref={ref}
      className={`container reveal${visible ? ' is-visible' : ''}`}
      style={{ padding: '6rem 0 3rem' }}
    >
      <div className="stats-grid">
        {STATS.map((stat, idx) => (
          <StatCard key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} index={idx} />
        ))}
      </div>
    </section>
  );
};

export default StatisticsSection;
