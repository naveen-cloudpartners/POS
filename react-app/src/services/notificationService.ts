import { apiFetch } from './api';
export interface AppNotification {
  id: string;
  kind: 'kitchen_new' | 'kitchen_ready' | 'kitchen_cancelled' | 'stock';
  title: string;
  message: string;
  createdAt: string;
  href: string;
  read: boolean;
}
export interface NotificationResponse { success: boolean; audience: string; data: AppNotification[]; soundEnabled: boolean; generatedAt: string; warnings?: string[] }
export const getNotifications = () => apiFetch<NotificationResponse>('/notifications');
export const saveNotificationState = (input: { ids?: string[]; soundEnabled?: boolean }) => apiFetch<NotificationResponse>('/notifications/state', { method: 'PUT', body: input });
