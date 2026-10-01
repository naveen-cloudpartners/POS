import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { syncFromBooks } from '../../services/productService';
import Card from '../ui/Card';

interface BooksStatus {
  master_configured: boolean;
  secret_configured: boolean;
  client_id: string;
  dc: string;
  redirect_uri: string;
  connected: boolean;
  connection: { orgId: string; orgName: string; dc: string } | null;
  organizations: Array<{ organization_id: string; name: string; currency_code: string }>;
  last_sync: { at: string; message: string } | null;
}

export default function BooksSetup() {
  const [status, setStatus] = useState<BooksStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [dc, setDc] = useState('US');
  const [organization, setOrganization] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    const result = await apiFetch<BooksStatus>('/settings/books');
    setStatus(result);
    return result;
  }, []);
  useEffect(() => {
    let live = true;
    refresh().then((result) => {
      if (live) { setClientId(result.client_id); setDc(result.dc); }
    }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load Books setup.'); });
    const changed = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === 'books_connection_updated') {
        void refresh().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not refresh connection.'));
      }
    };
    const focused = () => { void refresh().catch(() => undefined); };
    window.addEventListener('message', changed);
    window.addEventListener('focus', focused);
    return () => { live = false; window.removeEventListener('message', changed); window.removeEventListener('focus', focused); };
  }, [refresh]);
  const run = async (action: () => Promise<string>) => {
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action()); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Books request failed.'); }
    finally { setBusy(false); }
  };
  const connect = () => {
    // Open synchronously so browsers permit the popup after the async URL request.
    const popup = window.open('about:blank', 'books-authorization', 'width=600,height=720');
    if (!popup) { setError('Allow popups for this site and try Connect again.'); return; }
    void run(async () => {
      try {
        const result = await apiFetch<{ url: string }>('/auth/url?format=json');
        popup.location.href = result.url;
        return 'Approve access in Zoho, then select your organization below.';
      } catch (e) { popup.close(); throw e; }
    });
  };
  const dirty = status !== null && (clientId.trim() !== status.client_id || dc !== status.dc || secret !== '');
  return <Card id="integrations" title="Zoho Books" subtitle="Set up your company connection, then import products and post new sales">
    {error && <p role="alert" className="ch-hint" style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}
    {notice && <p role="status" className="ch-hint">{notice}</p>}
    <p className="ch-hint">You can leave Books disconnected until your account is ready. Your POS continues storing sales in Catalyst.</p>
    <div className="ch-form-grid" style={{ marginTop: 16 }}>
      <div className="ch-field"><label className="ch-label" htmlFor="books-region">Zoho account region</label>
        <select id="books-region" className="ch-input" value={dc} disabled={busy || status?.connected} onChange={(e) => setDc(e.target.value)}>
          {['US', 'EU', 'IN', 'AU', 'JP', 'CA', 'CN', 'SA'].map((region) => <option key={region}>{region}</option>)}
        </select>
      </div>
      <div className="ch-field"><label className="ch-label" htmlFor="books-client">OAuth Client ID</label>
        <input id="books-client" className="ch-input" value={clientId} disabled={busy || status?.connected} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
      </div>
      <div className="ch-field"><label className="ch-label" htmlFor="books-secret">OAuth Client Secret</label>
        <input id="books-secret" className="ch-input" type="password" value={secret} disabled={busy || status?.connected} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" placeholder={status?.secret_configured ? 'Saved — leave blank to keep' : 'Enter when ready'} />
      </div>
      <div className="ch-field"><label className="ch-label" htmlFor="books-callback">Authorized redirect URI</label>
        <input id="books-callback" className="ch-input" readOnly value={status?.redirect_uri || ''} />
        <span className="ch-hint">Copy this exact URL into your server-based app in the Zoho API Console.</span>
      </div>
    </div>
    <div className="ch-row" style={{ marginTop: 12 }}>
      <button className="ch-btn ch-btn-secondary" type="button" disabled={busy || !status?.redirect_uri} onClick={() => void run(async () => { await navigator.clipboard.writeText(status!.redirect_uri); return 'Callback URL copied.'; })}>Copy callback URL</button>
      {!status?.connected && <button className="ch-btn ch-btn-primary" type="button" disabled={busy || !clientId.trim() || (!secret && !status?.secret_configured)} onClick={() => void run(async () => {
        await apiFetch('/settings/books', { method: 'PUT', body: { client_id: clientId.trim(), client_secret: secret, dc } });
        setSecret(''); return 'OAuth setup saved. You can now connect.';
      })}>Save setup</button>}
      {!status?.connected && <button className="ch-btn ch-btn-primary" type="button" disabled={busy || !status?.master_configured || dirty} onClick={connect}>Connect Zoho Books</button>}
      <button className="ch-btn ch-btn-secondary" type="button" disabled={busy} onClick={() => void run(async () => 'Connection status refreshed.')}>Refresh status</button>
    </div>
    {!!status?.organizations.length && <div className="ch-field" style={{ marginTop: 20 }}>
      <label className="ch-label" htmlFor="books-organization">Choose your Books company</label>
      <select id="books-organization" className="ch-input" value={organization} onChange={(e) => setOrganization(e.target.value)} disabled={busy}>
        <option value="">Select organization</option>
        {status.organizations.map((org) => <option key={org.organization_id} value={org.organization_id}>{org.name} ({org.currency_code})</option>)}
      </select>
      <button className="ch-btn ch-btn-primary" style={{ marginTop: 10 }} type="button" disabled={busy || !organization} onClick={() => void run(async () => {
        await apiFetch('/settings/books/organization', { method: 'POST', body: { organization_id: organization } });
        setOrganization(''); return 'Company connected. Test the connection before importing products.';
      })}>Use this organization</button>
    </div>}
    <dl className="settings-zoho" style={{ marginTop: 20 }}>
      <div><dt>Connection</dt><dd>{status?.connected ? 'Connected' : 'Not connected'}</dd></div>
      <div><dt>Company</dt><dd>{status?.connection?.orgName || '—'}</dd></div>
      <div><dt>Books organization ID</dt><dd>{status?.connection?.orgId || '—'}</dd></div>
      <div><dt>Last product import</dt><dd>{status?.last_sync?.message || 'No import yet'}</dd></div>
    </dl>
    {status?.connected && <div className="ch-row" style={{ marginTop: 12 }}>
      <button className="ch-btn ch-btn-secondary" type="button" disabled={busy} onClick={() => void run(async () => (await apiFetch<{ message: string }>('/settings/books/test', { method: 'POST' })).message)}>Test connection</button>
      <button className="ch-btn ch-btn-primary" type="button" disabled={busy} onClick={() => void run(async () => { const result = await syncFromBooks(); return result.message || 'Products imported.'; })}>Import products from Books</button>
      <button className="ch-btn ch-btn-secondary" type="button" disabled={busy} onClick={() => void run(async () => { await apiFetch('/auth/disconnect', { method: 'POST' }); return 'Books disconnected. POS data is retained.'; })}>Disconnect</button>
    </div>}
    <p className="ch-hint" style={{ marginTop: 16 }}>Product import updates matching Books items, including prices and stock. New checkout sales attempt invoice and payment posting. Existing sales are not automatically uploaded, and voids need a separate reversal in Books.</p>
  </Card>;
}
