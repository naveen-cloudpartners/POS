const crypto = require('node:crypto');
const ZohoBooksService = require('./zohoBooksService');

const REGIONS = ['US', 'EU', 'IN', 'AU', 'JP', 'CA', 'CN', 'SA'];
const key = (orgId, suffix) => `org_${String(orgId).replace(/[^a-zA-Z0-9_-]/g, '')}_books_${suffix}`;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Strict configuration reads/writes: never report a successful connection after
// a swallowed Data Store failure. All access is scoped to the authenticated POS company.
async function read(app, orgId, suffix) {
  const rows = await app.zcql().executeZCQLQuery(`SELECT config_value FROM Configurations WHERE config_key = '${key(orgId, suffix)}'`);
  return rows.length && rows[0].Configurations.config_value ? JSON.parse(rows[0].Configurations.config_value) : null;
}
async function write(app, orgId, suffix, value) {
  const configKey = key(orgId, suffix);
  const rows = await app.zcql().executeZCQLQuery(`SELECT ROWID FROM Configurations WHERE config_key = '${configKey}'`);
  const payload = { config_key: configKey, config_value: JSON.stringify(value) };
  const table = app.datastore().table('Configurations');
  if (rows.length) await table.updateRow({ ...payload, ROWID: rows[0].Configurations.ROWID });
  else await table.insertRow(payload);
}
async function credentials(app, orgId) {
  const saved = await read(app, orgId, 'credentials');
  return saved || {
    clientId: process.env.ZOHO_CLIENT_ID || '', clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
    dc: REGIONS.includes(String(process.env.ZOHO_DC).toUpperCase()) ? process.env.ZOHO_DC.toUpperCase() : 'US',
  };
}
async function tenant(app, orgId) {
  const connection = await read(app, orgId, 'connection');
  if (!connection || !connection.orgId || !connection.refreshToken) return null;
  const client = await credentials(app, orgId);
  return { ...connection, ...client, posOrgId: String(orgId), serverManaged: true };
}
function summary(connection) {
  return connection ? { orgId: connection.orgId, orgName: connection.orgName, dc: connection.dc, connectedAt: connection.connectedAt } : null;
}
function saleLines(resolvedLines, orderPct) {
  return resolvedLines.map(({ line, live }) => {
    if (line.taxPct > 0 && (!live.tax_id || Math.abs(Number(live.tax_percentage) - line.taxPct) > 0.001)) {
      throw fail('A POS tax rate has no matching Books tax. Import/match product taxes before posting this sale.');
    }
    return { books_item_id: live.books_item_id || '', name: live.name, quantity: line.qty,
      rate: line.qty ? line.lineNet * (1 - orderPct / 100) / line.qty : 0,
      tax_id: line.taxPct > 0 ? live.tax_id : '' };
  });
}

function install(app, { catalyst, axios, getCurrentOrgUser, requirePermission, buildRedirectUri }) {
  async function context(req, res, admin = true) {
    const user = await getCurrentOrgUser(req, catalyst.initialize(req));
    if (!user) { res.status(401).json({ success: false, error: 'Not authenticated' }); return null; }
    if (admin && !requirePermission(user, res, 'manage_settings', 'Books setup requires Admin.')) return null;
    return { user, orgId: String(user.orgUser.org_id), sdk: catalyst.initialize(req, { scope: 'admin' }) };
  }
  const route = (handler) => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { await handler(req, res); }
    catch (error) {
      // SDK/OAuth responses can contain credentials. Return only controlled errors.
      res.status(error.status || 503).json({ success: false, error: error.status ? error.message : 'Books request failed. Check your credentials, region and connection, then retry.' });
    }
  };
  async function status(req, res) {
    const ctx = await context(req, res, false); if (!ctx) return;
    const client = await credentials(ctx.sdk, ctx.orgId);
    const connection = await read(ctx.sdk, ctx.orgId, 'connection');
    const pending = await read(ctx.sdk, ctx.orgId, 'pending');
    const sync = await read(ctx.sdk, ctx.orgId, 'sync');
    res.json({ success: true, master_configured: !!(client.clientId && client.clientSecret), connected: !!connection?.refreshToken,
      client_id: client.clientId, secret_configured: !!client.clientSecret, dc: client.dc,
      redirect_uri: buildRedirectUri(req), org_id: connection?.orgId || '', connection: summary(connection),
      organizations: pending && pending.expiresAt > Date.now() ? pending.organizations : [], last_sync: sync });
  }
  app.get('/api/auth/status', route(status));
  app.get('/api/settings/books', route(status));
  app.put('/api/settings/books', route(async (req, res) => {
    const ctx = await context(req, res); if (!ctx) return;
    const old = await credentials(ctx.sdk, ctx.orgId);
    const clientId = String(req.body.client_id || '').trim();
    const clientSecret = String(req.body.client_secret || '').trim() || old.clientSecret;
    const dc = String(req.body.dc || '').toUpperCase();
    if (!/^[a-zA-Z0-9._-]{5,200}$/.test(clientId) || !clientSecret || clientSecret.length > 1000 || !REGIONS.includes(dc)) throw fail('Enter a valid Client ID, Client Secret and region.');
    if (clientId !== old.clientId && !String(req.body.client_secret || '').trim()) throw fail('Enter the matching Client Secret when changing the Client ID.');
    if (await read(ctx.sdk, ctx.orgId, 'connection')) throw fail('Disconnect Books before changing OAuth credentials.');
    await write(ctx.sdk, ctx.orgId, 'credentials', { clientId, clientSecret, dc });
    await write(ctx.sdk, ctx.orgId, 'pending', null);
    await write(ctx.sdk, ctx.orgId, 'state', null);
    res.json({ success: true });
  }));
  app.get('/api/auth/url', route(async (req, res) => {
    const ctx = await context(req, res); if (!ctx) return;
    const client = await credentials(ctx.sdk, ctx.orgId);
    if (!client.clientId || !client.clientSecret) throw fail('Save your OAuth credentials in Settings → Integrations first.');
    const state = crypto.randomBytes(32).toString('hex');
    await write(ctx.sdk, ctx.orgId, 'state', { hash: crypto.createHash('sha256').update(state).digest('hex'),
      email: ctx.user.user.email, expiresAt: Date.now() + 10 * 60 * 1000, redirectUri: buildRedirectUri(req) });
    const url = new URL(`${new ZohoBooksService(ctx.sdk).getDomainUrls(client.dc).accounts}/oauth/v2/auth`);
    url.search = new URLSearchParams({ scope: 'ZohoBooks.fullaccess.all', client_id: client.clientId, response_type: 'code',
      redirect_uri: buildRedirectUri(req), access_type: 'offline', prompt: 'consent', state }).toString();
    if (req.query.format === 'json') return res.json({ success: true, url: url.toString() });
    res.redirect(url.toString());
  }));
  app.get('/api/auth/callback', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let message = 'Authorization complete. Return to Settings → Integrations and select your Books organization.';
    let ok = false;
    try {
      const ctx = await context(req, res); if (!ctx) return;
      const state = await read(ctx.sdk, ctx.orgId, 'state');
      const received = String(req.query.state || '');
      if (!state || state.email !== ctx.user.user.email || state.expiresAt < Date.now() ||
        crypto.createHash('sha256').update(received).digest('hex') !== state.hash) throw fail('Authorization expired or is invalid. Start Connect again from Settings.');
      await write(ctx.sdk, ctx.orgId, 'state', null);
      if (req.query.error || !req.query.code) throw fail('Zoho authorization was cancelled. You can connect again when ready.');
      const client = await credentials(ctx.sdk, ctx.orgId);
      const domains = new ZohoBooksService(ctx.sdk).getDomainUrls(client.dc);
      if (req.query['accounts-server'] && req.query['accounts-server'] !== domains.accounts) throw fail('Your Zoho account uses a different region. Select its region in Settings and reconnect.');
      const response = await axios.post(`${domains.accounts}/oauth/v2/token`, null, { timeout: 15000, params: {
        code: String(req.query.code), client_id: client.clientId, client_secret: client.clientSecret,
        redirect_uri: state.redirectUri, grant_type: 'authorization_code',
      } });
      const tokens = response.data;
      if (!tokens?.refresh_token || !tokens.access_token) throw fail('Zoho did not return offline authorization. Reconnect and approve access.');
      const orgs = await axios.get(`${domains.api}/organizations`, { timeout: 15000, headers: { Authorization: `Zoho-oauthtoken ${tokens.access_token}` } });
      if (orgs.data.code !== 0 || !orgs.data.organizations?.length) throw fail('No Books organizations found. Create your company in Books and reconnect.');
    const organizations = orgs.data.organizations.filter((o) => o.is_org_active !== false).map((o) => ({
        organization_id: String(o.organization_id), name: String(o.name), currency_code: String(o.currency_code || ''),
      }));
      if (!organizations.length) throw fail('No active Books organizations found.');
      await write(ctx.sdk, ctx.orgId, 'pending', { refreshToken: tokens.refresh_token, dc: client.dc,
        organizations, expiresAt: Date.now() + 30 * 60 * 1000 });
      ok = true;
    } catch (error) { message = error.status ? error.message : 'Authorization failed. Check the registered callback URL, credentials and region, then reconnect.'; }
    const escaped = message.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    res.status(ok ? 200 : 400).send(`<!doctype html><html><head><meta charset="utf-8"><title>Zoho Books connection</title></head><body style="font-family:system-ui;padding:40px;max-width:560px;margin:auto"><h2>${ok ? 'Zoho access approved' : 'Connection incomplete'}</h2><p>${escaped}</p><a href="/app/settings#integrations">Return to settings</a><script>if(window.opener)window.opener.postMessage({type:'books_connection_updated'},window.location.origin);</script></body></html>`);
  });
  app.post('/api/settings/books/organization', route(async (req, res) => {
    const ctx = await context(req, res); if (!ctx) return;
    const pending = await read(ctx.sdk, ctx.orgId, 'pending');
    if (!pending || pending.expiresAt < Date.now()) throw fail('Authorization expired. Connect to Zoho again.');
    const selected = pending.organizations.find((o) => o.organization_id === String(req.body.organization_id));
    if (!selected) throw fail('Select one of your authorized Books organizations.');
    const service = new ZohoBooksService(ctx.sdk);
    await service.saveConfig(`zoho_access_token_${ctx.orgId}`, '');
    await service.saveConfig(`zoho_token_time_${ctx.orgId}`, '');
    await write(ctx.sdk, ctx.orgId, 'connection', { orgId: selected.organization_id, orgName: selected.name,
      dc: pending.dc, refreshToken: pending.refreshToken, connectedAt: new Date().toISOString() });
    await write(ctx.sdk, ctx.orgId, 'pending', null);
    res.json({ success: true });
  }));
  app.post('/api/settings/books/test', route(async (req, res) => {
    const ctx = await context(req, res); if (!ctx) return;
    const config = await tenant(ctx.sdk, ctx.orgId);
    if (!config) throw fail('Connect Books and select an organization first.');
    const service = new ZohoBooksService(ctx.sdk, config);
    const response = await axios.get(await service.getBooksUrl(`/organizations/${config.orgId}`), { headers: await service.getHeaders(), timeout: 15000 });
    if (response.data.code !== 0) throw fail('Books could not verify the selected organization. Reconnect and retry.');
    res.json({ success: true, message: `Connected to ${response.data.organization?.name || config.orgName}.` });
  }));
  app.post('/api/auth/disconnect', route(async (req, res) => {
    const ctx = await context(req, res); if (!ctx) return;
    for (const suffix of ['connection', 'pending', 'state']) await write(ctx.sdk, ctx.orgId, suffix, null);
    // Clear the service's company cache so a later connection cannot reuse the old account token.
    const service = new ZohoBooksService(ctx.sdk);
    await service.saveConfig(`zoho_access_token_${ctx.orgId}`, '');
    await service.saveConfig(`zoho_token_time_${ctx.orgId}`, '');
    res.json({ success: true });
  }));
  // Retire global credential mutation routes. Admins use the company settings form.
  for (const path of ['/api/auth/save-master-credentials', '/api/auth/seed-credentials']) app.post(path, route(async (_req, res) => {
    res.status(410).json({ success: false, error: 'Use Settings → Integrations to save company OAuth credentials.' });
  }));
}
module.exports = { install, tenant, read, write, summary, credentials, saleLines, REGIONS };
