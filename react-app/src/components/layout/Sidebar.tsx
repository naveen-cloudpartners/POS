import { useEffect } from 'react';
import PrimaryRail from './PrimaryRail';
import ContextPanel from './ContextPanel';
import { hasPanel, type Workspace } from './navigation';

interface EnterpriseSidebarProps {
  workspaces: Array<Workspace>;
  activeWorkspace: Workspace;
  /** pathname + optional #hash of the current location. */
  activeKey: string;
  role: string;
  panelCollapsed: boolean;
  onTogglePanel: () => void;
  onSelectWorkspace: (ws: Workspace) => void;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

/**
 * Enterprise sidebar system — Level 1 icon rail + Level 2 context panel.
 * Desktop: fixed rail + panel. Tablet/mobile: drawer overlay.
 */
export default function Sidebar({
  workspaces,
  activeWorkspace,
  activeKey,
  role,
  panelCollapsed,
  onTogglePanel,
  onSelectWorkspace,
  drawerOpen,
  onCloseDrawer,
}: EnterpriseSidebarProps) {
  // Single-section modules hide the secondary panel (see navigation.hasPanel).
  const showPanel = hasPanel(activeWorkspace, role) && !panelCollapsed;

  // Escape closes the drawer; inert keeps hidden drawer links out of tab order.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, onCloseDrawer]);
  return (
    <>
      <div className={panelCollapsed ? 'ch-side collapsed' : 'ch-side'}>
        <PrimaryRail
          workspaces={workspaces}
          activeId={activeWorkspace.id}
          role={role}
          onSelect={onSelectWorkspace}
          onCollapsePanel={onTogglePanel}
          panelCollapsed={panelCollapsed}
        />
        {!showPanel ? null : (
          <ContextPanel
            key={activeWorkspace.id}
            workspace={activeWorkspace}
            role={role}
            activeKey={activeKey}
            onToggle={onTogglePanel}
            onNavigate={() => undefined}
          />
        )}
      </div>

      {drawerOpen && (
        <button type="button" className="ch-scrim" aria-label="Close navigation" onClick={onCloseDrawer} />
      )}
      <div className={drawerOpen ? 'ch-drawer-nav open' : 'ch-drawer-nav'} aria-hidden={!drawerOpen} inert={!drawerOpen}>
        <ContextPanel
          key={`drawer-${activeWorkspace.id}`}
          workspace={activeWorkspace}
          role={role}
          activeKey={activeKey}
          onToggle={onCloseDrawer}
          onNavigate={onCloseDrawer}
          switcher={workspaces}
          activeWorkspaceId={activeWorkspace.id}
          onSwitchWorkspace={onSelectWorkspace}
        />
      </div>
    </>
  );
}
