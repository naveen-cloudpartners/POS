import { Link, NavLink } from 'react-router-dom';
import { ChevronsLeft, Cloud } from 'lucide-react';
import { homeOf, type Workspace } from './navigation';

interface PrimaryRailProps {
  workspaces: Array<Workspace>;
  activeId: string;
  role: string;
  onSelect: (ws: Workspace) => void;
  onCollapsePanel: () => void;
  panelCollapsed: boolean;
}

/**
 * Level 1 — 70px Zoho-style primary navigation rail.
 * Dark, fixed, icon + micro-label, glow active indicator, tooltips.
 */
export default function PrimaryRail({ workspaces, activeId, role, onSelect, onCollapsePanel, panelCollapsed }: PrimaryRailProps) {
  return (
    <div className="ch-rail" role="navigation" aria-label="Workspaces">
      <Link to="/dashboard" className="ch-rail-logo" data-tip="CloudHub POS" aria-label="CloudHub POS home">
        <Cloud size={26} strokeWidth={2} aria-hidden="true" />
      </Link>
      <div className="ch-rail-items">
        {workspaces.map((ws) => {
          const Icon = ws.icon;
          const active = ws.id === activeId;
          return (
            <NavLink
              key={ws.id}
              to={homeOf(ws, role)}
              data-tip={ws.label}
              aria-label={ws.label}
              aria-current={active ? 'page' : 'false'}
              className={() => (active ? 'ch-rail-btn active' : 'ch-rail-btn')}
              onClick={() => onSelect(ws)}
            >
              <Icon size={21} strokeWidth={2.1} aria-hidden="true" />
              <span className="ch-rail-lbl" aria-hidden="true">{ws.label}</span>
            </NavLink>
          );
        })}
      </div>
      <button
        type="button"
        className="ch-rail-btn ch-rail-collapse"
        data-tip={panelCollapsed ? 'Expand panel' : 'Collapse panel'}
        aria-label={panelCollapsed ? 'Expand context panel' : 'Collapse context panel'}
        onClick={onCollapsePanel}
      >
        <ChevronsLeft size={18} aria-hidden="true" className={panelCollapsed ? 'flipped' : undefined} />
      </button>
    </div>
  );
}
