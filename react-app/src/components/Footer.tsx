import React from 'react';
import { Cloud, Globe, Mail, MessageCircle, ExternalLink } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

const Footer: React.FC = () => {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <footer ref={ref} className={`footer reveal${visible ? ' is-visible' : ''}`}>
      <div className="container">
        <div className="footer-grid">
          <div className="footer-column">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
              <div style={{
                width: '32px', height: '32px', background: 'var(--primary)',
                borderRadius: 'var(--radius-sm)', display: 'flex',
                alignItems: 'center', justifyContent: 'center'
              }}>
                <Cloud size={18} color="white" />
              </div>
              <span style={{ fontWeight: 800, fontSize: '1.25rem', color: 'white' }}>CloudHub POS</span>
            </div>
            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.9rem', marginBottom: '2rem' }}>
              The next-generation cloud point of sale system for multi-tenant enterprise operations.
              Built on Zoho Catalyst.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <a href="#" aria-label="Website" className="btn btn-secondary" style={{ padding: '0.5rem', borderRadius: '50%' }}><Globe size={18} /></a>
              <a href="#" aria-label="Community" className="btn btn-secondary" style={{ padding: '0.5rem', borderRadius: '50%' }}><MessageCircle size={18} /></a>
              <a href="#" aria-label="Email" className="btn btn-secondary" style={{ padding: '0.5rem', borderRadius: '50%' }}><Mail size={18} /></a>
            </div>
          </div>

          <div className="footer-column">
            <h4>Product</h4>
            <a href="#features" className="footer-link">Features</a>
            <a href="#demo" className="footer-link">Interactive Demo</a>
            <a href="#integration" className="footer-link">Integrations</a>
            <a href="/register" className="footer-link">Pricing</a>
          </div>

          <div className="footer-column">
            <h4>Company</h4>
            <a href="#" className="footer-link">About Us</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms Of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>

          <div className="footer-column">
            <h4>Developers</h4>
            <a href="#" className="footer-link">Developer API</a>
            <a href="#" className="footer-link">Catalyst SDK</a>
            <a href="#" className="footer-link">Github Repo <ExternalLink size={12} /></a>
            <a href="#" className="footer-link">Security Docs</a>
          </div>
        </div>

        <div style={{
          paddingTop: '2rem',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          fontSize: '0.85rem',
          color: 'var(--muted-foreground)'
        }}>
          <span>© 2026 CloudHub POS Suite. All rights reserved.</span>
          <span style={{ display: 'flex', gap: '1.5rem' }}>
            <span>Status: 99.99% Uptime</span>
            <span>Region: Global (US/EU/IN)</span>
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
