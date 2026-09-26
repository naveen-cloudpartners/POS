import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Landing from './pages/Landing';
import RootEntry from './pages/RootEntry';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Pos from './pages/Pos';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Reports from './pages/Reports';
import WorkspaceView from './pages/WorkspaceView';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './layouts/MainLayout';

export default function App() {
  return (
    <BrowserRouter basename="/app">
      <Routes>
        {/* Stray /app/index.html landings (bookmarks, Catalyst home links) */}
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        {/* RootEntry checks session FIRST, then routes to /landing or /dashboard */}
        <Route path="/" element={<RootEntry />} />
        <Route path="/landing" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Authenticated enterprise workspace: rail + context panel + views */}
        <Route element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
          {/* Dashboard workspace */}
          <Route path="/dashboard" element={<Dashboard />} />

          {/* Inventory workspace */}
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/products" element={<Products />} />
          <Route path="/inventory/categories" element={<WorkspaceView />} />
          <Route path="/inventory/adjustments" element={<WorkspaceView />} />
          <Route path="/inventory/warehouses" element={<WorkspaceView />} />
          <Route path="/inventory/transfers" element={<WorkspaceView />} />
          <Route path="/inventory/movements" element={<WorkspaceView />} />
          {/* Legacy alias */}
          <Route path="/products" element={<Products />} />

          {/* Sales workspace */}
          <Route path="/sales/pos" element={<Pos />} />
          <Route path="/sales/orders" element={<Orders />} />
          <Route path="/sales/payments" element={<WorkspaceView />} />
          <Route path="/sales/invoices" element={<WorkspaceView />} />
          <Route path="/sales/returns" element={<WorkspaceView />} />
          <Route path="/sales/kitchen" element={<WorkspaceView />} />
          {/* Legacy aliases */}
          <Route path="/pos" element={<Pos />} />
          <Route path="/orders" element={<Orders />} />

          {/* Customers workspace */}
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/loyalty" element={<WorkspaceView />} />
          <Route path="/customers/rewards" element={<WorkspaceView />} />
          <Route path="/customers/membership" element={<WorkspaceView />} />

          {/* Reports workspace (section anchors inside the page) */}
          <Route path="/reports" element={<Reports />} />

          {/* Administration workspace */}
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/roles" element={<WorkspaceView />} />
          <Route path="/admin/activity" element={<WorkspaceView />} />
          <Route path="/admin/audit" element={<WorkspaceView />} />
          {/* Legacy alias */}
          <Route path="/users" element={<Users />} />

          {/* Settings workspace (section anchors inside the page) */}
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/business" element={<WorkspaceView />} />
          <Route path="/settings/automation" element={<WorkspaceView />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
