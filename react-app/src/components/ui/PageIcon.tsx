import { useLocation } from 'react-router-dom';
import { Boxes, Package, Tags, Warehouse, ArrowLeftRight, History, LayoutDashboard, ShoppingCart, Users, UserCog, ChartNoAxesCombined, Settings, ReceiptText } from 'lucide-react';

export default function PageIcon() {
  const { pathname } = useLocation();
  const Icon = pathname.includes('products') ? Package : pathname.includes('categories') ? Tags : pathname.includes('warehouses') ? Warehouse : pathname.includes('transfers') ? ArrowLeftRight : pathname.includes('movements') ? History : pathname.includes('inventory') ? Boxes : pathname.includes('dashboard') ? LayoutDashboard : pathname.includes('customers') ? Users : pathname.includes('users') || pathname.includes('admin') ? UserCog : pathname.includes('reports') ? ChartNoAxesCombined : pathname.includes('settings') ? Settings : pathname.includes('orders') ? ReceiptText : ShoppingCart;
  return <span className="workspace-page-icon" aria-hidden="true"><Icon size={23} strokeWidth={1.7} /></span>;
}
