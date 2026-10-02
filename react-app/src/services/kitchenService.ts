import { apiFetch } from './api';

export type KitchenStatus = 'QUEUED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
export interface KitchenTicket {
  number: string; orderId: string; station: string; status: KitchenStatus;
  items: Array<{ name: string; sku: string; qty: number; imageUrl?: string }>;
  roomNumber: string; notes: string; firedAt: string; updatedAt: string;
  cancellationNote: string; detailsMissing: boolean;
}
export async function getKitchenTickets() {
  return apiFetch<{ success: boolean; data: KitchenTicket[]; hasMore: boolean; generatedAt: string }>('/kitchen/tickets');
}
export async function updateKitchenTicket(ticket: KitchenTicket, status: KitchenStatus) {
  const response = await apiFetch<{ success: boolean; ticket: KitchenTicket }>(`/kitchen/tickets/${encodeURIComponent(ticket.number)}/status`, { method: 'POST', body: { expected: ticket.status, status } });
  return response.ticket;
}
