const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadFunctions, extractSource } = require('./harness');
const cryptoHelpers = new Function('require', ['encryptQzPrivateKey', 'decryptQzPrivateKey', 'validateQzCertificatePair', 'createQzRequestSignature'].map((name) => extractSource(`function ${name}(`)).join('\n') + '; return { encryptQzPrivateKey, decryptQzPrivateKey, validateQzCertificatePair, createQzRequestSignature };')(require);
const { qzSigningRequestAllowed, roleCan, apiPermission, normWhRole } = loadFunctions(['qzSigningRequestAllowed', 'roleCan', 'apiPermission', 'normWhRole']);
const printers = [{ enabled: true, transport: 'qz', osPrinter: 'Receipt printer' }];
const now = Date.now();
const request = { call: 'print', timestamp: now, params: { printer: { name: 'Receipt printer' }, options: { copies: 1 }, data: [{ type: 'pixel', format: 'html', flavor: 'plain', data: '<html><body>Receipt</body></html>' }] } };
const allowed = (value) => qzSigningRequestAllowed(JSON.stringify(value), printers, now);
describe('QZ request signing scope', () => {
  it('allows inline receipts to an enabled company printer', () => assert.equal(allowed(request), true));
  it('allows discovery but blocks device commands and stale requests', () => {
    assert.equal(allowed({ call: 'printers.find', timestamp: now, params: {} }), true);
    assert.equal(allowed({ call: 'file.write', timestamp: now }), false);
    assert.equal(allowed({ ...request, timestamp: now - 130000 }), false);
  });
  it('blocks foreign printers, disabled printers, raw commands and remote files', () => {
    assert.equal(allowed({ ...request, params: { ...request.params, printer: { name: 'Foreign printer' } } }), false);
    assert.equal(qzSigningRequestAllowed(JSON.stringify(request), [{ ...printers[0], enabled: false }], now), false);
    for (const part of [{ type: 'raw', data: 'commands' }, { type: 'pixel', format: 'html', flavor: 'file', data: 'https://example.com' }, { ...request.params.data[0], data: '<img src="file:///secret">' }]) {
      assert.equal(allowed({ ...request, params: { ...request.params, data: [part] } }), false);
    }
  });
  it('allows all active staff to use shared printers but only Admin to configure them', () => {
    for (const role of ['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Waiter', 'Chef']) {
      assert.equal(roleCan(role, apiPermission('POST', '/api/printing/qz/sign')), true);
      assert.equal(roleCan(role, apiPermission('GET', '/api/printing/qz/certificate')), true);
      assert.equal(roleCan(role, apiPermission('GET', '/api/settings/printers')), true);
      assert.equal(roleCan(role, apiPermission('PUT', '/api/settings/printers')), role === 'Admin');
    }
    assert.equal(roleCan('', apiPermission('POST', '/api/printing/qz/sign')), false);
    for (const role of ['Manager', 'Cashier', 'Storekeeper']) assert.equal(roleCan(role, apiPermission('PUT', '/api/settings/printers/qz-certificate')), false);
    assert.equal(roleCan('Admin', apiPermission('PUT', '/api/settings/printers/qz-certificate')), true);
  });
  it('encrypts private keys and binds them to the company and server secret', () => {
    const key = require('crypto').randomBytes(32);
    const encrypted = cryptoHelpers.encryptQzPrivateKey('private test material', key, 'company-1');
    assert.equal(JSON.stringify(encrypted).includes('private test material'), false);
    assert.equal(cryptoHelpers.decryptQzPrivateKey(encrypted, key, 'company-1'), 'private test material');
    assert.throws(() => cryptoHelpers.decryptQzPrivateKey(encrypted, key, 'company-2'));
    assert.throws(() => cryptoHelpers.decryptQzPrivateKey(encrypted, require('crypto').randomBytes(32), 'company-1'));
  });
  it('rejects empty and invalid certificate uploads', () => {
    assert.throws(() => cryptoHelpers.validateQzCertificatePair('certificate', ''), /empty/);
    assert.throws(() => cryptoHelpers.validateQzCertificatePair('certificate', 'key'), /PEM/);
  });
  it('signs the SHA-256 hex digest expected by the actual QZ connector', () => {
    const crypto = require('crypto');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const message = JSON.stringify(request);
    const signature = Buffer.from(cryptoHelpers.createQzRequestSignature(message, privateKey), 'base64');
    const digest = crypto.createHash('sha256').update(message).digest('hex');
    assert.equal(crypto.verify('RSA-SHA512', Buffer.from(digest), publicKey, signature), true);
    assert.equal(crypto.verify('RSA-SHA512', Buffer.from(message), publicKey, signature), false);
  });
});
