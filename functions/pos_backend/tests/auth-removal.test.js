const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadScope } = require('./harness');

const { extractSdkMessage, removeCatalystAuthLogin } = loadScope(
  ['extractSdkMessage', 'removeCatalystAuthLogin'],
);

describe('removeCatalystAuthLogin', () => {
  it('matches email_id case-insensitively and deletes the Catalyst project user_id only', async () => {
    let deleted = '';
    const app = { userManagement: () => ({
      getAllUsers: async () => [
        { email_id: 'Other@example.test', zuid: 'other-zuid', user_id: 'other-project-user' },
        { email_id: ' ThrowAway@example.test ', zuid: 'zuid-42', user_id: 'project-user-42' },
      ],
      deleteUser: async (id) => { deleted = id; return true; },
    }) };
    const result = await removeCatalystAuthLogin(app, 'throwaway@example.test');
    assert.equal(deleted, 'project-user-42');
    assert.deepEqual(result, { auth_removed: true, auth_detail: 'Login account removed.' });
  });

  it('treats an absent login as already removed and preserves roster success on SDK failure', async () => {
    const absent = { userManagement: () => ({ getAllUsers: async () => [] }) };
    assert.deepEqual(await removeCatalystAuthLogin(absent, 'gone@example.test'), {
      auth_removed: true, auth_detail: 'Login account was already absent.',
    });
    const failing = { userManagement: () => ({ getAllUsers: async () => { throw { status: 503, code: 'AUTH_DOWN', message: 'temporarily unavailable' }; } }) };
    const result = await removeCatalystAuthLogin(failing, 'throwaway@example.test');
    assert.equal(result.auth_removed, false);
    assert.match(result.auth_detail, /temporarily unavailable/);
    assert.match(result.auth_detail, /AUTH_DOWN/);
  });
});
