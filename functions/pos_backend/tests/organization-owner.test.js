const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractSource, loadFunctions } = require('./harness');
const { getRolePermissions } = loadFunctions(['getRolePermissions', 'roleCan', 'normWhRole']);
const factory = new Function('syncOrgUserRole', 'findRosterUser', 'saveRosterUser', 'getRolePermissions', 'formatCatalystDateTime', 'extractSdkMessage',
  `async ${extractSource('function provisionOrganizationOwner(')}; return provisionOrganizationOwner;`);

function fixture(options = {}) {
  const calls = [];
  const app = {
    userManagement: () => ({
      getAllUsers: async () => options.exists ? [{ email_id: 'OWNER@example.test' }] : [],
      registerUser: async (platform, user) => {
        calls.push(['authentication', platform, user]);
        if (options.authError) throw options.authError;
      },
    }),
    datastore: () => ({ table: (table) => ({ updateRow: async (row) => { calls.push([table, row]); } }) }),
  };
  const provision = factory(
    async (...args) => { calls.push(['OrgUsers', ...args.slice(1)]); return options.mappingFails ? false : true; },
    async () => options.roster || null,
    async (app, email, row) => { calls.push(['roster', email, row]); if (options.rosterFails) throw new Error('roster unavailable'); },
    getRolePermissions, () => '2026-10-01 00:00:00', (error) => error.message,
  );
  return { calls, app, provision };
}
const org = { ROWID: '456', owner_email: ' Owner@example.test ', owner_name: 'Store Owner' };

describe('approved organization owner provisioning', () => {
  it('creates Authentication, company Admin mapping, full permissions, then marks approved', async () => {
    const { calls, app, provision } = fixture();
    await provision(app, org);
    assert.deepEqual(calls.map((call) => call[0]), ['authentication', 'OrgUsers', 'roster', 'Organizations']);
    assert.equal(calls[0][2].email_id, 'owner@example.test');
    assert.deepEqual(calls[1].slice(1), ['owner@example.test', 'Admin', { orgId: '456', displayName: 'Store Owner' }]);
    assert.equal(calls[2][2].role, 'Admin');
    assert.equal(calls[2][2].status, 'active');
    assert.equal(calls[2][2].org_id, '456');
    for (const permission of ['sell', 'manage_products', 'adjust_stock', 'view_reports', 'manage_users', 'manage_settings']) {
      assert.equal(calls[2][2].permissions[permission], true, permission);
    }
    assert.equal(calls[3][1].status, 'approved');
  });
  it('reuses an existing authentication user and preserves roster profile fields on retry', async () => {
    const { calls, app, provision } = fixture({ exists: true, roster: { data: { phone: '12345', invited_at: 100 } } });
    await provision(app, org);
    assert.equal(calls.some((call) => call[0] === 'authentication'), false);
    assert.equal(calls.find((call) => call[0] === 'roster')[2].phone, '12345');
    assert.equal(calls.find((call) => call[0] === 'roster')[2].invited_at, 100);
  });
  it('accepts an authentication duplicate response and still provisions Admin access', async () => {
    const { calls, app, provision } = fixture({ authError: new Error('User already exists') });
    await provision(app, org);
    assert.equal(calls.at(-1)[0], 'Organizations');
  });
  it('does not approve or grant roles when authentication creation fails', async () => {
    const { calls, app, provision } = fixture({ authError: new Error('Authentication unavailable') });
    await assert.rejects(provision(app, org), /Authentication unavailable/);
    assert.deepEqual(calls.map((call) => call[0]), ['authentication']);
  });
  it('leaves approval retryable when either role store fails', async () => {
    for (const options of [{ mappingFails: true }, { rosterFails: true }]) {
      const { calls, app, provision } = fixture(options);
      await assert.rejects(provision(app, org));
      assert.equal(calls.some((call) => call[0] === 'Organizations'), false);
    }
  });
});
