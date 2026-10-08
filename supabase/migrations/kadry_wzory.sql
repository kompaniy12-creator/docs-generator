-- Generator dokumentów: approvals of the bureau's own document templates by the HR officer.
-- One settings row; portal users with the Kadry section may read and update THIS key only
-- (every other key of portal_ustawienia stays service-role only).
insert into public.portal_ustawienia (key, value) values ('kadry_wzory', '{}'::jsonb) on conflict (key) do nothing;
drop policy if exists kadry_wzory_select on public.portal_ustawienia;
create policy kadry_wzory_select on public.portal_ustawienia for select to authenticated
  using (key = 'kadry_wzory' and public.has_portal_section('kadry'));
drop policy if exists kadry_wzory_update on public.portal_ustawienia;
create policy kadry_wzory_update on public.portal_ustawienia for update to authenticated
  using (key = 'kadry_wzory' and public.has_portal_section('kadry'))
  with check (key = 'kadry_wzory' and public.has_portal_section('kadry'));
grant select, update on public.portal_ustawienia to authenticated;
