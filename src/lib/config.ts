declare global {
  interface Window {
    HERD_CONFIG?: { supabaseUrl?: string; supabaseAnonKey?: string };
  }
  const __PREVIEW__: boolean;
}

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Reads public/config.js. Returns null until real Supabase values are filled in. */
export function readConfig(): AppConfig | null {
  if (__PREVIEW__) return null;
  const c = window.HERD_CONFIG;
  const url = c?.supabaseUrl?.trim() ?? '';
  const key = c?.supabaseAnonKey?.trim() ?? '';
  if (!url.startsWith('https://') || !key || key.includes('PASTE')) return null;
  return { supabaseUrl: url, supabaseAnonKey: key };
}

export const isPreviewBuild = __PREVIEW__;
