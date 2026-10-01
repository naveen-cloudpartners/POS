import type { CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { Cloud } from 'lucide-react';
import SidebarActions from './SidebarActions';
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
      <div className="ch-rail-top">
      <button
        type="button"
        className="ch-rail-logo"
        data-tip={panelCollapsed ? 'Muster POS · Expand panel' : 'Muster POS · Collapse panel'}
        aria-label={panelCollapsed ? 'Expand context panel' : 'Collapse context panel'}
        onClick={onCollapsePanel}
      >
        <Cloud size={26} strokeWidth={2} aria-hidden="true" />
      </button>
      </div>
      <div className="ch-rail-items" style={{ '--rail-count': workspaces.filter((ws) => ws.id !== 'settings').length } as CSSProperties}>
        {workspaces.filter((ws) => ws.id !== 'settings').map((ws) => {
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
      <div className="ch-rail-footer">

      <SidebarActions settingsControl={workspaces.filter((ws) => ws.id === 'settings').map((ws) => {
        const Icon = ws.icon;
        return (
          <NavLink key={ws.id} to={homeOf(ws, role)} aria-label={ws.label}
            data-tip={ws.label} className={activeId === ws.id ? 'ch-rail-btn active' : 'ch-rail-btn'}
            onClick={() => onSelect(ws)}>
            <Icon size={21} aria-hidden="true" />
          </NavLink>
        );
      })} />
      </div>
    </div>
  );
}
