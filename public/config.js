// Connects the app to your Supabase project. These two values are safe to
// publish: the database rules in supabase/schema.sql decide who sees what.
// Find them in Supabase under Project Settings > API (or "API Keys").
// Until they're filled in, the app only offers the demo household.
window.HERD_CONFIG = {
  supabaseUrl: 'https://PASTE-YOUR-PROJECT-ID.supabase.co',
  supabaseAnonKey: 'PASTE-YOUR-PUBLISHABLE-OR-ANON-KEY',
};
