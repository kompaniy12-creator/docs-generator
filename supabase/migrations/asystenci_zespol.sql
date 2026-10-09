-- Asystenci AI — team mode ("zespol"): the assistants are opened to the office staff.
-- Additive and idempotent. Nothing is opened to the browser here — on the contrary, this file re-asserts
-- that the run log and the bucket of kept files stay closed to every browser role:
--   * public.asystent_przebiegi: RLS on, NO policy, no grant for anon / authenticated;
--   * bucket asystenci-pliki: private, NO storage policy.
-- Both are read and written only by the `asystent` edge function (service role), which applies the rule
-- "a person sees, rates, removes and opens the files of their OWN runs; an administrator sees all" on every
-- call (supabase/functions/asystent/core.ts — `moj`). A direct query with a staff session returns nothing.

alter table public.asystent_przebiegi enable row level security;
revoke all on table public.asystent_przebiegi from anon, authenticated;
update storage.buckets set public = false where id = 'asystenci-pliki' and public is distinct from false;

comment on table public.asystent_przebiegi is
  'Asystenci AI: dziennik uruchomień (kto, asystent, to, co dostał model po zamaskowaniu, odpowiedź, tokeny, szacowany koszt). Tylko service role — funkcja `asystent` pokazuje pracownikowi wyłącznie jego własne uruchomienia (bez kosztów i zapisu wejścia modelu), administratorowi wszystkie. Retencja według ustawienia asystenci.retencja_dni (domyślnie 30 dni).';
comment on column public.asystent_przebiegi.kto is 'e-mail osoby, która uruchomiła asystenta (z sesji portalu) — klucz własności przebiegu';

-- the mode itself lives in portal_ustawienia[''asystenci''].tryb ("test" | "zespol"); a missing or unknown
-- value means "test" (administrators on the testers list only). It is switched with a jsonb merge:
--   update public.portal_ustawienia set value = value || '{"tryb":"zespol"}'::jsonb, updated_at = now() where key = 'asystenci';
