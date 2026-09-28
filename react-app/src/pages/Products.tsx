import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, RefreshCw, PackagePlus, CheckSquare, Eye, X, Upload, Download, ImagePlus, ImageOff } from 'lucide-react';
import Card from '../components/ui/Card';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import SearchBar from '../components/ui/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { getProducts, createProduct, updateProduct, deleteProduct, adjustStock, syncFromBooks, getCategories, createCategory, updateCategory, deactivateCategory, deleteCategory, uploadProductImage, deleteProductImage, productImageUrl, exportProductsCsv, importProductsCsv, ApiError, type ImportResult } from '../services/productService';
import { getTaxSettings, type TaxProfile } from '../services/settingsService';
import { getWarehouses } from '../services/inventoryService';
import { can } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import { categoryNameOf, currency, isLowStock, isOutOfStock, number, profitPerUnit, reorderLevelOf, stockValueOf, productCategoryIds, productCategoryNames } from '../utils/format';
import type { Category, Product, Warehouse } from '../types';
import './Products.css';

interface ProductForm {
  name: string;
  sku: string;
  barcode: string;
  rate: string;
  cost_price: string;
  stock: string;
  /** Warehouse that receives opening stock when a product is first created. */
  warehouse_id: string;
  reorder_level: string;
  category: string;
  category_id: string;
  /** PROD-05: every linked category (first selected = primary). */
  category_ids: Array<string>;
  unit: string;
  status: string;
  tax_percentage: string;
  description: string;
}

const EMPTY_FORM: ProductForm = {
  name: '', sku: '', barcode: '', rate: '', cost_price: '', stock: '', warehouse_id: '',
  reorder_level: '10', category: 'General', category_id: '', category_ids: [], unit: 'Piece', status: 'Active',
  tax_percentage: '0', description: '',
};

/** Parse a CSV text into rows (handles quoted commas + escaped quotes). */
function parseCsvText(text: string): Array<Array<string>> {
  const rows: Array<Array<string>> = [];
  let row: Array<string> = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** Map CSV headers to import keys (case-insensitive, common aliases). */
function mapCsvHeaders(header: Array<string>): Array<string | null> {
  const alias: Record<string, string> = {
    sku: 'sku', name: 'name', rate: 'rate', price: 'rate', sellingprice: 'rate',
    costprice: 'cost_price', cost: 'cost_price',
    stock: 'stock', qty: 'stock', quantity: 'stock',
    reorderlevel: 'reorder_level', reorder: 'reorder_level', min: 'reorder_level',
    barcode: 'barcode', unit: 'unit',
    status: 'status', taxpercentage: 'tax_percentage', tax: 'tax_percentage',
    description: 'description', categories: 'categories', category: 'categories',
  };
  return header.map((h) => alias[h.trim().toLowerCase().replace(/[\s_]+/g, '')] ?? null);
}

const UNIT_OPTIONS = ['Piece', 'Box', 'Bottle', 'Packet', 'Kg', 'Gram', 'Litre', 'ML', 'Other'];
const STATUS_OPTIONS = ['Active', 'Inactive', 'Discontinued'];
type TaxMode = 'default' | 'custom' | 'exempt' | `profile:${number}`;

function rowId(p: Product): string {
  return String(p.ROWID ?? p.sku);
}

export default function Products() {
  const { role } = useAuth();
  const [products, setProducts] = useState<Array<Product>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [category, setCategory] = useState(params.get('category') ?? 'all');
  const [stockFilter, setStockFilter] = useState(() => {
    const s = (params.get('stock') ?? 'all').toLowerCase();
    return s === 'in' || s === 'low' || s === 'out' ? s : 'all';
  });
  const [details, setDetails] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [stockTarget, setStockTarget] = useState<Product | null>(null);
  const [stockDelta, setStockDelta] = useState('');
  const [stockBusy, setStockBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [allCategories, setAllCategories] = useState<Array<Category>>([]);
  const [warehouses, setWarehouses] = useState<Array<Warehouse>>([]);
  const [catManageOpen, setCatManageOpen] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', description: '', display_order: '0', status: 'Active' });
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState('');
  const [catDeactivate, setCatDeactivate] = useState<Category | null>(null);
  const [catDelete, setCatDelete] = useState<Category | null>(null);
  const [catsFailed, setCatsFailed] = useState(false);
  // PROD-08 image staging (uploaded on save, never stored in form state).
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<{ dataUrl: string; mime: string; name: string } | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  // SET-02: tax treatment selector + live default rate for "Use default".
  const [taxModeSel, setTaxModeSel] = useState<TaxMode>('default');
  const [defaultTaxRate, setDefaultTaxRate] = useState(0);
  const [taxProfiles, setTaxProfiles] = useState<Array<TaxProfile>>([]);
  // PROD-09 CSV import/export.
  const [exportBusy, setExportBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const editable = can('manage_products', role === '' ? 'Admin' : role);

  const load = () => {
    setLoading(true);
    setError('');
    getTaxSettings().then((t) => {
      if (t !== null) {
        setDefaultTaxRate(Number(t.default_rate) || 0);
        setTaxProfiles(Array.isArray(t.profiles) ? t.profiles : []);
      }
    }).catch(() => setTaxProfiles([]));
    Promise.all([
      getProducts(),
      getCategories().then((c) => ({ ok: true as const, list: c })).catch(() => ({ ok: false as const, list: [] as Array<Category> })),
      getWarehouses().catch(() => [] as Array<Warehouse>),
    ])
      .then(([items, cats, loadedWarehouses]) => {
        setProducts(items);
        setAllCategories(cats.list);
        setCatsFailed(!cats.ok);
        setWarehouses(loadedWarehouses);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load products'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Escape closes the details drawer (modals handle their own Escape).
  useEffect(() => {
    if (details === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetails(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [details]);

  // Stay in sync with workspace deep links (e.g. Categories → ?category=X).
  useEffect(() => {
    const q = params.get('search');
    if (q !== null) setSearch(q);
    const c = params.get('category');
    if (c !== null) setCategory(c);
    const s = (params.get('stock') ?? '').toLowerCase();
    if (s === 'all' || s === 'in' || s === 'low' || s === 'out') setStockFilter(s);
  }, [params]);

  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of allCategories) m.set(String(c.ROWID ?? c.name), c);
    return m;
  }, [allCategories]);

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const c of allCategories) {
      if ((c.status || 'Active') === 'Active' && c.name.trim() !== '') names.add(c.name.trim());
    }
    for (const p of products) {
      names.add(categoryNameOf(p));
      for (const n of productCategoryNames(p, (id) => categoryById.get(String(id))?.name)) names.add(n);
    }
    return ['all', ...Array.from(names).sort()];
  }, [products, allCategories, categoryById]);

  /** Active categories for pickers (stable order). */
  const activeCategories = useMemo(() => {
    return allCategories.filter((c) => (c.status || 'Active') === 'Active');
  }, [allCategories]);

  /** Opening stock can only be assigned to an active warehouse. */
  const activeWarehouses = useMemo(() => (
    warehouses.filter((w) => String(w.status || 'Active').toLowerCase() === 'active')
  ), [warehouses]);

  /** Display names across every linked category (PROD-05). */
  const productNames = (p: Product): Array<string> =>
    productCategoryNames(p, (id) => {
      const c = categoryById.get(String(id));
      return c?.name;
    });

  /** Category filter matches when ANY linked name equals the selection. */
  const matchesCategory = (p: Product, name: string): boolean => {
    if (name === 'all') return true;
    if (categoryNameOf(p) === name) return true;
    return productNames(p).some((n) => n === name);
  };

  /** Linked product counts per category id (for delete gating). */
  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) {
      for (const id of productCategoryIds(p)) {
        m.set(id, (m.get(id) ?? 0) + 1);
      }
    }
    return m;
  }, [products]);

  const counts = useMemo(() => {
    const low = products.filter((p) => isLowStock(p)).length;
    const out = products.filter((p) => isOutOfStock(p)).length;
    const value = products.reduce((s, p) => s + stockValueOf(p), 0);
    return { total: products.length, low, out, value, healthy: products.length - low - out };
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'all' && !matchesCategory(p, category)) return false;
      if (stockFilter === 'low' && !isLowStock(p)) return false;
      if (stockFilter === 'out' && !isOutOfStock(p)) return false;
      if (stockFilter === 'in' && (isOutOfStock(p) || isLowStock(p))) return false;
      if (q === '') return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, category, stockFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) setSelected(new Set());
    else setSelected(new Set(filtered.map(rowId)));
  };

  const openAdd = () => {
    setEditing(null);
    const firstActive = allCategories.find((c) => (c.status || 'Active') === 'Active');
    const firstId = firstActive?.ROWID === undefined ? '' : String(firstActive.ROWID);
    const defaultWarehouse = activeWarehouses.find((w) => w.is_default === true) ?? activeWarehouses[0];
    setForm({
      ...EMPTY_FORM,
      category_id: firstId,
      category_ids: firstId === '' ? [] : [firstId],
      category: firstActive?.name ?? 'General',
      tax_percentage: String(defaultTaxRate),
      warehouse_id: defaultWarehouse?.ROWID === undefined ? '' : String(defaultWarehouse.ROWID),
    });
    setTaxModeSel('default');
    setImagePreview(null);
    setImageFile(null);
    setImageRemoved(false);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    const ids = productCategoryIds(p);
    const linked = p.category_id !== undefined && p.category_id !== null && String(p.category_id) !== ''
      ? categoryById.get(String(p.category_id))
      : undefined;
    setForm({
      name: p.name,
      sku: p.sku,
      barcode: p.barcode ?? '',
      rate: String(p.rate),
      cost_price: p.cost_price === undefined || p.cost_price === null ? '' : String(p.cost_price),
      stock: String(p.stock),
      warehouse_id: '',
      reorder_level: String(reorderLevelOf(p)),
      category: categoryNameOf(p),
      category_id: linked?.ROWID === undefined ? '' : String(linked.ROWID),
      category_ids: ids,
      unit: p.unit || 'Piece',
      status: p.status || 'Active',
      tax_percentage: String(p.tax_percentage ?? 0),
      description: p.description ?? '',
    });
    // Prefer a saved profile when the stored rate exactly matches one.
    const savedRate = Number(p.tax_percentage ?? 0);
    const profileIndex = taxProfiles.findIndex((profile) => Number(profile.rate) === savedRate);
    setTaxModeSel(savedRate === 0 ? 'exempt' : savedRate === defaultTaxRate ? 'default' : profileIndex >= 0 ? `profile:${profileIndex}` : 'custom');
    setImagePreview(p.image_id ? productImageUrl(rowId(p)) : null);
    setImageFile(null);
    setImageRemoved(false);
    setFormError('');
    setFormOpen(true);
  };

  /** Toggle one linked category; primary follows first-selected order. */
  const toggleFormCategory = (id: string) => {
    setForm((prev) => {
      const has = prev.category_ids.includes(id);
      const next = has ? prev.category_ids.filter((v) => v !== id) : [...prev.category_ids, id];
      const first = next[0] ?? '';
      const found = first === '' ? undefined : categoryById.get(first);
      return {
        ...prev,
        category_ids: next,
        category_id: first,
        category: found?.name ?? (first === '' ? 'General' : prev.category),
      };
    });
  };

  /** Read an image file into a staged data URL (validated on save). */
  const stageImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setFormError('Image must be PNG, JPEG, or WebP.');
      return;
    }
    if (file.size > 1536 * 1024) {
      setFormError('Image exceeds 1.5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageFile({ dataUrl: String(reader.result ?? ''), mime: file.type, name: file.name });
      setImagePreview(String(reader.result ?? ''));
      setImageRemoved(false);
      setFormError('');
    };
    reader.onerror = () => setFormError('Could not read the image file.');
    reader.readAsDataURL(file);
  };

  const submitForm = () => {
    if (form.name.trim() === '' || form.sku.trim() === '') {
      setFormError('Name and SKU are required.');
      return;
    }
    // Guard: never save category links the client can no longer resolve.
    // (Prevents "right pick, wrong display" from stale/deactivated options.)
    const stale = form.category_ids.filter((id) => !categoryById.has(id));
    if (stale.length > 0) {
      setFormError('A selected category is no longer available. Please re-check the list.');
      return;
    }
    if (form.category_id !== '' && !categoryById.has(form.category_id)) {
      setFormError('The selected category is no longer available. Please choose another.');
      return;
    }
    setFormBusy(true);
    setFormError('');
    // Single source of truth: the server derives the category text from the
    // linked record. Sending text alongside the id previously allowed stale
    // text to accompany (or outlive) the link.
    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim(),
      rate: Number(form.rate) || 0,
      cost_price: form.cost_price.trim() === '' ? 0 : Math.max(0, Number(form.cost_price) || 0),
      stock: Number(form.stock) || 0,
      reorder_level: form.reorder_level.trim() === '' ? 10 : Math.max(0, parseInt(form.reorder_level, 10) || 0),
      category_id: form.category_id === '' ? undefined : form.category_id,
      category_ids: form.category_ids,
      unit: form.unit.trim() || 'Piece',
      status: STATUS_OPTIONS.includes(form.status) ? form.status : 'Active',
      // SET-02: default resolves to the live default rate; exempt is 0.
      tax_percentage: taxModeSel === 'exempt' ? 0 : taxModeSel === 'default' ? defaultTaxRate : Math.max(0, Number(form.tax_percentage) || 0),
      description: form.description.trim(),
      // Only meaningful for create: edits keep their existing per-warehouse
      // balances and must use the stock adjustment / transfer flows.
      warehouse_id: form.warehouse_id === '' ? undefined : form.warehouse_id,
    };
    const syncImage = async (savedId: string): Promise<string | null> => {
      // Returns an error message, or null on success / nothing to do.
      try {
        if (imageFile !== null) {
          setImageBusy(true);
          await uploadProductImage(savedId, {
            imageData: imageFile.dataUrl,
            mimeType: imageFile.mime,
            fileName: imageFile.name,
          });
          return null;
        }
        if (imageRemoved && editing !== null) {
          setImageBusy(true);
          await deleteProductImage(rowId(editing)).catch(() => undefined);
          return null;
        }
        return null;
      } catch (e: unknown) {
        return e instanceof Error ? e.message : 'Image sync failed.';
      } finally {
        setImageBusy(false);
      }
    };
    const done = async (msg: string, savedId: string | null) => {
      if (savedId !== null) {
        const imgErr = await syncImage(savedId);
        if (imgErr !== null) {
          setFormError(imgErr);
          setFormBusy(false);
          load();
          return;
        }
      }
      setNotice(msg);
      setFormOpen(false);
      setFormBusy(false);
      load();
    };
    if (editing === null) {
      createProduct(payload)
        .then((created) => done('Product added.', created !== null && created.ROWID !== undefined ? String(created.ROWID) : null))
        .catch((e: unknown) => { setFormError(e instanceof Error ? e.message : 'Failed to save product'); setFormBusy(false); });
    } else {
      const id = rowId(editing);
      updateProduct(id, {
        name: payload.name, rate: payload.rate, cost_price: payload.cost_price,
        stock: payload.stock, reorder_level: payload.reorder_level, category_id: payload.category_id,
        category_ids: payload.category_ids,
        unit: payload.unit, status: payload.status, barcode: payload.barcode,
        tax_percentage: payload.tax_percentage, description: payload.description,
      })
        .then(() => done('Product updated.', id))
        .catch((e: unknown) => { setFormError(e instanceof Error ? e.message : 'Failed to save product'); setFormBusy(false); });
    }
  };

  const confirmDelete = () => {
    if (deleteTarget === null) return;
    setDeleteBusy(true);
    deleteProduct(rowId(deleteTarget))
      .then(() => {
        setNotice(`Deleted ${deleteTarget.name}.`);
        setDeleteTarget(null);
        load();
      })
      .catch((e: unknown) => {
        setNotice('');
        const msg = e instanceof Error ? e.message : 'Delete failed';
        // PROD-03: referenced products are blocked server-side (409) —
        // point at deactivation instead of leaving a dead end.
        const hint = e instanceof ApiError && e.status === 409
          ? ' Use Edit → Status → Inactive (or Discontinued) to deactivate instead.'
          : '';
        setError(msg + hint);
        setDeleteTarget(null);
      })
      .finally(() => setDeleteBusy(false));
  };

  const bulkDelete = () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    setDeleteBusy(true);
    Promise.allSettled(ids.map((id) => deleteProduct(id)))
      .then((results) => {
        const ok = results.filter((r) => r.status === 'fulfilled').length;
        const blocked = results.length - ok;
        if (ok > 0) {
          setNotice(`Deleted ${ok} product${ok === 1 ? '' : 's'}.${blocked > 0 ? ` ${blocked} skipped (referenced by orders — deactivate instead).` : ''}`);
        } else {
          setError('Nothing deleted — selected products are referenced by orders. Deactivate them instead.');
        }
        setSelected(new Set());
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Bulk delete failed'))
      .finally(() => setDeleteBusy(false));
  };

  const doExport = () => {
    setExportBusy(true);
    exportProductsCsv()
      .then(() => setNotice('Catalog exported as CSV.'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Export failed.'))
      .finally(() => setExportBusy(false));
  };

  const doImportFile = (file: File | undefined) => {
    if (!file) return;
    setImportError('');
    setImportResult(null);
    setImportBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCsvText(String(reader.result ?? ''));
        if (rows.length < 2) throw new Error('CSV has no data rows.');
        const keys = mapCsvHeaders(rows[0] ?? []);
        if (!keys.includes('sku') || !keys.includes('name')) {
          throw new Error('CSV must include sku and name columns.');
        }
        const records: Array<Record<string, string>> = [];
        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i] ?? [];
          if (cells.every((c) => c.trim() === '')) continue;
          const rec: Record<string, string> = {};
          keys.forEach((k, idx) => {
            if (k !== null) rec[k] = (cells[idx] ?? '').trim();
          });
          records.push(rec);
        }
        if (records.length === 0) throw new Error('CSV has no data rows.');
        importProductsCsv(records)
          .then((res) => {
            setImportResult(res);
            if (res.inserted > 0) load();
          })
          .catch((e: unknown) => setImportError(e instanceof Error ? e.message : 'Import failed.'))
          .finally(() => setImportBusy(false));
      } catch (e: unknown) {
        setImportError(e instanceof Error ? e.message : 'Could not parse CSV.');
        setImportBusy(false);
      }
    };
    reader.onerror = () => {
      setImportError('Could not read the file.');
      setImportBusy(false);
    };
    reader.readAsText(file);
  };

  const submitStock = () => {
    if (stockTarget === null || stockDelta.trim() === '') return;
    setStockBusy(true);
    adjustStock(rowId(stockTarget), Number(stockDelta), 'Manual adjustment from Products page')
      .then((res) => {
        setNotice(`Stock updated: ${res.old_stock ?? '?'} → ${res.new_stock ?? '?'}.`);
        setStockTarget(null);
        setStockDelta('');
        load();
      })
      .catch((e: unknown) => {
        setNotice('');
        setError(e instanceof Error ? e.message : 'Stock adjustment failed');
        setStockTarget(null);
      })
      .finally(() => setStockBusy(false));
  };

  const openCatManage = () => {
    setCatForm({ name: '', description: '', display_order: '0', status: 'Active' });
    setEditingCatId(null);
    setCatError('');
    setCatManageOpen(true);
  };

  const openCatEdit = (c: Category) => {
    setEditingCatId(c.ROWID === undefined ? null : String(c.ROWID));
    setCatForm({
      name: c.name,
      description: c.description ?? '',
      display_order: String(c.display_order ?? 0),
      status: c.status || 'Active',
    });
    setCatError('');
  };

  const submitCat = () => {
    if (catForm.name.trim() === '') {
      setCatError('Category name is required.');
      return;
    }
    setCatBusy(true);
    setCatError('');
    const payload = {
      name: catForm.name.trim(),
      description: catForm.description.trim(),
      display_order: Math.max(0, parseInt(catForm.display_order, 10) || 0),
      status: catForm.status,
    };
    const done = (msg: string) => {
      setNotice(msg);
      setCatBusy(false);
      load();
    };
    if (editingCatId === null) {
      createCategory(payload)
        .then(() => {
          setCatForm({ name: '', description: '', display_order: '0', status: 'Active' });
          done('Category added.');
        })
        .catch((e: unknown) => {
          setCatError(e instanceof Error ? e.message : 'Failed to save category');
          setCatBusy(false);
        });
    } else {
      updateCategory(editingCatId, payload)
        .then(() => {
          setEditingCatId(null);
          setCatForm({ name: '', description: '', display_order: '0', status: 'Active' });
          done('Category updated.');
        })
        .catch((e: unknown) => {
          setCatError(e instanceof Error ? e.message : 'Failed to save category');
          setCatBusy(false);
        });
    }
  };

  const confirmCatDeactivate = () => {
    if (catDeactivate === null || catDeactivate.ROWID === undefined) return;
    setCatBusy(true);
    deactivateCategory(String(catDeactivate.ROWID))
      .then(() => {
        setNotice(`Category "${catDeactivate.name}" deactivated. Linked products keep working.`);
        setCatDeactivate(null);
        setCatBusy(false);
        load();
      })
      .catch((e: unknown) => {
        setCatError(e instanceof Error ? e.message : 'Failed to deactivate category');
        setCatBusy(false);
        setCatDeactivate(null);
      });
  };

  const confirmCatDelete = () => {
    if (catDelete === null || catDelete.ROWID === undefined) return;
    setCatBusy(true);
    deleteCategory(String(catDelete.ROWID))
      .then((res) => {
        setNotice(res.message ?? `Category "${catDelete.name}" deleted.`);
        setCatDelete(null);
        setCatBusy(false);
        load();
      })
      .catch((e: unknown) => {
        setCatError(e instanceof Error ? e.message : 'Failed to delete category');
        setCatBusy(false);
        setCatDelete(null);
      });
  };

  const reactivateCat = (c: Category) => {
    if (c.ROWID === undefined) return;
    setCatBusy(true);
    updateCategory(String(c.ROWID), { status: 'Active' })
      .then(() => {
        setNotice(`Category "${c.name}" reactivated.`);
        setCatBusy(false);
        load();
      })
      .catch((e: unknown) => {
        setCatError(e instanceof Error ? e.message : 'Failed to reactivate category');
        setCatBusy(false);
      });
  };

  const sync = () => {
    setSyncBusy(true);
    syncFromBooks()
      .then((res) => {
        setNotice(res.message ?? 'Sync complete.');
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Sync failed'))
      .finally(() => setSyncBusy(false));
  };

  if (loading) return <Loader message="Loading products…" skeleton="page" />;
  if (error !== '' && products.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="ch-page-head reveal">
        <div>
          <h1 className="ch-page-title">Products</h1>
          <p className="ch-page-sub">{number(products.length)} items · {currency(counts.value)} stock value · {counts.low} low · {counts.out} out.</p>
        </div>
        <div className="ch-page-actions">
          <button type="button" className="ch-btn ch-btn-secondary" onClick={sync} disabled={syncBusy || !editable}>
            <RefreshCw size={15} />
            {syncBusy ? 'Syncing…' : 'Sync from Books'}
          </button>
          <button type="button" className="ch-btn ch-btn-secondary" onClick={doExport} disabled={exportBusy}>
            <Download size={15} />
            {exportBusy ? 'Exporting…' : 'Export CSV'}
          </button>
          {editable && (
            <>
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => { setImportError(''); setImportResult(null); setImportOpen(true); }}>
                <Upload size={15} />
                Import CSV
              </button>
              <button type="button" className="ch-btn ch-btn-primary" onClick={openAdd}>
                <Plus size={15} />
                Add product
              </button>
            </>
          )}
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      {/* Health strip */}
      <div className="prod-stats reveal" style={{ animationDelay: '60ms' }}>
        <button type="button" className={stockFilter === 'all' ? 'prod-stat active' : 'prod-stat'} onClick={() => setStockFilter('all')}>
          <b>{number(counts.total)}</b><span>Total SKUs</span>
        </button>
        <button type="button" className={stockFilter === 'in' ? 'prod-stat active ok' : 'prod-stat ok'} onClick={() => setStockFilter(stockFilter === 'in' ? 'all' : 'in')}>
          <b>{number(counts.healthy)}</b><span>Healthy</span>
        </button>
        <button type="button" className={stockFilter === 'low' ? 'prod-stat active warn' : 'prod-stat warn'} onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}>
          <b>{number(counts.low)}</b><span>Low stock</span>
        </button>
        <button type="button" className={stockFilter === 'out' ? 'prod-stat active bad' : 'prod-stat bad'} onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')}>
          <b>{number(counts.out)}</b><span>Out of stock</span>
        </button>
      </div>

      <Card delay={100} className="prod-table-card">
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search name, SKU, barcode…" ariaLabel="Search products" />
          <FilterBar
            filters={[
              { key: 'cat', value: category, ariaLabel: 'Filter by category', options: categories.map((c) => ({ value: c, label: c === 'all' ? 'All categories' : c })), onChange: setCategory },
              {
                key: 'stock', value: stockFilter, ariaLabel: 'Filter by stock', onChange: setStockFilter,
                options: [
                  { value: 'all', label: 'All stock' },
                  { value: 'in', label: 'In stock' },
                  { value: 'low', label: 'Low stock (≤ reorder)' },
                  { value: 'out', label: 'Out of stock' },
                ],
              },
            ]}
            onReset={() => { setSearch(''); setCategory('all'); setStockFilter('all'); }}
          />
          {selected.size > 0 && editable && (
            <button type="button" className="ch-btn ch-btn-danger ch-btn-sm" onClick={bulkDelete} disabled={deleteBusy}>
              <Trash2 size={14} />
              Delete {selected.size} selected
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="prod-bulkbar">
            <CheckSquare size={15} />
            <b>{selected.size} selected</b>
            <span className="ch-cell-sub">Bulk actions apply to all checked items</span>
            <span style={{ marginLeft: 'auto' }} className="ch-row">
              <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </span>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            title="No products found"
            message="Try a different search, or add a new product to the catalog."
            icon={<PackagePlus size={26} />}
            action={editable ? <button type="button" className="ch-btn ch-btn-primary" onClick={openAdd}><Plus size={15} /> Add product</button> : undefined}
          />
        ) : (
          <div className="prod-grid">
            {filtered.map((p, i) => {
              const low = isLowStock(p);
              const out = isOutOfStock(p);
              return (
                <article key={`${rowId(p)}-${i}`} className="prod-card reveal" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <div className="prod-card-top">
                    {p.image_id ? (
                      <img className="prod-grid-img" src={productImageUrl(rowId(p))} alt="" aria-hidden="true" loading="lazy" />
                    ) : (
                      <span className="ch-thumb prod-big" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                    )}
                    {out ? <StatusBadge status="Out of stock" /> : low ? <StatusBadge status="Low stock" /> : <StatusBadge status={p.status || 'Active'} />}
                    <label className="prod-check"><input type="checkbox" className="ch-checkbox" aria-label={`Select ${p.name}`} checked={selected.has(rowId(p))} onChange={() => toggleSelect(rowId(p))} /></label>
                  </div>
                  <h4 className="prod-card-name">{p.name}</h4>
                  <p className="prod-card-sub">{p.sku} · {p.unit || 'Piece'}</p>
                  <div className="prod-card-row">
                    <span className="prod-price">{currency(p.rate)}</span>
                    <span className="ch-cell-sub"><b style={low || out ? { color: 'var(--ch-danger)' } : { color: 'var(--ch-ink)' }}>{number(p.stock)}</b> / min {number(reorderLevelOf(p))}</span>
                  </div>
                  <div className="ch-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(4, (Number(p.stock) / 50) * 100))}%` }} /></div>
                  <div className="prod-card-hover">
                    <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => setDetails(p)}><Eye size={13} /> View</button>
                    {editable && (
                      <>
                        <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => openEdit(p)}><Pencil size={13} /> Edit</button>
                        <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => { setStockTarget(p); setStockDelta(''); }}>Stock</button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <div className="ch-pagination">
          <label className="ch-row" style={{ gap: 8 }}>
            <input type="checkbox" className="ch-checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleSelectAll} aria-label="Select all" />
            Select all
          </label>
          <span>Showing {filtered.length} of {products.length}</span>
        </div>
      </Card>

      {/* Drawer details panel */}
      {details !== null && (
        <div className="ch-drawer-backdrop" onClick={() => setDetails(null)} role="presentation">
          <aside
            className="ch-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`Product details — ${details.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ch-drawer-head">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {details.image_id ? (
                  <img className="prod-drawer-img" src={productImageUrl(rowId(details))} alt="" aria-hidden="true" />
                ) : (
                  <span className="ch-thumb" style={{ width: 52, height: 52, fontSize: 20 }} aria-hidden="true">{details.name.charAt(0).toUpperCase()}</span>
                )}
                <div>
                  <h2 className="ch-modal-title">{details.name}</h2>
                  <p className="ch-modal-sub">{details.sku} · {productNames(details).join(', ') || 'General'}</p>
                </div>
              </div>
              <button type="button" className="ch-modal-x" onClick={() => setDetails(null)} aria-label="Close details"><X size={16} /></button>
            </div>
            <div className="ch-drawer-body">
              <div className="prod-drawer-price">
                <span><span className="ch-cell-sub">Selling</span><br /><b>{currency(details.rate)}</b></span>
                <span><span className="ch-cell-sub">Cost</span><br /><b>{currency(details.cost_price ?? 0)}</b></span>
                <span><span className="ch-cell-sub">Profit / unit</span><br /><b>{currency(profitPerUnit(details))}</b></span>
                <span><span className="ch-cell-sub">Stock</span><br /><b>{number(details.stock)}</b></span>
                <StatusBadge status={isOutOfStock(details) ? 'Out of stock' : isLowStock(details) ? 'Low stock' : 'In stock'} />
              </div>
              <dl className="prod-drawer-dl">
                <div><dt>SKU</dt><dd>{details.sku}</dd></div>
                <div><dt>Barcode</dt><dd>{details.barcode || '—'}</dd></div>
                <div><dt>Categor{productNames(details).length === 1 ? 'y' : 'ies'}</dt><dd>{productNames(details).join(', ') || 'General'}</dd></div>
                {(() => {
                  const linked = details.category_id !== undefined && details.category_id !== null && String(details.category_id) !== ''
                    ? categoryById.get(String(details.category_id))
                    : undefined;
                  if (details.category_id !== undefined && details.category_id !== null && String(details.category_id) !== '' && linked === undefined) {
                    return <div><dt>Category link</dt><dd><span className="ch-form-error">Invalid — category missing. Re-link or run Repair links.</span></dd></div>;
                  }
                  if (linked === undefined) {
                    return <div><dt>Category source</dt><dd><span className="ch-cell-sub">Free text (legacy)</span></dd></div>;
                  }
                  return (
                    <>
                      <div><dt>Category description</dt><dd>{linked.description || '—'}</dd></div>
                      <div><dt>Category status</dt><dd><StatusBadge status={linked.status || 'Active'} /></dd></div>
                      <div><dt>Display order</dt><dd>{number(linked.display_order ?? 0)}</dd></div>
                    </>
                  );
                })()}
                <div><dt>Unit</dt><dd>{details.unit || 'Piece'}</dd></div>
                <div><dt>Tax</dt><dd>{Number(details.tax_percentage ?? 0)}%</dd></div>
                <div><dt>Reorder level</dt><dd>{number(reorderLevelOf(details))} units</dd></div>
                <div><dt>Status</dt><dd><StatusBadge status={details.status || 'Active'} /></dd></div>
                <div><dt>Stock value</dt><dd><b>{currency(stockValueOf(details))}</b></dd></div>
                {details.description !== undefined && details.description !== '' && (
                  <div><dt>Description</dt><dd>{details.description}</dd></div>
                )}
              </dl>
              <div className="ch-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(4, (Number(details.stock) / 50) * 100))}%` }} /></div>
              <p className="ch-hint" style={{ marginTop: 10 }}>Stock level indicator relative to a 50-unit par.</p>
            </div>
            {editable && (
              <div className="ch-drawer-foot">
                <button type="button" className="ch-btn ch-btn-secondary" onClick={() => { const p = details; setDetails(null); openEdit(p); }}><Pencil size={14} /> Edit</button>
                <button type="button" className="ch-btn ch-btn-primary" onClick={() => { const p = details; setDetails(null); setStockTarget(p); setStockDelta(''); }}>Adjust stock</button>
              </div>
            )}
          </aside>
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing === null ? 'Add product' : `Edit ${editing.name}`}
        subtitle="Catalog item stored in the CloudHub datastore"
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setFormOpen(false)} disabled={formBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitForm} disabled={formBusy}>{formBusy ? 'Saving…' : editing === null ? 'Add product' : 'Save changes'}</button>
          </>
        }
      >
        {formError !== '' && <p className="ch-form-error">{formError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-name">Product name</label>
            <input id="pf-name" className="ch-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chicken Rice" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-sku">SKU</label>
            <input id="pf-sku" className="ch-input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. FD-001" disabled={editing !== null} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-barcode">Barcode</label>
            <input id="pf-barcode" className="ch-input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Scan or type…" />
          </div>
          <div className="ch-field ch-field-full">
            <span className="ch-label" id="pf-cats-label">Categories (first checked = primary)</span>
            <div className="prod-cat-checks" role="group" aria-labelledby="pf-cats-label">
              {activeCategories.length === 0 && (
                <span className="ch-hint">No active categories — product saves as General.</span>
              )}
              {activeCategories.map((c) => {
                const id = String(c.ROWID ?? c.name);
                const checked = form.category_ids.includes(id);
                return (
                  <label key={id} className={checked ? 'prod-cat-check on' : 'prod-cat-check'}>
                    <input
                      type="checkbox"
                      className="ch-checkbox"
                      checked={checked}
                      onChange={() => toggleFormCategory(id)}
                    />
                    {c.name}
                    {form.category_ids[0] === id && form.category_ids.length > 1 && (
                      <span className="ch-cell-sub"> · primary</span>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="ch-row" style={{ marginTop: 8 }}>
              {editable && (
                <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={openCatManage} title="Manage categories">
                  Manage
                </button>
              )}
            </div>
            <span className="ch-hint">Linked categories resolve names automatically.</span>
            {catsFailed && allCategories.length === 0 && (
              <span className="ch-hint">Categories could not be loaded — products will save as General until the Categories table is reachable.</span>
            )}
          </div>
          <div className="ch-field ch-field-full">
            <span className="ch-label" id="pf-img-label">Product image (PNG, JPEG, or WebP, max 1.5 MB)</span>
            <div className="prod-img-row" role="group" aria-labelledby="pf-img-label">
              {imagePreview !== null && imagePreview !== '' ? (
                <img className="prod-img-preview" src={imagePreview} alt="Product preview" />
              ) : (
                <span className="prod-img-empty" aria-hidden="true"><ImagePlus size={20} /></span>
              )}
              <span className="prod-img-actions">
                <label className="ch-btn ch-btn-secondary ch-btn-sm" style={{ cursor: 'pointer' }}>
                  {imagePreview ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => { stageImageFile(e.target.files?.[0]); e.target.value = ''; }}
                  />
                </label>
                {imagePreview !== null && imagePreview !== '' && (
                  <button
                    type="button"
                    className="ch-btn ch-btn-ghost ch-btn-sm"
                    disabled={imageBusy}
                    onClick={() => { setImagePreview(null); setImageFile(null); setImageRemoved(true); }}
                  >
                    <ImageOff size={15} /> Remove
                  </button>
                )}
              </span>
            </div>
            {imageBusy && <span className="ch-hint">Saving image…</span>}
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-unit">Unit</label>
            <select id="pf-unit" className="ch-select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
              {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-status">Status</label>
            <select id="pf-status" className="ch-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-rate">Selling price</label>
            <input id="pf-rate" className="ch-input" type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-cost">Cost price</label>
            <input id="pf-cost" className="ch-input" type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })} placeholder="0.00" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-taxmode">Tax treatment</label>
            <select id="pf-taxmode" className="ch-select" value={taxModeSel} onChange={(e) => {
              const v = e.target.value as TaxMode;
              setTaxModeSel(v);
              if (v === 'default') setForm((prev) => ({ ...prev, tax_percentage: String(defaultTaxRate) }));
              if (v === 'exempt') setForm((prev) => ({ ...prev, tax_percentage: '0' }));
              if (v.startsWith('profile:')) {
                const profile = taxProfiles[Number(v.slice('profile:'.length))];
                if (profile !== undefined) setForm((prev) => ({ ...prev, tax_percentage: String(profile.rate) }));
              }
            }}>
              <option value="default">Use default ({defaultTaxRate}%)</option>
              {taxProfiles.map((profile, index) => (
                <option key={`${profile.name}-${index}`} value={`profile:${index}`}>{profile.name} ({profile.rate}%)</option>
              ))}
              <option value="custom">Custom rate</option>
              <option value="exempt">Tax exempt</option>
            </select>
            <span className="ch-hint">Choose a saved tax profile, use the current default, or enter a custom rate.</span>
          </div>
          {taxModeSel === 'custom' && (
            <div className="ch-field">
              <label className="ch-label" htmlFor="pf-tax">Custom tax %</label>
              <input id="pf-tax" className="ch-input" type="number" min="0" step="0.01" value={form.tax_percentage} onChange={(e) => setForm({ ...form, tax_percentage: e.target.value })} />
            </div>
          )}
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-stock">{editing === null ? 'Opening stock' : 'Stock'}</label>
            <input id="pf-stock" className="ch-input" type="number" step="1" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
          </div>
          {editing === null && (
            <div className="ch-field">
              <label className="ch-label" htmlFor="pf-warehouse">Opening stock warehouse</label>
              <select id="pf-warehouse" className="ch-select" value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
                {activeWarehouses.length === 0 && <option value="">Default warehouse</option>}
                {activeWarehouses.map((warehouse) => (
                  <option key={String(warehouse.ROWID)} value={String(warehouse.ROWID)}>
                    {warehouse.name}{warehouse.is_default === true ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <span className="ch-hint">Opening stock is assigned here. Use Transfers to move stock between warehouses later.</span>
            </div>
          )}
          <div className="ch-field">
            <label className="ch-label" htmlFor="pf-reorder">Reorder level</label>
            <input id="pf-reorder" className="ch-input" type="number" min="0" step="1" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })} placeholder="10" />
            <span className="ch-hint">Flagged low at or below this level.</span>
          </div>
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="pf-desc">Description</label>
            <textarea id="pf-desc" className="ch-textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional product notes…" />
          </div>
        </div>
      </Modal>

      <Modal
        open={catManageOpen}
        title="Manage categories"
        subtitle="First-class catalog grouping — renames apply to linked products automatically"
        onClose={() => setCatManageOpen(false)}
        footer={
          <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setCatManageOpen(false)}>Done</button>
        }
      >
        {catError !== '' && <p className="ch-form-error">{catError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-name">Category name</label>
            <input id="cf-name" className="ch-input" value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. Beverages" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-order">Display order</label>
            <input id="cf-order" className="ch-input" type="number" min="0" step="1" value={catForm.display_order} onChange={(e) => setCatForm({ ...catForm, display_order: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-status">Status</label>
            <select id="cf-status" className="ch-select" value={catForm.status} onChange={(e) => setCatForm({ ...catForm, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-desc">Description</label>
            <input id="cf-desc" className="ch-input" value={catForm.description} onChange={(e) => setCatForm({ ...catForm, description: e.target.value })} placeholder="Optional" />
          </div>
        </div>
        <div className="ch-row" style={{ marginTop: 12 }}>
          <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={submitCat} disabled={catBusy}>
            {catBusy ? 'Saving…' : editingCatId === null ? 'Add category' : 'Save category'}
          </button>
          {editingCatId !== null && (
            <button
              type="button"
              className="ch-btn ch-btn-ghost ch-btn-sm"
              onClick={() => {
                setEditingCatId(null);
                setCatForm({ name: '', description: '', display_order: '0', status: 'Active' });
                setCatError('');
              }}
            >
              Cancel edit
            </button>
          )}
        </div>
        <div className="prod-cat-list">
          {allCategories.length === 0 && <p className="ch-hint">No categories yet — add the first one above.</p>}
          {allCategories.map((c) => {
            const id = String(c.ROWID ?? c.name);
            const linkedCount = catCounts.get(String(c.ROWID ?? '')) ?? 0;
            const isActive = (c.status || 'Active') === 'Active';
            return (
              <div key={id} className="prod-cat-row">
                <span className="prod-cat-meta">
                  <span className="ch-cell-main">{c.name}</span>
                  <span className="ch-cell-sub">Order {number(c.display_order ?? 0)}{c.description ? ` · ${c.description}` : ''} · {linkedCount} product{linkedCount === 1 ? '' : 's'}</span>
                </span>
                <StatusBadge status={c.status || 'Active'} />
                <span className="prod-actions">
                  <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => openCatEdit(c)} aria-label={`Edit ${c.name}`}><Pencil size={15} /></button>
                  {isActive ? (
                    <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setCatDeactivate(c)}>Deactivate</button>
                  ) : (
                    <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => reactivateCat(c)}>Reactivate</button>
                  )}
                  {linkedCount === 0 && (
                    <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm prod-danger" onClick={() => setCatDelete(c)} aria-label={`Delete ${c.name}`} title="Delete permanently (no linked products)"><Trash2 size={15} /></button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Modal>

      <ConfirmDialog
        open={catDeactivate !== null}
        title="Deactivate category"
        message={catDeactivate === null ? '' : `Deactivate "${catDeactivate.name}"? Linked products keep working via their saved category name.`}
        confirmLabel="Deactivate"
        danger
        busy={catBusy}
        onConfirm={confirmCatDeactivate}
        onCancel={() => setCatDeactivate(null)}
      />

      <ConfirmDialog
        open={catDelete !== null}
        title="Delete category"
        message={catDelete === null ? '' : `Delete "${catDelete.name}" permanently? This cannot be undone. Only categories with zero linked products can be deleted.`}
        confirmLabel="Delete"
        danger
        busy={catBusy}
        onConfirm={confirmCatDelete}
        onCancel={() => setCatDelete(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete product"
        message={deleteTarget === null ? '' : `Delete "${deleteTarget.name}" (${deleteTarget.sku})? This cannot be undone. Products used in orders cannot be deleted — set Status to Inactive instead.`}
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <Modal
        open={importOpen}
        title="Import products from CSV"
        subtitle="Columns: sku, name, rate, cost_price, stock, reorder_level, barcode, unit, status, tax_percentage, description, categories (;-separated)"
        onClose={() => { if (!importBusy) { setImportOpen(false); setImportError(''); } }}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => { setImportOpen(false); setImportError(''); }} disabled={importBusy}>Close</button>
            <label className="ch-btn ch-btn-primary" style={{ cursor: importBusy ? 'wait' : 'pointer' }}>
              {importBusy ? 'Importing…' : 'Choose CSV file'}
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                disabled={importBusy}
                onChange={(e) => { doImportFile(e.target.files?.[0]); e.target.value = ''; }}
              />
            </label>
          </>
        }
      >
        {importError !== '' && <p className="ch-form-error">{importError}</p>}
        {importResult === null && importError === '' && (
          <p className="ch-hint">SKUs must be unique, categories must already exist and be Active, prices and stock must be 0 or more. Images are not part of CSV import.</p>
        )}
        {importResult !== null && (
          <div className="prod-import-result">
            <p><b>{importResult.inserted} inserted</b><span className="ch-cell-sub"> · {importResult.failed} failed</span></p>
            {importResult.errors.length > 0 && (
              <ul className="prod-import-errors">
                {importResult.errors.slice(0, 50).map((e, i) => (
                  <li key={i}>Row {e.row}{e.sku !== '' ? ` (${e.sku})` : ''}: {e.error}</li>
                ))}
              </ul>
            )}
            {importResult.errors.length > 50 && (
              <p className="ch-hint">Showing first 50 of {importResult.errors.length} errors.</p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={stockTarget !== null}
        title={stockTarget === null ? 'Adjust stock' : `Adjust stock — ${stockTarget.name}`}
        subtitle={stockTarget === null ? undefined : `Current stock: ${number(stockTarget.stock)}`}
        onClose={() => setStockTarget(null)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setStockTarget(null)} disabled={stockBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitStock} disabled={stockBusy || stockDelta.trim() === ''}>{stockBusy ? 'Saving…' : 'Apply adjustment'}</button>
          </>
        }
      >
        <div className="ch-field">
          <label className="ch-label" htmlFor="pf-delta">Quantity change (use negative to reduce)</label>
          <input id="pf-delta" className="ch-input" type="number" step="1" value={stockDelta} onChange={(e) => setStockDelta(e.target.value)} placeholder="e.g. 10 or -5" />
          <span className="ch-hint">Example: +25 for a delivery, −3 for wastage.</span>
        </div>
      </Modal>
    </div>
  );
}
