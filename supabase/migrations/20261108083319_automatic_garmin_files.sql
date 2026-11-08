-- Server-only one-shot download ledger. Never stores callback URLs or OAuth tokens.
create table public.garmin_api_files(
 id uuid primary key default gen_random_uuid(),
 athlete_id uuid not null references auth.users(id) on delete cascade,
 external_id text not null check(external_id ~ '^[0-9]{1,20}$'),
 garmin_user_id text not null,
 callback_sha text not null check(callback_sha ~ '^[0-9a-f]{64}$'),
 source_format text not null check(source_format in ('FIT','TCX','GPX')),
 summary jsonb not null check(octet_length(summary::text)<4096),
 received_at timestamptz not null,
 status text not null check(status in ('downloading','uploading','stored','processing','ready','error','uncertain')),
 reserved_bytes bigint not null default 56623104 check(reserved_bytes between 0 and 56623104),
 archive_id text,
 activity_id uuid references public.activities(id) on delete set null,
 lease_token uuid,lease_until timestamptz,last_dispatched_at timestamptz,
 attempts integer not null default 0,last_error text check(length(last_error)<100),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(athlete_id,external_id,callback_sha),
 foreign key(athlete_id,archive_id) references public.garmin_original_archives(owner_id,archive_id)
);
alter table public.garmin_api_files enable row level security;
revoke all on public.garmin_api_files from public,anon,authenticated;
grant select(id,athlete_id,external_id,status,activity_id,last_error,created_at,updated_at) on public.garmin_api_files to authenticated;
create policy api_file_owner_status on public.garmin_api_files for select to authenticated using(athlete_id=(select auth.uid()));
grant all on public.garmin_api_files to service_role;
create index api_file_pending on public.garmin_api_files(status,lease_until);

create function public.start_garmin_api_file(p_owner uuid,p_user_id text,p_external_id text,p_callback_sha text,p_format text,p_received_at timestamptz,p_summary jsonb)
 returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.garmin_api_files;used bigint;
begin
 if not exists(select 1 from public.garmin_connections c where c.athlete_id=p_owner and c.garmin_user_id=p_user_id and c.connected_at<=p_received_at and 'ACTIVITY_EXPORT'=any(c.permissions)) then return jsonb_build_object('download',false,'status','disconnected');end if;
 perform pg_catalog.pg_advisory_xact_lock(681026115);
 select * into job from public.garmin_api_files where athlete_id=p_owner and external_id=p_external_id and (callback_sha=p_callback_sha or status in ('downloading','uploading','stored','processing','ready')) order by created_at limit 1;
 if found then return jsonb_build_object('download',false,'id',job.id,'status',job.status);end if;
 select coalesce(sum(byte_size),0) into used from public.garmin_original_archives;
 used:=used+coalesce((select sum(byte_size) from public.garmin_activity_series),0)+coalesce((select sum(reserved_bytes) from public.garmin_api_files where status in ('downloading','uploading','stored','processing')),0);
 used:=used+coalesce((select sum(case when metadata->>'size' ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else 0 end) from storage.objects where bucket_id not in ('garmin-originals','garmin-sports-series')),0);
 if used+56623104>838860800 then raise exception 'api_file_storage_budget_exceeded';end if;
 insert into public.garmin_api_files(athlete_id,external_id,garmin_user_id,callback_sha,source_format,summary,received_at,status) values(p_owner,p_external_id,p_user_id,p_callback_sha,p_format,p_summary,p_received_at,'downloading') returning * into job;
 return jsonb_build_object('download',true,'id',job.id,'status',job.status);
end $$;
create function public.stage_garmin_api_original(p_job uuid,p_manifest jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare j public.garmin_api_files;size bigint;chunk jsonb;pos integer:=0;
begin
 select * into strict j from public.garmin_api_files where id=p_job and status='downloading' for update;
 size:=(p_manifest->>'byte_size')::bigint;
 if size not between 1 and 52428800 or p_manifest->>'archive_id' !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_manifest->'chunks')<>'array' or jsonb_array_length(p_manifest->'chunks') not between 1 and 13 then raise exception 'invalid_manifest';end if;
 for chunk in select value from jsonb_array_elements(p_manifest->'chunks') loop
  if chunk->>'sha256' !~ '^[0-9a-f]{64}$' or (chunk->>'size')::bigint not between 1 and 4194304 or (pos<jsonb_array_length(p_manifest->'chunks')-1 and (chunk->>'size')::bigint<>4194304) then raise exception 'invalid_manifest';end if;pos:=pos+1;
 end loop;
 if (select sum((c->>'size')::bigint) from jsonb_array_elements(p_manifest->'chunks') c)<>size then raise exception 'invalid_manifest';end if;
 insert into public.garmin_original_archives(owner_id,archive_id,filename,byte_size,chunks,status) values(j.athlete_id,p_manifest->>'archive_id','garmin-'||j.external_id||'.'||lower(j.source_format),size,p_manifest->'chunks','uploading') on conflict(owner_id,archive_id) do nothing;
 update public.garmin_api_files set archive_id=p_manifest->>'archive_id',status='uploading',reserved_bytes=4194304,updated_at=now() where id=j.id;
end $$;
create function public.dispatch_garmin_api_file(p_job uuid) returns void language plpgsql security invoker set search_path='' as $$
declare job public.garmin_api_files;payload jsonb;secret text;signature text;
begin
 select * into job from public.garmin_api_files where id=p_job for update;
 if not found or job.status not in ('stored','processing') or job.lease_until>clock_timestamp() or job.attempts>=5 or job.last_dispatched_at>clock_timestamp()-interval '30 seconds' then return;end if;
 select hook_secret into secret from asturpower_private.push_config where singleton;
 payload:=jsonb_build_object('kind','garmin-api-file','job_id',job.id,'sent_at',extract(epoch from clock_timestamp())::bigint);
 signature:=encode(extensions.hmac(convert_to(payload::text,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex');
 update public.garmin_api_files set last_dispatched_at=clock_timestamp() where id=job.id;
 perform net.http_post(url:='https://drnefgxdrultneeodtsy.supabase.co/functions/v1/garmin-file-analysis',headers:=jsonb_build_object('Content-Type','application/json','x-asturpower-hook',signature),body:=payload,timeout_milliseconds:=10000);
end $$;
create function public.finish_garmin_api_original(p_job uuid) returns void language plpgsql security invoker set search_path='' as $$
declare j public.garmin_api_files;a public.garmin_original_archives;
begin
 select * into strict j from public.garmin_api_files where id=p_job for update;
 if j.status<>'uploading' then return;end if;
 select * into strict a from public.garmin_original_archives where owner_id=j.athlete_id and archive_id=j.archive_id;
 if exists(select 1 from jsonb_array_elements(a.chunks) with ordinality c(value,n) where not exists(select 1 from storage.objects o where o.bucket_id='garmin-originals' and o.name=j.athlete_id::text||'/'||a.archive_id||'/'||lpad((c.n-1)::text,6,'0')||'-'||(c.value->>'sha256')||'.bin' and o.metadata->>'size'=c.value->>'size')) then raise exception 'original_upload_incomplete';end if;
 update public.garmin_original_archives set status='ready',completed_at=now() where owner_id=j.athlete_id and archive_id=j.archive_id;
 update public.garmin_api_files set status='stored',updated_at=now() where id=j.id;
 perform public.dispatch_garmin_api_file(j.id);
end $$;
create function public.claim_garmin_api_file(p_job uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.garmin_api_files;
begin
 update public.garmin_api_files set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '110 seconds' where id=p_job and status in ('stored','processing') and (lease_until is null or lease_until<clock_timestamp()) and attempts<5 returning * into j;
 if not found then return null;end if;
 return to_jsonb(j);
end $$;
create function public.resume_garmin_api_files() returns void language plpgsql security invoker set search_path='' as $$
declare j public.garmin_api_files;
begin
 -- An interrupted GET can never be retried. Already uploaded chunks can be finalized.
 update public.garmin_api_files set status='uncertain',last_error='download_interrupted',reserved_bytes=0 where status='downloading' and created_at<now()-interval '5 minutes';
 for j in select * from public.garmin_api_files where status='uploading' limit 10 loop
  begin perform public.finish_garmin_api_original(j.id);exception when others then update public.garmin_api_files set last_error='original_upload_incomplete' where id=j.id;end;
 end loop;
 for j in select * from public.garmin_api_files where status in ('stored','processing') and (lease_until is null or lease_until<clock_timestamp()) and attempts<5 limit 10 loop perform public.dispatch_garmin_api_file(j.id);end loop;
end $$;
revoke all on function public.start_garmin_api_file(uuid,text,text,text,text,timestamptz,jsonb),public.stage_garmin_api_original(uuid,jsonb),public.finish_garmin_api_original(uuid),public.dispatch_garmin_api_file(uuid),public.claim_garmin_api_file(uuid),public.resume_garmin_api_files() from public,anon,authenticated;
grant execute on function public.start_garmin_api_file(uuid,text,text,text,text,timestamptz,jsonb),public.stage_garmin_api_original(uuid,jsonb),public.finish_garmin_api_original(uuid),public.dispatch_garmin_api_file(uuid),public.claim_garmin_api_file(uuid),public.resume_garmin_api_files() to service_role;

-- Browser uploads share the same budget as automatic files in flight.
do $block$
declare target regprocedure;definition text;anchor text:='total:=total+coalesce((select sum(byte_size) from public.garmin_activity_series),0);';
begin
 for target in select unnest(array['asturpower_private.reserve_garmin_original(text,text,bigint,jsonb,boolean)'::regprocedure,'asturpower_private.reserve_activity_series(uuid,text,integer)'::regprocedure]) loop
  definition:=pg_get_functiondef(target);
  anchor:='total:=total+coalesce((select sum(byte_size) from public.garmin_activity_series),0);';
  if position(anchor in definition)=0 then anchor:='total:=total+coalesce((select sum(byte_size) from public.garmin_activity_series where status=''uploading''),0);';end if;
  if position(anchor in definition)=0 then raise exception 'reservation_definition_changed';end if;
  definition:=replace(definition,anchor,anchor||E'\n total:=total+coalesce((select sum(reserved_bytes) from public.garmin_api_files where status in (''downloading'',''uploading'',''stored'',''processing'')),0);');
  execute definition;
 end loop;
end $block$;
