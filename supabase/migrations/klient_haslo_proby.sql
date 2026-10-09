-- Client profile: one password attempt is counted atomically BEFORE the password is checked, so
-- parallel requests cannot slip past the lockout (security review 2026-10-09). Returns false when
-- the account is locked; the attempt that reaches the limit is still allowed and starts the lock.
-- Additive; called only by the `klient` function (service role).
create or replace function public.klient_proba_hasla(p_id uuid, p_max int, p_min int) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.klient_konta set bledne = bledne + 1
   where id = p_id and (blokada_do is null or blokada_do <= now())
  returning bledne into n;
  if not found then return false; end if;
  if n >= greatest(p_max, 1) then
    update public.klient_konta set bledne = 0, blokada_do = now() + make_interval(mins => greatest(p_min, 1)) where id = p_id;
  end if;
  return true;
end $$;
revoke all on function public.klient_proba_hasla(uuid, int, int) from public, anon, authenticated;
grant execute on function public.klient_proba_hasla(uuid, int, int) to service_role;
