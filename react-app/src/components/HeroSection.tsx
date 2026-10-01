import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, LogIn, ShieldCheck, RefreshCw, BookOpenCheck } from 'lucide-react';

const HERO_BARS = [42, 68, 55, 80, 62, 92, 74];

const HeroSection: React.FC = () => {
  const navigate = useNavigate();

  return (
    <section className="hero-section el-hero">
      <div className="el-blobs" aria-hidden="true">
        <span className="el-blob b1" />
        <span className="el-blob b2" />
        <span className="el-blob b3" />
      </div>
      <div className="container el-hero-grid">
        {/* Left: copy */}
        <div className="el-hero-copy">
          <div className="badge el-eyebrow">
            <ShieldCheck size={14} style={{ marginRight: '0.5rem' }} aria-hidden="true" />
            Enterprise Retail Platform
          </div>

          <h1 className="hero-title">
            Muster POS
            <span className="el-hero-accent">Next-Generation Retail Management</span>
          </h1>

          <p className="hero-subtitle">
            Manage sales, inventory, customers,
            analytics and operations from a single platform.
          </p>

          <div className="hero-actions">
            <button
              onClick={() => navigate('/register')}
              className="btn btn-primary btn-lg el-cta"
            >
              Start Free
              <ArrowRight size={18} />
            </button>
            <button
              onClick={() => navigate('/login')}
              className="btn btn-secondary btn-lg"
            >
              <LogIn size={18} />
              Login
            </button>
          </div>

          <div className="hero-proof el-proof">
            <span><ShieldCheck size={14} aria-hidden="true" /> 99.9% Uptime</span>
            <span><RefreshCw size={14} aria-hidden="true" /> Real-Time Sync</span>
            <span><BookOpenCheck size={14} aria-hidden="true" /> Zoho Books Native</span>
          </div>
        </div>

        {/* Right: floating glass product mockup (pure CSS, no imagery) */}
        <div className="el-visual" role="img" aria-label="Preview of the Muster POS dashboard, register, inventory and reports">
          <div className="el-mock-window anim-fade-up">
            <div className="browser-bar" aria-hidden="true">
              <span className="browser-dots"><i></i><i></i><i></i></span>
              <span className="browser-url">Muster POS / Dashboard</span>
              <span className="browser-live">Live</span>
            </div>
            <div className="el-mock-app">
              <div className="el-mock-rail" aria-hidden="true">
                <i className="on" /><i /><i /><i /><i />
              </div>
              <div className="el-mock-main">
                <div className="el-mock-kpis">
                  <span><em>Revenue</em><b>LKR 48.2k</b></span>
                  <span><em>Orders</em><b>132</b></span>
                  <span><em>Stock</em><b>98%</b></span>
                </div>
                <div className="el-mock-bars" aria-hidden="true">
                  {HERO_BARS.map((h, i) => (
                    <i key={i} style={{ height: `${h}%` }} className={i === 5 ? 'peak' : undefined} />
                  ))}
                </div>
                <div className="el-mock-rows" aria-hidden="true">
                  <span><i className="dot ok" />Order #INV-2041 · Synced</span>
                  <span><i className="dot warn" />Low stock · 4 items</span>
                </div>
              </div>
              <div className="el-mock-cart" aria-hidden="true">
                <em>Current sale</em>
                <span><i />Chicken Rice ×2</span>
                <span><i />Fish Curry ×1</span>
                <b>LKR 3,450.00</b>
                <u>Charge</u>
              </div>
            </div>
          </div>
          <div className="el-chip el-chip-top">
            <BookOpenCheck size={15} aria-hidden="true" />
            <span>Zoho Books synced</span>
          </div>
          <div className="el-chip el-chip-bottom">
            <RefreshCw size={15} aria-hidden="true" />
            <span>Real-time inventory</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
