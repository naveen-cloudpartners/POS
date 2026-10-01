const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(fail = false, signed = false) {
  const calls = [];
  let hasher, signatureHandler;
  const signRequest = async (call, params) => {
    if (!signed) return;
    const message = JSON.stringify({ call, params, timestamp: Date.now() });
    const digest = await hasher(message);
    assert.match(digest, /^[a-f0-9]{64}$/);
    await new Promise(signatureHandler(digest));
  };
  const qz = {
    api: { setSha256Type: (value) => { hasher = value; } },
    security: { setCertificatePromise() {}, setSignatureAlgorithm() {}, setSignaturePromise: (value) => { signatureHandler = value; } },
    websocket: { isActive: () => false, connect: async () => { calls.push('connect'); } },
    printers: { find: async () => { await signRequest('printers.find', {}); return ['Receipt']; } },
    configs: { create: (name, options) => ({ name, options }) },
    print: async (config, data) => { await signRequest('print', { printer: { name: config.name }, options: config.options, data }); calls.push({ config, data }); if (fail) throw new Error('Printer offline'); },
  };
  const source = fs.readFileSync(require.resolve('../src/services/printService.ts'), 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, window: { qz }, crypto: require('node:crypto').webcrypto, TextEncoder,
    require: (name) => name === './api' ? { apiFetch: async (path, options) => {
      if (path.endsWith('/sign')) {
        const request = JSON.parse(options.body.message);
        calls.push({ signing: request });
        return { signature: 'signed-digest' };
      }
      return { certificate: signed ? 'test-certificate' : '' };
    } } : {
      billHtml: () => '<h1>Receipt</h1>', kotHtml: () => '', cancelHtml: () => '',
      openPrintWindow: () => { calls.push('browser'); return true; },
    },
  });
  return { service: exports, calls };
}
const printer = { id: 'counter', enabled: true, station: 'counter', width: 58, transport: 'qz', osPrinter: 'Receipt' };
const job = { jobId: 'bill-123', template: 'bill', copies: 1, payload: { receipt: {} } };

test('QZ receipts use pixel HTML, chosen printer, width and copies without browser popup', async () => {
  const { service, calls } = fixture();
  const result = await service.sendPrintJob(job, printer);
  assert.equal(result.ok, true);
  assert.equal(calls.includes('browser'), false);
  const sent = calls.find((call) => typeof call === 'object');
  assert.equal(sent.config.name, 'Receipt');
  assert.equal(sent.config.options.copies, 1);
  assert.equal(sent.data[0].type, 'pixel');
  assert.equal(sent.data[0].format, 'html');
  assert.equal(sent.data[0].flavor, 'plain');
  assert.equal(sent.data[0].options.pageWidth, 58 / 25.4);
});
test('QZ errors and missing printer selection never fall back to a browser popup', async () => {
  for (const configured of [printer, { ...printer, osPrinter: '' }]) {
    const { service, calls } = fixture(true);
    assert.equal((await service.sendPrintJob(job, configured)).ok, false);
    assert.equal(calls.includes('browser'), false);
  }
});
test('printer discovery connects to the local QZ instance', async () => {
  const { service, calls } = fixture();
  const result = await service.discoverQzPrinters();
  assert.equal(result.connected, true);
  assert.equal(result.printers[0], 'Receipt');
  assert.ok(calls.includes('connect'));
});
test('signed discovery and receipt printing send validated JSON rather than the QZ hash to the backend', async () => {
  const { service, calls } = fixture(false, true);
  assert.equal((await service.discoverQzPrinters()).connected, true);
  assert.equal((await service.sendPrintJob(job, printer)).ok, true);
  assert.deepEqual(calls.filter((call) => call.signing).map((call) => call.signing.call), ['printers.find', 'print']);
});
