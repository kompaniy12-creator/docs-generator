-- Access changes take effect at once: when an administrator revokes somebody's portal access or narrows
-- the sections, the portal-admin function ends that person's sessions (the refresh tokens go with them),
-- so the old claims live at most until the access token already issued runs out. The auth project is shared
-- with the office's other apps: the person signs in there again. Service role only. Purely additive.
create or replace function public.portal_zakoncz_sesje(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_user is null then return 0; end if;
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.portal_zakoncz_sesje(uuid) from public, anon, authenticated;
grant execute on function public.portal_zakoncz_sesje(uuid) to service_role;
