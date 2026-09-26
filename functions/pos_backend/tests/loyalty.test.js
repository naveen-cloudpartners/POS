const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFunctions } = require('./harness');

const { calculateLoyaltyPoints, calculateCustomerTier } = loadFunctions([
  'calculateLoyaltyPoints',
  'calculateCustomerTier',
]);

describe('calculateLoyaltyPoints', () => {
  it('awards floor(total / points_per_currency)', () => {
    assert.equal(calculateLoyaltyPoints(250, 100), 2);
    assert.equal(calculateLoyaltyPoints(99, 100), 0);
    assert.equal(calculateLoyaltyPoints(100, 100), 1);
  });

  it('never goes negative and guards bad earn rates', () => {
    assert.equal(calculateLoyaltyPoints(0, 100), 0);
    assert.equal(calculateLoyaltyPoints(-50, 100), 0);
    assert.equal(calculateLoyaltyPoints(500, -5), 0);
    // ppc 0 falls back to 100 via `|| 100` (config layer guarantees >= 1).
    assert.equal(calculateLoyaltyPoints(500, 0), 5);
  });
});

describe('calculateCustomerTier', () => {
  const thresholds = { tier_active: 100, tier_loyal: 500, tier_vip: 1000 };

  it('walks New → Active → Loyal → VIP at the thresholds', () => {
    assert.equal(calculateCustomerTier(0, thresholds), 'New');
    assert.equal(calculateCustomerTier(99, thresholds), 'New');
    assert.equal(calculateCustomerTier(100, thresholds), 'Active');
    assert.equal(calculateCustomerTier(500, thresholds), 'Loyal');
    assert.equal(calculateCustomerTier(1000, thresholds), 'VIP');
    assert.equal(calculateCustomerTier(99999, thresholds), 'VIP');
  });
});
