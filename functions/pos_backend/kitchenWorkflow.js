const STATES = ['QUEUED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
const locks = new Map();

function kitchenState(entry) {
  return STATES.includes(entry.prepStatus) ? entry.prepStatus : entry.status === 'DONE' ? 'SERVED' : 'QUEUED';
}
function kitchenTicket(entry) {
  return {
    number: String(entry.number || ''), orderId: String(entry.orderId || ''),
    station: String(entry.station || ''), status: kitchenState(entry),
    items: (Array.isArray(entry.items) ? entry.items : []).map((item, index) => ({ name: String(item.name || 'Item'), sku: String(item.sku || ''), qty: Math.max(0, Number(item.qty) || 0), imageUrl: `/kitchen/tickets/${encodeURIComponent(entry.number)}/items/${index}/image?v=${encodeURIComponent(entry.prepUpdatedAt || entry.firedAt || '')}` })).filter(item => item.qty > 0),
    roomNumber: String(entry.roomNumber || ''), notes: String(entry.kitchenNotes || ''),
    firedAt: String(entry.firedAt || ''), updatedAt: String(entry.prepUpdatedAt || entry.firedAt || ''),
    cancellationNote: String(entry.cancellationNote || ''),
    detailsMissing: !Array.isArray(entry.items),
  };
}
function transitionKitchen(entry, expected, next, actor, now = new Date().toISOString(), allowLegacyDismiss = false) {
  const current = kitchenState(entry);
  if (current !== expected) return { error: 'This ticket changed on another screen. Refresh and try again.', code: 409 };
  if (allowLegacyDismiss && next === 'CANCELLED' && !Array.isArray(entry.items) && ['QUEUED', 'PREPARING', 'READY'].includes(current)) return { entry: { ...entry, prepStatus: next, prepUpdatedAt: now, prepActor: actor, prepHistory: nextHistory(entry, next, now), cancellationNote: 'Legacy ticket dismissed by Admin after counter verification.' } };
  if (!['QUEUED:PREPARING', 'PREPARING:READY', 'READY:SERVED'].includes(`${current}:${next}`)) return { error: 'Invalid kitchen transition.', code: 400 };
  if (next !== 'SERVED' && (!Array.isArray(entry.items) || entry.items.length === 0)) return { error: 'Item details are unavailable for this legacy ticket. Ask the counter to verify it.', code: 400 };
  return { entry: { ...entry, prepStatus: next, prepUpdatedAt: now, prepActor: actor, prepHistory: nextHistory(entry, next, now) } };
}
function nextHistory(entry, status, at) {
  const history = Array.isArray(entry.prepHistory) ? entry.prepHistory : [{ status: kitchenState(entry), at: entry.prepUpdatedAt || entry.firedAt }];
  return [...history, { status, at }].slice(-5);
}
function cancelKitchenItems(entry, lines, reason, full) {
  if (['SERVED', 'CANCELLED'].includes(kitchenState(entry))) return entry;
  const now = new Date().toISOString();
  if (full || !Array.isArray(entry.items)) return { ...entry, prepStatus: 'CANCELLED', cancellationNote: reason, prepUpdatedAt: now, prepHistory: nextHistory(entry, 'CANCELLED', now) };
  const remaining = lines.map(line => ({ ...line, qty: Math.max(0, Number(line.qty) || 0) }));
  const items = entry.items.map(item => {
    let qty = Number(item.qty) || 0;
    for (const line of remaining) {
      const matches = item.sku && line.sku ? item.sku === line.sku : item.name === line.name;
      if (!matches) continue;
      const removed = Math.min(qty, line.qty);
      qty -= removed; line.qty -= removed;
    }
    return { ...item, qty };
  }).filter(item => item.qty > 0);
  return { ...entry, items, prepStatus: items.length === 0 ? 'CANCELLED' : kitchenState(entry), cancellationNote: `Order adjusted: ${reason}`, prepUpdatedAt: now, adjustmentAt: now, prepHistory: items.length === 0 ? nextHistory(entry, 'CANCELLED', now) : entry.prepHistory };
}
/** Serialize read-modify-write KOT documents within this function instance. */
async function withKitchenLock(key, operation) {
  const previous = locks.get(key) || Promise.resolve();
  const pending = previous.catch(() => undefined).then(operation);
  locks.set(key, pending);
  try { return await pending; } finally { if (locks.get(key) === pending) locks.delete(key); }
}
module.exports = { kitchenState, kitchenTicket, transitionKitchen, cancelKitchenItems, withKitchenLock };
