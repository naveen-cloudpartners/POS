const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFunctions } = require('./harness');

const { auditActionFor } = loadFunctions(['auditActionFor']);

describe('auditActionFor routing', () => {
  it('never audits reads', () => {
    assert.equal(auditActionFor('GET', '/api/orders'), '');
    assert.equal(auditActionFor('GET', '/api/settings/company'), '');
    assert.equal(auditActionFor('GET', '/api/stock-movements'), '');
  });

  it('maps sales mutations', () => {
    assert.equal(auditActionFor('POST', '/api/orders'), 'ORDER_CREATED');
    assert.equal(auditActionFor('POST', '/api/orders/123/void'), 'ORDER_VOIDED');
    assert.equal(auditActionFor('POST', '/api/orders/1/return'), 'ORDER_REFUNDED');
  });

  it('maps catalog, inventory and transfer mutations', () => {
    assert.equal(auditActionFor('POST', '/api/items'), 'PRODUCT_CREATED');
    assert.equal(auditActionFor('PUT', '/api/items/5'), 'PRODUCT_UPDATED');
    assert.equal(auditActionFor('DELETE', '/api/items/5'), 'PRODUCT_DELETED');
    assert.equal(auditActionFor('POST', '/api/items/stock-adjust'), 'STOCK_ADJUSTED');
    assert.equal(auditActionFor('POST', '/api/transfers'), 'TRANSFER_CREATED');
    assert.equal(auditActionFor('POST', '/api/transfers/2/approve'), 'TRANSFER_APPROVED');
    assert.equal(auditActionFor('POST', '/api/transfers/2/complete'), 'TRANSFER_COMPLETED');
    assert.equal(auditActionFor('POST', '/api/transfers/2/cancel'), 'TRANSFER_CANCELLED');
    assert.equal(auditActionFor('POST', '/api/categories/repair'), 'CATEGORY_UPDATED');
  });

  it('maps customers, users, shifts and settings mutations', () => {
    assert.equal(auditActionFor('POST', '/api/customers'), 'CUSTOMER_CREATED');
    assert.equal(auditActionFor('PUT', '/api/customers/7'), 'CUSTOMER_UPDATED');
    assert.equal(auditActionFor('POST', '/api/customers/7/adjust-points'), 'POINTS_ADJUSTED');
    assert.equal(auditActionFor('POST', '/api/admin/users'), 'USER_CREATED');
    assert.equal(auditActionFor('DELETE', '/api/admin/users/a@b.c'), 'USER_DELETED');
    assert.equal(auditActionFor('POST', '/api/admin/users/a@b.c/activate'), 'USER_ACTIVATED');
    assert.equal(auditActionFor('POST', '/api/shifts/open'), 'SHIFT_OPENED');
    assert.equal(auditActionFor('POST', '/api/shifts/close'), 'SHIFT_CLOSED');
    assert.equal(auditActionFor('POST', '/api/config/settings'), 'SETTINGS_CHANGED');
    assert.equal(auditActionFor('PUT', '/api/settings/company'), 'SETTINGS_CHANGED');
    assert.equal(auditActionFor('PUT', '/api/settings/payments'), 'SETTINGS_CHANGED');
  });

  it('returns empty for unmapped mutating paths', () => {
    assert.equal(auditActionFor('POST', '/api/sync/books'), '');
    assert.equal(auditActionFor('DELETE', '/api/unknown/path'), '');
  });
});
