type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusBadgeProps {
  status: string;
}

function toneFor(status: string): Tone {
  const s = status.trim().toLowerCase();
  if (['active', 'synced', 'paid', 'completed', 'offline pending', 'approved', 'connected', 'in stock', 'healthy', 'closed'].includes(s)) return 'success';
  if (['pending', 'low stock', 'open', 'processing', 'draft', 'partially paid'].includes(s)) return 'warning';
  if (['inactive', 'failed', 'rejected', 'cancelled', 'canceled', 'out of stock', 'error', 'unpaid', 'void', 'voided'].includes(s)) return 'danger';
  if (['refunded', 'refund'].includes(s)) return 'neutral';
  if (['synced', 'info', 'backordered'].includes(s)) return 'info';
  return 'neutral';
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const label = status.trim().toLowerCase() === 'offline pending' ? 'Completed' : status;
  return <span className={`ch-badge ch-badge-${toneFor(status)}`}>{label}</span>;
}
