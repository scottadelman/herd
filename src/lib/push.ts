import type { Backend } from './types';

// Push reminders. On iPhone these only work once Herd is added to the Home
// Screen and opened from there (iOS 16.4 or newer).

export type PushSupport = 'ok' | 'needs-install' | 'unsupported';

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (ok) return 'ok';
  return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null;
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function keyToBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function bytesToKey(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function enablePush(backend: Backend): Promise<void> {
  if (!backend.supportsPush) throw new Error('Reminders work in the real app, not the demo.');
  if (pushSupport() !== 'ok') throw new Error('Add Herd to your Home Screen and open it from there to turn on reminders.');
  const key = await backend.getPushPublicKey();
  if (!key) {
    throw new Error('Reminders aren’t switched on for this app yet. The README’s “Turn on reminders” steps set them up.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them for Herd in your phone’s Settings, then try again.');
  }
  const reg = await registration();
  if (!reg) throw new Error('Reminders need the installed app. Open Herd from your Home Screen and try again.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) as BufferSource });
  }
  await backend.savePushSubscription({
    endpoint: sub.endpoint,
    p256dh: bytesToKey(sub.getKey('p256dh')),
    auth: bytesToKey(sub.getKey('auth')),
  });
}

export async function disablePush(backend: Backend): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await backend.deletePushSubscription(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
