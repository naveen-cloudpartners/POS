import React from 'react';
import { Boxes, ReceiptText, Users, BarChart3, Store, Blocks } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

const FeaturesSection: React.FC = () => {
  const { ref, visible } = useReveal<HTMLElement>();
  const features = [
    {
      title: 'Inventory Management',
      desc: 'Real-time stock across stores and warehouses, with low-stock alerts and adjustments.',
      icon: Boxes
    },
    {
      title: 'POS Billing',
      desc: 'Lightning checkout with tax automation, discounts, and offline protection.',
      icon: ReceiptText
    },
    {
      title: 'Customer Management',
      desc: 'Profiles, loyalty tiers and purchase history in one enterprise directory.',
      icon: Users
    },
    {
      title: 'Analytics',
      desc: 'Margins, shifts, and best-sellers live on every dashboard and report.',
      icon: BarChart3
    },
    {
      title: 'Multi-Location',
      desc: 'Outlets, warehouses and transfers unified under one live ledger.',
      icon: Store
    },
    {
      title: 'Integrations',
      desc: 'Native two-way Zoho Books sync — invoices, payments and customers reconciled.',
      icon: Blocks
    },
  ];

  return (
    <section ref={ref} id="features" className={`section container reveal${visible ? ' is-visible' : ''}`}>
      <div style={{ textAlign: 'center', maxWidth: '700px', margin: '0 auto 2.5rem' }}>
        <div className="badge" style={{ marginBottom: '1rem' }}>Features</div>
        <h2 style={{ fontSize: 'var(--h2)' }}>Everything a Modern Store Needs</h2>
        <p className="text-muted">
          Six tightly-integrated modules on one platform — no plugins,
          no middleware, no sync lag.
        </p>
      </div>

      <div className="features-grid">
        {features.map((feature, idx) => (
          <div
            key={idx}
            className="surface feature-card reveal-item"
            style={{ '--reveal-delay': `${idx * 120}ms` } as React.CSSProperties}
          >
            <div className="feature-icon">
              <feature.icon size={24} />
            </div>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{feature.title}</h3>
            <p className="text-muted" style={{ fontSize: '0.9rem' }}>{feature.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default FeaturesSection;
