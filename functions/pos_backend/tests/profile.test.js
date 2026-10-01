const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractSource, loadFunctions } = require('./harness');
const { personalProfilePatch, parseProfilePhoto, roleCan, apiPermission } = loadFunctions([
  'personalProfilePatch', 'parseProfilePhoto', 'roleCan', 'apiPermission', 'normWhRole',
]);
const personalProfileKey = new Function('require', `${extractSource('function personalProfileKey(')}; return personalProfileKey;`)(require);

describe('personal profile access and validation', () => {
  it('permits staff personal settings while preserving Admin business settings', () => {
    for (const role of ['Manager', 'Storekeeper', 'Cashier', 'Waiter', 'Chef']) {
      for (const path of ['/api/profile/me', '/api/profile/me/photo']) {
        for (const method of ['GET', 'PUT', 'POST', 'DELETE']) {
          assert.equal(roleCan(role, apiPermission(method, path)), true);
        }
      }
    }
    assert.equal(roleCan('Admin', 'manage_profile'), false);
    assert.equal(roleCan('', 'manage_profile'), false);
    assert.equal(roleCan('Cashier', 'manage_settings'), false);
  });
  it('isolates saved profiles by authenticated company and email', () => {
    const context = (org, email) => ({ orgUser: { org_id: org }, user: { email } });
    const key = personalProfileKey(context('1', 'User@example.test'));
    assert.equal(key, personalProfileKey(context('1', ' user@example.test ')));
    assert.notEqual(key, personalProfileKey(context('2', 'user@example.test')));
    assert.notEqual(key, personalProfileKey(context('1', 'other@example.test')));
    assert.match(key, /^personal_profile_[a-f0-9]{64}$/);
  });
  it('only accepts personal fields and ignores privilege or identity changes', () => {
    assert.deepEqual(personalProfilePatch({ name: ' Staff ', phone: '+94 123', role: 'Admin', email: 'other@test', org_id: '2', photo_ref: 'foreign' }), { name: 'Staff', phone: '+94 123' });
    assert.ok(personalProfilePatch({ name: '' }).error);
    assert.ok(personalProfilePatch({ name: 'Staff', phone: '<script>' }).error);
  });
  it('rejects unsupported, disguised and oversized photos', () => {
    assert.ok(parseProfilePhoto({ imageData: 'data:image/svg+xml;base64,PHN2Zz4=' }).error);
    assert.ok(parseProfilePhoto({ imageData: 'data:image/png;base64,aGVsbG8=' }).error);
    assert.ok(parseProfilePhoto({ imageData: `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}` }).error);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const result = parseProfilePhoto({ imageData: `data:image/png;base64,${png.toString('base64')}` });
    assert.equal(result.mime, 'image/png');
    assert.deepEqual(result.buffer, png);
  });
});
