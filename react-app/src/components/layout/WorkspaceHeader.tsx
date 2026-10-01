import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Search, X } from 'lucide-react';
import { visibleChildren, type Workspace } from './navigation';
import SidebarActions from './SidebarActions';
interface Props { workspaces: Workspace[]; role: string; label: string; drawerOpen: boolean; onOpenDrawer: () => void }
export default function WorkspaceHeader({ workspaces, role, label, drawerOpen, onOpenDrawer }: Props) {
  const [search, setSearch] = useState('');
  const matches = search.trim() ? workspaces.flatMap((workspace) => visibleChildren(workspace, role).map((item) => ({ ...item, workspace: workspace.label }))).filter((item) => `${item.workspace} ${item.label}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8) : [];
  return <header className="muster-workspace-header">
    <button className="muster-menu-button" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={onOpenDrawer}><Menu size={22} /></button>
    <div className="muster-header-search"><Search size={17} /><input aria-label="Find a workspace page" placeholder="Find a page…" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="Clear page search" onClick={() => setSearch('')}><X size={16} /></button>}
      {search.trim() && <div className="muster-search-results">{matches.length ? matches.map((item) => <Link key={item.id} to={item.to} onClick={() => setSearch('')}><span>{item.label}</span><small>{item.workspace}</small></Link>) : <p>No matching pages</p>}</div>}
    </div>
    <span className="muster-header-label">{label}</span><SidebarActions />
  </header>;
}
