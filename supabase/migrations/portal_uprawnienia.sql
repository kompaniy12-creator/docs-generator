-- Uprawnienia szczegółowe (phase 1): the SQL face of the per-function switch-off list.
-- app_metadata.portal_wylaczone is a DENY list of catalogue keys (see /uprawnienia.js). portal_moze(k) answers
-- "may the caller use key k": a portal user, and either an administrator, or no list at all, or a list that
-- holds neither k nor a dotted ancestor of k. A claim that is not a list denies everything (fail closed).
-- Nothing uses the function yet: phase 3 adds it to the row level security policies. It reads only the
-- caller's own token, like is_portal_user() / has_portal_section(), and has the same grants.
create or replace function public.portal_moze(k text) returns boolean
language sql stable set search_path to '' as $$
  select coalesce((auth.jwt()->'app_metadata'->>'portal')='true', false) and (
    coalesce((auth.jwt()->'app_metadata'->>'portal_admin')='true', false)
    or case coalesce(jsonb_typeof(auth.jwt()->'app_metadata'->'portal_wylaczone'), 'null')
         when 'null' then true
         when 'array' then not exists (
           select 1 from jsonb_array_elements_text(auth.jwt()->'app_metadata'->'portal_wylaczone') e
           where k = e or left(k, length(e) + 1) = e || '.')
         else false end)
$$;
comment on function public.portal_moze(text) is 'Uprawnienia szczegółowe: czy wywołujący może użyć funkcji o danym kluczu (lista app_metadata.portal_wylaczone; administrator zawsze).';
grant execute on function public.portal_moze(text) to anon, authenticated, service_role;
