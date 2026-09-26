import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Store, Building2, Network, ArrowRight } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

const PricingSection: React.FC = () => {
  const navigate = useNavigate();
  const { ref, visible } = useReveal<HTMLElement>();

  const plans = [
    {
      name: 'Starter',
      price: '$19',
      unit: '/store/mo',
      desc: 'For single counters getting online fast.',
      icon: Store,
      features: ['1 register terminal', 'Core POS billing', 'Basic inventory', 'Email support'],
      featured: false,
    },
    {
      name: 'Professional',
      price: '$49',
      unit: '/store/mo',
      desc: 'For growing stores that need the full loop.',
      icon: Building2,
      features: [
        'Unlimited terminals',
        'Zoho Books sync',
        'Role based access',
        'Analytics dashboard',
        'Priority support',
      ],
      featured: true,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      unit: '',
      desc: 'For chains and multi-tenant operations.',
      icon: Network,
      features: [
        'Multi-store + multi-brand',
        'Dedicated infrastructure',
        'SSO & audit logs',
        'Onboarding manager',
      ],
      featured: false,
    },
  ];

  return (
    <section ref={ref} id="pricing" className={`section container reveal${visible ? ' is-visible' : ''}`} aria-labelledby="pricing-title">
      <div style={{ textAlign: 'center', maxWidth: '700px', margin: '0 auto 2.5rem' }}>
        <div className="badge" style={{ marginBottom: '1rem' }}>Pricing</div>
        <h2 id="pricing-title" style={{ fontSize: 'var(--h2)' }}>Simple Pricing That Scales</h2>
        <p className="text-muted">
          Start free. Upgrade when a register pays for itself.
        </p>
      </div>

      <div className="pricing-grid" role="list" aria-label="Pricing plans">
        {plans.map((plan, idx) => (
          <article
            key={plan.name}
            className={`surface pricing-card reveal-item${plan.featured ? ' featured' : ''}`}
            style={{ '--reveal-delay': `${idx * 130}ms` } as React.CSSProperties}
            role="listitem"
          >
            {plan.featured && <span className="pricing-flag">Most popular</span>}
            <div className="feature-icon" aria-hidden="true">
              <plan.icon size={24} />
            </div>
            <h3 className="pricing-name">{plan.name}</h3>
            <p className="pricing-price">
              {plan.price}
              {plan.unit && <span>{plan.unit}</span>}
            </p>
            <p className="text-muted pricing-desc">{plan.desc}</p>
            <ul className="pricing-list">
              {plan.features.map((f) => (
                <li key={f}>
                  <Check size={16} aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              className={`btn ${plan.featured ? 'btn-primary' : 'btn-secondary'} btn-lg pricing-cta`}
              onClick={() => navigate('/register')}
            >
              Start Free
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
};

export default PricingSection;
