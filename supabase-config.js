/* Supabase client config for the document portal.
   The anon (publishable) key is public by design — it ships to every browser
   in any Supabase web app. Row Level Security on the server controls data access;
   here we use it only for authentication (login/logout/session). */
(function () {
  var SUPABASE_URL = 'https://dpfxwkxpzqqjtmgqwozw.supabase.co';
  var SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZnh3a3hwenFxanRtZ3F3b3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTQxODksImV4cCI6MjA4ODgzMDE4OX0.sUFX90FKNuxM7u8ftOlDKdf1iD4gsfq2T3S0FDzRdC0';

  if (!window.supabase || !window.supabase.createClient) {
    console.error('[auth] supabase-js nie został załadowany przed supabase-config.js');
    return;
  }
  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
})();
