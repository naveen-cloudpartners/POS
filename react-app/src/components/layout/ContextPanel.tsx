import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, LayoutGrid } from 'lucide-react';
import { groupedChildren, homeOf, resolveRoute, splitHash, type Workspace } from './navigation';

interface ContextPanelProps {
  workspace: Workspace;
  role: string;
  /** Current location key: pathname + optional #hash. */
  activeKey: string;
  onToggle: () => void;
  onNavigate: () => void;
  /** All visible workspaces — shown as a switcher inside the mobile drawer. */
  switcher?: Array<Workspace>;
  activeWorkspaceId?: string;
  onSwitchWorkspace?: (ws: Workspace) => void;
}

function keyOf(to: string): string {
  const s = splitHash(to);
  return s.hash === '' ? s.path : `${s.path}#${s.hash}`;
}

/** Level 2 — 220px context-aware navigation panel. */
export default function ContextPanel({
  workspace,
  role,
  activeKey,
  onToggle,
  onNavigate,
  switcher,
  activeWorkspaceId,
  onSwitchWorkspace,
}: ContextPanelProps) {
  const groups = groupedChildren(workspace, role);
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  const Icon = workspace.icon;
  // Exact key match wins; bare/legacy paths fall back to the resolved child.
  // The className function below deliberately ignores NavLink's own
  // prefix/hash-blind matching — exactly one tab highlights, ever.
  const hashIdx = activeKey.indexOf('#');
  const resolvedId = resolveRoute(
    hashIdx < 0 ? activeKey : activeKey.slice(0, hashIdx),
    hashIdx < 0 ? '' : activeKey.slice(hashIdx),
    role,
  )?.child.id;

  return (
    <div className="ch-panel" aria-label={`${workspace.label} navigation`}>
      <div className="ch-panel-head">
        <span className="ch-panel-ic" aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="ch-panel-titles">
          <b>{workspace.label}</b>
          <span>{workspace.tagline}</span>
        </span>
        <button type="button" className="ch-collapse-btn" onClick={onToggle} aria-label="Collapse panel" title="Collapse panel">
          <ChevronsLeft size={15} />
        </button>
      </div>

      {switcher !== undefined && switcher.length > 1 && (
        <div className="ch-panel-switcher" role="navigation" aria-label="Switch workspace">
          {switcher.map((ws) => {
            const WIcon = ws.icon;
            const active = ws.id === activeWorkspaceId;
            return (
              <NavLink
                key={ws.id}
                to={homeOf(ws, role)}
                className={active ? 'ch-sw-btn active' : 'ch-sw-btn'}
                aria-label={ws.label}
                title={ws.label}
                onClick={() => {
                  onSwitchWorkspace?.(ws);
                  onNavigate();
                }}
              >
                <WIcon size={17} aria-hidden="true" />
              </NavLink>
            );
          })}
        </div>
      )}

      <nav className="ch-panel-nav">
        {groups.map((g, gi) => (
          <Fragment key={g.label ?? `all-${gi}`}>
            <div className="ch-panel-section">
              {g.label === null ? (
                <><LayoutGrid size={12} aria-hidden="true" /> {workspace.label} workspace</>
              ) : (
                g.label
              )}
            </div>
            {g.items.map((c) => {
              const exact = keyOf(c.to) === activeKey;
              const active = exact || (resolvedId === c.id && !g.items.some((i) => keyOf(i.to) === activeKey));
              return (
                <NavLink
                  key={c.id}
                  to={c.to}
                  onClick={onNavigate}
                  className={() => (active ? 'ch-panel-link active' : 'ch-panel-link')}
                  aria-current={active ? 'page' : 'false'}
                >
                  <span className="ch-panel-dot" aria-hidden="true" />
                  {c.label}
                </NavLink>
              );
            })}
          </Fragment>
        ))}
      </nav>

      <div className="ch-panel-foot">
        <span className="ch-cell-sub">{total} view{total === 1 ? '' : 's'} · {workspace.label}</span>
      </div>
    </div>
  );
}
