interface SkeletonProps {
  lines?: number;
  chart?: boolean;
  stats?: number;
}

/** Premium skeleton placeholder — replaces plain "Loading…" text. */
export default function Skeleton({ lines = 4, chart = false, stats = 0 }: SkeletonProps) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {stats > 0 && (
        <div className="ch-grid-stats" style={{ marginBottom: 0 }}>
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="ch-skel-card">
              <div className="ch-skel-row">
                <div className="ch-skeleton ch-skel-avatar" />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="ch-skeleton" style={{ width: '45%' }} />
                  <div className="ch-skeleton" style={{ width: '70%', height: 20 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="ch-skel-card">
        <div className="ch-skeleton" style={{ width: '30%', height: 18 }} />
        {chart && <div className="ch-skeleton ch-skel-chart" />}
        {Array.from({ length: lines }).map((_, i) => (
          <div className="ch-skeleton" key={i} style={{ width: `${92 - i * 9}%` }} />
        ))}
      </div>
    </div>
  );
}
