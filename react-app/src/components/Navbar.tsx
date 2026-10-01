import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, Cloud, Terminal, Shield, Workflow, Layout } from 'lucide-react';

const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'Features', href: '#features', icon: Layout },
    { label: 'Demo', href: '#demo', icon: Terminal },
    { label: 'Integration', href: '#integration', icon: Workflow },
    { label: 'Security', href: '#security', icon: Shield },
  ];

  return (
    <nav className={`navbar ${isScrolled ? 'scrolled' : ''}`}>
      <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' }}>
        {/* Brand Logo */}
        <div
          onClick={() => navigate('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
        >
          <div style={{
            width: '36px',
            height: '36px',
            background: 'var(--primary)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 4px 12px rgba(55, 65, 81, 0.2)'
          }}>
            <Cloud size={20} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>Muster</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.05em' }}>ENTERPRISE POS</span>
          </div>
        </div>

        {/* Desktop Nav */}
        <div className="nav-desktop" style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="btn btn-ghost"
                style={{ fontSize: '0.85rem', fontWeight: 600 }}
              >
                {link.label}
              </a>
            ))}
          </div>
          <div style={{ height: '24px', width: '1px', background: 'var(--border)' }}></div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button onClick={() => navigate('/login')} className="btn btn-secondary">Login</button>
            <button onClick={() => navigate('/register')} className="btn btn-primary">Start Free</button>
          </div>
        </div>

        {/* Mobile Toggle */}
        <button
          className="nav-mobile-toggle"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          style={{ display: 'none' }}
        >
          {mobileMenuOpen ? <X /> : <Menu />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="glass" style={{
          position: 'fixed', top: '64px', left: 0, right: 0,
          padding: '2rem', borderBottom: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: '1.5rem'
        }}>
          {navLinks.map((link) => (
            <a key={link.label} href={link.href} onClick={() => setMobileMenuOpen(false)} style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <link.icon size={18} style={{ color: 'var(--primary)' }} />
              {link.label}
            </a>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button onClick={() => navigate('/login')} className="btn btn-secondary w-full">Login</button>
            <button onClick={() => navigate('/register')} className="btn btn-primary w-full">Start Free</button>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 1024px) {
          .nav-desktop { display: none !important; }
          .nav-mobile-toggle { display: block !important; }
        }
      `}</style>
    </nav>
  );
};

export default Navbar;
