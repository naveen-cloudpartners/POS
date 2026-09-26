import React from 'react';
import { Workflow, CheckCircle2, ChevronRight, ExternalLink } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

const IntegrationSection: React.FC = () => {
  const { ref, visible } = useReveal<HTMLElement>();
  const connectZoho = async () => {
    try {
      const response = await fetch('/api/auth/url');
      const data = await response.json();
      if (data.url) window.location.href = data.url;
    } catch (error) {
      console.error('Failed to get auth URL:', error);
    }
  };

  return (
    <section ref={ref} id="integration" className={`section reveal${visible ? ' is-visible' : ''}`} style={{ background: '#e9f1ff', color: '#0f172a', overflow: 'clip' }}>
      <div className="container">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3.5rem', alignItems: 'center' }}>
          <div>
            <div className="badge" style={{ background: '#e8f0ff', color: '#0061ff', borderColor: '#c9dcff', marginBottom: '1.5rem' }}>
              Native Integration
            </div>
            <h2 style={{ fontSize: 'var(--h2)', color: '#0a1a3d', marginBottom: '1.5rem' }}>
              A Direct Pipeline To Your <br />
              <span style={{ color: 'var(--primary)' }}>Zoho Books Ledger.</span>
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
              {[
                'Automated Inventory Mapping',
                'Instant Payment Reconciliation',
                'Unified Customer Profiles'
              ].map(item => (
                <div key={item} style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '1rem' }}>
                  <CheckCircle2 size={20} style={{ color: 'var(--success)' }} />
                  {item}
                </div>
              ))}
            </div>
            <button onClick={connectZoho} className="btn btn-primary btn-lg">
              <Workflow size={20} />
              Connect Zoho Books
              <ExternalLink size={16} />
            </button>
          </div>

          <div className="integration-visual">
            <div className="integration-card">
              <div style={{ fontWeight: 800, color: 'var(--foreground)' }}>POS Node</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Transaction Declared</div>
            </div>
            <ChevronRight style={{ color: 'var(--muted-foreground)' }} />
            <div className="integration-card" style={{ borderColor: 'var(--primary)', boxShadow: '0 0 20px rgba(0,97,255,0.2)' }}>
              <div style={{ fontWeight: 800, color: 'var(--primary)' }}>Catalyst</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Advanced I/O</div>
            </div>
            <ChevronRight style={{ color: 'var(--muted-foreground)' }} />
            <div className="integration-card">
              <div style={{ fontWeight: 800, color: 'var(--foreground)' }}>Zoho Books</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>Ledger Posted</div>
            </div>
          </div>

          <figure className="integration-shot">
            <img
              src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=70"
              alt="Sales reports and analytics synced from CloudHub POS to Zoho Books"
              width="1200" height="675"
              loading="lazy"
            />
            <figcaption>POS → Zoho Books → Reports → Inventory, reconciled in real time.</figcaption>
          </figure>
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          #integration .container > div { grid-template-columns: 1fr !important; gap: 4rem !important; }
          .integration-visual { grid-template-columns: 1fr !important; }
          .integration-visual > svg { transform: rotate(90deg); margin: 0.5rem auto; }
        }
      `}</style>
    </section>
  );
};

export default IntegrationSection;
