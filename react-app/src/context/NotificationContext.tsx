import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { getNotifications, saveNotificationState, type AppNotification, type NotificationResponse } from '../services/notificationService';
import { audioReady, playSound, setSoundEnabled, unlockAudio } from '../services/soundService';
import { newNotifications, notificationSound } from '../utils/notificationDelivery';

interface Notifications {
  events: AppNotification[]; unread: number; loading: boolean; error: string; saving: boolean;
  soundEnabled: boolean; soundReady: boolean; latest: AppNotification | null;
  refresh: () => void; markRead: (ids: string[]) => Promise<boolean>; toggleSound: () => Promise<void>; testSound: () => Promise<void>;
}
const Context = createContext<Notifications | null>(null);
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const identity = `${user?.userId || user?.email || ''}:${role}`;
  const hasUser = !!user;
  const [events, setEvents] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [soundEnabled, setEnabled] = useState(true);
  const [soundReady, setReady] = useState(audioReady);
  const [latest, setLatest] = useState<AppNotification | null>(null);
  const runtime = useRef({ refresh: () => {}, live: false, identity: '', busy: false, mutating: false, baseline: false, audience: '', seen: new Set<string>(), version: 0 });

  useEffect(() => {
    const state = runtime.current;
    state.identity = identity; state.live = true; state.busy = false; state.mutating = false; state.baseline = false; state.audience = ''; state.seen = new Set(); state.version++;
    setEvents([]); setLatest(null); setError(''); setLoading(true); setSaving(false); setSoundEnabled(false);
    if (!hasUser || !role) { setLoading(false); return () => { state.live = false; state.version++; }; }
    const apply = (response: NotificationResponse, notify: boolean) => {
      if (state.audience !== response.audience) { state.audience = response.audience; state.baseline = false; state.seen = new Set(); }
      const key = `pos-delivered:${response.audience}`;
      try { for (const id of JSON.parse(localStorage.getItem(key) || '[]')) if (typeof id === 'string') state.seen.add(id); } catch { /* storage may be disabled */ }
      const fresh = newNotifications(response.data, state.seen, state.baseline && notify);
      state.baseline = true;
      try { localStorage.setItem(key, JSON.stringify([...state.seen].slice(-500))); } catch { /* visual alerts still work */ }
      setEvents(response.data); setEnabled(response.soundEnabled); setSoundEnabled(response.soundEnabled); setError((response.warnings || []).join(' ')); setLoading(false);
      if (fresh.length) { setLatest(fresh[0]); playSound(notificationSound(fresh)); }
    };
    const refresh = async () => {
      if (state.busy || state.mutating || document.hidden) return;
      const version = state.version;
      state.busy = true;
      try {
        const response = await getNotifications();
        if (state.live && state.identity === identity && version === state.version) apply(response, true);
      } catch (failure) {
        if (state.live && state.identity === identity && version === state.version) { setError(failure instanceof Error ? failure.message : 'Notifications unavailable'); setLoading(false); }
      } finally { if (version === state.version) state.busy = false; }
    };
    state.refresh = () => { void refresh(); };
    const gesture = (event: Event) => { if (event.isTrusted) void unlockAudio().then(() => { if (state.live) setReady(audioReady()); }); };
    const onVisible = () => { if (!document.hidden) state.refresh(); };
    const onDelivered = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) {
        state.seen.add(id);
        try { localStorage.setItem(`pos-delivered:${state.audience}`, JSON.stringify([...state.seen].slice(-500))); } catch { /* optional dedup cache */ }
      }
    };
    void refresh();
    const timer = window.setInterval(state.refresh, 15000);
    window.addEventListener('pointerdown', gesture); window.addEventListener('keydown', gesture);
    window.addEventListener('pos-notifications-refresh', state.refresh); window.addEventListener('pos-alert-delivered', onDelivered);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      state.live = false; state.version++; setSoundEnabled(false); window.clearInterval(timer);
      window.removeEventListener('pointerdown', gesture); window.removeEventListener('keydown', gesture);
      window.removeEventListener('pos-notifications-refresh', state.refresh); window.removeEventListener('pos-alert-delivered', onDelivered);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [identity, hasUser, role]);

  useEffect(() => {
    if (!latest) return;
    const timer = window.setTimeout(() => setLatest(null), 6500);
    return () => window.clearTimeout(timer);
  }, [latest]);
  const persist = async (input: { ids?: string[]; soundEnabled?: boolean }) => {
    const state = runtime.current;
    if (state.mutating || !state.live) return false;
    const session = state.identity;
    state.version++; state.busy = false; state.mutating = true; setSaving(true);
    const version = state.version;
    try {
      const response = await saveNotificationState(input);
      if (!state.live || session !== state.identity || version !== state.version) return false;
      setEvents(response.data); setEnabled(response.soundEnabled); setSoundEnabled(response.soundEnabled); setError((response.warnings || []).join(' '));
      return true;
    } catch (failure) {
      if (state.live && session === state.identity && version === state.version) setError(failure instanceof Error ? failure.message : 'Unable to save notifications');
      return false;
    } finally { if (state.live && session === state.identity && version === state.version) { state.mutating = false; setSaving(false); state.refresh(); } }
  };
  const testSound = async () => { await unlockAudio(); setReady(audioReady()); playSound('new_order', true); };
  const toggleSound = async () => {
    const next = !soundEnabled || !audioReady();
    // Resume within the click gesture, before waiting on the network.
    if (next) await unlockAudio();
    setReady(audioReady());
    if (await persist({ soundEnabled: next })) { if (next) playSound('success', true); }
  };
  return <Context.Provider value={{ events, unread: events.filter(e => !e.read).length, loading, error, saving, soundEnabled, soundReady, latest, refresh: () => runtime.current.refresh(), markRead: ids => persist({ ids }), toggleSound, testSound }}>{children}</Context.Provider>;
}
export function useNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error('NotificationProvider is required');
  return context;
}
