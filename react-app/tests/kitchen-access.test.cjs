const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports) {
  const exports = {};
  const source = fs.readFileSync(require.resolve(path), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: name => imports[name], Set, Map });
  return exports;
}
const auth = load('../src/services/authService.ts', { './catalystAuth': {} });
const navigation = load('../src/components/layout/navigation.ts', { 'lucide-react': {} });
test('Kitchen role normalizes and cannot sell, edit inventory, view reports or manage users', () => {
  assert.equal(auth.normalizeRole('Kitchen'), 'Kitchen');
  assert.equal(auth.can('kitchen_board', 'Kitchen'), true);
  for (const permission of ['sell', 'manage_products', 'adjust_stock', 'view_reports', 'manage_users', 'manage_settings']) assert.equal(auth.can(permission, 'Kitchen'), false);
});
test('Kitchen navigation contains preparation board and personal settings only, with kitchen as home', () => {
  const visible = navigation.visibleWorkspaces('Kitchen');
  assert.equal(visible.map(item => item.id).join(','), 'kitchen,settings');
  assert.equal(navigation.homeOf(visible[0], 'Kitchen'), '/sales/kitchen');
  assert.equal(navigation.visibleChildren(visible[1], 'Kitchen').map(item => item.to).join(','), '/settings/profile');
  assert.equal(navigation.resolveRoute('/dashboard', '', 'Kitchen'), null);
  assert.equal(navigation.resolveRoute('/sales/pos', '', 'Kitchen'), null);
});
test('Kitchen board route is available only to Admin and kitchen roles', () => {
  for (const role of ['Admin', 'Kitchen', 'Chef']) assert.ok(navigation.resolveRoute('/sales/kitchen', '', role));
  for (const role of ['Manager', 'Cashier', 'Waiter', 'Storekeeper', '']) assert.equal(navigation.resolveRoute('/sales/kitchen', '', role), null);
});
