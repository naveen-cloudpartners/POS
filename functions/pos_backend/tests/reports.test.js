const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScope } = require('./harness');

const { resolveReportRange } = loadScope(
  ['resolveReportRange', 'utcDay', 'shiftDays'],
  []
);

describe('resolveReportRange', () => {
  it('defaults to lifetime when nothing is given', () => {
    assert.deepEqual(resolveReportRange({}), { from: '', to: '', period: 'all', label: 'All time' });
    assert.deepEqual(resolveReportRange(undefined).period, 'all');
  });

  it('honors explicit ranges and swaps inverted ones', () => {
    const r = resolveReportRange({ date_from: '2026-09-10', date_to: '2026-09-01' });
    assert.equal(r.from, '2026-09-01');
    assert.equal(r.to, '2026-09-10');
    assert.equal(r.period, 'custom');
    assert.equal(r.label, '2026-09-01 → 2026-09-10');
  });

  it('resolves today to a single-day window', () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = resolveReportRange({ period: 'today' });
    assert.equal(r.from, today);
    assert.equal(r.to, today);
    assert.equal(r.label, 'Today');
  });

  it('resolves last7 to a six-day span ending today', () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = resolveReportRange({ period: 'last7' });
    assert.equal(r.to, today);
    const span = Math.round(
      (new Date(`${r.to}T00:00:00Z`) - new Date(`${r.from}T00:00:00Z`)) / 86400000,
    );
    assert.equal(span, 6);
  });

  it('falls back to lifetime on unknown periods', () => {
    assert.equal(resolveReportRange({ period: 'someday' }).period, 'all');
  });
});
