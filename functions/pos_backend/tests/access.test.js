const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFunctions, extractSource } = require('./harness');
const { roleCan, apiPermission, canReadOrder, customerLookup, getRolePermissions } = loadFunctions([
  'roleCan', 'apiPermission', 'canReadOrder', 'customerLookup', 'normWhRole', 'getRolePermissions',
]);

describe('enforced endpoint permissions', () => {
  const allowed = (role, method, path) => roleCan(role, apiPermission(method, path));
  it('blocks cashier and storekeeper back-office access including direct API calls', () => {
    for (const role of ['Cashier', 'Storekeeper']) {
      for (const path of ['/api/users', '/api/admin/users', '/api/reports/products', '/api/dashboard/summary']) {
        assert.equal(allowed(role, 'GET', path), false, `${role}: ${path}`);
      }
      assert.equal(allowed(role, 'PUT', '/api/settings/company'), false);
    }
  });
  it('keeps Storekeeper products read-only and permits inventory adjustments/transfers', () => {
    assert.equal(allowed('Storekeeper', 'GET', '/api/items'), true);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal(allowed('Storekeeper', method, '/api/items/123'), false);
    assert.equal(allowed('Storekeeper', 'POST', '/api/items/stock-adjust'), true);
    assert.equal(allowed('Storekeeper', 'POST', '/api/transfers'), true);
    assert.equal(allowed('Storekeeper', 'POST', '/api/orders'), false);
  });
  it('allows Cashier checkout and basic lookup while blocking customer edits', () => {
    for (const path of ['/api/items', '/api/customers', '/api/settings/tax', '/api/settings/payments']) {
      assert.equal(allowed('Cashier', 'GET', path), true, path);
    }
    assert.equal(allowed('Cashier', 'POST', '/api/orders'), true);
    assert.equal(allowed('Cashier', 'POST', '/api/customers'), false);
    assert.equal(allowed('Cashier', 'POST', '/api/contacts'), false);
    assert.equal(allowed('Cashier', 'POST', '/api/orders/123/void'), false);
  });
  it('supports limited Manager user administration and Admin-only settings', () => {
    assert.equal(allowed('Manager', 'POST', '/api/admin/users/a/change-role'), true);
    assert.equal(allowed('Manager', 'PUT', '/api/settings/tax'), false);
    assert.equal(allowed('Admin', 'PUT', '/api/settings/tax'), true);
    assert.equal(allowed('', 'GET', '/api/items'), false);
    assert.equal(allowed('Cashier', 'GET', '/api/new-private-endpoint'), false);
  });
  it('reports the same capabilities the server enforces', () => {
    for (const role of ['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Unknown']) {
      for (const permission of ['sell', 'manage_products', 'adjust_stock', 'view_reports', 'manage_users', 'manage_settings']) {
        assert.equal(getRolePermissions(role)[permission], roleCan(role, permission));
      }
    }
    assert.equal(getRolePermissions('master_admin').manage_settings, true);
  });
});

describe('private transaction history and customer lookup', () => {
  it('requires exact ownership for Cashier receipts; blank attribution does not grant access', () => {
    assert.equal(canReadOrder('Cashier', 'me@example.com', 'ME@example.com'), true);
    assert.equal(canReadOrder('Cashier', 'me@example.com', 'other@example.com'), false);
    assert.equal(canReadOrder('Cashier', 'me@example.com', ''), false);
    assert.equal(canReadOrder('Cashier', '', ''), false);
    assert.equal(canReadOrder('Admin', 'me@example.com', 'other@example.com'), true);
    assert.equal(canReadOrder('Storekeeper', 'me@example.com', 'me@example.com'), false);
  });
  it('does not include revenue and transaction metrics in basic customer lookup', () => {
    assert.deepEqual(customerLookup({ id: '123', name: 'Alice', phone: '12345', lifetime_value: 999, order_count: 5 }),
      { id: '123', name: 'Alice', phone: '12345' });
  });
});

describe('live roster authority', () => {
  const resolveFactory = new Function('findRosterUser', 'safeZcql', 'sanitizeZcql', 'normWhRole',
    `async ${extractSource('function resolveCurrentOrgUser(')}; return resolveCurrentOrgUser;`);
  const normalize = (role) => role === 'master_admin' ? 'Admin' : String(role || '');
  const app = { userManagement: () => ({ getCurrentUser: async () => ({ email_id: 'staff@example.com', user_id: '123' }) }) };
  it('applies role changes immediately even when OrgUsers sync is stale', async () => {
    let currentRole = 'Manager';
    const resolve = resolveFactory(async () => ({ data: { role: currentRole, status: 'active' } }),
      async (app, query) => query.includes('FROM OrgUsers') ? [{ OrgUsers: { user_id: 'staff@example.com', role: 'Admin', org_id: 'org_default' } }] : [],
      String, normalize);
    assert.equal((await resolve({}, app)).orgUser.role, 'Manager');
    currentRole = 'Cashier';
    assert.equal((await resolve({}, app)).orgUser.role, 'Cashier');
    currentRole = 'Storekeeper';
    assert.equal((await resolve({}, app)).orgUser.role, 'Storekeeper');
  });
  it('never grants Admin to an unmapped user', async () => {
    const resolve = resolveFactory(async () => null, async () => [], String, normalize);
    assert.equal((await resolve({}, app)).orgUser.role, '');
  });
  it('denies suspended and deleted accounts before resolving table roles', async () => {
    for (const status of ['inactive', 'deleted']) {
      const resolve = resolveFactory(async () => ({ data: { role: 'Admin', status } }),
        async () => { throw new Error('must not query'); }, String, normalize);
      assert.equal(await resolve({}, app), null);
    }
  });
});
