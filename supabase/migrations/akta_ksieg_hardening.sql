-- Hardening after the security review of 2026-10-08.
alter table public.akta_dokumenty add column if not exists analiza_at timestamptz;
-- a scan's path is always "<row id>/<plain file name>" in the akta-osobowe bucket
alter table public.akta_dokumenty drop constraint if exists akta_path_ok;
alter table public.akta_dokumenty add constraint akta_path_ok
  check (path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]+$' and path !~ '\.\.' and path like id::text || '/%');
update storage.buckets set file_size_limit = 25165824,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/gif']
  where id = 'akta-osobowe';
revoke all on public.ksieg_zamkniecia from anon;

-- who uploaded / checked / changed is taken from the session, not from what the browser sends
create or replace function public.akta_audit() returns trigger language plpgsql set search_path = '' as $$
declare me text := nullif(auth.jwt() ->> 'email', '');
begin
  if me is null then return new; end if; -- service role (the akta function)
  if tg_op = 'INSERT' then new.uploaded_by := me; new.sprawdzil := null; new.sprawdzono_at := null;
  else
    new.uploaded_by := old.uploaded_by; new.path := old.path;
    if new.sprawdzil is distinct from old.sprawdzil or new.sprawdzono_at is distinct from old.sprawdzono_at then
      new.sprawdzil := me; new.sprawdzono_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists akta_audit on public.akta_dokumenty;
create trigger akta_audit before insert or update on public.akta_dokumenty for each row execute function public.akta_audit();

create or replace function public.ksieg_audit() returns trigger language plpgsql set search_path = '' as $$
declare me text := nullif(auth.jwt() ->> 'email', '');
begin
  if me is not null then new.updated_by := me; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ksieg_audit on public.ksieg_zamkniecia;
create trigger ksieg_audit before insert or update on public.ksieg_zamkniecia for each row execute function public.ksieg_audit();
