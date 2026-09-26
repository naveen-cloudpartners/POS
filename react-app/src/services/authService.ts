import { fetchBackendSession } from './catalystAuth';
import { getUsers } from './userService';

/* CloudHub POS — session + role helpers for the frontend shell.
   Catalyst session remains the single source of truth (no local auth). */

export type AppRole = 'Admin' | 'Manager' | 'Cashier' | 'Storekeeper' | 'Waiter' | 'Chef' | '';

/** Resolve the signed-in user's POS role from the backend roster. */
export async function getCurrentRole(): Promise<AppRole> {
  try {
    const session = await fetchBackendSession();
    if (!session.authenticated) return '';
    const users = await getUsers();
    const me = users.find((u) => u.email.toLowerCase() === session.email.toLowerCase());
    const raw = (me?.role ?? 'Admin').trim();
    if (raw === 'master_admin') return 'Admin';
    return raw as AppRole;
  } catch {
    return '';
  }
}

export function can(permission: 'manage_products' | 'adjust_stock' | 'view_reports' | 'manage_users' | 'manage_settings' | 'sell', role: string): boolean {
  switch (permission) {
    case 'sell':
      return ['Admin', 'Manager', 'Cashier', 'Waiter'].includes(role);
    case 'manage_products':
    case 'adjust_stock':
      return ['Admin', 'Manager', 'Storekeeper'].includes(role);
    case 'view_reports':
      return ['Admin', 'Manager'].includes(role);
    case 'manage_users':
      return ['Admin', 'Manager'].includes(role);
    case 'manage_settings':
      return role === 'Admin';
    default:
      return false;
  }
}
