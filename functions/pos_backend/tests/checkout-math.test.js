const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFunctions } = require('./harness');

const { posNormalizeLine, posTotalsFor } = loadFunctions([
  'posRound2',
  'posClampPct',
  'posNormalizeLine',
  'posTotalsFor',
]);

describe('posNormalizeLine (exclusive default)', () => {
  it('adds tax on top, byte-identical to legacy math', () => {
    const l = posNormalizeLine({ quantity: 2, rate: 100, tax_percentage: 10 }, { mode: 'exclusive', round: true });
    assert.equal(l.lineGross, 200);
    assert.equal(l.lineDisc, 0);
    assert.equal(l.lineNet, 200);
    assert.equal(l.lineTax, 20);
  });

  it('clamps percent discounts at 100 and flat at gross', () => {
    const pct = posNormalizeLine({ quantity: 1, rate: 100, discount_type: 'percent', discount_value: 250 }, { mode: 'exclusive', round: true });
    assert.equal(pct.lineDisc, 100);
    const flat = posNormalizeLine({ quantity: 1, rate: 50, discount_type: 'flat', discount_value: 999 }, { mode: 'exclusive', round: true });
    assert.equal(flat.lineDisc, 50);
  });

  it('clamps tax_percentage into 0..100', () => {
    const l = posNormalizeLine({ quantity: 1, rate: 100, tax_percentage: 500 }, { mode: 'exclusive', round: true });
    assert.equal(l.taxPct, 100);
    assert.equal(l.lineTax, 100);
  });
});

describe('posNormalizeLine (inclusive mode)', () => {
  it('extracts the tax portion with the sticker total unchanged', () => {
    const l = posNormalizeLine({ quantity: 1, rate: 110, tax_percentage: 10 }, { mode: 'inclusive', round: true });
    assert.equal(l.lineTax, 10);
    assert.equal(l.lineNet, 100);
    assert.equal(l.lineNet + l.lineTax, 110);
  });
});

describe('posTotalsFor', () => {
  it('sums nets/taxes and applies the order discount', () => {
    const lines = [
      posNormalizeLine({ quantity: 2, rate: 100, tax_percentage: 10 }, { mode: 'exclusive', round: true }),
      posNormalizeLine({ quantity: 1, rate: 50, tax_percentage: 0 }, { mode: 'exclusive', round: true }),
    ];
    const t = posTotalsFor(lines, 10, { mode: 'exclusive', round: true });
    assert.equal(t.subtotal, 250);
    assert.equal(t.taxAmount, 20);
    assert.equal(t.orderDisc, 27);
    assert.equal(t.total, 243);
  });
});
