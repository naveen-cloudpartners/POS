import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Store, Mail, Link2, Unlink, Save, Percent, Boxes, HeartHandshake, ReceiptText, ShieldCheck, Bell, ImageOff, Banknote, Printer as PrinterIcon } from 'lucide-react';
import Card from '../components/ui/Card';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import API_BASE from '../services/api';
import {
  companyLogoUrl,
  disconnectZoho,
  getCompanyProfile,
  getIntegrationHealth,
  getNotificationSettings,
  getPaymentMethods,
  getSettings,
  getSmtpStatus,
  getTaxSettings,
  getZohoStatus,
  removeCompanyLogo,
  saveCompanyProfile,
  saveNotificationSettings,
  savePaymentMethods,
  saveSettings,
  saveSmtp,
  saveTaxSettings,
  sendLowStockDigest,
  uploadCompanyLogo,
  type CompanyProfile,
  type IntegrationHealth,
  type NotificationPrefs,
  type PaymentMethod,
  type TaxSettings,
} from '../services/settingsService';
import { getProducts } from '../services/productService';
import {
  getPrinters,
  getPrintRouting,
  savePrinters,
  savePrintRouting,
  type Printer,
  type PrintRouting,
} from '../services/printService';
import { useAuth } from '../context/AuthContext';
import { calcLine } from '../utils/tax';
import { currency } from '../utils/format';
import type { Product, StoreSettings, ZohoStatus } from '../types';
import './Settings.css';

const NOTIFICATION_GROUPS: Array<{ title: string; keys: Array<{ key: string; label: string; hint: string }> }> = [
  {
    title: 'Inventory notifications',
    keys: [
      { key: 'low_stock', label: 'Low stock alerts', hint: 'Email when stock breaches the threshold.' },
      { key: 'out_of_stock', label: 'Out of stock alerts', hint: 'Email when an item hits zero.' },
      { key: 'inventory_sync_fail', label: 'Inventory sync failures', hint: 'Alert when catalog sync fails.' },
    ],
  },
  {
    title: 'Order notifications',
    keys: [
      { key: 'order_confirmation', label: 'Order confirmations', hint: 'Confirm new sales to staff recipients.' },
      { key: 'order_status', label: 'Order status updates', hint: 'Follow-up status changes.' },
      { key: 'receipt', label: 'Receipt emails', hint: 'Allow emailing receipts from POS and Orders.' },
      { key: 'order_void', label: 'Void notifications', hint: 'Notify the customer when their order is voided.' },
      { key: 'order_refund', label: 'Refund notifications', hint: 'Reserved for the future refund flow.' },
    ],
  },
  {
    title: 'System notifications',
    keys: [
      { key: 'books_sync_fail', label: 'Books sync failures', hint: 'Alert when Zoho Books sync fails.' },
      { key: 'audit_alerts', label: 'Audit alerts', hint: 'Important audit events (role changes, deactivations).' },
      { key: 'user_invite', label: 'User invitations', hint: 'Notify when team invitations are sent.' },
    ],
  },
];

const SETTINGS_SECTION_IDS: Array<string> = [
  'general',
  'inventory',
  'loyalty',
  'reporting',
  'administration',
  'taxes',
  'printers',
  'notifications',
  'email',
  'integrations',
  'payments',
];

export default function Settings() {
  const { role } = useAuth();
  const { hash } = useLocation();
  const hashId = hash.startsWith('#') ? hash.slice(1) : '';
  const activeSection = SETTINGS_SECTION_IDS.includes(hashId) ? hashId : 'general';
  const [settings, setSettings] = useState<StoreSettings>({});
  const [company, setCompany] = useState<Partial<CompanyProfile>>({});
  const [tax, setTax] = useState<TaxSettings | null>(null);
  const [notif, setNotif] = useState<NotificationPrefs | null>(null);
  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [products, setProducts] = useState<Array<Product>>([]);
  const [zoho, setZoho] = useState<ZohoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState('');

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpBusy, setSmtpBusy] = useState(false);

  const [logoBusy, setLogoBusy] = useState(false);
  const [logoTick, setLogoTick] = useState(0);
  const [payMethods, setPayMethods] = useState<Array<PaymentMethod>>([]);
  const [printers, setPrinters] = useState<Array<Printer>>([]);
  const [routing, setRouting] = useState<PrintRouting | null>(null);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleStation, setNewRuleStation] = useState('kitchen');
  const [digestBusy, setDigestBusy] = useState(false);
  const [previewPrice, setPreviewPrice] = useState('100');
  const [previewRate, setPreviewRate] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileRate, setNewProfileRate] = useState('');

  const effectiveRole = role === '' ? 'Admin' : role;
  const isAdmin = effectiveRole === 'Admin';

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getSettings(),
      getCompanyProfile().catch(() => ({} as Partial<CompanyProfile>)),
      getTaxSettings(),
      getNotificationSettings(),
      getIntegrationHealth(),
      getPaymentMethods().catch(() => [] as Array<PaymentMethod>),
      getPrinters().catch(() => [] as Array<Printer>),
      getPrintRouting(),
      getZohoStatus(),
      getSmtpStatus(),
      getProducts().catch(() => [] as Array<Product>),
    ])
      .then(([s, co, tx, nt, he, pm, pr, rt, z, smtp, prods]) => {
        setSettings(s);
        setCompany(co);
        setTax(tx);
        setNotif(nt);
        setHealth(he);
        setPayMethods(pm);
        setPrinters(pr);
        setRouting(rt);
        setProducts(prods);
        setZoho(z);
        setSmtpHost(smtp.smtp_host);
        setSmtpPort(smtp.smtp_port);
        setSmtpUser(smtp.smtp_user);
        setSmtpFrom(smtp.smtp_from);
        setSmtpConfigured(smtp.configured);
        if (tx !== null && previewRate === '') setPreviewRate(String(tx.default_rate));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const taxStats = useMemo(() => {
    const rates = products.map((p) => Number(p.tax_percentage ?? 0));
    const taxed = rates.filter((r) => r > 0).length;
    const avg = rates.length === 0 ? 0 : rates.reduce((s, r) => s + r, 0) / rates.length;
    return { taxed, avg: avg.toFixed(2), max: rates.length === 0 ? '0' : Math.max(...rates).toFixed(2) };
  }, [products]);

  const set = (key: string, value: string) => setSettings((prev) => ({ ...prev, [key]: value }));
  const setCo = (key: string, value: string) => setCompany((prev) => ({ ...prev, [key]: value }));

  /* INV-08: backorder policy toggle (boolean stored as a Settings key). */
  const backordersOn = settings.allow_backorders === true
    || settings.allow_backorders === 1
    || String(settings.allow_backorders ?? '').toLowerCase() === 'true';
  const setBackorders = (on: boolean) => setSettings((prev) => ({ ...prev, allow_backorders: on }));

  /* CUST-05: loyalty program settings (org-scoped keys, backend defaults apply). */
  const boolOf = (v: unknown, dflt: boolean): boolean => {
    if (v === undefined || v === null || v === '') return dflt;
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return dflt;
  };
  const numOf = (v: unknown, dflt: number): number => {
    if (v === undefined || v === null || v === '') return dflt;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  const setLoyalty = (key: string, value: string | boolean) => setSettings((prev) => ({ ...prev, [key]: value }));

  const saveGeneral = () => {
    setSaving(true);
    setSavingKey('general');
    setNotice('');
    saveSettings(settings)
      .then(() => setNotice('Store settings saved.'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => { setSaving(false); setSavingKey(''); });
  };

  const saveCompany = () => {
    setSaving(true);
    setSavingKey('company');
    setNotice('');
    saveCompanyProfile(company)
      .then((co) => {
        setCompany(co);
        setNotice('Company profile saved.');
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => { setSaving(false); setSavingKey(''); });
  };

  const saveTax = () => {
    if (tax === null) return;
    setSaving(true);
    setSavingKey('tax');
    setNotice('');
    saveTaxSettings(tax)
      .then((t) => {
        if (t !== null) setTax(t);
        setNotice('Tax settings saved. POS, orders and receipts use them immediately.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => { setSaving(false); setSavingKey(''); });
  };

  const saveNotif = () => {
    if (notif === null) return;
    setSaving(true);
    setSavingKey('notif');
    setNotice('');
    saveNotificationSettings(notif)
      .then((n) => {
        if (n !== null) setNotif(n);
        setNotice('Notification preferences saved.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => { setSaving(false); setSavingKey(''); });
  };

  const savePayMethods = () => {
    setSaving(true);
    setSavingKey('pay');
    setNotice('');
    savePaymentMethods(payMethods)
      .then((m) => {
        setPayMethods(m);
        setNotice('Payment methods saved. POS offers only enabled methods.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => { setSaving(false); setSavingKey(''); });
  };

  const savePrintersForm = () => {
    setSaving(true);
    setSavingKey('printers');
    setNotice('');
    savePrinters(printers)
      .then((m) => {
        setPrinters(m);
        setNotice('Printers saved. Checkout routes bills and KOTs to enabled printers.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => { setSaving(false); setSavingKey(''); });
  };

  const addPrinter = () => {
    const name = newPrinterName.trim();
    if (name === '') return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'printer'}-${Date.now().toString(36)}`;
    const printer: Printer = { id, name: name.slice(0, 80), station: 'kitchen', width: 80, transport: 'browser', address: '', enabled: true };
    setPrinters((prev) => [...prev, printer]);
    setNewPrinterName('');
  };

  const saveRoutingForm = () => {
    if (routing === null) return;
    setSaving(true);
    setSavingKey('routing');
    setNotice('');
    savePrintRouting(routing)
      .then((r) => {
        if (r !== null) setRouting(r);
        setNotice('Print routing saved. New sales split by station.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => { setSaving(false); setSavingKey(''); });
  };

  const addRoutingRule = () => {
    const name = newRuleName.trim().toLowerCase();
    if (name === '' || routing === null) return;
    setRouting({ ...routing, byCategoryName: { ...routing.byCategoryName, [name]: newRuleStation } });
    setNewRuleName('');
  };

  const sendDigest = () => {
    setDigestBusy(true);
    setNotice('');
    sendLowStockDigest()
      .then((res) => setNotice(res.message ?? (res.sent ? `Digest sent to ${(res.to ?? []).join(', ')}.` : 'Digest checked.')))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Digest failed'))
      .finally(() => setDigestBusy(false));
  };

  const saveSmtpForm = () => {
    if (smtpHost.trim() === '' || smtpUser.trim() === '' || smtpPass === '') {
      setError('SMTP host, username and password are required.');
      return;
    }
    setSmtpBusy(true);
    saveSmtp({ smtp_host: smtpHost.trim(), smtp_port: smtpPort, smtp_user: smtpUser.trim(), smtp_pass: smtpPass, smtp_from: smtpFrom.trim() || smtpUser.trim() })
      .then(() => {
        setNotice('SMTP configuration saved.');
        setSmtpPass('');
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'SMTP save failed'))
      .finally(() => setSmtpBusy(false));
  };

  const onLogoFile = (file: File | undefined) => {
    if (!file || !isAdmin) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Logo must be PNG, JPG/JPEG, or WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Logo exceeds 5 MB.');
      return;
    }
    setLogoBusy(true);
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      uploadCompanyLogo({ imageData: String(reader.result ?? ''), mimeType: file.type })
        .then(() => {
          setNotice('Logo uploaded.');
          setLogoTick((t) => t + 1);
          load();
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Logo upload failed'))
        .finally(() => setLogoBusy(false));
    };
    reader.onerror = () => {
      setError('Could not read the logo file.');
      setLogoBusy(false);
    };
    reader.readAsDataURL(file);
  };

  const onLogoRemove = () => {
    setLogoBusy(true);
    removeCompanyLogo()
      .then(() => {
        setNotice('Logo removed.');
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Logo removal failed'))
      .finally(() => setLogoBusy(false));
  };

  const connectZoho = () => {
    window.open(`${API_BASE}/auth/url`, '_blank', 'width=560,height=680');
  };

  const disconnect = () => {
    disconnectZoho()
      .then(() => {
        setNotice('Zoho Books disconnected.');
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Disconnect failed'));
  };

  const preview = useMemo(() => {
    const price = Math.max(0, Number(previewPrice) || 0);
    const rate = Math.max(0, Math.min(100, Number(previewRate) || 0));
    const mode = tax?.mode ?? 'exclusive';
    const r = calcLine({ qty: 1, rate: price, taxPct: rate }, { mode, round: tax?.round ?? true });
    return { price, rate, sub: r.net, tax: r.tax, total: r.net + r.tax, mode };
  }, [previewPrice, previewRate, tax]);

  const setNotifKey = (key: string, patch: Partial<{ enabled: boolean; channels: Array<string>; threshold: string; recipients: string; frequency: string }>) => {
    setNotif((prev) => {
      if (prev === null) return prev;
      const cur = (prev[key] ?? { enabled: false, channels: ['email'] }) as {
        enabled: boolean; channels: Array<string>; threshold?: string | number; recipients?: string; frequency?: string;
      };
      return { ...prev, [key]: { ...cur, ...patch } };
    });
  };

  const saveBtn = (key: string, onClick: () => void, label = 'Save settings') => (
    isAdmin ? (
      <button type="button" className="ch-btn ch-btn-primary" onClick={onClick} disabled={saving}>
        <Save size={15} /> {saving && savingKey === key ? 'Saving…' : label}
      </button>
    ) : (
      <span className="ch-hint">Read-only — Managers cannot save settings.</span>
    )
  );

  if (loading) return <Loader message="Loading settings…" skeleton="page" />;
  if (error !== '' && zoho === null && Object.keys(settings).length === 0) {
    return <ErrorState message={error} onRetry={load} />;
  }

  const logoSrc = company.logo_file_id ? `${companyLogoUrl()}?t=${logoTick}` : '';

  return (
    <div>
      <div className="ch-page-head">
        <div>
          <h1 className="ch-page-title">Settings</h1>
          <p className="ch-page-sub">Company profile, taxes, notifications, email and integrations.</p>
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}
      {!isAdmin && <div className="ch-alert ch-alert-info">Read-only view — only Admins can save settings.</div>}

      <div className="settings-grid">
        {activeSection === 'general' && (
        <Card
          id="general"
          title="General"
          subtitle="Company profile, address and contact details"
          action={<Store size={18} aria-hidden="true" />}
          footer={saveBtn('company', saveCompany)}
        >
          <div className="settings-logo-row">
            <div>
              {logoSrc !== '' ? (
                <div className="ch-row" style={{ alignItems: 'center' }}>
                  <img src={logoSrc} alt="Company logo" style={{ maxHeight: 48, maxWidth: 160, borderRadius: 8, border: '1px solid var(--ch-border-soft)' }} />
                  {isAdmin && (
                    <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={onLogoRemove} disabled={logoBusy}>
                      <ImageOff size={14} /> {logoBusy ? 'Working…' : 'Remove'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="ch-hint" style={{ margin: 0 }}>No logo yet — it appears on emailed receipts once uploaded.</p>
              )}
            </div>
            {isAdmin && (
              <div className="ch-field" style={{ marginBottom: 0 }}>
                <label className="ch-label" htmlFor="st-logo">Company logo (PNG/JPG/WebP, max 5 MB)</label>
                <input
                  id="st-logo"
                  className="ch-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={logoBusy}
                  onChange={(e) => onLogoFile(e.target.files?.[0])}
                />
              </div>
            )}
          </div>
          <div className="ch-form-grid">
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-cname">Company name</label>
              <input id="st-cname" className="ch-input" value={String(company.company_name ?? '')} onChange={(e) => setCo('company_name', e.target.value)} placeholder="My Store" disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-legal">Legal / business name</label>
              <input id="st-legal" className="ch-input" value={String(company.legal_name ?? '')} onChange={(e) => setCo('legal_name', e.target.value)} placeholder="Company (Pvt) Ltd" disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-addr1">Address line 1</label>
              <input id="st-addr1" className="ch-input" value={String(company.address1 ?? '')} onChange={(e) => setCo('address1', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-addr2">Address line 2</label>
              <input id="st-addr2" className="ch-input" value={String(company.address2 ?? '')} onChange={(e) => setCo('address2', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-city">City</label>
              <input id="st-city" className="ch-input" value={String(company.city ?? '')} onChange={(e) => setCo('city', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-prov">Province</label>
              <input id="st-prov" className="ch-input" value={String(company.province ?? '')} onChange={(e) => setCo('province', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-postal">Postal code</label>
              <input id="st-postal" className="ch-input" value={String(company.postal_code ?? '')} onChange={(e) => setCo('postal_code', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-country">Country</label>
              <input id="st-country" className="ch-input" value={String(company.country ?? '')} onChange={(e) => setCo('country', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-phone">Phone</label>
              <input id="st-phone" className="ch-input" value={String(company.phone ?? '')} onChange={(e) => setCo('phone', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-cemail">Email</label>
              <input id="st-cemail" className="ch-input" type="email" value={String(company.email ?? '')} onChange={(e) => setCo('email', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-web">Website</label>
              <input id="st-web" className="ch-input" value={String(company.website ?? '')} onChange={(e) => setCo('website', e.target.value)} placeholder="https://…" disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-currency">Currency</label>
              <select id="st-currency" className="ch-select" value={String(company.currency ?? settings.currency ?? 'LKR')} onChange={(e) => { setCo('currency', e.target.value); set('currency', e.target.value); }} disabled={!isAdmin}>
                {['LKR', 'USD', 'EUR', 'INR', 'GBP'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-reg">Business registration no.</label>
              <input id="st-reg" className="ch-input" value={String(company.reg_number ?? '')} onChange={(e) => setCo('reg_number', e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-taxno">Tax registration no.</label>
              <input id="st-taxno" className="ch-input" value={String(company.tax_number ?? '')} onChange={(e) => setCo('tax_number', e.target.value)} disabled={!isAdmin} />
            </div>
          </div>
        </Card>

        )}
        {activeSection === 'inventory' && (
        <Card
          id="inventory"
          title="Inventory"
          subtitle="Warehouses, transfers and backorder policy"
          action={<Boxes size={18} aria-hidden="true" />}
          footer={saveBtn('general', saveGeneral)}
        >
          <div className="ch-field">
            <label className="ch-label" htmlFor="st-backorders" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id="st-backorders"
                type="checkbox"
                checked={backordersOn}
                onChange={(e) => setBackorders(e.target.checked)}
                disabled={!isAdmin}
              />
              Allow negative inventory
            </label>
            <span className="ch-hint">
              Allow inventory quantities to go below zero and create backorders.
              When off, adjustments and transfers that would drive stock negative are rejected with “Insufficient stock”.
            </span>
          </div>
        </Card>

        )}
        {activeSection === 'loyalty' && (
        <Card
          id="loyalty"
          title="Customer loyalty"
          subtitle="Points engine, tiers and manual adjustments"
          action={<HeartHandshake size={18} aria-hidden="true" />}
          footer={
            <span className="ch-row" style={{ gap: 8 }}>
              {saveBtn('general-loyal', saveGeneral)}
              <Link to="/customers/loyalty" className="ch-btn ch-btn-secondary">View loyalty</Link>
            </span>
          }
        >
          <div className="ch-form-grid">
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-loyal-on" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="st-loyal-on"
                  type="checkbox"
                  checked={boolOf(settings.loyalty_enabled, true)}
                  onChange={(e) => setLoyalty('loyalty_enabled', e.target.checked)}
                  disabled={!isAdmin}
                />
                Enable loyalty program
              </label>
              <span className="ch-hint">Checkout awards points automatically when on.</span>
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-loyal-ppc">Spend per point (LKR)</label>
              <input
                id="st-loyal-ppc"
                className="ch-input"
                type="number"
                min="1"
                step="1"
                value={String(numOf(settings.loyalty_points_per_currency, 100))}
                onChange={(e) => setLoyalty('loyalty_points_per_currency', e.target.value)}
                disabled={!isAdmin}
              />
              <span className="ch-hint">Default 100 = 1 point per LKR 100.</span>
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-tier-active">Active threshold (pts)</label>
              <input
                id="st-tier-active"
                className="ch-input"
                type="number"
                min="1"
                step="1"
                value={String(numOf(settings.loyalty_tier_active, 100))}
                onChange={(e) => setLoyalty('loyalty_tier_active', e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-tier-loyal">Loyal threshold (pts)</label>
              <input
                id="st-tier-loyal"
                className="ch-input"
                type="number"
                min="1"
                step="1"
                value={String(numOf(settings.loyalty_tier_loyal, 500))}
                onChange={(e) => setLoyalty('loyalty_tier_loyal', e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-tier-vip">VIP threshold (pts)</label>
              <input
                id="st-tier-vip"
                className="ch-input"
                type="number"
                min="1"
                step="1"
                value={String(numOf(settings.loyalty_tier_vip, 1000))}
                onChange={(e) => setLoyalty('loyalty_tier_vip', e.target.value)}
                disabled={!isAdmin}
              />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-loyal-manual" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="st-loyal-manual"
                  type="checkbox"
                  checked={boolOf(settings.loyalty_manual_adjustments, true)}
                  onChange={(e) => setLoyalty('loyalty_manual_adjustments', e.target.checked)}
                  disabled={!isAdmin}
                />
                Manual adjustments enabled
              </label>
              <span className="ch-hint">Admins always retain access; this gates Managers.</span>
            </div>
            <div className="ch-field ch-field-full">
              <label className="ch-label" htmlFor="st-loyal-noemail" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="st-loyal-noemail"
                  type="checkbox"
                  checked={boolOf(settings.loyalty_allow_no_email, true)}
                  onChange={(e) => setLoyalty('loyalty_allow_no_email', e.target.checked)}
                  disabled={!isAdmin}
                />
                Allow customers without email
              </label>
            </div>
          </div>
        </Card>

        )}
        {activeSection === 'reporting' && (
        <Card
          id="reporting"
          title="Reporting"
          subtitle="Default range, PDF export and report branding"
          action={<ReceiptText size={18} aria-hidden="true" />}
          footer={
            <span className="ch-row" style={{ gap: 8 }}>
              {saveBtn('general-rep', saveGeneral)}
              <Link to="/reports" className="ch-btn ch-btn-secondary">View reports</Link>
            </span>
          }
        >
          <div className="ch-form-grid">
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-rep-range">Default report range</label>
              <select
                id="st-rep-range"
                className="ch-select"
                value={String(settings.report_default_range ?? 'month')}
                onChange={(e) => set('report_default_range', e.target.value)}
                disabled={!isAdmin}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="lastmonth">Last month</option>
                <option value="year">This year</option>
                <option value="all">All time</option>
              </select>
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-rep-pdf" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="st-rep-pdf"
                  type="checkbox"
                  checked={boolOf(settings.report_pdf_enabled, true)}
                  onChange={(e) => setSettings((prev) => ({ ...prev, report_pdf_enabled: e.target.checked }))}
                  disabled={!isAdmin}
                />
                Enable PDF export
              </label>
              <span className="ch-hint">Branded PDFs with metrics, tables, charts and page numbers.</span>
            </div>
            <div className="ch-field ch-field-full">
              <label className="ch-label" htmlFor="st-rep-footer">Report footer</label>
              <input
                id="st-rep-footer"
                className="ch-input"
                value={String(settings.report_footer ?? '')}
                onChange={(e) => set('report_footer', e.target.value)}
                placeholder="Printed on every PDF footer, e.g. Thank you for your business"
                disabled={!isAdmin}
              />
              <span className="ch-hint">Company name branding comes from General settings automatically.</span>
            </div>
          </div>
        </Card>

        )}
        {activeSection === 'administration' && (
        <Card
          id="administration"
          title="Administration"
          subtitle="Audit retention, exports and invitations"
          action={<ShieldCheck size={18} aria-hidden="true" />}
          footer={
            <span className="ch-row" style={{ gap: 8 }}>
              {saveBtn('general-adm', saveGeneral)}
              <Link to="/admin/audit" className="ch-btn ch-btn-secondary">View audit log</Link>
            </span>
          }
        >
          <div className="ch-form-grid">
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-audit-retention">Audit retention (days)</label>
              <input
                id="st-audit-retention"
                className="ch-input"
                type="number"
                min="7"
                max="3650"
                step="1"
                value={String(numOf(settings.admin_audit_retention_days, 90))}
                onChange={(e) => set('admin_audit_retention_days', e.target.value)}
                disabled={!isAdmin}
              />
              <span className="ch-hint">Events older than this are pruned on read (min 7).</span>
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="st-audit-export" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="st-audit-export"
                  type="checkbox"
                  checked={boolOf(settings.admin_audit_export, true)}
                  onChange={(e) => setSettings((prev) => ({ ...prev, admin_audit_export: e.target.checked }))}
                  disabled={!isAdmin}
                />
                Enable audit export
              </label>
              <span className="ch-hint">CSV and PDF downloads on the Audit page.</span>
            </div>
            <div className="ch-field ch-field-full">
              <label className="ch-label" htmlFor="st-invitations" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  id="st-invitations"
                  type="checkbox"
                  checked={boolOf(settings.admin_allow_invitations, true)}
                  onChange={(e) => setSettings((prev) => ({ ...prev, admin_allow_invitations: e.target.checked }))}
                  disabled={!isAdmin}
                />
                Enable user invitations
              </label>
              <span className="ch-hint">When off, even Admins cannot invite new members.</span>
            </div>
            <div className="ch-field ch-field-full">
              <span className="ch-hint" style={{ marginTop: 0 }}>
                Passwords live in Catalyst Auth: members reset their own via “Forgot password” on the
                hosted login page, and Admins can re-issue invitations from Administration → Users.
              </span>
            </div>
          </div>
        </Card>

        )}
        {activeSection === 'taxes' && (
        <Card
          id="taxes"
          title="Taxes"
          subtitle="Modes, profiles and catalog coverage"
          action={<Percent size={18} aria-hidden="true" />}
          footer={saveBtn('tax', saveTax)}
        >
          {tax === null ? (
            <p className="ch-hint">Tax settings unavailable on this backend.</p>
          ) : (
            <>
              <div className="ch-form-grid">
                <div className="ch-field">
                  <label className="ch-label" htmlFor="st-tax-on" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      id="st-tax-on"
                      type="checkbox"
                      checked={tax.enabled}
                      onChange={(e) => setTax({ ...tax, enabled: e.target.checked })}
                      disabled={!isAdmin}
                    />
                    Tax enabled
                  </label>
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor="st-tax-name">Tax name</label>
                  <input
                    id="st-tax-name"
                    className="ch-input"
                    value={tax.name}
                    onChange={(e) => setTax({ ...tax, name: e.target.value })}
                    placeholder="VAT"
                    disabled={!isAdmin}
                  />
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor="st-tax-mode">Tax mode</label>
                  <select
                    id="st-tax-mode"
                    className="ch-select"
                    value={tax.mode}
                    onChange={(e) => setTax({ ...tax, mode: e.target.value as 'exclusive' | 'inclusive' })}
                    disabled={!isAdmin}
                  >
                    <option value="exclusive">Exclusive (tax added on top)</option>
                    <option value="inclusive">Inclusive (price includes tax)</option>
                  </select>
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor="st-tax-rate">Default rate %</label>
                  <input
                    id="st-tax-rate"
                    className="ch-input"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={String(tax.default_rate)}
                    onChange={(e) => setTax({ ...tax, default_rate: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="ch-field ch-span-2">
                  <label className="ch-label" htmlFor="st-tax-round" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      id="st-tax-round"
                      type="checkbox"
                      checked={tax.round}
                      onChange={(e) => setTax({ ...tax, round: e.target.checked })}
                      disabled={!isAdmin}
                    />
                    Round tax per line (off rounds only the final total)
                  </label>
                </div>
              </div>
              <div className="settings-3col">
                <div>
              <h4 className="cust-h">Tax profiles</h4>
              {tax.profiles.length === 0 ? (
                <p className="ch-hint">No profiles — products fall back to the default rate.</p>
              ) : (
                <ul className="ws-mini">
                  {tax.profiles.map((p) => (
                    <li key={p.name}>
                      {p.name} — {p.rate}%
                      {isAdmin && (
                        <button
                          type="button"
                          className="ch-btn ch-btn-ghost ch-btn-sm"
                          style={{ marginLeft: 8 }}
                          onClick={() => setTax({ ...tax, profiles: tax.profiles.filter((x) => x.name !== p.name) })}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && (
                <div className="ch-form-grid" style={{ marginTop: 8 }}>
                  <div className="ch-field">
                    <label className="ch-label" htmlFor="st-prof-name">Profile name</label>
                    <input id="st-prof-name" className="ch-input" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder="e.g. VAT" />
                  </div>
                  <div className="ch-field">
                    <label className="ch-label" htmlFor="st-prof-rate">Rate %</label>
                    <input id="st-prof-rate" className="ch-input" type="number" min="0" max="100" step="0.01" value={newProfileRate} onChange={(e) => setNewProfileRate(e.target.value)} />
                  </div>
                  <div className="ch-field" style={{ alignSelf: 'end' }}>
                    <button
                      type="button"
                      className="ch-btn ch-btn-secondary ch-btn-sm"
                      onClick={() => {
                        if (newProfileName.trim() === '') return;
                        setTax({ ...tax, profiles: [...tax.profiles, { name: newProfileName.trim(), rate: Math.max(0, Math.min(100, Number(newProfileRate) || 0)) }] });
                        setNewProfileName('');
                        setNewProfileRate('');
                      }}
                    >
                      Add profile
                    </button>
                  </div>
                </div>
              )}
                </div>
                <div>
              <h4 className="cust-h">Preview calculator</h4>
              <div className="ch-form-grid">
                <div className="ch-field">
                  <label className="ch-label" htmlFor="st-prev-price">Price</label>
                  <input id="st-prev-price" className="ch-input" type="number" min="0" step="0.01" value={previewPrice} onChange={(e) => setPreviewPrice(e.target.value)} />
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor="st-prev-rate">Rate %</label>
                  <select id="st-prev-rate" className="ch-select" value={previewRate} onChange={(e) => setPreviewRate(e.target.value)}>
                    <option value={String(tax.default_rate)}>Default ({tax.default_rate}%)</option>
                    {tax.profiles.map((p) => <option key={p.name} value={String(p.rate)}>{p.name} ({p.rate}%)</option>)}
                  </select>
                </div>
              </div>
              <dl className="settings-zoho" style={{ marginTop: 8 }}>
                <div><dt>Subtotal</dt><dd>{currency(preview.sub)}</dd></div>
                <div><dt>{tax.name}{preview.mode === 'inclusive' ? ' (incl.)' : ''}</dt><dd>{currency(preview.tax)}</dd></div>
                <div><dt>Final total</dt><dd><b>{currency(preview.total)}</b></dd></div>
              </dl>
                </div>
                <div>
              <h4 className="cust-h">Catalog coverage</h4>
              <dl className="settings-zoho">
                <div><dt>Taxed SKUs</dt><dd>{taxStats.taxed} of {products.length}</dd></div>
                <div><dt>Average item tax</dt><dd>{taxStats.avg}%</dd></div>
                <div><dt>Highest item tax</dt><dd>{taxStats.max}%</dd></div>
              </dl>
                </div>
              </div>
            </>
          )}
        </Card>

        )}
        {activeSection === 'notifications' && (
        <Card
          id="notifications"
          title="Notifications"
          subtitle="What the store sends, and where"
          action={<Bell size={18} aria-hidden="true" />}
          footer={
            <span className="ch-row" style={{ gap: 8 }}>
              {saveBtn('notif', saveNotif)}
              {isAdmin && (
                <button type="button" className="ch-btn ch-btn-secondary" onClick={sendDigest} disabled={digestBusy}>
                  <Mail size={15} /> {digestBusy ? 'Sending…' : 'Send digest now'}
                </button>
              )}
            </span>
          }
        >
          {notif === null ? (
            <p className="ch-hint">Notification settings unavailable on this backend.</p>
          ) : (
            <>
              <div className="settings-3col">
              {NOTIFICATION_GROUPS.map((g) => (
                <div key={g.title}>
                  <h4 className="cust-h">{g.title}</h4>
                  {g.keys.map((k) => {
                    const cur = (notif[k.key] ?? { enabled: false, channels: [] }) as {
                      enabled: boolean; channels: Array<string>;
                    };
                    return (
                      <div className="ch-field" key={k.key}>
                        <label className="ch-label" htmlFor={`nt-${k.key}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            id={`nt-${k.key}`}
                            type="checkbox"
                            checked={cur.enabled === true}
                            onChange={(e) => setNotifKey(k.key, { enabled: e.target.checked })}
                            disabled={!isAdmin}
                          />
                          {k.label}
                        </label>
                        <span className="ch-hint">{k.hint}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              </div>
              <h4 className="cust-h">Low-stock delivery</h4>
              <div className="ch-form-grid settings-2col">
                <div className="ch-field">
                  <label className="ch-label" htmlFor="nt-threshold">Threshold (units)</label>
                  <input
                    id="nt-threshold"
                    className="ch-input"
                    type="number"
                    min="0"
                    step="1"
                    value={String((notif.low_stock as { threshold?: unknown })?.threshold ?? '')}
                    onChange={(e) => setNotifKey('low_stock', { threshold: e.target.value })}
                    placeholder="Per-product reorder level"
                    disabled={!isAdmin}
                  />
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor="nt-frequency">Frequency</label>
                  <select
                    id="nt-frequency"
                    className="ch-select"
                    value={String((notif.low_stock as { frequency?: unknown })?.frequency ?? 'immediate')}
                    onChange={(e) => setNotifKey('low_stock', { frequency: e.target.value })}
                    disabled={!isAdmin}
                  >
                    <option value="immediate">Immediate alert</option>
                    <option value="daily">Daily digest (scheduled delivery)</option>
                  </select>
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor="nt-recipients">Recipients (comma-separated)</label>
                  <input
                    id="nt-recipients"
                    className="ch-input"
                    value={String((notif.low_stock as { recipients?: unknown })?.recipients ?? '')}
                    onChange={(e) => setNotifKey('low_stock', { recipients: e.target.value })}
                    placeholder="manager@store.lk"
                    disabled={!isAdmin}
                  />
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor="nt-alert">Alert email (system failures)</label>
                  <input
                    id="nt-alert"
                    className="ch-input"
                    type="email"
                    value={String(notif.alert_email ?? '')}
                    onChange={(e) => setNotif({ ...notif, alert_email: e.target.value })}
                    placeholder="owner@store.lk"
                    disabled={!isAdmin}
                  />
                  <span className="ch-hint">All email leaves through the configured SMTP engine. Daily digest needs a scheduler (stored, pending delivery).</span>
                </div>
              </div>
            </>
          )}
        </Card>

        )}
        {activeSection === 'email' && (
        <Card
          id="email"
          title="SMTP email"
          subtitle="Receipts and notifications delivery"
          action={<span>{smtpConfigured ? <StatusBadge status="Connected" /> : <StatusBadge status="Pending" />}</span>}
          footer={
            isAdmin ? (
              <button type="button" className="ch-btn ch-btn-primary" onClick={saveSmtpForm} disabled={smtpBusy}>
                <Save size={15} /> {smtpBusy ? 'Saving…' : 'Save SMTP'}
              </button>
            ) : (
              <span className="ch-hint">Read-only — Managers cannot save settings.</span>
            )
          }
        >
          <div className="ch-form-grid">
            <div className="ch-field">
              <label className="ch-label" htmlFor="smtp-host">Host</label>
              <input id="smtp-host" className="ch-input" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" autoComplete="off" disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="smtp-port">Port</label>
              <input id="smtp-port" className="ch-input" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" autoComplete="off" disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="smtp-user">Username</label>
              <input id="smtp-user" className="ch-input" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="user@example.com" autoComplete="off" disabled={!isAdmin} />
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor="smtp-pass">Password</label>
              <input id="smtp-pass" className="ch-input" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={smtpConfigured ? '•••••••• (unchanged)' : 'SMTP password'} autoComplete="new-password" disabled={!isAdmin} />
            </div>
            <div className="ch-field ch-field-full">
              <label className="ch-label" htmlFor="smtp-from">From address</label>
              <input id="smtp-from" className="ch-input" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="noreply@store.lk" disabled={!isAdmin} />
            </div>
          </div>
          <p className="ch-hint" style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Mail size={13} aria-hidden="true" /> Password is never displayed back — it is stored server-side only.
          </p>
        </Card>

        )}
        {activeSection === 'integrations' && (
        <Card
          id="integrations"
          title="Zoho Books"
          subtitle="Inventory sync, invoice posting and connection health"
          action={zoho?.connected === true ? <StatusBadge status="Connected" /> : <StatusBadge status="Pending" />}
        >
          <dl className="settings-zoho">
            <div><dt>Connection</dt><dd>{zoho?.connected === true ? 'Active' : 'Not connected'}</dd></div>
            <div><dt>Organisation</dt><dd>{health?.books.org_id || zoho?.org_id || '—'}</dd></div>
            <div><dt>Data centre</dt><dd>{health?.books.dc || zoho?.dc || '—'}</dd></div>
            <div><dt>Developer keys</dt><dd>{zoho?.master_configured === true ? 'Configured' : 'Missing'}</dd></div>
            <div><dt>Token expires</dt><dd>{health?.books.token_expires_at ? health.books.token_expires_at.slice(0, 16).replace('T', ' ') : '—'}</dd></div>
            <div><dt>Last sync</dt><dd>{health?.books.last_sync_at ? health.books.last_sync_at.slice(0, 16).replace('T', ' ') : '—'}</dd></div>
            <div><dt>Last sync result</dt><dd>{health?.books.last_sync_result || '—'}</dd></div>
            <div><dt>SMTP engine</dt><dd>{health?.smtp.configured === true ? 'Configured' : 'Not configured'}</dd></div>
          </dl>
          {isAdmin && (
            <div className="ch-row" style={{ marginTop: 12 }}>
              {zoho?.connected === true ? (
                <button type="button" className="ch-btn ch-btn-secondary" onClick={disconnect}>
                  <Unlink size={15} /> Disconnect
                </button>
              ) : (
                <button type="button" className="ch-btn ch-btn-primary" onClick={connectZoho}>
                  <Link2 size={15} /> Connect Zoho Books
                </button>
              )}
            </div>
          )}
          <p className="ch-hint" style={{ marginTop: 10 }}>
            Connecting opens the secure Zoho authorisation page. After approval, return here and refresh — the connection is verified server-side.
          </p>
        </Card>

        )}
        {activeSection === 'payments' && (
        <Card
          id="payments"
          title="Payment methods"
          subtitle="Tender methods offered at the counter"
          action={<Banknote size={18} aria-hidden="true" />}
          footer={saveBtn('pay', savePayMethods)}
        >
          <div className="ch-form-grid">
            {payMethods.map((m) => (
              <div className="ch-field" key={m.mode}>
                <label className="ch-label" htmlFor={`pm-${m.mode}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    id={`pm-${m.mode}`}
                    type="checkbox"
                    checked={m.enabled}
                    onChange={(e) => setPayMethods((prev) => prev.map((x) => (x.mode === m.mode ? { ...x, enabled: e.target.checked } : x)))}
                    disabled={!isAdmin}
                  />
                  {m.mode}
                </label>
              </div>
            ))}
          </div>
          <p className="ch-hint" style={{ marginTop: 10 }}>
            At least one method stays enabled. No external payment gateway is connected — manual tender only.
          </p>
        </Card>
        )}
        {activeSection === 'printers' && (
        <Card
          id="printers"
          title="Printers"
          subtitle="Counter, kitchen and bar printers claimed by the terminals"
          action={<PrinterIcon size={18} aria-hidden="true" />}
          footer={saveBtn('printers', savePrintersForm)}
        >
          {printers.length === 0 ? (
            <p className="ch-hint">No printers yet — add the counter printer first, then kitchen and bar. Unclaimed stations fall back to browser print.</p>
          ) : (
            printers.map((p) => (
              <div className="ch-form-grid" key={p.id} style={{ marginBottom: 12 }}>
                <div className="ch-field">
                  <label className="ch-label" htmlFor={`pr-name-${p.id}`}>Name</label>
                  <input
                    id={`pr-name-${p.id}`}
                    className="ch-input"
                    value={p.name}
                    onChange={(e) => setPrinters((prev) => prev.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
                    disabled={!isAdmin}
                  />
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor={`pr-station-${p.id}`}>Station</label>
                  <select
                    id={`pr-station-${p.id}`}
                    className="ch-select"
                    value={p.station}
                    onChange={(e) => setPrinters((prev) => prev.map((x) => (x.id === p.id ? { ...x, station: e.target.value as Printer['station'] } : x)))}
                    disabled={!isAdmin}
                  >
                    <option value="counter">Counter</option>
                    <option value="kitchen">Kitchen</option>
                    <option value="bar">Bar</option>
                  </select>
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor={`pr-width-${p.id}`}>Width</label>
                  <select
                    id={`pr-width-${p.id}`}
                    className="ch-select"
                    value={String(p.width)}
                    onChange={(e) => setPrinters((prev) => prev.map((x) => (x.id === p.id ? { ...x, width: Number(e.target.value) === 58 ? 58 : 80 } : x)))}
                    disabled={!isAdmin}
                  >
                    <option value="80">80 mm</option>
                    <option value="58">58 mm</option>
                  </select>
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor={`pr-transport-${p.id}`}>Connection</label>
                  <select
                    id={`pr-transport-${p.id}`}
                    className="ch-select"
                    value={p.transport}
                    onChange={(e) => setPrinters((prev) => prev.map((x) => (x.id === p.id ? { ...x, transport: e.target.value as Printer['transport'] } : x)))}
                    disabled={!isAdmin}
                  >
                    <option value="browser">Browser print</option>
                    <option value="qz">QZ Tray</option>
                    <option value="bridge">Print bridge</option>
                    <option value="cloud">Cloud</option>
                  </select>
                </div>
                <div className="ch-field">
                  <label className="ch-label" htmlFor={`pr-addr-${p.id}`}>Address (IP / queue, optional)</label>
                  <input
                    id={`pr-addr-${p.id}`}
                    className="ch-input"
                    value={p.address}
                    onChange={(e) => setPrinters((prev) => prev.map((x) => (x.id === p.id ? { ...x, address: e.target.value } : x)))}
                    placeholder="192.168.1.50"
                    disabled={!isAdmin}
                  />
                </div>
                <div className="ch-field" style={{ alignSelf: 'end' }}>
                  <span className="ch-row" style={{ gap: 8 }}>
                    <label className="ch-label" htmlFor={`pr-on-${p.id}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        id={`pr-on-${p.id}`}
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => setPrinters((prev) => prev.map((x) => (x.id === p.id ? { ...x, enabled: e.target.checked } : x)))}
                        disabled={!isAdmin}
                      />
                      Enabled
                    </label>
                    {isAdmin && (
                      <button
                        type="button"
                        className="ch-btn ch-btn-ghost ch-btn-sm"
                        onClick={() => setPrinters((prev) => prev.filter((x) => x.id !== p.id))}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                </div>
              </div>
            ))
          )}
          {isAdmin && (
            <div className="ch-form-grid" style={{ marginTop: 8 }}>
              <div className="ch-field">
                <label className="ch-label" htmlFor="pr-new-name">New printer name</label>
                <input id="pr-new-name" className="ch-input" value={newPrinterName} onChange={(e) => setNewPrinterName(e.target.value)} placeholder="e.g. Kitchen printer" />
              </div>
              <div className="ch-field" style={{ alignSelf: 'end' }}>
                <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={addPrinter}>
                  Add printer
                </button>
              </div>
            </div>
          )}
        </Card>
        )}
        {activeSection === 'printers' && (
        <Card
          id="print-routing"
          title="Station routing"
          subtitle="Which product categories fire which station chits"
          action={<PrinterIcon size={18} aria-hidden="true" />}
          footer={saveBtn('routing', saveRoutingForm)}
        >
          {routing === null ? (
            <p className="ch-hint">Routing unavailable on this backend.</p>
          ) : (
            <>
              <div className="ch-form-grid">
                <div className="ch-field">
                  <label className="ch-label" htmlFor="rt-default">Default station</label>
                  <select
                    id="rt-default"
                    className="ch-select"
                    value={routing.defaultStation}
                    onChange={(e) => setRouting({ ...routing, defaultStation: e.target.value })}
                    disabled={!isAdmin}
                  >
                    <option value="counter">Counter</option>
                    <option value="kitchen">Kitchen</option>
                    <option value="bar">Bar</option>
                  </select>
                </div>
              </div>
              <h4 className="cust-h">Category rules (name match)</h4>
              {Object.entries(routing.byCategoryName).length === 0 ? (
                <p className="ch-hint">No rules — everything fires at the default station.</p>
              ) : (
                <ul className="ws-mini">
                  {Object.entries(routing.byCategoryName).map(([match, station]) => (
                    <li key={match}>
                      {match} → {station}
                      {isAdmin && (
                        <button
                          type="button"
                          className="ch-btn ch-btn-ghost ch-btn-sm"
                          style={{ marginLeft: 8 }}
                          onClick={() => {
                            const next = { ...routing.byCategoryName };
                            delete next[match];
                            setRouting({ ...routing, byCategoryName: next });
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && (
                <div className="ch-form-grid" style={{ marginTop: 8 }}>
                  <div className="ch-field">
                    <label className="ch-label" htmlFor="rt-rule-name">Category name contains</label>
                    <input id="rt-rule-name" className="ch-input" value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} placeholder="e.g. beverage" />
                  </div>
                  <div className="ch-field">
                    <label className="ch-label" htmlFor="rt-rule-station">Station</label>
                    <select id="rt-rule-station" className="ch-select" value={newRuleStation} onChange={(e) => setNewRuleStation(e.target.value)}>
                      <option value="counter">Counter</option>
                      <option value="kitchen">Kitchen</option>
                      <option value="bar">Bar</option>
                    </select>
                  </div>
                  <div className="ch-field" style={{ alignSelf: 'end' }}>
                    <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={addRoutingRule}>
                      Add rule
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
        )}
      </div>
    </div>
  );
}
