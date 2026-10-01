import { useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import Breadcrumbs from '../components/layout/Breadcrumbs';
import {
  getStoredPanelCollapsed,
  getStoredWorkspace,
  hasPanel,
  resolveRoute,
  setStoredPanelCollapsed,
  setStoredWorkspace,
  trailForPath,
  visibleWorkspaces,
  homeOf,
  WORKSPACES,
  type Workspace,
} from '../components/layout/navigation';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { getCompanyProfile } from '../services/settingsService';
import { setCurrencyCode } from '../utils/format';
import '../styles/purchasing-design.css';

function fallbackWorkspace(role: string): Workspace {
  const stored = getStoredWorkspace();
  const list = visibleWorkspaces(role);
  return list.find((w) => w.id === stored) ?? list[0] ?? WORKSPACES[0];
}

function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => getStoredPanelCollapsed());
  const location = useLocation();
  const navigate = useNavigate();
  const { role, user, loading } = useAuth();

  const workspaces = useMemo(() => visibleWorkspaces(role), [role]);

  const activeKey = useMemo(() => {
    const h = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    return h === '' ? location.pathname : `${location.pathname}#${h}`;
  }, [location.pathname, location.hash]);

  const resolved = useMemo(
    () => resolveRoute(location.pathname, location.hash, role),
    [location.pathname, location.hash, role],
  );

  const activeWorkspace = resolved?.workspace ?? fallbackWorkspace(role);

  // Remember workspace selection (sticky state).
  useEffect(() => {
    if (resolved !== null) setStoredWorkspace(resolved.workspace.id);
  }, [resolved]);

  // Display currency follows store settings (single initialization point).
  useEffect(() => {
    getCompanyProfile()
      .then((co) => {
        if (co.currency) setCurrencyCode(String(co.currency));
      })
      .catch(() => undefined);
  }, []);

  // Close drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.hash]);

  // In-page anchor scrolling for section links (e.g. /reports#profit).
  useEffect(() => {
    if (location.hash === '') return;
    const id = location.hash.slice(1);
    // Wait a tick so the target view has rendered.
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [location.pathname, location.hash]);

  const togglePanel = () => {
    setPanelCollapsed((c) => {
      setStoredPanelCollapsed(!c);
      return !c;
    });
  };

  const selectWorkspace = (ws: Workspace) => {
    setStoredWorkspace(ws.id);
    // Zoho-style module switch: always reveal the context panel for the module.
    setPanelCollapsed(false);
    setStoredPanelCollapsed(false);
    navigate(homeOf(ws, role));
  };

  const crumbs = useMemo(
    () => trailForPath(location.pathname, location.hash, role),
    [location.pathname, location.hash, role],
  );

  const panelVisible = hasPanel(activeWorkspace, role) && !panelCollapsed;
  const appClass = `ch-app${panelCollapsed ? ' panel-collapsed' : ''}${panelVisible ? '' : ' no-panel'}`;

  if (loading) return <div className="ch-state">Checking access...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (workspaces.length === 0) return <div className="ch-state">Your account has no POS role. Ask an administrator to assign access.</div>;
  if (!resolved) return <Navigate to={homeOf(workspaces[0], role)} replace />;

  return (
    <div className={`${appClass} ch-headerless`}>
      <div className="ch-bg-decor" aria-hidden="true">
        <span className="b1" />
        <span className="b2" />
        <span className="b3" />
        <span className="b4" />
      </div>
      <Sidebar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        activeKey={activeKey}
        role={role}
        panelCollapsed={panelCollapsed}
        onTogglePanel={togglePanel}
        onSelectWorkspace={selectWorkspace}
        drawerOpen={drawerOpen}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCloseDrawer={() => setDrawerOpen(false)}
      />
      <div className="ch-main">
        <main className="ch-content workspace-design" style={{ '--workspace-label': `"${activeWorkspace.label.toUpperCase()}"` } as React.CSSProperties} key={`${location.pathname}:${role}`}>
          <Breadcrumbs items={crumbs} />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function MainLayout() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
