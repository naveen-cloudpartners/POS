import React, { useState } from 'react';
import { ShoppingCart, ShoppingBag, Coffee, Store, Utensils, CreditCard } from 'lucide-react';
import { useReveal } from '../hooks/useReveal';

interface DemoProduct {
  id: number;
  name: string;
  price: number;
  category: string;
  tint: string;
}

const DemoSection: React.FC = () => {
  const { ref, visible } = useReveal<HTMLElement>();
  const [activeCategory, setActiveCategory] = useState('Retail');
  const [cart, setCart] = useState<Array<DemoProduct>>([]);

  const categories = [
    { name: 'Retail', icon: ShoppingBag },
    { name: 'Restaurant', icon: Utensils },
    { name: 'Cafe', icon: Coffee },
    { name: 'Supermarket', icon: Store }
  ];

  const products: Array<DemoProduct> = [
    { id: 1, name: 'Premium Espresso', price: 4.50, category: 'Cafe', tint: 'tint-amber' },
    { id: 2, name: 'Organic Cotton Tee', price: 29.99, category: 'Retail', tint: 'tint-blue' },
    { id: 3, name: 'Fresh Avocado', price: 2.50, category: 'Supermarket', tint: 'tint-green' },
    { id: 4, name: 'Wireless Headphones', price: 149.00, category: 'Retail', tint: 'tint-violet' },
    { id: 5, name: 'Signature Pasta', price: 18.50, category: 'Restaurant', tint: 'tint-red' },
    { id: 6, name: 'Artisan Sourdough', price: 6.00, category: 'Cafe', tint: 'tint-amber' },
  ];

  const addToCart = (product: DemoProduct) => {
    setCart([...cart, product]);
  };

  const total = cart.reduce((sum, item) => sum + item.price, 0);

  return (
    <section ref={ref} id="demo" className={`section demo-section container reveal${visible ? ' is-visible' : ''}`}>
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div className="badge" style={{ marginBottom: '1rem' }}>Interactive Sandbox</div>
        <h2 style={{ fontSize: 'var(--h2)' }}>Experience Zero-Latency Sales</h2>
        <p className="text-muted" style={{ maxWidth: '600px', margin: '0 auto' }}>
          Test our high-performance register interface.
          Built for speed, sync, and simplicity.
        </p>
      </div>

      <div className="demo-wrapper browser-frame">
        <div className="browser-bar" aria-hidden="true">
          <span className="browser-dots"><i></i><i></i><i></i></span>
          <span className="browser-url">app.cloudhubpos.com/register-01</span>
          <span className="browser-live">Live demo</span>
        </div>
        <div className="pos-demo-ui" style={{ background: 'white', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', overflow: 'hidden' }}>
          {/* Sidebar */}
          <div className="pos-sidebar">
            {categories.map(cat => (
              <div
                key={cat.name}
                onClick={() => setActiveCategory(cat.name)}
                style={{
                  width: '48px',
                  height: '48px',
                  background: activeCategory === cat.name ? 'var(--primary)' : 'transparent',
                  color: activeCategory === cat.name ? 'white' : 'var(--muted-foreground)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                title={cat.name}
              >
                <cat.icon size={20} />
              </div>
            ))}
          </div>

          {/* Main Grid */}
          <div className="pos-main">
            <div className="pos-header">
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{activeCategory} Inventory</h3>
              <div className="badge" style={{ margin: 0, fontSize: '0.65rem' }}>Terminal Active</div>
            </div>
            <div className="pos-grid">
              {products.filter(p => p.category === activeCategory || activeCategory === 'Retail').map(product => (
                <div key={product.id} className="pos-product-card" onClick={() => addToCart(product)}>
                  <div className={`pos-product-media ${product.tint}`} aria-hidden="true">
                    <span>{product.name.charAt(0)}</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{product.name}</div>
                  <div style={{ color: 'var(--primary)', fontWeight: 800, marginTop: 'auto', paddingTop: '0.25rem' }}>${product.price.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Cart Panel */}
          <div className="pos-cart">
            <div className="pos-header" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <ShoppingCart size={18} />
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Order #4202</h3>
            </div>
            <div className="pos-cart-items">
              {cart.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--muted-foreground)', marginTop: '4rem', fontSize: '0.9rem' }}>
                  Your cart is empty
                </div>
              ) : (
                cart.map((item, idx) => (
                  <div key={idx} className="pos-cart-item">
                    <span>{item.name}</span>
                    <span style={{ fontWeight: 700 }}>${item.price.toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="pos-checkout" style={{ background: 'var(--muted)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <span style={{ fontWeight: 600 }}>Total Due</span>
                <span style={{ fontWeight: 900, fontSize: '1.25rem' }}>${total.toFixed(2)}</span>
              </div>
              <button className="btn btn-primary" style={{ width: '100%', padding: '0.875rem', borderRadius: 'var(--radius-md)' }}>
                <CreditCard size={18} />
                Process Payment
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DemoSection;
