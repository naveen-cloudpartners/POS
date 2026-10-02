const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/utils/dashboardAnalytics.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const analyticsExports = {};
vm.runInNewContext(output, { exports: analyticsExports, Date, Map, Number, String, Math, Array });
const analytics = Promise.resolve(analyticsExports);
const now = new Date(2026, 9, 2, 12);

test('compares consecutive equal periods across month boundaries with zero-filled days', async () => {
  const { buildDashboardSeries } = await analytics;
  const rows = buildDashboardSeries([
    { CREATEDTIME: '2026-09-25 23:55:00', paid_total: 300, total: 300 },
    { CREATEDTIME: '2026-10-02 00:05:00', paid_total: 500, total: 500 },
  ], 7, now);
  assert.equal(rows.length, 7);
  assert.equal(rows[0].date, '2026-09-26');
  assert.equal(rows[6].previousDate, '2026-09-25');
  assert.equal(rows[6].revenue, 500);
  assert.equal(rows[6].previousRevenue, 300);
  assert.equal(rows[5].revenue, 0);
  assert.equal(rows[6].cumulativeRevenue, 500);
  assert.equal(rows[6].previousCumulativeRevenue, 300);
});
test('uses collections rather than invoice totals and counts outstanding payments', async () => {
  const { buildDashboardSeries } = await analytics;
  const rows = buildDashboardSeries([
    { CREATEDTIME: '2026-10-02', total: 1000, paid_total: 400 },
    { CREATEDTIME: '2026-10-02', total: 500, paid_total: 500 },
    { CREATEDTIME: '2026-10-02', total: 200, paid_total: 0 },
  ], 7, now);
  assert.equal(rows[6].revenue, 900);
  assert.equal(rows[6].orders, 3);
  assert.equal(rows[6].unpaidOrders, 2);
});
test('excludes cancelled, refunded and voided sales and does not count undated rows', async () => {
  const { buildDashboardSeries } = await analytics;
  const orders = ['void', 'VOIDED', 'cancelled', 'canceled', 'refunded'].map(status => ({ status, CREATEDTIME: '2026-10-02', paid_total: 100 }));
  orders.push({ status: 'Synced', CREATEDTIME: '', paid_total: 999 });
  const rows = buildDashboardSeries(orders, 7, now);
  assert.equal(rows.reduce((s, p) => s + p.revenue, 0), 0);
  assert.equal(rows.reduce((s, p) => s + p.orders, 0), 0);
});
test('missing and invalid payment amounts do not create phantom revenue or NaN', async () => {
  const { buildDashboardSeries } = await analytics;
  const rows = buildDashboardSeries([
    { CREATEDTIME: '2026-10-02', total: 500 },
    { CREATEDTIME: '2026-10-02', total: 500, paid_total: 'invalid' },
    { CREATEDTIME: '2026-10-02', total: 500, paid_total: -20 },
  ], 30, now);
  assert.equal(rows[29].revenue, 0);
  assert.equal(rows[29].unpaidOrders, 3);
  assert.equal(rows[0].date, '2026-09-03');
});
test('empty periods return complete zero-valued chart points', async () => {
  const { buildDashboardSeries } = await analytics;
  const rows = buildDashboardSeries([], 7, now);
  assert.ok(rows.every(p => p.revenue === 0 && p.orders === 0 && p.previousCumulativeRevenue === 0));
});

test('sales line and point sit at the exact center of the current bar top', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const ts = require('typescript');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const source = fs.readFileSync(require.resolve('../src/components/dashboard/DashboardChart.tsx'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Intl, require: path => path.includes('utils/format') ? { currency: value => `LKR ${value}` } : require(path) });
  const html = renderToStaticMarkup(React.createElement(exports.default, { kind: 'sales', points: [{date:'2026-10-02',previousDate:'2026-09-25',label:'2 Oct',revenue:100,previousRevenue:80}] }));
  const bar = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*fill="#5d8ef9"/.exec(html);
  const marker = /<circle cx="([\d.]+)" cy="([\d.]+)"[^>]*fill="#ef6a72"/.exec(html);
  assert.ok(bar && marker);
  assert.ok(Math.abs(Number(marker[1]) - (Number(bar[1]) + Number(bar[3]) / 2)) < .00001);
  assert.equal(Number(marker[2]), Number(bar[2]));
  const lineStart = /<path d="M([\d.]+),([\d.]+)[^"]*" fill="none" stroke="#ef6a72"/.exec(html);
  assert.equal(Number(lineStart[1]), Number(marker[1]));
  assert.equal(Number(lineStart[2]), Number(marker[2]));
});
