import React from 'react';
import { Lock, Server, ShieldCheck, BadgeCheck, FileText } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

const SecuritySection: React.FC = () => {
  const { ref, visible } = useReveal<HTMLElement>();
  const securityFeatures = [
    { label: 'AES Encryption', icon: Lock },
    { label: 'Catalyst Infrastructure', icon: Server },
    { label: 'Cloud Security', icon: ShieldCheck },
    { label: 'Enterprise Compliance', icon: BadgeCheck }
  ];

  return (
    <section ref={ref} id="security" className={`section container reveal${visible ? ' is-visible' : ''}`} style={{ textAlign: 'center' }}>
      <div className="badge" style={{ marginBottom: '1.5rem' }}>Security & Compliance</div>
      <h2 style={{ fontSize: 'var(--h2)', marginBottom: '1rem' }}>Enterprise-Grade Security</h2>
      <p className="text-muted" style={{ maxWidth: '600px', margin: '0 auto 2rem' }}>
        We employ the same security standards used by the world's leading financial institutions
        to ensure your business data remains private and protected.
      </p>

      <figure className="security-shot anim-fade-up" aria-label="Cloud infrastructure">
        <img
          src="https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1600&q=70"
          alt="Cloud datacenter infrastructure hosting Muster POS"
          width="1600" height="700"
          loading="lazy"
        />
        <figcaption>
          <span className="security-shot-badge">ISO 27001 datacenters</span>
          <span className="security-shot-badge">Multi-region failover</span>
        </figcaption>
      </figure>

      <div className="security-grid">
        {securityFeatures.map((feat, idx) => (
          <div
            key={idx}
            className="surface reveal-item"
            style={{
              padding: '1.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.85rem',
              '--reveal-delay': `${idx * 120}ms`,
            } as React.CSSProperties}
          >
            <div style={{ color: 'var(--primary)' }}>
              <feat.icon size={24} />
            </div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{feat.label}</div>
          </div>
        ))}
      </div>

      <button className="btn btn-outline" style={{ marginTop: '2rem' }}>
        <FileText size={18} />
        Read Security Whitepaper
      </button>
    </section>
  );
};

export default SecuritySection;
