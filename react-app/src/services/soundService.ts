export type SoundKind = 'success' | 'error' | 'scan' | 'new_order' | 'ready' | 'warning';
let audio: AudioContext | null = null;
let enabled = false;
let lastPlayed = 0;
export function setSoundEnabled(value: boolean) { enabled = value; }
export function audioReady() { return audio?.state === 'running'; }
export async function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') await audio.resume();
    return audio.state === 'running';
  } catch { return false; }
}
export function playSound(kind: SoundKind, force = false) {
  if (!enabled || !audioReady() || !audio || (!force && Date.now() - lastPlayed < 350)) return false;
  lastPlayed = Date.now();
  const notes: Record<SoundKind, number[]> = { scan: [880], success: [660, 880], error: [220, 165], new_order: [784, 988, 784], ready: [523, 659, 1047], warning: [440, 330] };
  const context = audio;
  try {
    notes[kind].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * .13;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(.075, start + .012);
      gain.gain.exponentialRampToValueAtTime(.001, start + .12);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + .13);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
    return true;
  } catch { return false; }
}
export function actionSound(path: string, method: string, data: unknown): SoundKind | null {
  if (method === 'GET' || method === 'HEAD' || /^\/(notifications|auth|printing)(\/|$)/.test(path)) return null;
  if (data && typeof data === 'object') {
    const result = data as { success?: boolean; kitchen_warning?: string; zoho_books?: { warning?: string }; ticket?: { status?: string } };
    if (result.success === false) return 'error';
    if (result.kitchen_warning || result.zoho_books?.warning) return 'warning';
    if (result.ticket?.status === 'READY') return 'ready';
  }
  return 'success';
}
