const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(require.resolve(path), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Set, ...globals });
  return exports;
}
test('polling and reload baselines do not replay old/read alerts', () => {
  const { newNotifications } = load('../src/utils/notificationDelivery.ts');
  const seen = new Set();
  const old = { id: 'old', read: false };
  assert.equal(newNotifications([old], seen, false).length, 0);
  assert.equal(newNotifications([old], seen, true).length, 0);
  const fresh = { id: 'fresh', read: false };
  assert.equal(newNotifications([fresh, old, { id: 'read', read: true }], seen, true).length, 1);
  assert.equal(newNotifications([fresh, old], seen, true).length, 0);
});
test('batched arrivals play one priority alert instead of one chime per ticket', () => {
  const { notificationSound } = load('../src/utils/notificationDelivery.ts');
  assert.equal(notificationSound([{ kind: 'kitchen_ready' }]), 'ready');
  assert.equal(notificationSound([{ kind: 'kitchen_new' }, { kind: 'stock' }]), 'new_order');
  assert.equal(notificationSound([{ kind: 'kitchen_new' }, { kind: 'kitchen_cancelled' }]), 'warning');
});
test('action sounds exclude polling, notification state and QZ signing', () => {
  const { actionSound } = load('../src/services/soundService.ts');
  assert.equal(actionSound('/orders', 'POST', { success: true }), 'success');
  assert.equal(actionSound('/orders', 'POST', { kitchen_warning: 'failed' }), 'warning');
  assert.equal(actionSound('/items', 'POST', { success: false }), 'error');
  assert.equal(actionSound('/kitchen/tickets/KOT-1/status', 'POST', { ticket: { status: 'READY' } }), 'ready');
  for (const [path, method] of [['/notifications/state', 'PUT'], ['/printing/qz/sign', 'POST'], ['/items', 'GET']]) assert.equal(actionSound(path, method, {}), null);
});
test('sound respects mute, browser unlock and throttles rapid calls without queues', async () => {
  let started = 0;
  class AudioContext {
    state = 'suspended'; currentTime = 0; destination = {};
    async resume() { this.state = 'running'; }
    createOscillator() { return { frequency: {}, connect() {}, start() { started++; }, stop() {}, disconnect() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const sounds = load('../src/services/soundService.ts', { AudioContext });
  sounds.setSoundEnabled(true);
  assert.equal(sounds.playSound('ready'), false);
  assert.equal(started, 0);
  await sounds.unlockAudio();
  assert.equal(sounds.playSound('ready'), true);
  assert.equal(started, 3);
  assert.equal(sounds.playSound('new_order'), false);
  sounds.setSoundEnabled(false);
  assert.equal(sounds.playSound('error', true), false);
  assert.equal(started, 3);
});
