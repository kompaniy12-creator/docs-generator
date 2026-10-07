-- Schedules (UTC). The key for the calls lives in Vault (name 'cron_key') and in the
-- functions' CRON_KEY secret; it is never stored in this file or in cron.job.
create extension if not exists pg_net;

create or replace function public.portal_cron_call(fn text, action text) returns bigint
language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://dpfxwkxpzqqjtmgqwozw.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_key')),
    body := jsonb_build_object('action', action),
    timeout_milliseconds := 120000)
$$;
revoke all on function public.portal_cron_call(text, text) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname in ('portal-terminy', 'portal-watchdog', 'portal-prawo');
-- 05:10 UTC = 07:10 in summer, 06:10 in winter (Europe/Warsaw)
select cron.schedule('portal-terminy',  '10 5 * * *',  $$select public.portal_cron_call('terminy', 'run')$$);
select cron.schedule('portal-watchdog', '40 6 * * *',  $$select public.portal_cron_call('terminy', 'watchdog')$$);
select cron.schedule('portal-prawo',    '30 4 * * *',  $$select public.portal_cron_call('prawo-monitor', 'run')$$);
