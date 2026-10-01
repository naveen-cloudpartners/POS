const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(failedPath) {
  const calls = [];
  const source = fs.readFileSync(require.resolve('../src/services/purchaseService.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Promise, Error, require: () => ({ apiFetch: async (path) => {
    calls.push(path);
    if (path === failedPath) throw new Error('No privileges to perform this action.');
    return { success: true, data: [{ ROWID: '1' }] };
  } }) });
  return { service: exports, calls };
}
test('a bills privilege error does not erase vendor or order data', async () => {
  const { service } = load('/purchases/bills');
  const records = await service.getPurchasingRecords();
  assert.equal(records.vendors.length, 1);
  assert.equal(records.orders.length, 1);
  assert.equal(records.bills.length, 0);
  assert.match(records.errors.bills, /No privileges/);
});
test('Storekeeper loading skips payables endpoints', async () => {
  const { service, calls } = load();
  const records = await service.getPurchasingRecords(false);
  assert.equal(records.vendors.length, 1);
  assert.equal(records.bills.length, 0);
  assert.equal(calls.includes('/purchases/bills'), false);
  assert.equal(calls.includes('/purchases/payments'), false);
});
