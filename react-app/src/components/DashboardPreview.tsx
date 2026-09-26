import React from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

function MockBar({ url, children }: { url: string; children?: React.ReactNode }) {
  return (
    <div className="browser-bar" aria-hidden="true">
      <span className="browser-dots"><i></i><i></i><i></i></span>
      <span className="browser-url">{url}</span>
      {children}
    </div>
  );
}

const DashboardPreview: React.FC = () => {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <section ref={ref} id="product" className={`section container reveal${visible ? ' is-visible' : ''}`} aria-labelledby="product-title">
      <div style={{ textAlign: 'center', maxWidth: '700px', margin: '0 auto 2.5rem' }}>
        <div className="badge" style={{ marginBottom: '1rem' }}>
          <MonitorSmartphone size={14} style={{ marginRight: '0.5rem' }} />
          Product Tour
        </div>
        <h2 id="product-title" style={{ fontSize: 'var(--h2)' }}>One Dashboard for the Whole Business</h2>
        <p className="text-muted">
          Sales, stock, staff and books — live in a single cloud console
          that works on counter, tablet and back office.
        </p>
      </div>

      <div className="shot-grid" role="list" aria-label="Product screenshots">
        {/* Dashboard mock */}
        <figure className="shot-card browser-frame reveal-item" role="listitem" style={{ '--reveal-delay': '0ms' } as React.CSSProperties}>
          <MockBar url="app.cloudhubpos.com/dashboard" />
          <div className="el-shot el-shot-dash" aria-hidden="true">
            <span className="el-shot-kpis"><i /><i /><i /></span>
            <span className="el-shot-bars"><i style={{ height: '45%' }} /><i style={{ height: '70%' }} /><i style={{ height: '55%' }} /><i style={{ height: '90%' }} className="peak" /><i style={{ height: '65%' }} /></span>
            <span className="el-shot-lines"><i /><i /><i /></span>
          </div>
          <figcaption>Dashboard analytics</figcaption>
        </figure>

        {/* POS mock */}
        <figure className="shot-card browser-frame reveal-item" role="listitem" style={{ '--reveal-delay': '120ms' } as React.CSSProperties}>
          <MockBar url="app.cloudhubpos.com/register-01" />
          <div className="el-shot el-shot-pos" aria-hidden="true">
            <span className="el-shot-tiles"><i>A</i><i>B</i><i>C</i><i>D</i><i>E</i><i>F</i></span>
            <span className="el-shot-total"><em>Total due</em><b>LKR 3,450.00</b><u>Charge</u></span>
          </div>
          <figcaption>Counter checkout</figcaption>
        </figure>

        {/* Inventory mock */}
        <figure className="shot-card browser-frame reveal-item" role="listitem" style={{ '--reveal-delay': '240ms' } as React.CSSProperties}>
          <MockBar url="app.cloudhubpos.com/inventory" />
          <div className="el-shot el-shot-inv" aria-hidden="true">
            <span className="el-shot-row"><i className="pill ok" />Chicken Rice<b>48</b></span>
            <span className="el-shot-row"><i className="pill warn" />Fish Curry<b>6</b></span>
            <span className="el-shot-row"><i className="pill ok" />Egg Hopper<b>112</b></span>
            <span className="el-shot-row"><i className="pill bad" />Milk Toffee<b>0</b></span>
          </div>
          <figcaption>Inventory control</figcaption>
        </figure>

        {/* Reports mock */}
        <figure className="shot-card browser-frame reveal-item el-shot-wide" role="listitem" style={{ '--reveal-delay': '360ms' } as React.CSSProperties}>
          <MockBar url="app.cloudhubpos.com/reports" />
          <div className="el-shot el-shot-rep" aria-hidden="true">
            <span className="el-shot-trend"><i style={{ width: '82%' }} /><i style={{ width: '64%' }} /><i style={{ width: '91%' }} className="peak" /></span>
            <span className="el-shot-stats"><i /><i /><i /></span>
          </div>
          <figcaption>Reports &amp; registers</figcaption>
        </figure>
      </div>
    </section>
  );
};

export default DashboardPreview;
