import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Landing from './pages/Landing';
import RootEntry from './pages/RootEntry';
import Dashboard from './pages/Dashboard';
import KitchenBoard from './pages/KitchenBoard';
import Login from './pages/Login';
import Register from './pages/Register';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Pos from './pages/Pos';
import Orders from './pages/Orders';
import Customers from './pages/Customers';
import Users from './pages/Users';
import Settings from './pages/Settings';
import ProfileSettings from './pages/ProfileSettings';
import { useAuth } from './context/AuthContext';
import Reports from './pages/Reports';
import Purchases from './pages/Purchases';
import WorkspaceView from './pages/WorkspaceView';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './layouts/MainLayout';

function SettingsPage() {
  const { role } = useAuth();
  return role === 'Admin' ? <Settings /> : <ProfileSettings />;
}

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
          <Route path="/inventory/warehouses" element={<WorkspaceView />} />
          <Route path="/inventory/transfers" element={<WorkspaceView />} />
          <Route path="/inventory/movements" element={<WorkspaceView />} />

          {/* Purchasing workspace */}
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/purchases/vendors" element={<Purchases />} />
          <Route path="/purchases/orders" element={<Purchases />} />
          <Route path="/purchases/receiving" element={<Purchases />} />
          <Route path="/purchases/bills" element={<Purchases />} />
          <Route path="/purchases/payments" element={<Purchases />} />
          {/* Legacy alias */}
          <Route path="/products" element={<Products />} />

          {/* Sales workspace */}
          <Route path="/sales/pos" element={<Pos />} />
          <Route path="/sales/orders" element={<Orders />} />
          <Route path="/sales/payments" element={<WorkspaceView />} />
          <Route path="/sales/invoices" element={<WorkspaceView />} />
          <Route path="/sales/returns" element={<WorkspaceView />} />
          <Route path="/sales/kitchen" element={<KitchenBoard />} />
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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/profile" element={<ProfileSettings />} />
          <Route path="/settings/business" element={<WorkspaceView />} />
          <Route path="/settings/automation" element={<WorkspaceView />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
