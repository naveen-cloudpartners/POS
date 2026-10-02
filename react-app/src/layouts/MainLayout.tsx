import { useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import { Menu } from 'lucide-react';
import Breadcrumbs from '../components/layout/Breadcrumbs';
import { resolveRoute, setStoredWorkspace, trailForPath, visibleWorkspaces, homeOf, hasPanel, getStoredPanelCollapsed, setStoredPanelCollapsed } from '../components/layout/navigation';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { NotificationProvider } from '../context/NotificationContext';
import { NotificationToast } from '../components/layout/NotificationBell';
import { getCompanyProfile } from '../services/settingsService';
import { setCurrencyCode } from '../utils/format';
import '../styles/purchasing-design.css';
function Shell() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(getStoredPanelCollapsed);
  const togglePanel = () => setPanelCollapsed((value) => { setStoredPanelCollapsed(!value); return !value; });
  const location = useLocation();
  const { role, user, loading } = useAuth();
  const workspaces = useMemo(() => visibleWorkspaces(role), [role]);
  const resolved = useMemo(() => resolveRoute(location.pathname, location.hash, role), [location.pathname, location.hash, role]);
  const crumbs = useMemo(() => trailForPath(location.pathname, location.hash, role), [location.pathname, location.hash, role]);
  useEffect(() => { if (resolved) setStoredWorkspace(resolved.workspace.id); }, [resolved]);
  useEffect(() => { getCompanyProfile().then((company) => { if (company.currency) setCurrencyCode(String(company.currency)); }).catch(() => undefined); }, []);
  useEffect(() => { setDrawerOpen(false); }, [location.pathname, location.hash]);
  useEffect(() => {
    if (!location.hash) return;
    const timer = window.setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    return () => window.clearTimeout(timer);
  }, [location.pathname, location.hash]);
  if (loading) return <div className="ch-state">Checking access…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!workspaces.length) return <div className="ch-state">Your account has no POS role. Ask an administrator to assign access.</div>;
  if (!resolved) return <Navigate to={homeOf(workspaces[0], role)} replace />;
  return <div className={`ch-app muster-reference-app muster-previous-nav${panelCollapsed ? " panel-collapsed" : ""}${hasPanel(resolved.workspace, role) && !panelCollapsed ? "" : " no-panel"}`}>
    <a className="muster-skip-link" href="#workspace-content" onClick={(event) => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }}>Skip to main content</a>
    <Sidebar workspaces={workspaces} activeWorkspace={resolved.workspace} activeKey={`${location.pathname}${location.hash}`} role={role} panelCollapsed={panelCollapsed} onTogglePanel={togglePanel} onSelectWorkspace={() => { setPanelCollapsed(false); setStoredPanelCollapsed(false); }} drawerOpen={drawerOpen} onOpenDrawer={() => setDrawerOpen(true)} onCloseDrawer={() => setDrawerOpen(false)} />
    <NotificationToast />
    <div className="ch-main" inert={drawerOpen}>
      <button type="button" className="muster-mobile-nav-toggle" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu size={22} /></button>
      <main id="workspace-content" tabIndex={-1} className="ch-content workspace-design" key={`${location.pathname}:${role}`}><Breadcrumbs items={crumbs} /><Outlet /></main>
    </div>
  </div>;
}
export default function MainLayout() { return <AuthProvider><NotificationProvider><Shell /></NotificationProvider></AuthProvider>; }
