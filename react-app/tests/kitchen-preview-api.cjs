// Loopback-only fixtures for visual/workflow QA. Never connects to Catalyst.
const http = require('node:http');
const { kitchenTicket, transitionKitchen } = require('../../functions/pos_backend/kitchenWorkflow');
const { notificationFeed, notificationState, updateNotificationState } = require('../../functions/pos_backend/notificationFeed');
let alertState = notificationState(null);
const role = process.argv.find(arg => arg.startsWith('--role='))?.split('=')[1] || 'Kitchen';
const started = Date.now();
const tickets = [
  { number: 'KOT-20261002-001', orderId: '1001', station: 'kitchen', status: 'FIRED', prepStatus: 'QUEUED', roomNumber: '4', kitchenNotes: 'Nut allergy. No garnish.', items: [{ name: 'Grilled chicken with rice', sku: 'A', qty: 2 }, { name: 'Vegetable soup', sku: 'B', qty: 1 }], firedAt: new Date(started - 21 * 60000).toISOString() },
  { number: 'KOT-20261002-002', orderId: '1002', station: 'bar', status: 'FIRED', prepStatus: 'QUEUED', roomNumber: '7', items: [{ name: 'Fresh lime juice', sku: 'C', qty: 3 }], firedAt: new Date(started - 5 * 60000).toISOString() },
  { number: 'KOT-20261002-003', orderId: '1003', station: 'kitchen', status: 'ACKED', prepStatus: 'PREPARING', roomNumber: '2', items: [{ name: 'Chicken burger', sku: 'D', qty: 1 }], firedAt: new Date(started - 10 * 60000).toISOString() },
  { number: 'KOT-20261002-004', orderId: '1004', station: 'kitchen', status: 'DONE', prepStatus: 'READY', roomNumber: '8', items: [{ name: 'Seafood pasta', sku: 'E', qty: 2 }], firedAt: new Date(started - 14 * 60000).toISOString() },
];
for (let i = 5; i <= 20; i++) {
  const original = tickets[i % 4];
  tickets.push({ ...original, number: `KOT-20261002-${String(i).padStart(3, '0')}`, orderId: String(1000 + i), roomNumber: String(i), firedAt: new Date(started - 3 * 60000).toISOString() });
}
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5173');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.end('{}');
  const path = new URL(req.url, 'http://localhost').pathname.replace('/server/pos_backend/api', '');
  const json = (data, code = 200) => { res.writeHead(code); res.end(JSON.stringify(data)); };
  if (path === '/notifications' || path === '/notifications/state') {
    const feed = notificationFeed(role, tickets, []);
    if (req.method === 'PUT') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      alertState = updateNotificationState(alertState, JSON.parse(raw), feed);
    }
    return json({ success: true, audience: `fixture:preview:${role}`, soundEnabled: alertState.soundEnabled, data: feed.map(event => ({ ...event, read: !!alertState.read[event.id] })), generatedAt: new Date().toISOString() });
  }
  // Loopback-only arrival fixture, never used by the deployed client.
  if (path === '/preview/arrival' && req.method === 'POST') {
    const number = `KOT-PREVIEW-${tickets.length + 1}`;
    tickets.push({ ...tickets[0], number, orderId: String(1000 + tickets.length + 1), prepStatus: 'QUEUED', roomNumber: '12', firedAt: new Date().toISOString(), prepUpdatedAt: undefined, prepHistory: undefined });
    return json({ success: true, number });
  }
  if (/\/items\/\d+\/image$/.test(path) && path.startsWith('/kitchen/tickets/')) {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#fff0d9"/><text x="50" y="67" text-anchor="middle" font-size="55">🍲</text></svg>');
  }
  if (path === '/settings/company/logo') {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.end(require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/muster.svg')));
  }
  if (path === '/profile/me/photo') {
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="50" fill="#efcde6"/><text x="50" y="68" text-anchor="middle" font-family="sans-serif" font-size="55" fill="#81316a">K</text></svg>');
  }
  if (path === '/auth/me') return json({ authenticated: true, role, user: { email: 'kitchen@example.test', name: 'Kitchen preview', user_id: 'preview', avatar_version: 'fixture' } });
  if (path === '/profile/me') return json({ success: true, profile: { name: 'Kitchen preview', role } });
  if (path === '/settings/company') return json({ success: true, company: { name: 'Muster Restaurant', currency: 'LKR', logo_file_id: 'fixture' } });
  if (path === '/settings/tax') return json({ success: true, tax: { enabled: false, mode: 'exclusive', round: true, name: 'Tax', default_rate: 0, profiles: [] } });
  if (path === '/kitchen/tickets') return json({ success: true, data: tickets.map(kitchenTicket), hasMore: false, generatedAt: new Date().toISOString() });
  if (req.method === 'POST' && /^\/kitchen\/tickets\/[^/]+\/status$/.test(path)) {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const index = tickets.findIndex(ticket => ticket.number === path.split('/')[3]);
    if (index < 0) return json({ error: 'Missing ticket' }, 404);
    const changed = transitionKitchen(tickets[index], body.expected, body.status, 'preview');
    if (changed.error) return json({ error: changed.error }, changed.code);
    tickets[index] = changed.entry;
    return json({ success: true, ticket: kitchenTicket(changed.entry) });
  }
  if (req.method !== 'GET') return json({ error: 'Fixture route unavailable' }, 405);
  return json({ success: true, data: [], settings: {} });
}).listen(3000, '127.0.0.1', () => console.log(`Kitchen fixture on 3000 (${role})`));
