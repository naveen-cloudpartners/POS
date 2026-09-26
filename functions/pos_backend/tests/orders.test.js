const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFunctions } = require('./harness');

const { normalizeOrderStatus, derivePaymentStatus } = loadFunctions([
  'normalizeOrderStatus',
  'derivePaymentStatus',
]);

describe('normalizeOrderStatus', () => {
  it('canonicalizes known states and passes the rest through', () => {
    assert.equal(normalizeOrderStatus('paid'), 'Paid');
    assert.equal(normalizeOrderStatus('OFFLINE PENDING'), 'Offline Pending');
    assert.equal(normalizeOrderStatus('void'), 'Voided');
    assert.equal(normalizeOrderStatus('refund'), 'Refunded');
    assert.equal(normalizeOrderStatus(''), 'Pending');
    assert.equal(normalizeOrderStatus('weird-state'), 'weird-state');
  });
});

describe('derivePaymentStatus', () => {
  it('derives Paid / Partially Paid / Unpaid from legs', () => {
    assert.equal(derivePaymentStatus({ status: 'Synced', total: 100 }, 100), 'Paid');
    assert.equal(derivePaymentStatus({ status: 'Synced', total: 100 }, 40), 'Partially Paid');
    assert.equal(derivePaymentStatus({ status: 'Pending', total: 100 }, 0), 'Pending');
    assert.equal(derivePaymentStatus({ status: 'Synced', total: 100 }, 0), 'Unpaid');
  });

  it('void and refund dominate any tender math', () => {
    assert.equal(derivePaymentStatus({ status: 'Voided', total: 100 }, 100), 'Void');
    assert.equal(derivePaymentStatus({ status: 'Refunded', total: 100 }, 100), 'Refunded');
  });

  it('tolerates a 0.015 rounding gap', () => {
    assert.equal(derivePaymentStatus({ status: 'Synced', total: 100 }, 99.99), 'Paid');
  });
});
