const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { SRC, extractSource, extractConstObject, loadFunctions } = require('./harness');

describe('company profile write/read symmetry (regression)', () => {
  it('every company_* key written by saveCompanyProfile is read back', () => {
    const mapping = extractConstObject('mapping');
    assert.equal(mapping.company_name, 'company_name');
    const profSrc = extractSource('async function getCompanyProfile(');
    for (const written of Object.values(mapping)) {
      if (written === 'company_name' || written === 'currency') continue; // short keys, symmetric by name
      assert.ok(
        profSrc.includes(`s.${written}`),
        `getCompanyProfile never reads s.${written} (saved as org_<id>_setting_${written})`
      );
    }
  });
});

describe('ZCQL LIMIT cap (regression: platform rejects LIMIT > 300)', () => {
  it('no numeric LIMIT above 300 anywhere in the backend', () => {
    const bad = [];
    for (const m of SRC.matchAll(/LIMIT\s+(\d+)/g)) {
      if (Number(m[1]) > 300) bad.push(`LIMIT ${m[1]}`);
    }
    assert.deepEqual(bad, []);
  });

  it('dynamic limits are clamped to 300', () => {
    assert.ok(SRC.includes('Math.min(300'), 'expected a Math.min(300 clamp for dynamic limits');
  });
});

describe('storage key builders', () => {
  const { companyLogoKey, logoRefIsStratus, logoKeyFromRef, productImageKey } = loadFunctions([
    'companyLogoKey',
    'logoRefIsStratus',
    'logoKeyFromRef',
    'productImageKey',
  ]);

  it('builds safe Stratus keys and detects stratus: refs', () => {
    assert.equal(companyLogoKey('cloudhub_admin', 'png'), 'company/cloudhub_admin/logo.png');
    assert.equal(productImageKey('123', 'jpg'), 'products/123.jpg');
    assert.equal(logoRefIsStratus('stratus:company/x/logo.png'), true);
    assert.equal(logoRefIsStratus('36929000000352047'), false);
    assert.equal(logoKeyFromRef('stratus:company/x/logo.png'), 'company/x/logo.png');
  });

  it('sanitizes hostile org ids out of object keys', () => {
    assert.equal(companyLogoKey('a/b#c', 'png'), 'company/a_b_c/logo.png');
  });
});
