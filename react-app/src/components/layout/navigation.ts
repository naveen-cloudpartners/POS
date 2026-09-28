import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Boxes,
  Users,
  ClipboardList,
  BarChart3,
  ShieldCheck,
  Settings,
} from 'lucide-react';

/* CloudHub POS — Enterprise workspace navigation model.
   IA-only (routes/labels/roles). No visual copy of any third-party product.
   Pattern: primary icon rail → context panel → workspace. */

export interface NavChild {
  id: string;
  label: string;
  /** Canonical workspace path (may include #anchor for in-page sections). */
  to: string;
  /** Legacy / alternate paths that resolve to the same view. */
  aliases?: Array<string>;
  roles: Array<string>;
}

export interface Workspace {
  id: string;
  label: string;
  tagline: string;
  icon: typeof LayoutDashboard;
  roles: Array<string>;
  children: Array<NavChild>;
  /** Optional level-2 grouping (section header → child ids). */
  sections?: Array<NavSection>;
}

export interface NavSection {
  label: string;
  childIds: Array<string>;
}

const STAFF = ['Admin', 'Manager', 'Storekeeper'];
const SELLERS = ['Admin', 'Manager', 'Cashier', 'Waiter'];
const MANAGERS = ['Admin', 'Manager'];
const FRONT = ['Admin', 'Manager', 'Cashier'];

/* Primary order follows the SRS module order:
   DASH → POS → PROD → INV → CUST → ORD → RPT → USR → SET.
   Routes, roles and view components are untouched — only workspace
   grouping, order and nav labels changed. */
export const WORKSPACES: Array<Workspace> = [
  {
    // DASH-08: Admin/Manager-only. Cashiers, Storekeepers and floor roles
    // are redirected away by the Dashboard page guard below.
    id: 'dashboard',
    label: 'Dashboard',
    tagline: 'Business overview',
    icon: LayoutDashboard,
    roles: MANAGERS,
    children: [{ id: 'dash-overview', label: 'Business Overview', to: '/dashboard', roles: MANAGERS }],
  },
  {
    id: 'pos',
    label: 'POS',
    tagline: 'Counter terminal & payments',
    icon: ShoppingCart,
    roles: SELLERS,
    children: [
      { id: 'pos-terminal', label: 'POS Terminal', to: '/sales/pos', aliases: ['/pos'], roles: SELLERS },
      { id: 'pos-kitchen', label: 'Kitchen', to: '/sales/kitchen', roles: [...SELLERS, 'Storekeeper', 'Chef'] },
      { id: 'pos-payments', label: 'Payments', to: '/sales/payments', roles: FRONT },
      { id: 'pos-invoices', label: 'Invoices', to: '/sales/invoices', roles: FRONT },
      { id: 'pos-returns', label: 'Returns', to: '/sales/returns', roles: FRONT },
    ],
  },
  {
    id: 'products',
    label: 'Products',
    tagline: 'Catalog & categories',
    icon: Package,
    roles: STAFF,
    children: [
      { id: 'prod-products', label: 'Products', to: '/inventory/products', aliases: ['/products'], roles: STAFF },
      { id: 'prod-categories', label: 'Categories', to: '/inventory/categories', roles: STAFF },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    tagline: 'Stock & warehouses',
    icon: Boxes,
    roles: STAFF,
    children: [
      { id: 'inv-stock', label: 'Stock', to: '/inventory', roles: STAFF },
      { id: 'inv-warehouses', label: 'Warehouses', to: '/inventory/warehouses', roles: STAFF },
      { id: 'inv-transfers', label: 'Transfers', to: '/inventory/transfers', aliases: ['/inventory/warehouses#transfers'], roles: STAFF },
      { id: 'inv-adjust', label: 'Adjustments', to: '/inventory/adjustments', roles: STAFF },
      { id: 'inv-movements', label: 'Movements', to: '/inventory/movements', roles: STAFF },
    ],
  },
  {
    id: 'customers',
    label: 'Customers',
    tagline: 'Relationships & value',
    icon: Users,
    roles: FRONT,
    children: [
      { id: 'cust-all', label: 'Customers', to: '/customers', roles: FRONT },
      { id: 'cust-loyalty', label: 'Loyalty', to: '/customers/loyalty', roles: FRONT },
      { id: 'cust-rewards', label: 'Rewards', to: '/customers/rewards', roles: FRONT },
    ],
  },
  {
    id: 'orders',
    label: 'Orders',
    tagline: 'History & tracking',
    icon: ClipboardList,
    roles: [...SELLERS, 'Storekeeper'],
    children: [
      { id: 'ord-orders', label: 'Orders', to: '/sales/orders', aliases: ['/orders'], roles: [...SELLERS, 'Storekeeper'] },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    tagline: 'Analytics & registers',
    icon: BarChart3,
    roles: MANAGERS,
    children: [
      { id: 'rep-revenue', label: 'Revenue', to: '/reports#revenue', aliases: ['/reports'], roles: MANAGERS },
      { id: 'rep-inventory', label: 'Inventory', to: '/reports#inventory', roles: MANAGERS },
      { id: 'rep-customer', label: 'Customers', to: '/reports#customers', roles: MANAGERS },
      { id: 'rep-profit', label: 'Profit', to: '/reports#profit', roles: MANAGERS },
      { id: 'rep-register', label: 'Register Reports', to: '/reports#register', roles: MANAGERS },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    tagline: 'Team & audit',
    icon: ShieldCheck,
    roles: MANAGERS,
    children: [
      { id: 'adm-users', label: 'Users', to: '/admin/users', aliases: ['/users'], roles: MANAGERS },
      { id: 'adm-roles', label: 'Roles', to: '/admin/roles', roles: MANAGERS },
      { id: 'adm-activity', label: 'Activity', to: '/admin/activity', roles: MANAGERS },
      { id: 'adm-audit', label: 'Audit', to: '/admin/audit', roles: MANAGERS },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    tagline: 'Store configuration',
    icon: Settings,
    roles: ['Admin'],
    children: [
      { id: 'set-general', label: 'General', to: '/settings#general', aliases: ['/settings'], roles: ['Admin'] },
      { id: 'set-inventory', label: 'Inventory', to: '/settings#inventory', roles: ['Admin'] },
      { id: 'set-loyalty', label: 'Loyalty', to: '/settings#loyalty', roles: ['Admin'] },
      { id: 'set-reporting', label: 'Reporting', to: '/settings#reporting', roles: ['Admin'] },
      { id: 'set-admin', label: 'Administration', to: '/settings#administration', roles: ['Admin'] },
      { id: 'set-taxes', label: 'Taxes', to: '/settings#taxes', roles: ['Admin'] },
      { id: 'set-notify', label: 'Notifications', to: '/settings#notifications', roles: ['Admin'] },
      { id: 'set-integrations', label: 'Integrations', to: '/settings#integrations', roles: ['Admin'] },
      { id: 'set-payments', label: 'Payments', to: '/settings#payments', roles: ['Admin'] },
      { id: 'set-printers', label: 'Printers', to: '/settings#printers', roles: ['Admin'] },
      { id: 'set-automation', label: 'Automation', to: '/settings/automation', roles: ['Admin'] },
    ],
    sections: [
      { label: 'Business Settings', childIds: ['set-general', 'set-taxes'] },
      { label: 'Store Operations', childIds: ['set-inventory', 'set-loyalty', 'set-reporting', 'set-admin'] },
      { label: 'Store Configuration', childIds: ['set-notify', 'set-integrations', 'set-payments', 'set-printers', 'set-automation'] },
    ],
  },
];

export function splitHash(to: string): { path: string; hash: string } {
  const i = to.indexOf('#');
  if (i < 0) return { path: to, hash: '' };
  return { path: to.slice(0, i), hash: to.slice(i + 1) };
}

export interface ResolvedRoute {
  workspace: Workspace;
  child: NavChild;
}

function pathMatches(child: NavChild, pathname: string): boolean {
  if (splitHash(child.to).path === pathname) return true;
  return (child.aliases ?? []).some((a) => splitHash(a).path === pathname);
}

/** Resolve a pathname (+ optional hash) to its workspace + child. */
export function resolveRoute(pathname: string, hash: string, role: string): ResolvedRoute | null {
  const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
  // Prefer exact hash match (e.g. /reports#profit beats bare /reports alias).
  if (cleanHash !== '') {
    for (const ws of WORKSPACES) {
      for (const c of ws.children) {
        const s = splitHash(c.to);
        if (s.path === pathname && s.hash === cleanHash && (role === '' || c.roles.includes(role))) {
          return { workspace: ws, child: c };
        }
      }
    }
  }
  for (const ws of WORKSPACES) {
    for (const c of ws.children) {
      if (pathMatches(c, pathname) && (role === '' || c.roles.includes(role))) {
        return { workspace: ws, child: c };
      }
    }
  }
  return null;
}

export function visibleWorkspaces(role: string): Array<Workspace> {
  return WORKSPACES.filter((ws) => {
    if (role !== '' && !ws.roles.includes(role)) return false;
    return ws.children.some((c) => role === '' || c.roles.includes(role));
  });
}

export function homeOf(ws: Workspace, role: string): string {
  return ws.children.find((c) => role === '' || c.roles.includes(role))?.to ?? '/dashboard';
}

/** Role-visible children of a workspace (the true level-2 module nav). */
export function visibleChildren(ws: Workspace, role: string): Array<NavChild> {
  return ws.children.filter((c) => role === '' || c.roles.includes(role));
}

/**
 * Single-section modules (e.g. Dashboard → Overview only) hide the
 * secondary panel — a lone item wastes 220px and breaks the Zoho rhythm.
 */
export function hasPanel(ws: Workspace, role: string): boolean {
  return visibleChildren(ws, role).length > 1;
}

export interface ChildGroup {
  /** Section header, or null for ungrouped workspaces. */
  label: string | null;
  items: Array<NavChild>;
}

/** Level-2 items folded into their workspace sections (role-filtered). */
export function groupedChildren(ws: Workspace, role: string): Array<ChildGroup> {
  const vis = visibleChildren(ws, role);
  if (ws.sections === undefined || ws.sections.length === 0) {
    return [{ label: null, items: vis }];
  }
  const byId = new Map(vis.map((c) => [c.id, c]));
  const groups: Array<ChildGroup> = [];
  const used = new Set<string>();
  for (const s of ws.sections) {
    const items: Array<NavChild> = [];
    for (const id of s.childIds) {
      const c = byId.get(id);
      if (c !== undefined) {
        items.push(c);
        used.add(id);
      }
    }
    if (items.length > 0) groups.push({ label: s.label, items });
  }
  const rest = vis.filter((c) => !used.has(c.id));
  if (rest.length > 0) groups.push({ label: null, items: rest });
  return groups;
}

export interface Crumb {
  label: string;
  to?: string;
}

/** Enterprise trail: Dashboard › Module › Page (hash children included). */
export function trailForPath(pathname: string, hash: string, role: string): Array<Crumb> {
  const r = resolveRoute(pathname, hash, role);
  if (r === null) return [{ label: 'Dashboard', to: '/dashboard' }];
  if (r.workspace.id === 'dashboard') return [{ label: 'Dashboard' }];
  return [
    { label: 'Dashboard', to: '/dashboard' },
    { label: r.workspace.label, to: homeOf(r.workspace, role) },
    { label: r.child.label },
  ];
}

/* ---- Sticky UI state (localStorage) ---- */

const WS_KEY = 'ch-workspace';
const PANEL_KEY = 'ch-panel-collapsed';

export function getStoredWorkspace(): string {
  try {
    return window.localStorage.getItem(WS_KEY) ?? 'dashboard';
  } catch {
    return 'dashboard';
  }
}

export function setStoredWorkspace(id: string): void {
  try {
    window.localStorage.setItem(WS_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getStoredPanelCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PANEL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setStoredPanelCollapsed(v: boolean): void {
  try {
    window.localStorage.setItem(PANEL_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}
