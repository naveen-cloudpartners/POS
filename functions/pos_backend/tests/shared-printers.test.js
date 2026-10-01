const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractSource, loadScope } = require('./harness');
const { roleCan, callerRole, printerExtraFields, normPrintStation } = loadScope(['roleCan', 'callerRole', 'normWhRole', 'printerExtraFields', 'normPrintStation'], ['PRINTER_KNOWN_FIELDS', 'PRINT_STATIONS']);
const serverApp = { server: true };
const scopes = [];
const settingsApp = new Function('catalyst', 'roleCan', 'callerRole', `${extractSource('function printerSettingsApp(')}; return printerSettingsApp;`)(
  { initialize: (req, options) => { scopes.push(options.scope); return serverApp; } }, roleCan, callerRole,
);
const readFactory = new Function('safeZcql', 'sanitizeZcql', 'printerExtraFields', 'normPrintStation', 'PRINT_TRANSPORTS', 'extractSdkMessage', `async ${extractSource('function getPrinters(')}; return getPrinters;`);
describe('company printer sharing', () => {
  it('reads the same Admin-created printer for every active role using server credentials and exact company key', async () => {
    const queries = [];
    const read = readFactory(async (app, query) => {
      assert.equal(app, serverApp); queries.push(query);
      return [{ Configurations: { config_value: JSON.stringify([{ id: 'counter', name: 'Receipt', station: 'counter', transport: 'qz', osPrinter: 'Thermal', active: true }]) } }];
    }, String, printerExtraFields, normPrintStation, ['browser', 'qz', 'bridge', 'cloud'], (e) => e.message);
    for (const role of ['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Waiter', 'Chef']) {
      const context = { user: { email: `${role}@example.test` }, orgUser: { org_id: '123', role } };
      const printers = await read(settingsApp({}, context), context.orgUser.org_id);
      assert.equal(printers[0].osPrinter, 'Thermal');
      assert.equal(printers[0].enabled, true);
    }
    assert.ok(scopes.every((scope) => scope === 'admin'));
    assert.ok(queries.every((query) => query.includes("config_key = 'org_123_setting_printers'")));
  });
  it('does not silently turn a printer read failure into an empty registry', async () => {
    const read = readFactory(async () => { throw new Error('access denied'); }, String, printerExtraFields, normPrintStation, [], (e) => e.message);
    await assert.rejects(read(serverApp, '123'), /access denied/);
  });
  it('rejects missing or unmapped user context before server access', () => {
    for (const context of [null, {}, { user: {}, orgUser: { org_id: '123', role: '' } }]) assert.throws(() => settingsApp({}, context));
  });
});
