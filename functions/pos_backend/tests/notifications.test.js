const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notificationFeed, notificationState, updateNotificationState } = require('../notificationFeed');
const { transitionKitchen, cancelKitchenItems } = require('../kitchenWorkflow');
const { extractSource, loadFunctions } = require('./harness');
const now = Date.parse('2026-10-02T12:00:00Z');
const ticket = () => ({ number: 'KOT-1', orderId: '123', station: 'kitchen', items: [{ name: 'Rice', sku: 'R', qty: 2 }], roomNumber: '4', prepStatus: 'QUEUED', firedAt: '2026-10-02T11:00:00Z', customerEmail: 'private', total: 900 });
test('notification feed follows role access and never exposes financial/customer fields', () => {
  let row = transitionKitchen(ticket(), 'QUEUED', 'PREPARING', 'chef', '2026-10-02T11:10:00Z').entry;
  row = transitionKitchen(row, 'PREPARING', 'READY', 'chef', '2026-10-02T11:20:00Z').entry;
  for (const role of ['Cashier', 'Waiter', 'Manager']) {
    const feed = notificationFeed(role, [row], [], now);
    assert.deepEqual(feed.map(e => e.kind), ['kitchen_ready']);
    assert.equal(feed[0].href, '/sales/pos');
    assert.ok(!JSON.stringify(feed).includes('private'));
    assert.ok(!JSON.stringify(feed).includes('900'));
  }
  assert.deepEqual(notificationFeed('Kitchen', [row], [], now).map(e => e.kind), ['kitchen_new']);
  assert.equal(notificationFeed('Storekeeper', [row], [], now).length, 0);
  assert.equal(notificationFeed('unknown', [row], [], now).length, 0);
});
test('ready event survives served transition between two polling intervals', () => {
  let row = transitionKitchen(ticket(), 'QUEUED', 'PREPARING', 'chef', '2026-10-02T11:10:00Z').entry;
  row = transitionKitchen(row, 'PREPARING', 'READY', 'chef', '2026-10-02T11:20:00Z').entry;
  const ready = notificationFeed('Waiter', [row], [], now)[0];
  row = transitionKitchen(row, 'READY', 'SERVED', 'chef', '2026-10-02T11:20:01Z').entry;
  assert.equal(notificationFeed('Waiter', [row], [], now)[0].id, ready.id);
});
test('counter/expired tickets are excluded, cancellations alert kitchen staff', () => {
  assert.equal(notificationFeed('Admin', [{ ...ticket(), station: 'counter' }, { ...ticket(), firedAt: '2020-01-01' }], [], now).length, 0);
  const row = cancelKitchenItems(ticket(), [], 'Voided', true);
  const feed = notificationFeed('Kitchen', [row], [], Date.now());
  assert.ok(feed.some(e => e.kind === 'kitchen_cancelled'));
  assert.ok(!feed.some(e => e.kind === 'kitchen_ready'));
});
test('stock alerts use stable IDs, correct thresholds and authorized roles', () => {
  const products = [{ ROWID: '1', name: 'Rice', stock: 3, reorder_level: 5 }, { ROWID: '2', name: 'Soup', stock: 0, reorder_level: 0 }, { ROWID: '3', stock: 9, reorder_level: 2 }, { ROWID: '4', stock: 0, status: 'Inactive' }];
  assert.equal(notificationFeed('Kitchen', [], products, now).length, 0);
  assert.equal(notificationFeed('Cashier', [], products, now).length, 0);
  const feed = notificationFeed('Storekeeper', [], products, now);
  assert.equal(feed.length, 2);
  assert.equal(notificationFeed('Storekeeper', [], [{ ...products[0], stock: 2 }], now + 15000)[0].id, feed.find(e => e.message.includes('Rice')).id);
});
test('read updates only accept visible IDs and preserve other reads and sound preference', () => {
  const feed = notificationFeed('Admin', [ticket()], [], now);
  const state = notificationState(null);
  const first = updateNotificationState(state, { ids: [feed[0].id, 'foreign'], soundEnabled: false }, feed, now);
  assert.deepEqual(Object.keys(first.read), [feed[0].id]);
  assert.equal(first.soundEnabled, false);
  assert.equal(updateNotificationState(first, { ids: [] }, feed, now).read[feed[0].id], now);
  assert.throws(() => updateNotificationState(state, { soundEnabled: 'yes' }, feed), /boolean/);
  assert.throws(() => updateNotificationState(state, { ids: ['x'.repeat(241)] }, feed), /IDs/);
  assert.throws(() => notificationState('{broken'), /JSON/);
});
test('notification identity is bound to session, never request tenant/user', async () => {
  const scopes = [];
  const context = { orgUser: { org_id: 'tenant-a', role: 'Kitchen' }, user: { user_id: 'user-a' } };
  const factory = new Function('catalyst', 'getCurrentOrgUser', 'roleCan', 'callerRole', 'Buffer', `async ${extractSource('function notificationContext(')}; return notificationContext;`);
  const load = factory({ initialize: (_req, options) => { scopes.push(options?.scope || 'user'); return {}; } }, async () => context, (role, permission) => role === 'Kitchen' && permission === 'signed_in', ctx => ctx.orgUser.role, Buffer);
  const result = await load({ query: { org_id: 'foreign', user_id: 'foreign' } });
  assert.equal(result.orgId, 'tenant-a');
  assert.equal(result.userId, 'user-a');
  assert.equal(result.key, `org_tenant-a_setting_notifications_user_${Buffer.from('user-a').toString('hex')}`);
  assert.deepEqual(scopes, ['user', 'admin']);
  const { apiPermission, roleCan } = loadFunctions(['apiPermission', 'roleCan']);
  for (const role of ['Admin', 'Kitchen', 'Chef', 'Cashier', 'Waiter', 'Manager', 'Storekeeper']) assert.equal(roleCan(role, apiPermission('PUT', '/api/notifications/state')), true);
  assert.equal(roleCan('unknown', apiPermission('GET', '/api/notifications')), false);
});
test('stock lookup uses existing user catalog scope and does not erase kitchen alerts on failure', async () => {
  const factory = new Function('readKotLog', 'STOCK_NOTIFICATION_ROLES', 'notificationFeed', `async ${extractSource('function loadNotificationFeed(')}; return loadNotificationFeed;`);
  let stockQueries = 0;
  const loader = factory(async (_app, orgId, strict) => { assert.equal(orgId, 'tenant-a'); assert.equal(strict, true); return [ticket()]; }, ['Admin', 'Manager', 'Storekeeper'], (role, tickets, products) => notificationFeed(role, tickets, products, now));
  const context = { dataApp: { zcql() { throw new Error('Must not elevate stock reads'); } }, userApp: { zcql: () => ({ executeZCQLQuery: async query => { stockQueries++; assert.ok(query.includes('FROM Products')); throw new Error('No privileges'); } }) }, orgId: 'tenant-a', role: 'Admin', warnings: [] };
  const events = await loader(context);
  assert.equal(stockQueries, 1);
  assert.equal(events[0].kind, 'kitchen_new');
  assert.equal(context.warnings.length, 1);
});
test('saved read-state JSON stays below the existing text-column budget', () => {
  const feed = Array.from({ length: 100 }, (_, i) => ({ id: `${i}-${'x'.repeat(230)}` }));
  const saved = updateNotificationState(notificationState(null), { ids: feed.map(e => e.id) }, feed, now);
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) < 9000);
});
