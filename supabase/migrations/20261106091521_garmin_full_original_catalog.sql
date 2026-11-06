-- Private full-file Garmin catalogue. Applied 2026-11-06.
-- The original ZIP is not duplicated. Coaches are not granted raw file access.
begin;
create table public.garmin_original_catalog (
 owner_id uuid not null,
 archive_id text not null,
 pack_name text not null check(length(pack_name) between 1 and 255),
 entries jsonb not null check(
  jsonb_typeof(entries)='array' and jsonb_array_length(entries) between 0 and 5000
  and octet_length(entries::text)<=1500000),
 indexed_at timestamptz not null default now(),
 primary key(owner_id,archive_id,pack_name),
 foreign key(owner_id,archive_id) references public.garmin_original_archives(owner_id,archive_id) on delete cascade
);
alter table public.garmin_original_catalog enable row level security;
revoke all on public.garmin_original_catalog from public,anon,authenticated,service_role;
grant select,insert,update on public.garmin_original_catalog to authenticated;
grant all on public.garmin_original_catalog to service_role;
create policy garmin_catalog_read_own on public.garmin_original_catalog
 for select to authenticated using(owner_id=(select auth.uid()));
create policy garmin_catalog_insert_own on public.garmin_original_catalog
 for insert to authenticated with check(owner_id=(select auth.uid())
 and exists(select 1 from public.garmin_original_archives a where a.owner_id=(select auth.uid())
  and a.archive_id=garmin_original_catalog.archive_id and a.status='ready'));
create policy garmin_catalog_update_own on public.garmin_original_catalog
 for update to authenticated using(owner_id=(select auth.uid()))
 with check(owner_id=(select auth.uid())
 and exists(select 1 from public.garmin_original_archives a where a.owner_id=(select auth.uid())
  and a.archive_id=garmin_original_catalog.archive_id and a.status='ready'));
comment on table public.garmin_original_catalog is
'Private per-pack file index. Complete data are retained in the original ZIP, owner-only.';
commit;
