import type { Order } from '../types/index';

export interface DailyDashboardPoint {
  date: string;
  previousDate: string;
  label: string;
  revenue: number;
  previousRevenue: number;
  cumulativeRevenue: number;
  previousCumulativeRevenue: number;
  orders: number;
  previousOrders: number;
  unpaidOrders: number;
}

/** Catalyst timestamps are store-local strings. Keep their calendar date,
 * avoiding UTC conversion moving a late-night sale into a different day. */
export function calendarKey(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (match) return match[1];
  return null;
}

function localKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function buildDashboardSeries(orders: Order[], days: number, now = new Date()): DailyDashboardPoint[] {
  const buckets = new Map<string, { revenue: number; orders: number; unpaidOrders: number }>();
  for (const order of orders) {
    const status = String(order.status ?? '').trim().toLowerCase();
    if (['void', 'voided', 'cancelled', 'canceled', 'refunded'].includes(status)) continue;
    const key = calendarKey(String(order.CREATEDTIME ?? ''));
    if (!key) continue;
    const paid = Number(order.paid_total ?? 0);
    const total = Number(order.total ?? 0);
    const bucket = buckets.get(key) ?? { revenue: 0, orders: 0, unpaidOrders: 0 };
    bucket.revenue += Number.isFinite(paid) ? Math.max(0, paid) : 0;
    bucket.orders += 1;
    if (Number.isFinite(total) && total > 0 && (!Number.isFinite(paid) || paid < total - .01)) bucket.unpaidOrders += 1;
    buckets.set(key, bucket);
  }
  let cumulativeRevenue = 0;
  let previousCumulativeRevenue = 0;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1 + index);
    const previous = new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
    const key = localKey(date);
    const previousKey = localKey(previous);
    const current = buckets.get(key);
    const prior = buckets.get(previousKey);
    cumulativeRevenue += current?.revenue ?? 0;
    previousCumulativeRevenue += prior?.revenue ?? 0;
    return {
      date: key, previousDate: previousKey,
      label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      revenue: current?.revenue ?? 0, previousRevenue: prior?.revenue ?? 0,
      cumulativeRevenue, previousCumulativeRevenue,
      orders: current?.orders ?? 0, unpaidOrders: current?.unpaidOrders ?? 0,
      previousOrders: prior?.orders ?? 0,
    };
  });
}
