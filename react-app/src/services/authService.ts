import { fetchBackendSession } from './catalystAuth';

/* CloudHub POS — session + role helpers for the frontend shell.
   Catalyst session remains the single source of truth (no local auth). */

export type AppRole = 'Admin' | 'Manager' | 'Cashier' | 'Storekeeper' | 'Waiter' | 'Chef' | 'Kitchen' | '';

/** Resolve the signed-in user's POS role from the backend roster. */
export async function getCurrentRole(): Promise<AppRole> {
  try {
    const session = await fetchBackendSession();
    if (!session.authenticated) return '';
    return normalizeRole(session.role);
  } catch {
    return '';
  }
}

export function normalizeRole(raw: string): AppRole {
  const role = raw === 'master_admin' ? 'Admin' : raw;
  return ['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Waiter', 'Chef', 'Kitchen'].includes(role) ? role as AppRole : '';
}

export function can(permission: 'manage_products' | 'adjust_stock' | 'view_reports' | 'manage_users' | 'manage_settings' | 'sell' | 'kitchen_board', role: string): boolean {
  switch (permission) {
    case 'kitchen_board':
      return ['Admin', 'Kitchen', 'Chef'].includes(role);
    case 'sell':
      return ['Admin', 'Manager', 'Cashier', 'Waiter'].includes(role);
    case 'manage_products':
      return ['Admin', 'Manager'].includes(role);
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
