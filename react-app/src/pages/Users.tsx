import { useEffect, useMemo, useState } from 'react';
import { UserPlus, Pencil, Trash2, KeyRound, UserCheck, UserX } from 'lucide-react';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import SearchBar from '../components/ui/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../context/AuthContext';
import {
  activateUser,
  changeUserRole,
  createAdminUser,
  deactivateUser,
  deleteAdminUser,
  getAdminUsers,
  getUsers,
  inviteUser,
  removeUser,
  resetUserPassword,
  updateAdminUser,
  updateUserRole,
} from '../services/userService';
import { ApiError } from '../services/api';
import { formatDate, initials, number } from '../utils/format';
import type { PosUser } from '../types';
import './Users.css';

const ROLES = ['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Waiter', 'Chef'];

function displayRole(role: string): string {
  return role === 'master_admin' ? 'Admin' : role;
}

function isActive(u: PosUser): boolean {
  return String(u.status ?? 'active').toLowerCase() !== 'inactive';
}

export default function Users() {
  const { role, email: myEmail } = useAuth();
  const [users, setUsers] = useState<Array<PosUser>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('Cashier');
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteNotes, setInviteNotes] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');

  const [roleTarget, setRoleTarget] = useState<PosUser | null>(null);
  const [roleValue, setRoleValue] = useState('Cashier');
  const [roleBusy, setRoleBusy] = useState(false);

  const [editTarget, setEditTarget] = useState<PosUser | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', notes: '' });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<PosUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<{ user: PosUser; to: 'active' | 'inactive' } | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<PosUser | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const effectiveRole = role === '' ? 'Admin' : role;
  const isAdmin = effectiveRole === 'Admin';
  const isManager = effectiveRole === 'Manager';
  const canManage = isAdmin || isManager;

  const load = () => {
    setLoading(true);
    setError('');
    // Admin API carries lifecycle state; fall back to the legacy roster
    // on backends that predate it.
    getAdminUsers()
      .catch((e: unknown) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 503)) return getUsers();
        throw e;
      })
      .then(setUsers)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && displayRole(u.role) !== roleFilter) return false;
      if (statusFilter !== 'all') {
        const active = isActive(u);
        if (statusFilter === 'active' && !active) return false;
        if (statusFilter === 'inactive' && active) return false;
      }
      if (q === '') return true;
      return (
        u.email.toLowerCase().includes(q) ||
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.phone ?? '').toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const counts = useMemo(() => {
    const active = users.filter(isActive).length;
    const admins = users.filter((u) => displayRole(u.role) === 'Admin' && isActive(u)).length;
    return { total: users.length, active, inactive: users.length - active, admins };
  }, [users]);

  const lastLoginOf = (u: PosUser): string => {
    if (u.last_login) return formatDate(u.last_login);
    if (u.verified_at !== undefined && u.verified_at !== null) {
      const t = new Date(Number(u.verified_at));
      return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString();
    }
    return '—';
  };

  /* ---- invite (USR-01): admin API with legacy fallback ---- */

  const submitInvite = () => {
    if (inviteEmail.trim() === '') {
      setInviteMsg('Email is required.');
      return;
    }
    setInviteBusy(true);
    setInviteMsg('');
    createAdminUser({
      name: inviteName.trim(),
      email: inviteEmail.trim(),
      role: inviteRole,
      phone: invitePhone.trim(),
      notes: inviteNotes.trim(),
    })
      .then((res) => {
        setNotice(res.message ?? 'User invited.');
        setInviteOpen(false);
        setInviteEmail('');
        setInviteName('');
        setInvitePhone('');
        setInviteNotes('');
        load();
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) {
          // Backend predates the admin API — legacy invite path.
          inviteUser(inviteEmail.trim(), inviteRole, inviteName.trim())
            .then((res) => {
              if (res.ok) {
                setNotice(res.message);
                setInviteOpen(false);
                setInviteEmail('');
                setInviteName('');
                load();
              } else {
                setInviteMsg(res.message);
              }
            })
            .finally(() => setInviteBusy(false));
          return;
        }
        setInviteMsg(e instanceof Error ? e.message : 'Invite failed');
      })
      .finally(() => {
        // Legacy branch manages its own busy flag; this is a safe no-op then.
        setInviteBusy(false);
      });
  };

  /* ---- role change (Admin full; Manager limited server-side) ---- */

  const submitRole = () => {
    if (roleTarget === null) return;
    setRoleBusy(true);
    changeUserRole(roleTarget.email, roleValue)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) {
          return updateUserRole(roleTarget.email, roleValue).then(() => null);
        }
        throw e;
      })
      .then(() => {
        setNotice(`Role updated to ${roleValue}.`);
        setRoleTarget(null);
        load();
      })
      .catch((e: unknown) => {
        setNotice('');
        setError(e instanceof Error ? e.message : 'Role update failed');
        setRoleTarget(null);
      })
      .finally(() => setRoleBusy(false));
  };

  /* ---- profile edit ---- */

  const openEdit = (u: PosUser) => {
    setEditTarget(u);
    setEditForm({ name: u.name ?? '', phone: u.phone ?? '', notes: u.notes ?? '' });
    setEditError('');
  };

  const submitEdit = () => {
    if (editTarget === null) return;
    if (editForm.name.trim() === '') {
      setEditError('Name cannot be empty.');
      return;
    }
    setEditBusy(true);
    setEditError('');
    updateAdminUser(editTarget.email, {
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      notes: editForm.notes.trim(),
    })
      .then(() => {
        setNotice('User updated.');
        setEditTarget(null);
        load();
      })
      .catch((e: unknown) => setEditError(e instanceof Error ? e.message : 'Update failed'))
      .finally(() => setEditBusy(false));
  };

  /* ---- activate / deactivate (USR-04, Admin only) ---- */

  const confirmToggle = () => {
    if (toggleTarget === null) return;
    setToggleBusy(true);
    const fn = toggleTarget.to === 'active' ? activateUser : deactivateUser;
    fn(toggleTarget.user.email)
      .then(() => {
        setNotice(`User ${toggleTarget.to === 'active' ? 'activated' : 'deactivated'}.`);
        setToggleTarget(null);
        load();
      })
      .catch((e: unknown) => {
        setNotice('');
        setError(e instanceof Error ? e.message : 'Status change failed');
        setToggleTarget(null);
      })
      .finally(() => setToggleBusy(false));
  };

  /* ---- delete (Admin only, guarded server-side) ---- */

  const confirmDelete = () => {
    if (deleteTarget === null) return;
    setDeleteBusy(true);
    deleteAdminUser(deleteTarget.email)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) {
          return removeUser(deleteTarget.email);
        }
        throw e;
      })
      .then((res) => {
        setNotice(res.message ?? 'User removed.');
        setDeleteTarget(null);
        load();
      })
      .catch((e: unknown) => {
        setNotice('');
        setError(e instanceof Error ? e.message : 'Remove failed');
        setDeleteTarget(null);
      })
      .finally(() => setDeleteBusy(false));
  };

  /* ---- password reset (Admin only) ---- */

  const confirmReset = () => {
    if (resetTarget === null) return;
    setResetBusy(true);
    resetUserPassword(resetTarget.email)
      .then((res) => {
        setNotice(res.message ?? 'Reset processed.');
        setResetTarget(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Reset failed');
        setResetTarget(null);
      })
      .finally(() => setResetBusy(false));
  };

  if (loading) return <Loader message="Loading users…" skeleton="page" />;
  if (error !== '' && users.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="ch-page-head">
        <div>
          <h1 className="ch-page-title">Users</h1>
          <p className="ch-page-sub">
            {number(counts.total)} members · {number(counts.active)} active · {number(counts.admins)} admins.
          </p>
        </div>
        <div className="ch-page-actions">
          {isAdmin && (
            <button type="button" className="ch-btn ch-btn-primary" onClick={() => { setInviteMsg(''); setInviteOpen(true); }}>
              <UserPlus size={15} /> Invite user
            </button>
          )}
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <Card>
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search name, email or phone…" ariaLabel="Search users" />
          <FilterBar
            filters={[
              {
                key: 'role', value: roleFilter, ariaLabel: 'Filter by role', onChange: setRoleFilter,
                options: [{ value: 'all', label: 'All roles' }, ...ROLES.map((r) => ({ value: r, label: r }))],
              },
              {
                key: 'status', value: statusFilter, ariaLabel: 'Filter by status', onChange: setStatusFilter,
                options: [
                  { value: 'all', label: 'Any status' },
                  { value: 'active', label: `Active (${counts.active})` },
                  { value: 'inactive', label: `Inactive (${counts.inactive})` },
                ],
              },
            ]}
            onReset={() => { setSearch(''); setRoleFilter('all'); setStatusFilter('all'); }}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No users found" message="Invite a team member to give them POS access." />
        ) : (
          <Table
            columns={[
              {
                key: 'n', header: 'Name', render: (u: PosUser) => (
                  <span className="users-who">
                    <span className="ch-avatar" aria-hidden="true">{initials(u.name || u.email)}</span>
                    <span><span className="ch-cell-main">{u.name}</span><br /><span className="ch-cell-sub">{u.email}{u.phone ? ` · ${u.phone}` : ''}</span></span>
                  </span>
                ),
              },
              { key: 'r', header: 'Role', render: (u: PosUser) => <StatusBadge status={displayRole(u.role)} /> },
              { key: 's', header: 'Status', render: (u: PosUser) => <StatusBadge status={isActive(u) ? 'Active' : 'Inactive'} /> },
              { key: 'l', header: 'Last login', render: (u: PosUser) => <span className="ch-cell-sub">{lastLoginOf(u)}</span> },
              {
                key: 'a', header: 'Actions', render: (u: PosUser) => {
                  const self = u.email.toLowerCase() === myEmail.toLowerCase();
                  return (
                    <span className="users-actions">
                      {canManage && (
                        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => { setRoleTarget(u); setRoleValue(displayRole(u.role)); }} aria-label={`Change role for ${u.email}`}>
                          <Pencil size={15} /> Role
                        </button>
                      )}
                      {canManage && (
                        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => openEdit(u)} aria-label={`Edit ${u.email}`}>
                          Edit
                        </button>
                      )}
                      {isAdmin && isActive(u) && !self && (
                        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setToggleTarget({ user: u, to: 'inactive' })} aria-label={`Deactivate ${u.email}`}>
                          <UserX size={15} />
                        </button>
                      )}
                      {isAdmin && !isActive(u) && (
                        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setToggleTarget({ user: u, to: 'active' })} aria-label={`Activate ${u.email}`}>
                          <UserCheck size={15} />
                        </button>
                      )}
                      {isAdmin && (
                        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setResetTarget(u)} aria-label={`Reset password for ${u.email}`}>
                          <KeyRound size={15} />
                        </button>
                      )}
                      {isAdmin && !self && (
                        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm users-danger" onClick={() => setDeleteTarget(u)} aria-label={`Remove ${u.email}`}>
                          <Trash2 size={15} />
                        </button>
                      )}
                    </span>
                  );
                },
              },
            ]}
            rows={filtered}
            rowKey={(u) => u.email}
          />
        )}
      </Card>

      <Modal
        open={inviteOpen}
        title="Invite user"
        subtitle="The member signs in with Catalyst; assign their POS role here"
        onClose={() => setInviteOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setInviteOpen(false)} disabled={inviteBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitInvite} disabled={inviteBusy}>{inviteBusy ? 'Sending…' : 'Send invite'}</button>
          </>
        }
      >
        {inviteMsg !== '' && <p className="ch-form-error">{inviteMsg}</p>}
        <div className="ch-form-grid">
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="us-email">Email</label>
            <input id="us-email" className="ch-input" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@store.lk" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="us-name">Display name</label>
            <input id="us-name" className="ch-input" value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Optional" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="us-role">Role</label>
            <select id="us-role" className="ch-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {ROLES.filter((r) => isAdmin || r !== 'Admin').map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="us-phone">Phone</label>
            <input id="us-phone" className="ch-input" value={invitePhone} onChange={(e) => setInvitePhone(e.target.value)} placeholder="Optional" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="us-notes">Notes</label>
            <input id="us-notes" className="ch-input" value={inviteNotes} onChange={(e) => setInviteNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <p className="ch-hint" style={{ marginTop: 12 }}>
          Roles control menu access: Admin (everything), Manager (reports, users, inventory), Cashier (POS, orders, customers), Storekeeper (products, inventory, orders).
        </p>
      </Modal>

      <Modal
        open={roleTarget !== null}
        title={roleTarget === null ? 'Change role' : `Change role — ${roleTarget.email}`}
        onClose={() => setRoleTarget(null)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setRoleTarget(null)} disabled={roleBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitRole} disabled={roleBusy}>{roleBusy ? 'Saving…' : 'Save role'}</button>
          </>
        }
      >
        <div className="ch-field">
          <label className="ch-label" htmlFor="us-newrole">Role</label>
          <select id="us-newrole" className="ch-select" value={roleValue} onChange={(e) => setRoleValue(e.target.value)}>
            {ROLES.filter((r) => isAdmin || r !== 'Admin').map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        {!isAdmin && <p className="ch-hint" style={{ marginTop: 8 }}>Managers cannot grant or modify the Admin role.</p>}
      </Modal>

      <Modal
        open={editTarget !== null}
        title={editTarget === null ? 'Edit user' : `Edit — ${editTarget.email}`}
        onClose={() => setEditTarget(null)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setEditTarget(null)} disabled={editBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitEdit} disabled={editBusy}>{editBusy ? 'Saving…' : 'Save changes'}</button>
          </>
        }
      >
        {editError !== '' && <p className="ch-form-error">{editError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="us-edit-name">Display name</label>
            <input id="us-edit-name" className="ch-input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="us-edit-phone">Phone</label>
            <input id="us-edit-phone" className="ch-input" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="us-edit-notes">Notes</label>
            <input id="us-edit-notes" className="ch-input" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={toggleTarget !== null}
        title={toggleTarget === null ? '' : toggleTarget.to === 'active' ? 'Activate user' : 'Deactivate user'}
        message={
          toggleTarget === null
            ? ''
            : toggleTarget.to === 'active'
              ? `Restore POS access for ${toggleTarget.user.email}?`
              : `Suspend POS access for ${toggleTarget.user.email}? They will be signed out of protected APIs immediately.`
        }
        confirmLabel={toggleTarget?.to === 'active' ? 'Activate' : 'Deactivate'}
        danger={toggleTarget?.to !== 'active'}
        busy={toggleBusy}
        onConfirm={confirmToggle}
        onCancel={() => setToggleTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove user"
        message={deleteTarget === null ? '' : `Remove ${deleteTarget.email} from the POS team? They will lose access immediately. Users with the last Admin role are protected.`}
        confirmLabel="Remove"
        danger
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset password"
        message={
          resetTarget === null
            ? ''
            : `Re-issue the Catalyst sign-in invitation for ${resetTarget.email}? Passwords live in Catalyst Auth — the member can also use "Forgot password" on the hosted login page.`
        }
        confirmLabel="Send reset"
        busy={resetBusy}
        onConfirm={confirmReset}
        onCancel={() => setResetTarget(null)}
      />
    </div>
  );
}
