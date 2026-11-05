-- Additive original-file vault. Does not reapply or alter the Garmin sync migration.
-- Complete account exports are owner-only, including when a coach is linked.
begin;

create table public.garmin_original_archives (
 owner_id uuid not null references auth.users(id) on delete cascade,
 archive_id text not null check (archive_id ~ '^[a-f0-9]{64}$'),
 filename text not null check (char_length(filename) between 1 and 255),
 byte_size bigint not null check (byte_size between 1 and 838860800),
 chunks jsonb not null check (jsonb_typeof(chunks)='array' and jsonb_array_length(chunks) between 1 and 200 and octet_length(chunks::text)<=32768),
 consent_version text not null default 'originals-2026-11-05' check (consent_version='originals-2026-11-05'),
 status text not null default 'uploading' check (status in ('uploading','ready')),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 primary key(owner_id,archive_id)
);
alter table public.garmin_original_archives enable row level security;
revoke all on public.garmin_original_archives from public,anon,authenticated,service_role;
grant select on public.garmin_original_archives to authenticated;
grant all on public.garmin_original_archives to service_role;
create policy garmin_original_archives_owner_read on public.garmin_original_archives
 for select to authenticated using(owner_id=(select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('garmin-originals','garmin-originals',false,4194304,array['application/octet-stream']);

-- A definer is needed here solely to enforce one project-wide reservation budget
-- without allowing users to read another person's file metadata or storage usage.
create function public.reserve_garmin_original(p_archive_id text,p_filename text,p_byte_size bigint,p_chunks jsonb,p_consent boolean)
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
 if total+p_byte_size>838860800 then raise exception 'original_storage_budget_exceeded' using errcode='54000'; end if;
 insert into public.garmin_original_archives(owner_id,archive_id,filename,byte_size,chunks)
  values(actor,p_archive_id,p_filename,p_byte_size,p_chunks);
 return jsonb_build_object('archive_id',p_archive_id,'status','uploading','byte_size',p_byte_size);
end; $$;
revoke all on function public.reserve_garmin_original(text,text,bigint,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.reserve_garmin_original(text,text,bigint,jsonb,boolean) to authenticated;

create function public.complete_garmin_original(p_archive_id text)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.garmin_original_archives;
begin
 if actor is null then raise exception 'athlete_required' using errcode='42501'; end if;
 select * into item from public.garmin_original_archives where owner_id=actor and archive_id=p_archive_id for update;
 if not found then raise exception 'original_not_found' using errcode='42501'; end if;
 if exists(select 1 from jsonb_array_elements(item.chunks) with ordinality c(value,n)
  where not exists(select 1 from storage.objects o where o.bucket_id='garmin-originals'
   and o.name=actor::text||'/'||item.archive_id||'/'||lpad((n-1)::text,6,'0')||'-'||(value->>'sha256')||'.bin'
   and o.metadata->>'size'=(value->>'size'))) then
  raise exception 'original_upload_incomplete' using errcode='22023';
 end if;
 update public.garmin_original_archives set status='ready',completed_at=coalesce(completed_at,now())
  where owner_id=actor and archive_id=p_archive_id;
 return jsonb_build_object('archive_id',p_archive_id,'status','ready','byte_size',item.byte_size);
end; $$;
revoke all on function public.complete_garmin_original(text) from public,anon,authenticated,service_role;
grant execute on function public.complete_garmin_original(text) to authenticated;

create policy garmin_originals_owner_select on storage.objects for select to authenticated
 using(bucket_id='garmin-originals' and split_part(name,'/',1)=(select auth.uid())::text
  and exists(select 1 from public.garmin_original_archives a where a.owner_id=(select auth.uid())
   and a.archive_id=split_part(name,'/',2)));
create policy garmin_originals_reserved_insert on storage.objects for insert to authenticated
 with check(bucket_id='garmin-originals' and split_part(name,'/',1)=(select auth.uid())::text
  and exists(select 1 from public.garmin_original_archives a,
   jsonb_array_elements(a.chunks) with ordinality c(value,n)
   where a.owner_id=(select auth.uid()) and a.status='uploading'
    and name=a.owner_id::text||'/'||a.archive_id||'/'||lpad((n-1)::text,6,'0')||'-'||(value->>'sha256')||'.bin'
    and (metadata is null or metadata->>'size'=value->>'size')));
-- No UPDATE/DELETE policy: chunks are immutable. Resume verifies an existing chunk.
comment on table public.garmin_original_archives is 'Complete user-provided originals, owner-only. SHA-256 per ordered chunk; no silent field filtering. Coach links never grant access to an entire account export.';
commit;
