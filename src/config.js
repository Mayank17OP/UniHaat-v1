// UniHaat runtime configuration.
//
// The publishable ("anon") key is designed to ship in the browser — it is
// public by design and only grants the access our Row Level Security policies
// allow. The secret/service-role key must NEVER appear here.
//
// To point the app at a different Supabase project, override at runtime
// before the app boots, e.g. in index.html:
//   <script>window.UNIHAAT_CONFIG = { supabaseUrl: "...", supabaseKey: "..." };</script>

const DEFAULTS = {
  supabaseUrl: "https://gzbmqwvybcmxlsgouhyh.supabase.co",
  supabaseKey: "sb_publishable_IEnWxp9YcxdilAbXxj8KHw_YQp34BbU",
};

const runtime = (typeof window !== "undefined" && window.UNIHAAT_CONFIG) || {};

export const CONFIG = { ...DEFAULTS, ...runtime };

export const isSupabaseConfigured = () =>
  Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey);
