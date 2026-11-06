-- Sports-only samples, separate from the owner's complete private Garmin export.
alter table public.athlete_coach_fit_sharing add column series_enabled boolean not null default false;
grant update(series_enabled) on public.athlete_coach_fit_sharing to authenticated;
create policy fit_sharing_owner_update_series on public.athlete_coach_fit_sharing for update to authenticated
 using(athlete_id=(select auth.uid())) with check(athlete_id=(select auth.uid()) and exists(
 select 1 from public.coach_athletes ca where ca.athlete_id=athlete_coach_fit_sharing.athlete_id and ca.coach_id=athlete_coach_fit_sharing.coach_id and ca.status='active'));
alter table public.garmin_fit_scan_progress add column processing_version integer not null default 1 check(processing_version between 1 and 20);
alter table public.garmin_fit_analysis add column np_method text check(np_method in ('device','records_1s'));
alter table public.garmin_fit_analysis add column source_format text not null default 'FIT' check(source_format in ('FIT','TCX','GPX'));
alter table public.garmin_fit_analysis add column source_file_key text;
update public.garmin_fit_analysis set source_file_key=encode(sha256(convert_to(pack_name||E'\n'||file_name,'UTF8')),'hex');
alter table public.garmin_fit_analysis alter column source_file_key set not null;
create function asturpower_private.set_fit_reference_key() returns trigger language plpgsql security invoker set search_path='' as $$begin
 new.source_file_key:=encode(sha256(convert_to(new.pack_name||E'\n'||new.file_name,'UTF8')),'hex');return new;
end;$$;
revoke all on function asturpower_private.set_fit_reference_key() from public,anon,authenticated;
create trigger fit_reference_key before insert or update of pack_name,file_name on public.garmin_fit_analysis for each row execute function asturpower_private.set_fit_reference_key();
grant select(source_file_key) on public.garmin_fit_analysis to authenticated;
grant select(np_method) on public.garmin_fit_analysis to authenticated;
grant select(source_format) on public.garmin_fit_analysis to authenticated;
alter policy garmin_fit_analysis_insert_self on public.garmin_fit_analysis with check(
 athlete_id=(select auth.uid()) and exists(select 1 from public.activities a where a.id=activity_id and a.athlete_id=(select auth.uid()) and a.source in ('garmin_export','garmin_api'))
 and exists(select 1 from public.garmin_original_catalog cat where cat.owner_id=(select auth.uid()) and cat.archive_id=garmin_fit_analysis.archive_id and cat.pack_name=garmin_fit_analysis.pack_name
 and exists(select 1 from jsonb_array_elements(cat.entries) e where e->>'name'=garmin_fit_analysis.file_name and e->>'kind'=garmin_fit_analysis.source_format)));
grant update(normalized_power_watts,power_seconds,power_coverage,sample_count,np_method,calculation_version) on public.garmin_fit_analysis to authenticated;
create policy fit_analysis_owner_upgrade on public.garmin_fit_analysis for update to authenticated
 using(athlete_id=(select auth.uid())) with check(athlete_id=(select auth.uid()));

create table public.garmin_fit_diagnostics(
 athlete_id uuid not null references auth.users(id) on delete cascade,
 archive_id text not null,file_key text not null check(file_key ~ '^[a-f0-9]{64}$'),
 file_name text not null default '' check(length(file_name)<=2048),pack_name text not null default '' check(length(pack_name)<=2048),
 reason text not null check(reason in ('linked','already_linked','not_activity','multi_session','few_records','invalid_session','unsupported_sport','no_match','ambiguous_match','unreadable','size_limit','series_saved')),
 activity_id uuid references public.activities(id) on delete cascade,
 checked_at timestamptz not null default now(),primary key(athlete_id,archive_id,file_key),
 foreign key(athlete_id,archive_id) references public.garmin_original_archives(owner_id,archive_id) on delete cascade
);
alter table public.garmin_fit_diagnostics enable row level security;
create index garmin_fit_diagnostics_activity on public.garmin_fit_diagnostics(activity_id);
revoke all on public.garmin_fit_diagnostics from public,anon,authenticated;
grant select,insert,update on public.garmin_fit_diagnostics to authenticated;
grant all on public.garmin_fit_diagnostics to service_role;
create policy fit_diagnostics_owner_read on public.garmin_fit_diagnostics for select to authenticated using(athlete_id=(select auth.uid()));
create policy fit_diagnostics_owner_insert on public.garmin_fit_diagnostics for insert to authenticated with check(athlete_id=(select auth.uid()) and (activity_id is null or exists(select 1 from public.activities a where a.id=activity_id and a.athlete_id=(select auth.uid()))));
create policy fit_diagnostics_owner_update on public.garmin_fit_diagnostics for update to authenticated using(athlete_id=(select auth.uid())) with check(athlete_id=(select auth.uid()) and (activity_id is null or exists(select 1 from public.activities a where a.id=activity_id and a.athlete_id=(select auth.uid()))));

create table public.garmin_activity_series(
 athlete_id uuid not null references auth.users(id) on delete cascade,
 activity_id uuid not null references public.activities(id) on delete cascade,
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 byte_size integer not null check(byte_size between 1 and 4194304),
 status text not null default 'uploading' check(status in ('uploading','ready')),
 created_at timestamptz not null default now(),primary key(athlete_id,activity_id)
);
create index garmin_activity_series_activity on public.garmin_activity_series(activity_id);
alter table public.garmin_activity_series enable row level security;
revoke all on public.garmin_activity_series from public,anon,authenticated;
grant select on public.garmin_activity_series to authenticated;
grant all on public.garmin_activity_series to service_role;
create policy sports_series_authorized_read on public.garmin_activity_series for select to authenticated using(
 athlete_id=(select auth.uid()) or (status='ready' and exists(
 select 1 from public.athlete_coach_fit_sharing s join public.coach_athletes ca on ca.athlete_id=s.athlete_id and ca.coach_id=s.coach_id
 where s.athlete_id=garmin_activity_series.athlete_id and s.coach_id=(select auth.uid()) and s.series_enabled and ca.status='active')));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('garmin-sports-series','garmin-sports-series',false,4194304,array['application/octet-stream']);
create policy sports_series_reserved_upload on storage.objects for insert to authenticated with check(
 bucket_id='garmin-sports-series' and exists(select 1 from public.garmin_activity_series s where s.athlete_id=(select auth.uid()) and s.status='uploading'
 and name=s.athlete_id::text||'/'||s.activity_id::text||'/'||s.sha256||'.gz'));
create policy sports_series_authorized_download on storage.objects for select to authenticated using(
 bucket_id='garmin-sports-series' and exists(select 1 from public.garmin_activity_series s where
 name=s.athlete_id::text||'/'||s.activity_id::text||'/'||s.sha256||'.gz' and (s.status='ready' or s.athlete_id=(select auth.uid()))));

create function asturpower_private.reserve_activity_series(p_activity_id uuid,p_sha text,p_bytes integer)
 returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior public.garmin_activity_series; total bigint;
begin
 if actor is null or not exists(select 1 from public.garmin_fit_analysis where athlete_id=actor and activity_id=p_activity_id) then raise exception 'owned_fit_required' using errcode='42501'; end if;
 if p_sha is null or p_sha !~ '^[a-f0-9]{64}$' or p_bytes is null or p_bytes not between 1 and 4194304 then raise exception 'invalid_series_manifest'; end if;
 perform pg_catalog.pg_advisory_xact_lock(681026115);
 select * into prior from public.garmin_activity_series where athlete_id=actor and activity_id=p_activity_id;
 if found then
  if prior.sha256<>p_sha or prior.byte_size<>p_bytes then raise exception 'series_manifest_conflict'; end if;
 else
  select coalesce(sum(byte_size),0) into total from public.garmin_original_archives;
  total:=total+coalesce((select sum(byte_size) from public.garmin_activity_series),0);
  total:=total+coalesce((select sum(case when metadata->>'size' ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else 0 end) from storage.objects where bucket_id not in ('garmin-originals','garmin-sports-series')),0);
  if total+p_bytes>838860800 then raise exception 'series_storage_budget_exceeded' using errcode='54000'; end if;
  insert into public.garmin_activity_series(athlete_id,activity_id,sha256,byte_size) values(actor,p_activity_id,p_sha,p_bytes);
 end if;
 return actor::text||'/'||p_activity_id::text||'/'||p_sha||'.gz';
end; $$;
create function asturpower_private.complete_activity_series(p_activity_id uuid,p_sha text)
 returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s public.garmin_activity_series;
begin
 if actor is null then raise exception 'owned_fit_required' using errcode='42501'; end if;
 select * into s from public.garmin_activity_series where athlete_id=actor and activity_id=p_activity_id and sha256=p_sha for update;
 if not found then raise exception 'series_not_found'; end if;
 if not exists(select 1 from storage.objects where bucket_id='garmin-sports-series' and name=actor::text||'/'||p_activity_id::text||'/'||p_sha||'.gz' and metadata->>'size'=s.byte_size::text) then raise exception 'series_upload_incomplete'; end if;
 update public.garmin_activity_series set status='ready' where athlete_id=actor and activity_id=p_activity_id;
end; $$;
create function public.reserve_activity_series(p_activity_id uuid,p_sha text,p_bytes integer)
 returns text language sql security invoker set search_path='' as $$select asturpower_private.reserve_activity_series(p_activity_id,p_sha,p_bytes)$$;
create function public.complete_activity_series(p_activity_id uuid,p_sha text)
 returns void language sql security invoker set search_path='' as $$select asturpower_private.complete_activity_series(p_activity_id,p_sha)$$;
revoke all on function public.reserve_activity_series(uuid,text,integer),public.complete_activity_series(uuid,text),asturpower_private.reserve_activity_series(uuid,text,integer),asturpower_private.complete_activity_series(uuid,text) from public,anon;
grant execute on function public.reserve_activity_series(uuid,text,integer),public.complete_activity_series(uuid,text),asturpower_private.reserve_activity_series(uuid,text,integer),asturpower_private.complete_activity_series(uuid,text) to authenticated;

-- Explicit bounded replacement: original validation and access remain intact.
create or replace function asturpower_private.reserve_garmin_original(p_archive_id text,p_filename text,p_byte_size bigint,p_chunks jsonb,p_consent boolean)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior public.garmin_original_archives; total bigint; pieces integer;
begin
 if actor is null or not exists(select 1 from public.user_roles where user_id=actor and role='athlete') then
  raise exception 'athlete_required' using errcode='42501';
 end if;
 if p_consent is distinct from true then raise exception 'original_consent_required' using errcode='22023'; end if;
 if p_archive_id is null or p_archive_id !~ '^[a-f0-9]{64}$' or p_filename is null
  or char_length(p_filename) not between 1 and 255 or p_byte_size is null
  or p_byte_size not between 1 and 838860800 or p_chunks is null or jsonb_typeof(p_chunks)<>'array'
  or octet_length(p_chunks::text)>32768 then
  raise exception 'invalid_original_manifest' using errcode='22023';
 end if;
 pieces:=jsonb_array_length(p_chunks);
 if pieces not between 1 and 200 then raise exception 'invalid_original_manifest' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_chunks) with ordinality c(value,n)
   where jsonb_typeof(value)<>'object' or value->>'sha256' is null or value->>'sha256' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(value->'size') is distinct from 'number'
    or coalesce(value->>'size','') !~ '^[0-9]{1,7}$') then
  raise exception 'invalid_original_manifest' using errcode='22023';
 end if;
 if exists(select 1 from jsonb_array_elements(p_chunks) with ordinality c(value,n)
   where (value->>'size')::bigint not between 1 and 4194304
    or (n<pieces and (value->>'size')::bigint<>4194304))
  or (select sum((value->>'size')::bigint) from jsonb_array_elements(p_chunks))<>p_byte_size then
  raise exception 'invalid_original_manifest' using errcode='22023';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(681026115);
 select * into prior from public.garmin_original_archives where owner_id=actor and archive_id=p_archive_id;
 if found then
  if prior.byte_size<>p_byte_size or prior.chunks<>p_chunks then raise exception 'original_manifest_conflict' using errcode='22023'; end if;
  return jsonb_build_object('archive_id',prior.archive_id,'status',prior.status,'byte_size',prior.byte_size);
 end if;
 select coalesce(sum(byte_size),0) into total from public.garmin_original_archives;
 -- Count unrelated buckets too; only the free project reserve (800 MiB) is used.
 total:=total+coalesce((select sum(case when metadata->>'size' ~ '^[0-9]{1,15}$'
  then (metadata->>'size')::bigint else 0 end) from storage.objects where bucket_id<>'garmin-originals'),0);
 total:=total+coalesce((select sum(byte_size) from public.garmin_activity_series where status='uploading'),0);
 if total+p_byte_size>838860800 then raise exception 'original_storage_budget_exceeded' using errcode='54000'; end if;
 insert into public.garmin_original_archives(owner_id,archive_id,filename,byte_size,chunks)
  values(actor,p_archive_id,p_filename,p_byte_size,p_chunks);
 return jsonb_build_object('archive_id',p_archive_id,'status','uploading','byte_size',p_byte_size);
end; $$;
