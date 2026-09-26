const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFunctions } = require('./harness');

const { roleCan } = loadFunctions(['roleCan']);

/* Mirrors the permission model documented above roleCan (USR-03):
   unknown roles get nothing, unknown permissions are denied. */
describe('roleCan matrix', () => {
  const yes = (role, perm) => assert.equal(roleCan(role, perm), true, `${role} should have ${perm}`);
  const no = (role, perm) => assert.equal(roleCan(role, perm), false, `${role} must not have ${perm}`);

  it('sell: frontline sellers only', () => {
    yes('Admin', 'sell');
    yes('Manager', 'sell');
    yes('Cashier', 'sell');
    yes('Waiter', 'sell');
    no('Storekeeper', 'sell');
    no('Chef', 'sell');
  });

  it('manage_products: Admin/Manager only', () => {
    yes('Admin', 'manage_products');
    yes('Manager', 'manage_products');
    no('Cashier', 'manage_products');
    no('Storekeeper', 'manage_products');
  });

  it('adjust_stock/manage_inventory: warehouse roles included', () => {
    for (const perm of ['adjust_stock', 'manage_inventory']) {
      yes('Admin', perm);
      yes('Manager', perm);
      yes('Storekeeper', perm);
      no('Cashier', perm);
    }
  });

  it('view_reports and manage_users: Admin/Manager only', () => {
    for (const perm of ['view_reports', 'manage_users']) {
      yes('Admin', perm);
      yes('Manager', perm);
      no('Cashier', perm);
      no('Storekeeper', perm);
    }
  });

  it('delete_users/manage_settings/export_audit: Admin only', () => {
    for (const perm of ['delete_users', 'manage_settings', 'export_audit']) {
      yes('Admin', perm);
      no('Manager', perm);
      no('Cashier', perm);
      no('Storekeeper', perm);
    }
  });

  it('denies unknown roles and unknown permissions', () => {
    no('', 'sell');
    no('SuperAdmin', 'sell');
    no('Admin', 'launch_missiles');
    no('Cashier', '');
  });
});
