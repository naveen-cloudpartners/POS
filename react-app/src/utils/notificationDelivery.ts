import type { AppNotification } from '../services/notificationService';
// Initial snapshots establish a baseline; only later unseen/unread events alert.
export function newNotifications(events: AppNotification[], seen: Set<string>, baseline: boolean) {
  const fresh = baseline ? events.filter(event => !event.read && !seen.has(event.id)) : [];
  for (const event of events) seen.add(event.id);
  return fresh;
}
export function notificationSound(events: AppNotification[]) {
  return events.some(e => e.kind === 'kitchen_cancelled') ? 'warning' : events.some(e => e.kind === 'kitchen_new') ? 'new_order' : events.some(e => e.kind === 'kitchen_ready') ? 'ready' : 'warning';
}
