import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Building2, Package, Star, Warehouse as WarehouseIcon } from 'lucide-react';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../context/AuthContext';
import { can } from '../services/authService';
import {
  createWarehouse,
  deleteWarehouse,
  getWarehouses,
  setDefaultWarehouse,
  updateWarehouse,
} from '../services/inventoryService';
import { currency, number } from '../utils/format';
import type { Warehouse } from '../types';
import './Inventory.css';

type FormState = {
  name: string;
  code: string;
  description: string;
  address: string;
  contact_person: string;
  contact_phone: string;
  status: string;
  is_default: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  code: '',
  description: '',
  address: '',
  contact_person: '',
  contact_phone: '',
  status: 'Active',
  is_default: false,
};

export default function Warehouses() {
  const { role } = useAuth();
  const [warehouses, setWarehouses] = useState<Array<Warehouse>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Warehouse | null>(null);
  const [detail, setDetail] = useState<Warehouse | null>(null);

  const effectiveRole = role === '' ? 'Admin' : role;
  const manageable = can('manage_products', effectiveRole);
  const deletable = ['Admin', 'Manager'].includes(effectiveRole);

  const load = () => {
    setLoading(true);
    setError('');
    getWarehouses()
      .then(setWarehouses)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load warehouses'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const stats = useMemo(() => {
    const active = warehouses.filter((w) => (w.status ?? 'Active') === 'Active');
    const value = warehouses.reduce((s, w) => s + Number(w.inventory_value || 0), 0);
    const low = warehouses.reduce((s, w) => s + Number(w.low_stock_count || 0), 0);
    return { total: warehouses.length, active: active.length, value, low };
  }, [warehouses]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return warehouses.filter((w) => {
      if (filter === 'active' && (w.status ?? 'Active') !== 'Active') return false;
      if (filter === 'inactive' && (w.status ?? 'Active') !== 'Inactive') return false;
      if (filter === 'default' && w.is_default !== true) return false;
      if (q === '') return true;
      return w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q);
    });
  }, [warehouses, search, filter]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (w: Warehouse) => {
    setEditing(w);
    setForm({
      name: w.name,
      code: w.code,
      description: w.description ?? '',
      address: w.address ?? '',
      contact_person: w.contact_person ?? '',
      contact_phone: w.contact_phone ?? '',
      status: w.status ?? 'Active',
      is_default: w.is_default === true,
    });
    setFormError('');
    setFormOpen(true);
  };

  const submitForm = () => {
    if (form.name.trim() === '') {
      setFormError('Warehouse name is required.');
      return;
    }
    if (form.code.trim() === '') {
      setFormError('Warehouse code is required.');
      return;
    }
    setFormBusy(true);
    setFormError('');
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: form.description.trim(),
      address: form.address.trim(),
      contact_person: form.contact_person.trim(),
      contact_phone: form.contact_phone.trim(),
      status: form.status,
      is_default: form.is_default,
    };
    const done = (msg: string) => {
      setNotice(msg);
      setFormOpen(false);
      setFormBusy(false);
      load();
    };
    if (editing === null || editing.ROWID === undefined) {
      createWarehouse(payload)
        .then(() => done('Warehouse added.'))
        .catch((e: unknown) => {
          setFormError(e instanceof Error ? e.message : 'Failed to save warehouse');
          setFormBusy(false);
        });
    } else {
      updateWarehouse(String(editing.ROWID), payload)
        .then(() => done('Warehouse updated.'))
        .catch((e: unknown) => {
          setFormError(e instanceof Error ? e.message : 'Failed to save warehouse');
          setFormBusy(false);
        });
    }
  };

  const toggleActive = (w: Warehouse) => {
    if (w.ROWID === undefined) return;
    setBusy(true);
    setNotice('');
    const next = (w.status ?? 'Active') === 'Active' ? 'Inactive' : 'Active';
    updateWarehouse(String(w.ROWID), { status: next })
      .then(() => {
        setNotice(`Warehouse "${w.name}" ${next === 'Active' ? 'reactivated' : 'deactivated'}.`);
        load();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to update warehouse');
        setBusy(false);
      })
      .finally(() => setBusy(false));
  };

  const makeDefault = (w: Warehouse) => {
    if (w.ROWID === undefined) return;
    setBusy(true);
    setNotice('');
    setDefaultWarehouse(String(w.ROWID))
      .then(() => {
        setNotice(`"${w.name}" is now the default warehouse.`);
        load();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to set default warehouse');
        setBusy(false);
      })
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    if (deleteTarget === null || deleteTarget.ROWID === undefined) return;
    setBusy(true);
    setNotice('');
    deleteWarehouse(String(deleteTarget.ROWID))
      .then((res) => {
        setNotice(res.message ?? `Warehouse "${deleteTarget.name}" deleted.`);
        setDeleteTarget(null);
        load();
      })
      .catch((e: unknown) => {
        // 409 carries the held-stock explanation.
        setError(e instanceof Error ? e.message : 'Failed to delete warehouse');
        setDeleteTarget(null);
        setBusy(false);
      })
      .finally(() => setBusy(false));
  };

  if (loading) return <Loader message="Loading warehouses…" skeleton="page" />;
  if (error !== '' && warehouses.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="ch-page-head">
        <div>
          <h1 className="ch-page-title">Warehouses</h1>
          <p className="ch-page-sub">Stock locations, valuations and the default store.</p>
        </div>
        <div className="ch-page-actions">
          <Link to="/inventory" className="ch-btn ch-btn-secondary ch-btn-sm">
            View stock <ArrowRight size={13} />
          </Link>
          {manageable && (
            <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={openAdd}>
              Add warehouse
            </button>
          )}
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <div className="ch-grid-stats cols-4">
        <StatCard label="Total warehouses" value={number(stats.total)} icon={<WarehouseIcon size={20} />} />
        <StatCard
          label="Active warehouses"
          value={number(stats.active)}
          delta={stats.total - stats.active > 0 ? `${stats.total - stats.active} inactive` : 'All active'}
          deltaTone={stats.total - stats.active > 0 ? 'down' : 'up'}
          icon={<Building2 size={20} />}
          iconBg="#e3f6ec"
          iconColor="#147a50"
        />
        <StatCard label="Total inventory value" value={currency(stats.value)} icon={<span aria-hidden="true">₨</span>} iconBg="#e9f0fe" iconColor="#2b5fe3" />
        <StatCard
          label="Low stock lines"
          value={number(stats.low)}
          delta={stats.low > 0 ? 'Reorder soon' : 'All healthy'}
          deltaTone={stats.low > 0 ? 'down' : 'up'}
          icon={<Package size={20} />}
          iconBg="#fef3e2"
          iconColor="#d97706"
        />
      </div>

      <Card>
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search name or code…" ariaLabel="Search warehouses" />
          <FilterBar
            filters={[{
              key: 'f',
              value: filter,
              ariaLabel: 'Filter warehouses',
              onChange: setFilter,
              options: [
                { value: 'all', label: `All (${warehouses.length})` },
                { value: 'active', label: `Active (${stats.active})` },
                { value: 'inactive', label: `Inactive (${stats.total - stats.active})` },
                { value: 'default', label: 'Default' },
              ],
            }]}
            onReset={() => { setSearch(''); setFilter('all'); }}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No warehouses to show"
            message="No locations match this filter — or the warehouse tables are not provisioned yet."
            icon={<WarehouseIcon size={24} />}
            action={manageable ? <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={openAdd}>Add warehouse</button> : undefined}
          />
        ) : (
          <div className="warehouse-grid">
            {filtered.map((w) => (
              <Card
                key={String(w.ROWID ?? w.code)}
                className="warehouse-card"
                title={w.name}
                subtitle={`${w.code}${w.is_default === true ? ' · Default' : ''}`}
                hoverable
                action={
                  <span className="ch-row" style={{ gap: 6 }}>
                    {w.is_default === true && <Star size={15} aria-label="Default warehouse" />}
                    <StatusBadge status={w.status ?? 'Active'} />
                  </span>
                }
              >
                <dl className="ws-dl">
                  <div><dt>SKUs stored</dt><dd><b>{number(w.skus ?? 0)}</b></dd></div>
                  <div><dt>Units</dt><dd><b>{number(w.units ?? 0)}</b></dd></div>
                  <div><dt>Inventory value</dt><dd><b>{currency(w.inventory_value ?? 0)}</b></dd></div>
                  <div><dt>Low stock lines</dt><dd>{number(w.low_stock_count ?? 0)}</dd></div>
                  {(w.contact_person ?? '') !== '' && <div><dt>Contact</dt><dd>{w.contact_person}{w.contact_phone ? ` · ${w.contact_phone}` : ''}</dd></div>}
                </dl>
                <div className="warehouse-card-actions">
                  <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setDetail(w)}>Details</button>
                  <Link to={`/inventory?warehouse=${encodeURIComponent(String(w.ROWID ?? ''))}`} className="ch-btn ch-btn-ghost ch-btn-sm">View stock <ArrowRight size={13} /></Link>
                  {manageable && <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => openEdit(w)} disabled={busy}>Edit</button>}
                  {manageable && <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => toggleActive(w)} disabled={busy}>{(w.status ?? 'Active') === 'Active' ? 'Deactivate' : 'Reactivate'}</button>}
                  {manageable && w.is_default !== true && (w.status ?? 'Active') === 'Active' && <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => makeDefault(w)} disabled={busy}>Set default</button>}
                  {deletable && w.is_default !== true && <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setDeleteTarget(w)} disabled={busy}>Delete</button>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={formOpen}
        title={editing === null ? 'Add warehouse' : `Edit ${editing.name}`}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setFormOpen(false)} disabled={formBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitForm} disabled={formBusy}>
              {formBusy ? 'Saving…' : editing === null ? 'Add warehouse' : 'Save changes'}
            </button>
          </>
        }
      >
        {formError !== '' && <p className="ch-form-error">{formError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field">
            <label className="ch-label" htmlFor="wh-name">Warehouse name</label>
            <input id="wh-name" className="ch-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main Store" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="wh-code">Code (unique)</label>
            <input id="wh-code" className="ch-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. MAIN" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="wh-status">Status</label>
            <select id="wh-status" className="ch-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="wh-contact">Contact person</label>
            <input id="wh-contact" className="ch-input" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="Optional" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="wh-phone">Contact phone</label>
            <input id="wh-phone" className="ch-input" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="Optional" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="wh-addr">Address</label>
            <input id="wh-addr" className="ch-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Optional" />
          </div>
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="wh-desc">Description</label>
            <input id="wh-desc" className="ch-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
          </div>
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="wh-default" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                id="wh-default"
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              />
              Default warehouse (receives legacy stock writes)
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={detail !== null}
        title={detail === null ? 'Warehouse details' : detail.name}
        subtitle={detail === null ? undefined : `${detail.code} · ${detail.status ?? 'Active'}`}
        onClose={() => setDetail(null)}
        footer={<button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDetail(null)}>Close</button>}
      >
        {detail !== null && (
          <dl className="ws-dl">
            <div><dt>Code</dt><dd>{detail.code}</dd></div>
            <div><dt>Status</dt><dd><StatusBadge status={detail.status ?? 'Active'} /></dd></div>
            <div><dt>Default</dt><dd>{detail.is_default === true ? 'Yes' : 'No'}</dd></div>
            <div><dt>SKUs stored</dt><dd><b>{number(detail.skus ?? 0)}</b></dd></div>
            <div><dt>Units</dt><dd><b>{number(detail.units ?? 0)}</b></dd></div>
            <div><dt>Inventory value</dt><dd><b>{currency(detail.inventory_value ?? 0)}</b></dd></div>
            <div><dt>Description</dt><dd>{detail.description || '—'}</dd></div>
            <div><dt>Address</dt><dd>{detail.address || '—'}</dd></div>
            <div><dt>Contact</dt><dd>{detail.contact_person || '—'}{detail.contact_phone ? ` · ${detail.contact_phone}` : ''}</dd></div>
          </dl>
        )}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        title="Delete warehouse"
        subtitle="Permanent removal — only possible with zero stock"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-danger" onClick={confirmDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ch-muted)' }}>
          {deleteTarget === null
            ? ''
            : `Delete "${deleteTarget.name}" permanently? Warehouses holding stock cannot be deleted — transfer the stock out first.`}
        </p>
      </Modal>

    </div>
  );
}
