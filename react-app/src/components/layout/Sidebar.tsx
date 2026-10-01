import { useEffect, useRef } from 'react';
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
  onOpenDrawer: () => void;
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
  onOpenDrawer,
}: EnterpriseSidebarProps) {
  // Single-section modules hide the secondary panel (see navigation.hasPanel).
  const showPanel = hasPanel(activeWorkspace, role) && !panelCollapsed;

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onCloseDrawer);
  closeRef.current = onCloseDrawer;

  // Escape closes the drawer; inert keeps hidden drawer links out of tab order.
  useEffect(() => {
    if (!drawerOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(drawerRef.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? []).filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => controls()[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const items = controls(); const first = items[0]; const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); cancelAnimationFrame(frame); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [drawerOpen]);
  return (
    <>
      <div className={panelCollapsed ? 'ch-side collapsed' : 'ch-side'}>
        <PrimaryRail
          workspaces={workspaces}
          activeId={activeWorkspace.id}
          role={role}
          onSelect={onSelectWorkspace}
          onCollapsePanel={() => {
            if (window.matchMedia('(max-width: 1024px)').matches) onOpenDrawer();
            else onTogglePanel();
          }}
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
      <div ref={drawerRef} role="dialog" aria-modal={drawerOpen || undefined} aria-label="Navigation" className={drawerOpen ? 'ch-drawer-nav open' : 'ch-drawer-nav'} aria-hidden={!drawerOpen} inert={!drawerOpen}>
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
