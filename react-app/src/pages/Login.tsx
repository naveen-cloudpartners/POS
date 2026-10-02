import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Cloud,
  ShoppingCart,
  Boxes,
  BarChart3,
  ShieldCheck,
  ArrowRight,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react';
import '../styles/login.css';
import { login, fetchBackendSession, renderEmbeddedLogin } from '../services/catalystAuth';
import '../styles/login-custom.css';

/* ==========================================================================
   Muster POS — Modern SaaS Login Page
   Native Embedded Authentication with a Muster CSS theme.
   ========================================================================== */

type CatalystState = 'checking' | 'signedin' | 'signedout';

const FEATURES = [
  { icon: ShoppingCart, title: 'Fast, simple checkout', desc: 'Keep billing and orders moving.' },
  { icon: Boxes, title: 'Inventory in one place', desc: 'Manage products, stock and purchasing.' },
  { icon: BarChart3, title: 'A clear view of your sales', desc: 'See the reports that matter to your store.' },
];

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [catalystState, setCatalystState] = useState<CatalystState>('checking');
  const [email, setEmail] = useState('');
  const showEmbeddedLogin = true;
  const [frameBlocked, setFrameBlocked] = useState(false);
  const [embedNote, setEmbedNote] = useState('');
  const authRef = useRef<HTMLDivElement | null>(null);
  const [formHeight, setFormHeight] = useState(280);

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

  const handleFrameLoad = useCallback(async () => {
    const frame = authRef.current?.querySelector('iframe');
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
  }, []);

  const useHostedSignIn = () => {
    void login();
  };

  useEffect(() => {
    if (catalystState !== 'signedout') return;
    let mounted = true;
    const container = authRef.current;
    const frames = new Set<HTMLIFrameElement>();
    const resizeObservers: ResizeObserver[] = [];
    const onLoad = (event: Event) => {
      if (!mounted) return;
      void handleFrameLoad();
      const frame = event.currentTarget as HTMLIFrameElement;
      try {
        const form = frame.contentDocument?.querySelector('.signin_container, .recovery_container');
        if (!form) return;
        const resize = () => {
          if (mounted) setFormHeight(Math.max(260, Math.ceil(form.getBoundingClientRect().height) + 12));
        };
        resize();
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(form);
        resizeObservers.push(resizeObserver);
      } catch { /* Cross-origin provider screens retain the initial frame height. */ }
    };
    const observeFrame = () => {
      const frame = container?.querySelector('iframe');
      if (!frame || frames.has(frame)) return;
      frames.add(frame);
      frame.title = 'Sign in to Muster';
      frame.addEventListener('load', onLoad);
    };
    const observer = new MutationObserver(observeFrame);
    if (container) observer.observe(container, { childList: true });
    void renderEmbeddedLogin('muster-login-form', () => mounted).catch(() => {
      if (mounted) {
        setFrameBlocked(true);
        setEmbedNote('We couldn’t load the sign-in form. Please use full-page sign-in below.');
      }
    });
    return () => {
      mounted = false;
      observer.disconnect();
      resizeObservers.forEach(resizeObserver => resizeObserver.disconnect());
      frames.forEach(frame => frame.removeEventListener('load', onLoad));
    };
  }, [catalystState, handleFrameLoad]);

  return (
    <div className="login-page muster-login-page">
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
              Your store.<br />
              <span className="headline-gradient">One workspace.</span>
            </h1>
            <p className="login-sub">
              Everything your team needs to sell, manage stock and keep the business moving.
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

          {/* Bottom Trust Badge */}
          <div className="login-trust-footer">
            <div className="trust-pulse" aria-hidden="true" />
            <span>Connected with Zoho Books · Powered by Catalyst</span>
          </div>
        </div>
      </aside>

      {/* ---------- Right: Glassmorphism Sign-In Panel ---------- */}
      <main className="login-main">
        <Link to="/landing" className="login-mobile-brand" aria-label="Muster POS home"><Cloud size={24} aria-hidden="true" /><span>Muster POS</span></Link>
        <div className="glass-login-card" role="region" aria-labelledby="login-title">
          <div className="card-top-accent" aria-hidden="true" />
          
          <div className="login-card-header">
            <div className="secure-badge">
              <Zap className="badge-zap-icon" aria-hidden="true" />
              <span>Welcome back</span>
            </div>
            <h2 id="login-title">Sign in to Muster</h2>
            <p className="login-card-desc">
              Welcome back. Let’s get your day started.
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
              <div ref={authRef} id="muster-login-form" className="login-auth-frame" style={{ '--auth-form-height': `${formHeight}px` } as React.CSSProperties} />
              <p className="login-hint">
                Having trouble?{' '}
                <button type="button" className="login-link-btn" onClick={useHostedSignIn}>
                  Use full-page sign in
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
          <p className="login-security-note"><ShieldCheck size={15} aria-hidden="true" />Secure sign in powered by Catalyst</p>
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
