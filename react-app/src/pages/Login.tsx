import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Cloud,
  ShoppingCart,
  Boxes,
  BarChart3,
  Users,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react';
import '../styles/login.css';
import { login, fetchBackendSession, CATALYST_LOGIN_URL } from '../services/catalystAuth';

/* ==========================================================================
   Muster POS — Modern SaaS Login Page
   Authentication & Session logic kept 100% unchanged.
   ========================================================================== */

type CatalystState = 'checking' | 'signedin' | 'signedout';

const FEATURES = [
  { icon: ShoppingCart, title: 'POS Billing', desc: 'Lightning-fast checkout with offline protection' },
  { icon: Boxes, title: 'Inventory Tracking', desc: 'Real-time stock sync across all stores & warehouses' },
  { icon: BarChart3, title: 'Sales Analytics', desc: 'Shift tracking, margins, and best-sellers at a glance' },
  { icon: Users, title: 'Multi User Access', desc: 'Role-based access control for cashiers, managers & admins' },
  { icon: ShieldCheck, title: 'Secure Cloud Hosting', desc: 'Enterprise safety & SLA powered by Zoho Catalyst' },
];

const STATS = [
  { value: '10,000+', label: '10,000+ Orders', sub: 'Monthly sales volume' },
  { value: '99.9%', label: '99.9% Uptime', sub: 'Enterprise reliability' },
  { value: 'Real-Time', label: 'Real-Time Inventory', sub: 'Multi-location sync' },
  { value: 'Zoho Books', label: 'Zoho Books Connected', sub: 'Auto-reconciliation' },
];

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [catalystState, setCatalystState] = useState<CatalystState>('checking');
  const [email, setEmail] = useState('');
  const showEmbeddedLogin = true;
  const [frameBlocked, setFrameBlocked] = useState(false);
  const [embedNote, setEmbedNote] = useState('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const session = await fetchBackendSession();
      if (!live) return;
      if (session.authenticated && session.email) {
        setEmail(session.email);
        setCatalystState('signedin');
      } else {
        setCatalystState('signedout');
      }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (catalystState === 'signedin') {
      navigate('/dashboard', { replace: true });
    }
  }, [catalystState, navigate]);

  useEffect(() => {
    if (!showEmbeddedLogin || catalystState !== 'signedout') return;
    let cancelled = false;
    let attempts = 0;
    const id = setInterval(async () => {
      // Fetch-light: stop polling a hidden tab, and give up after ~5 min
      // (user can retry manually) instead of polling forever.
      attempts += 1;
      if (cancelled || document.hidden || attempts > 120) {
        if (attempts > 120 && !cancelled) clearInterval(id);
        return;
      }
      const session = await fetchBackendSession();
      if (cancelled) return;
      if (session.authenticated && session.email) {
        setEmail(session.email);
        setCatalystState('signedin');
      }
    }, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, [showEmbeddedLogin, catalystState]);

  const handleFrameLoad = async () => {
    const frame = frameRef.current;
    if (!frame) return;
    let nested = false;
    let detectedUrl = '';
    try {
      detectedUrl = frame.contentWindow?.location.href ?? '';
      const path = new URL(detectedUrl).pathname;
      nested = path === '/app' || path.startsWith('/app/');
    } catch {
      return;
    }
    if (!nested) return;
    frame.remove();
    setFrameBlocked(true);
    const session = await fetchBackendSession();
    if (session.authenticated && session.email) {
      setEmail(session.email);
      setCatalystState('signedin');
    } else {
      setEmbedNote('Embedded sign-in is unavailable — please use full-page sign-in below.');
    }
  };

  const useHostedSignIn = () => {
    void login();
  };

  return (
    <div className="login-page">
      {/* Background Ambient Glow Effects */}
      <div className="login-bg-glow glow-1" aria-hidden="true" />
      <div className="login-bg-glow glow-2" aria-hidden="true" />
      <div className="login-bg-grid" aria-hidden="true" />

      {/* ---------- Left: Brand & Product Showcase Panel ---------- */}
      <aside className="login-brand" aria-label="Muster POS overview">
        <div className="login-brand-inner">
          {/* Brand Header */}
          <div className="brand-header">
            <Link to="/" className="login-logo" aria-label="Muster POS home">
              <span className="login-logo-mark" aria-hidden="true">
                <Cloud />
              </span>
              <span className="login-logo-text">Muster POS</span>
            </Link>
            <span className="login-version-badge">
              <Sparkles className="badge-sparkle-icon" aria-hidden="true" />
              <span>Cloud Enterprise</span>
            </span>
          </div>

          {/* Hero Section */}
          <div className="brand-hero">
            <h1 className="login-headline">
              Manage Your Store <br />
              <span className="headline-gradient">From Anywhere</span>
            </h1>
            <p className="login-sub">
              Muster POS combines billing, sales, inventory, reporting and Zoho Books integration in one cloud platform.
            </p>
          </div>

          {/* Feature List */}
          <div className="login-features-wrapper">
            <h2 className="features-section-title">Core Capabilities</h2>
            <ul className="login-features-list" role="list">
              {FEATURES.map((f) => (
                <li key={f.title} className="login-feature-card">
                  <div className="feature-icon-box" aria-hidden="true">
                    <f.icon />
                  </div>
                  <div className="feature-info">
                    <strong className="feature-title">{f.title}</strong>
                    <span className="feature-desc">{f.desc}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Statistics Grid */}
          <div className="login-stats-grid">
            {STATS.map((s) => (
              <div key={s.label} className="glass-stat-card">
                <div className="stat-header">
                  <span className="stat-value-text">{s.value}</span>
                  <CheckCircle2 className="stat-check" aria-hidden="true" />
                </div>
                <span className="stat-label-text">{s.label}</span>
                <span className="stat-sub-text">{s.sub}</span>
              </div>
            ))}
          </div>

          {/* Bottom Trust Badge */}
          <div className="login-trust-footer">
            <div className="trust-pulse" aria-hidden="true" />
            <span>Official Zoho Books &amp; Zoho Catalyst Cloud Partner</span>
          </div>
        </div>
      </aside>

      {/* ---------- Right: Glassmorphism Sign-In Panel ---------- */}
      <main className="login-main">
        <div className="glass-login-card" role="region" aria-labelledby="login-title">
          <div className="card-top-accent" aria-hidden="true" />
          
          <div className="login-card-header">
            <div className="secure-badge">
              <Zap className="badge-zap-icon" aria-hidden="true" />
              <span>Secure Single Sign-On</span>
            </div>
            <h2 id="login-title">Sign in to Muster</h2>
            <p className="login-card-desc">
              Access your point-of-sale, inventory controls &amp; sales reports.
            </p>
          </div>

          {/* Session Checking State */}
          {catalystState === 'checking' && (
            <div className="login-state-box">
              <Loader2 className="spin-icon" aria-hidden="true" />
              <span>Verifying Catalyst authentication session…</span>
            </div>
          )}

          {/* Embedded Iframe State */}
          {catalystState === 'signedout' && !frameBlocked && (
            <div className="login-frame-container">
              <div className="login-auth-frame">
                <iframe
                  ref={frameRef}
                  src={CATALYST_LOGIN_URL}
                  title="Catalyst sign-in"
                  onLoad={() => { void handleFrameLoad(); }}
                  onError={() => {
                    setFrameBlocked(true);
                    setEmbedNote('Embedded sign-in is unavailable — please use full-page sign-in below.');
                  }}
                />
              </div>
              <p className="login-hint">
                Prefer full screen?{' '}
                <button type="button" className="login-link-btn" onClick={useHostedSignIn}>
                  Open Catalyst Sign In
                </button>
              </p>
            </div>
          )}

          {/* Fallback State */}
          {catalystState === 'signedout' && frameBlocked && (
            <div className="login-fallback-box">
              {embedNote !== '' && (
                <p className="login-error" role="alert">{embedNote}</p>
              )}
              <button
                type="button"
                className="login-submit"
                onClick={useHostedSignIn}
              >
                <span>Open Catalyst Sign In</span>
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Signed In State */}
          {catalystState === 'signedin' && (
            <div className="login-signedin-box">
              <div className="signedin-indicator" />
              <p className="signedin-text">
                Authenticated as <strong>{email}</strong>
              </p>
              <span className="redirect-note">Launching your dashboard…</span>
            </div>
          )}

          {/* Card Footer Link */}
          <div className="login-card-footer">
            <p className="login-signup">
              Need access? <Link to="/register">Create Account</Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Login;
