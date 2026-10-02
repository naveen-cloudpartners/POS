const { kitchenState } = require('./kitchenWorkflow');
const KITCHEN = ['Admin', 'Kitchen', 'Chef'];
const SERVICE = ['Admin', 'Manager', 'Cashier', 'Waiter'];
const STOCK = ['Admin', 'Manager', 'Storekeeper'];

function notificationFeed(role, tickets, products, now = Date.now()) {
  const events = [];
  const cutoff = now - 7 * 86400000;
  const add = (event) => {
    const time = Date.parse(event.createdAt);
    if (Number.isFinite(time) && time >= cutoff && time <= now + 60000) events.push(event);
  };
  for (const ticket of tickets) {
    if (!['kitchen', 'bar'].includes(ticket.station)) continue;
    const label = `${ticket.number}${ticket.roomNumber ? ` · Table / room ${ticket.roomNumber}` : ''}`;
    const kitchenLink = KITCHEN.includes(role) ? '/sales/kitchen' : '/sales/pos';
    const states = Array.isArray(ticket.prepHistory) ? [...ticket.prepHistory] : [];
    if (!states.some(e => e.status === 'QUEUED')) states.push({ status: 'QUEUED', at: ticket.firedAt });
    const status = kitchenState(ticket);
    if (!states.some(e => e.status === status)) states.push({ status, at: ticket.prepUpdatedAt || ticket.firedAt });
    for (const event of states) {
      if (event.status === 'QUEUED' && KITCHEN.includes(role)) add({ id: `kot:${ticket.number}:QUEUED:${event.at}`, kind: 'kitchen_new', title: 'New kitchen order', message: `${label} · ${ticket.station}`, createdAt: event.at, href: kitchenLink });
      if (event.status === 'READY' && SERVICE.includes(role)) add({ id: `kot:${ticket.number}:READY:${event.at}`, kind: 'kitchen_ready', title: 'Order ready to serve', message: label, createdAt: event.at, href: kitchenLink });
      if (event.status === 'CANCELLED' && KITCHEN.includes(role)) add({ id: `kot:${ticket.number}:CANCELLED:${event.at}`, kind: 'kitchen_cancelled', title: 'Kitchen order cancelled', message: `${label} · Check the ticket before preparing`, createdAt: event.at, href: kitchenLink });
    }
    if (ticket.cancellationNote && status !== 'CANCELLED' && KITCHEN.includes(role)) add({ id: `kot:${ticket.number}:adjusted:${ticket.adjustmentAt || ticket.prepUpdatedAt}`, kind: 'kitchen_cancelled', title: 'Kitchen order adjusted', message: `${label} · Review remaining dishes`, createdAt: ticket.adjustmentAt || ticket.prepUpdatedAt, href: kitchenLink });
  }
  if (STOCK.includes(role)) for (const product of products) {
    if (['inactive', 'discontinued'].includes(String(product.status || 'active').toLowerCase())) continue;
    const stock = Number(product.stock);
    const threshold = product.reorder_level !== null && product.reorder_level !== undefined && product.reorder_level !== '' && Number.isFinite(Number(product.reorder_level)) ? Number(product.reorder_level) : 10;
    if (!Number.isFinite(stock) || stock > Math.max(0, threshold)) continue;
    const out = stock <= 0;
    // Stable while in the same stock band; ordinary sales must not repeatedly chime.
    events.push({ id: `stock:${product.ROWID}:${out ? 'out' : 'low'}`, kind: 'stock', title: out ? 'Product out of stock' : 'Low stock', message: `${product.name || product.sku || 'Product'} · ${stock} remaining`, createdAt: new Date(now).toISOString(), href: '/inventory/products' });
  }
  return [...new Map(events.map(e => [e.id, e])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}
function notificationState(raw) {
  if (raw === null || raw === undefined || raw === '') return { read: {}, soundEnabled: true };
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification state');
  return { read: value.read && typeof value.read === 'object' && !Array.isArray(value.read) ? value.read : {}, soundEnabled: value.soundEnabled !== false };
}
function updateNotificationState(state, input, feed, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Notification update is required');
  if (input.soundEnabled !== undefined && typeof input.soundEnabled !== 'boolean') throw new Error('soundEnabled must be boolean');
  if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 100 || input.ids.some(id => typeof id !== 'string' || id.length > 240))) throw new Error('Invalid notification IDs');
  const valid = new Set(feed.map(e => e.id));
  const read = Object.fromEntries(Object.entries(state.read).filter(([id, at]) => valid.has(id) || Number(at) >= now - 30 * 86400000));
  for (const id of input.ids || []) if (valid.has(id)) read[id] = now;
  const entries = Object.entries(read).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 100);
  while (Buffer.byteLength(JSON.stringify(entries), 'utf8') > 8500) entries.pop();
  const bounded = Object.fromEntries(entries);
  return { read: bounded, soundEnabled: input.soundEnabled ?? state.soundEnabled };
}
module.exports = { notificationFeed, notificationState, updateNotificationState, KITCHEN, SERVICE, STOCK };
