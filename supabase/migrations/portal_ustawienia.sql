-- Portal settings kept server-side (e.g. the Telegram chats that get notifications).
-- Service role only: read and written through edge functions, no policies.
create table if not exists public.portal_ustawienia (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.portal_ustawienia enable row level security;
