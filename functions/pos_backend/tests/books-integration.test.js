const { test } = require('node:test');
const assert = require('node:assert/strict');
const books = require('../booksIntegration');
const Service = require('../zohoBooksService');

function fixture() {
  const values = new Map();
  const sdk = {
    zcql: () => ({ executeZCQLQuery: async (query) => {
      const key = query.match(/config_key = '([^']+)'/)[1];
      return values.has(key) ? [{ Configurations: { ROWID: key, config_value: values.get(key) } }] : [];
    } }),
    datastore: () => ({ table: () => ({
      insertRow: async (row) => { values.set(row.config_key, row.config_value); },
      updateRow: async (row) => { values.set(row.config_key, row.config_value); },
    }) }),
  };
  const routes = new Map();
  const app = Object.fromEntries(['get', 'put', 'post'].map((method) => [method, (path, handler) => routes.set(`${method} ${path}`, handler)]));
  const calls = [];
  const axios = {
    post: async (url, _, options) => { calls.push({ url, options }); return { data: { access_token: 'test-access', refresh_token: 'test-refresh' } }; },
    get: async (url) => { calls.push({ url }); return { data: { code: 0, organizations: [{ organization_id: 'books-42', name: 'Demo', currency_code: 'LKR' }] } }; },
  };
  books.install(app, { catalyst: { initialize: () => sdk }, axios,
    getCurrentOrgUser: async (req) => req.user === false ? null : ({ user: { email: req.email || 'admin@example.test' }, orgUser: { org_id: req.company || 'pos-1', role: req.role || 'Admin' } }),
    requirePermission: (ctx, res) => { if (ctx.orgUser.role === 'Admin') return true; res.status(403).json({ error: 'Admin required' }); return false; },
    buildRedirectUri: () => 'https://pos.example.test/server/pos_backend/api/auth/callback',
  });
  async function request(method, path, input = {}) {
    const res = { code: 200, body: null, set: () => res, status: (n) => { res.code = n; return res; },
      json: (body) => { res.body = body; return res; }, send: (body) => { res.body = body; return res; }, redirect: (url) => { res.url = url; return res; } };
    await routes.get(`${method} ${path}`)({ body: {}, query: {}, ...input }, res);
    return res;
  }
  return { sdk, values, calls, request };
}
const setup = { client_id: '1000.test', client_secret: 'test-secret', dc: 'EU' };

test('Books setup remains available without OAuth environment prerequisites', async () => {
  const f = fixture();
  const result = await f.request('put', '/api/settings/books', { body: setup });
  assert.equal(result.code, 200);
  const status = (await f.request('get', '/api/settings/books')).body;
  assert.equal(status.master_configured, true);
  assert.equal(status.connected, false);
  assert.equal(status.dc, 'EU');
  assert.ok(!JSON.stringify(status).includes('test-secret'));
  assert.equal(f.calls.length, 0);
});
test('OAuth is company/user bound, uses the chosen region and never returns tokens to the browser', async () => {
  const f = fixture();
  await f.request('put', '/api/settings/books', { body: setup });
  const auth = (await f.request('get', '/api/auth/url', { query: { format: 'json' } })).body;
  const url = new URL(auth.url);
  assert.equal(url.host, 'accounts.zoho.eu');
  const state = url.searchParams.get('state');
  assert.equal((await f.request('get', '/api/auth/callback', { company: 'pos-2', query: { state, code: 'test-code' } })).code, 400);
  assert.equal((await f.request('get', '/api/auth/callback', { email: 'other@example.test', query: { state, code: 'test-code' } })).code, 400);
  assert.equal(f.calls.length, 0);
  const result = await f.request('get', '/api/auth/callback', { query: { state, code: 'test-code' } });
  assert.equal(result.code, 200);
  assert.ok(!result.body.includes('test-refresh') && !result.body.includes('test-access'));
  assert.equal(f.calls[0].url, 'https://accounts.zoho.eu/oauth/v2/token');
  const status = (await f.request('get', '/api/settings/books')).body;
  assert.equal(status.connected, false);
  assert.equal(status.organizations[0].organization_id, 'books-42');
  assert.ok(!JSON.stringify(status).includes('test-refresh'));
  assert.equal((await f.request('get', '/api/auth/callback', { query: { state, code: 'test-code' } })).code, 400);
});
test('organization selection and disconnect affect only the current POS company', async () => {
  const f = fixture();
  await books.write(f.sdk, 'pos-1', 'credentials', { clientId: 'test', clientSecret: 'secret', dc: 'EU' });
  await books.write(f.sdk, 'pos-1', 'pending', { refreshToken: 'test-refresh', dc: 'EU', expiresAt: Date.now() + 10000,
    organizations: [{ organization_id: 'books-42', name: 'Demo' }] });
  assert.equal((await f.request('post', '/api/settings/books/organization', { body: { organization_id: 'unauthorized' } })).code, 400);
  await f.request('post', '/api/settings/books/organization', { body: { organization_id: 'books-42' } });
  const tenant = await books.tenant(f.sdk, 'pos-1');
  assert.equal(tenant.orgId, 'books-42');
  assert.equal(tenant.posOrgId, 'pos-1');
  assert.equal(tenant.serverManaged, true);
  assert.equal(await books.tenant(f.sdk, 'pos-2'), null);
  await books.write(f.sdk, 'pos-2', 'connection', { orgId: 'another', refreshToken: 'other' });
  await f.request('post', '/api/auth/disconnect');
  assert.equal(await books.tenant(f.sdk, 'pos-1'), null);
  assert.equal((await books.tenant(f.sdk, 'pos-2')).orgId, 'another');
});
test('Cashier and Manager cannot configure, connect, select or disconnect Books', async () => {
  for (const role of ['Cashier', 'Manager']) {
    const f = fixture();
    for (const [method, path] of [['put', '/api/settings/books'], ['get', '/api/auth/url'], ['post', '/api/settings/books/organization'], ['post', '/api/auth/disconnect']]) {
      assert.equal((await f.request(method, path, { role, body: setup })).code, 403);
    }
    assert.equal(f.values.size, 0);
  }
});
test('expired state is rejected before exchanging credentials', async () => {
  const f = fixture();
  await books.write(f.sdk, 'pos-1', 'state', { email: 'admin@example.test', expiresAt: 1, hash: 'old' });
  assert.equal((await f.request('get', '/api/auth/callback', { query: { state: 'old', code: 'code' } })).code, 400);
  assert.equal(f.calls.length, 0);
});
test('server-managed Books URLs use the selected Books id instead of the POS id', async () => {
  const service = new Service({}, { serverManaged: true, orgId: 'books-42', posOrgId: 'pos-1', dc: 'EU' });
  assert.equal(await service.getBooksUrl('/items'), 'https://www.zohoapis.eu/books/v3/items?organization_id=books-42');
});
test('configuration storage failures propagate instead of pretending setup succeeded', async () => {
  const sdk = { zcql: () => ({ executeZCQLQuery: async () => { throw new Error('unavailable'); } }) };
  await assert.rejects(books.write(sdk, 'pos-1', 'credentials', {}), /unavailable/);
  await assert.rejects(books.tenant(sdk, 'pos-1'), /unavailable/);
});
test('invoice lines use live Books ids and preserve discounted net amounts with matching taxes', () => {
  const lines = books.saleLines([{ line: { qty: 2, lineNet: 180, taxPct: 10 }, live: { name: 'Item', books_item_id: 'books-item', tax_id: 'tax-10', tax_percentage: 10 } }], 10);
  assert.deepEqual(lines, [{ books_item_id: 'books-item', name: 'Item', quantity: 2, rate: 81, tax_id: 'tax-10' }]);
  assert.throws(() => books.saleLines([{ line: { qty: 1, lineNet: 100, taxPct: 15 }, live: { tax_id: 'tax-10', tax_percentage: 10 } }], 0), /matching Books tax/);
});
test('request headers cannot override the server-resolved company connection', () => {
  const { loadFunctions } = require('./harness');
  const { getTenantConfig } = loadFunctions(['getTenantConfig']);
  const request = { header: () => 'attacker-token' };
  assert.equal(getTenantConfig(request), null);
  request._booksTenant = { orgId: 'trusted-company' };
  assert.equal(getTenantConfig(request).orgId, 'trusted-company');
});
