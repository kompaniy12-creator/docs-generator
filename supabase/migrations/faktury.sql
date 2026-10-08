-- Invoices of the office (wFirma) for the client profile: the payer's NIP as a real column,
-- so a client can be shown its own invoices. Filled by the sync; backfilled from the stored data.
alter table public.invoices add column if not exists contractor_nip text;
create index if not exists invoices_contractor_nip on public.invoices (contractor_nip, issue_date desc);
update public.invoices
   set contractor_nip = nullif(regexp_replace(coalesce(case when jsonb_typeof(wfirma_data) = 'string' then (wfirma_data #>> '{}')::jsonb else wfirma_data end ->> 'contractor_nip', ''), '\D', '', 'g'), '')
 where contractor_nip is null and wfirma_data is not null;

select cron.unschedule(jobname) from cron.job where jobname = 'portal-faktury';
-- every 3 hours; the function does nothing until the wFirma application key is configured
select cron.schedule('portal-faktury', '5 */3 * * *', $$select public.portal_cron_call('faktury', 'sync')$$);
