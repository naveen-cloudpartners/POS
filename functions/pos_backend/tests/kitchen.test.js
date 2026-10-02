const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SRC, extractSource, loadFunctions } = require('./harness');
const workflow = require('../kitchenWorkflow');
const { kitchenState, kitchenTicket, transitionKitchen, cancelKitchenItems, withKitchenLock } = workflow;
const { roleCan, apiPermission } = loadFunctions(['roleCan', 'apiPermission']);
const entry = () => ({ number: 'KOT-20261002-001', orderId: '123', station: 'kitchen', status: 'FIRED', prepStatus: 'QUEUED', firedAt: '2026-10-02T10:00:00Z', items: [{ name: 'Rice', sku: 'R', qty: 2 }, { name: 'Soup', sku: 'S', qty: 1 }], kitchenNotes: 'No nuts', roomNumber: '4' });

describe('Kitchen preparation and access', () => {
  it('only Admin, Kitchen and legacy Chef can access either kitchen endpoint', () => {
    for (const role of ['Admin', 'Kitchen', 'Chef']) assert.equal(roleCan(role, 'kitchen_board'), true);
    for (const role of ['Manager', 'Cashier', 'Storekeeper', 'Waiter', '', 'unknown']) assert.equal(roleCan(role, 'kitchen_board'), false);
    for (const [method, path] of [['GET', '/api/kitchen/tickets'], ['POST', '/api/kitchen/tickets/KOT-1/status']]) assert.equal(apiPermission(method, path), 'kitchen_board');
    for (const [method, path] of [['POST', '/api/orders/checkout'], ['GET', '/api/orders'], ['GET', '/api/items'], ['GET', '/api/customers'], ['GET', '/api/dashboard/summary'], ['PUT', '/api/settings/tax'], ['GET', '/api/users']]) assert.equal(roleCan('Kitchen', apiPermission(method, path)), false, path);
  });
  it('projects dishes and notes without payment, customer or cashier details', () => {
    const ticket = kitchenTicket({ ...entry(), total: 500, customerEmail: 'private', customerName: 'private', cashier: 'private', prepActor: 'private' });
    assert.deepEqual(ticket.items.map(({ name, sku, qty }) => ({ name, sku, qty })), entry().items);
    assert.match(ticket.items[0].imageUrl, /^\/kitchen\/tickets\/KOT-20261002-001\/items\/0\/image/);
    assert.equal(ticket.notes, 'No nuts');
    for (const key of ['total', 'customerEmail', 'customerName', 'cashier', 'prepActor']) assert.equal(key in ticket, false);
  });
  it('requires forward transitions and rejects stale screens and repeat clicks', () => {
    let current = entry();
    for (const next of ['PREPARING', 'READY', 'SERVED']) {
      const old = kitchenState(current);
      const result = transitionKitchen(current, old, next, 'chef', '2026-10-02T11:00:00Z');
      assert.equal(result.entry.status, 'FIRED', 'printer status must remain independent');
      assert.equal(transitionKitchen(result.entry, old, next, 'chef').code, 409);
      current = result.entry;
    }
    assert.equal(transitionKitchen(entry(), 'QUEUED', 'SERVED', 'chef').code, 400);
    assert.equal(transitionKitchen(current, 'SERVED', 'QUEUED', 'chef').code, 400);
  });
  it('does not prepare legacy tickets without dishes and preserves legacy completed state', () => {
    const legacy = { ...entry(), items: undefined, prepStatus: undefined };
    assert.equal(kitchenTicket(legacy).detailsMissing, true);
    assert.equal(transitionKitchen(legacy, 'QUEUED', 'PREPARING', 'chef').code, 400);
    assert.equal(kitchenState({ ...legacy, status: 'DONE' }), 'SERVED');
    assert.equal(transitionKitchen(legacy, 'QUEUED', 'CANCELLED', 'chef').code, 400);
    assert.equal(transitionKitchen(legacy, 'QUEUED', 'CANCELLED', 'admin', undefined, true).entry.prepStatus, 'CANCELLED');
    assert.equal(transitionKitchen(entry(), 'QUEUED', 'CANCELLED', 'admin', undefined, true).code, 400);
  });
  it('partial returns remove only returned quantities and full voids cancel', () => {
    const original = entry();
    const partial = cancelKitchenItems(original, [{ sku: 'R', qty: 1 }], 'Return', false);
    assert.equal(partial.items[0].qty, 1);
    assert.equal(partial.prepStatus, 'QUEUED');
    assert.equal(original.items[0].qty, 2);
    assert.equal(cancelKitchenItems(original, [], 'Void', true).prepStatus, 'CANCELLED');
    assert.equal(cancelKitchenItems(original, [{ sku: 'R', qty: 2 }, { sku: 'S', qty: 1 }], 'Return', false).prepStatus, 'CANCELLED');
    const served = { ...original, prepStatus: 'SERVED' };
    assert.equal(cancelKitchenItems(served, [], 'Void', true), served);
  });
  it('serializes concurrent document writes and recovers after failures', async () => {
    const trace = [];
    await Promise.all([withKitchenLock('test', async () => { trace.push(1); await new Promise(resolve => setTimeout(resolve, 5)); trace.push(2); }), withKitchenLock('test', async () => trace.push(3))]);
    assert.deepEqual(trace, [1, 2, 3]);
    await assert.rejects(withKitchenLock('test', async () => { throw new Error('failure'); }));
    assert.equal(await withKitchenLock('test', async () => 42), 42);
  });
});

function kitchenRoutes(context, tickets, query = async () => []) {
  const handlers = {};
  const deps = {
    app: { get: (path, handler) => { handlers[path] = handler; }, post: (path, handler) => { handlers[path] = handler; }, put: (path, handler) => { handlers[path] = handler; } },
    catalyst: { initialize: () => ({}) }, getCurrentOrgUser: async () => context,
    requirePermission: (ctx, res, permission) => { if (roleCan(ctx.orgUser.role, permission)) return true; res.status(403).json({ success: false }); return false; },
    readKotLog: async (_app, org) => { assert.equal(org, 'tenant-a'); return tickets; },
    modifyKitchenLog: async (_app, org, predicate, update) => { assert.equal(org, 'tenant-a'); const found = tickets.find(predicate); if (!found) return { changed: [] }; const result = update(found); return result.error ? result : { changed: [result.entry] }; },
    whActorEmail: async () => 'chef@test', callerRole: ctx => ctx.orgUser.role, logAuditLog: async () => {}, kotAuditPayload: () => ({}), ...workflow,
    sanitizeZcql: value => String(value).replace(/'/g, "''"), safeZcql: query,
    getProductImageBytes: async () => Buffer.from('image-bytes'), PRODUCT_IMAGE_MIME: { 'image/png': true },
  };
  const start = SRC.indexOf("app.get('/api/kitchen/tickets/:number/items/:index/image'");
  const end = SRC.indexOf("app.get('/api/kot'", start);
  new Function(...Object.keys(deps), SRC.slice(start, end))(...Object.values(deps));
  return handlers;
}
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, set(headers) { this.headers = headers; return this; }, send(body) { this.body = body; return this; } });
describe('Kitchen endpoint tenant and session guards', () => {
  it('blocks foreign tickets, counter tickets and malformed item indices before reading product images', async () => {
    let queried = false;
    const handlers = kitchenRoutes({ orgUser: { role: 'Kitchen', org_id: 'tenant-a' } }, [entry(), { ...entry(), number: 'KOT-COUNTER', station: 'counter' }], async () => { queried = true; return []; });
    for (const [number, index, code] of [['KOT-FOREIGN', '0', 404], ['KOT-COUNTER', '0', 404], [entry().number, '99', 404], [entry().number, '-1', 400]]) {
      const res = response();
      await handlers['/api/kitchen/tickets/:number/items/:index/image']({ params: { number, index } }, res);
      assert.equal(res.code, code);
    }
    assert.equal(queried, false);
  });
  it('resolves legacy dish images by SKU inside the session company and serves only bytes', async () => {
    const handlers = kitchenRoutes({ orgUser: { role: 'Kitchen', org_id: 'tenant-a' } }, [entry()], async (_app, query) => {
      assert.match(query, /org_id = 'tenant-a' AND sku = 'R'/);
      return [{ Products: { image_id: 'saved-image', image_mime: 'image/png' } }];
    });
    const res = response();
    await handlers['/api/kitchen/tickets/:number/items/:index/image']({ params: { number: entry().number, index: '0' }, query: { org_id: 'foreign' } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.equal(res.body.toString(), 'image-bytes');
  });
  it('rejects guests and other roles before loading tickets', async () => {
    for (const context of [null, { orgUser: { role: 'Cashier', org_id: 'tenant-a' } }]) {
      const res = response();
      await kitchenRoutes(context, [entry()])['/api/kitchen/tickets']({}, res);
      assert.equal(res.code, context ? 403 : 401);
    }
  });
  it('uses session tenant, ignores request tenant and excludes counter tickets', async () => {
    const res = response();
    await kitchenRoutes({ orgUser: { role: 'Kitchen', org_id: 'tenant-a' } }, [entry(), { ...entry(), station: 'counter' }])['/api/kitchen/tickets']({ query: { org_id: 'tenant-b' } }, res);
    assert.equal(res.body.data.length, 1);
  });
  it('cannot update missing/foreign tickets, skip stages or use malformed numbers', async () => {
    const handlers = kitchenRoutes({ orgUser: { role: 'Kitchen', org_id: 'tenant-a' } }, [entry()]);
    for (const [number, status, expectedCode] of [['KOT-OTHER', 'PREPARING', 404], [entry().number, 'READY', 400], ['bad ticket', 'PREPARING', 400]]) {
      const res = response();
      await handlers['/api/kitchen/tickets/:number/status']({ params: { number }, body: { org_id: 'tenant-b', expected: 'QUEUED', status } }, res);
      assert.equal(res.code, expectedCode);
    }
  });
});

describe('Kitchen log mutation', () => {
  it('reads configured routing strictly and surfaces storage failures instead of routing to counter', async () => {
    const normPrintStation = (value, fallback) => ['kitchen', 'bar', 'counter'].includes(value) ? value : fallback;
    const routing = new Function('readKitchenConfig', 'normPrintStation', `async ${extractSource('function getPrintRouting(')}; return getPrintRouting;`)(async (_app, key) => {
      assert.equal(key, 'org_a_setting_print_routing');
      return JSON.stringify({ defaultStation: 'kitchen' });
    }, normPrintStation);
    assert.equal((await routing({}, 'a', true)).defaultStation, 'kitchen');
    const failing = new Function('readKitchenConfig', 'normPrintStation', `async ${extractSource('function getPrintRouting(')}; return getPrintRouting;`)(async () => { throw new Error('unavailable'); }, normPrintStation);
    await assert.rejects(failing({}, 'a', true), /unavailable/);
    assert.match(SRC, /getPrintRouting\(kitchenApp, posOrgId, true\)/);
    assert.match(SRC, /appendKotLog\(kitchenApp, posOrgId/);
  });
  it('does not report an empty queue after a configuration storage failure', async () => {
    const reader = new Function(`async ${extractSource('function readKitchenConfig(')}; return readKitchenConfig;`)();
    await assert.rejects(reader({ zcql: () => ({ executeZCQLQuery: async () => { throw new Error('unavailable'); } }) }, 'org_a_setting_kot_log_today'), /unavailable/);
  });
  it('keeps more than 200 unfinished tickets instead of silently dropping orders', async () => {
    let saved;
    const writer = new Function('kitchenState', 'safeUpsertConfig', 'kotLogKey', `async ${extractSource('function writeKotDay(')}; return writeKotDay;`)(kitchenState, async (_app, _key, value) => { saved = JSON.parse(value); }, () => 'tenant-key');
    await writer({}, 'a', 'today', Array.from({ length: 220 }, (_, i) => ({ ...entry(), number: `KOT-${i}` })));
    assert.equal(saved.length, 220);
  });
  it('updates a duplicate legacy ticket once, using only tenant configuration keys', async () => {
    const stores = new Map([['org_a_setting_kot_log_today', JSON.stringify([entry()])], ['org_a_setting_kot_log', JSON.stringify([entry()])]]);
    const deps = { withKitchenLock, kotRecentDays: () => ['today'], kotLogKey: (org, day) => `org_${org}_setting_kot_log_${day}`, readKitchenConfig: async (_app, key) => { assert.ok(key.startsWith('org_a_')); return stores.get(key); }, safeUpsertConfig: async (_app, key, value) => stores.set(key, value) };
    const modify = new Function(...Object.keys(deps), `async ${extractSource('function modifyKitchenLog(')}; return modifyKitchenLog;`)(...Object.values(deps));
    const result = await modify({}, 'a', row => row.number === entry().number, row => transitionKitchen(row, 'QUEUED', 'PREPARING', 'chef'));
    assert.equal(result.changed.length, 1);
    assert.equal(JSON.parse(stores.get('org_a_setting_kot_log_today'))[0].prepStatus, 'PREPARING');
  });
});
