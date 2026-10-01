const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractSource, loadFunctions, SRC } = require('./harness');
const { canUsePurchasing, canManagePayables, purchaseRole, normWhRole } = loadFunctions(['canUsePurchasing', 'canManagePayables', 'purchaseRole', 'normWhRole']);

test('allowed purchasing roles use server table credentials only after role verification', () => {
  const scopes = [];
  const server = {};
  const resolve = new Function('catalyst', 'canUsePurchasing', 'purchaseRole', `${extractSource('function purchaseDataApp(')}; return purchaseDataApp;`)(
    { initialize: (_req, opts) => { scopes.push(opts.scope); return server; } }, canUsePurchasing, (ctx) => normWhRole(ctx.orgUser.role),
  );
  for (const role of ['Admin', 'Manager', 'Storekeeper']) {
    assert.equal(resolve({}, { user: {}, orgUser: { org_id: 'company', role } }), server);
  }
  for (const role of ['Cashier', 'Chef', 'Waiter', '']) {
    assert.throws(() => resolve({}, { user: {}, orgUser: { org_id: 'company', role } }));
  }
  assert.throws(() => resolve({}, null));
  assert.deepEqual(scopes, ['admin', 'admin', 'admin']);
  assert.equal(canManagePayables(purchaseRole({ orgUser: { role: 'Storekeeper' } })), false);
});
test('every purchasing route verifies its action before switching table credentials', () => {
  const start = SRC.indexOf("app.get('/api/purchases/vendors'");
  const end = SRC.indexOf('CUSTOMER LOYALTY FOUNDATION', start);
  const routes = SRC.slice(start, end).split(/app\.(?:get|post)\(/).slice(1);
  assert.equal(routes.length, 10);
  for (const source of routes) {
    assert.match(source, /requirePurchaseAccess\(res, ctx(?:, true)?\)\) return; app = purchaseDataApp\(req, ctx\)/);
  }
});
test('sale product lookup returns live Books item and tax mapping for checkout', async () => {
  const queryLog = [];
  const resolve = new Function('safeZcql', 'sanitizeZcql', `async ${extractSource('function resolveProductForSale(')}; return resolveProductForSale;`)(
    async (_app, query) => { queryLog.push(query); return [{ Products: { ROWID: '42', books_item_id: 'books-item', tax_id: 'tax', tax_percentage: 10 } }]; }, String,
  );
  const product = await resolve({}, { books_item_id: 'books-item' });
  assert.equal(product.tax_id, 'tax');
  assert.match(queryLog[0], /books_item_id, tax_id, tax_percentage FROM Products/);
});
