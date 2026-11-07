-- Derived, reproducible records. Original activities, series and dated FTP stay intact.
create table public.activity_effort_bests (
 activity_id uuid primary key references public.activities(id) on delete cascade,
 athlete_id uuid not null references public.profiles(user_id) on delete cascade,
 source_sha text not null check(source_sha ~ '^[a-f0-9]{64}$'),
 algorithm_version integer not null check(algorithm_version>=1),
 status text not null check(status in ('ready','error')),
 bests jsonb not null default '[]' check(jsonb_typeof(bests)='array' and jsonb_array_length(bests)<=12),
 record_count integer not null default 0 check(record_count between 0 and 250000),
 power_seconds integer not null default 0 check(power_seconds between 0 and 250000),
 heart_rate_seconds integer not null default 0 check(heart_rate_seconds between 0 and 250000),
 checked_at timestamptz not null default clock_timestamp()
);
create index activity_effort_owner on public.activity_effort_bests(athlete_id);
alter table public.activity_effort_bests enable row level security;
revoke all on public.activity_effort_bests from public,anon,authenticated;
grant select on public.activity_effort_bests to authenticated;
grant all on public.activity_effort_bests to service_role;
create policy effort_owner_read on public.activity_effort_bests for select to authenticated using(athlete_id=(select auth.uid()) and exists(select 1 from public.garmin_activity_series s where s.athlete_id=activity_effort_bests.athlete_id and s.activity_id=activity_effort_bests.activity_id and s.sha256=source_sha and s.status='ready'));
create table asturpower_private.effort_jobs (
 athlete_id uuid primary key references public.profiles(user_id) on delete cascade,
 status text not null default 'queued' check(status in ('queued','running','done')),
 lease_token uuid,
 lease_until timestamptz,
 last_dispatched_at timestamptz
);
alter table asturpower_private.effort_jobs enable row level security;
revoke all on asturpower_private.effort_jobs from public,anon,authenticated;
grant all on asturpower_private.effort_jobs to service_role;

create function public.dispatch_effort_owner(p_owner uuid,p_force boolean default false) returns void language plpgsql set search_path='' as $$
declare job asturpower_private.effort_jobs%rowtype;payload jsonb;signature text;secret text;
begin
 select * into job from asturpower_private.effort_jobs where athlete_id=p_owner for update;
 if not found or job.status='done' or job.lease_until>clock_timestamp() or (not p_force and job.last_dispatched_at>clock_timestamp()-interval '10 seconds') then return;end if;
 select hook_secret into secret from asturpower_private.push_config where singleton;
 payload=jsonb_build_object('owner_id',p_owner,'sent_at',extract(epoch from clock_timestamp())::bigint);
 signature=encode(extensions.hmac(convert_to(payload::text,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex');
 update asturpower_private.effort_jobs set last_dispatched_at=clock_timestamp() where athlete_id=p_owner;
 perform net.http_post(url:='https://drnefgxdrultneeodtsy.supabase.co/functions/v1/athlete-records',headers:=jsonb_build_object('Content-Type','application/json','x-asturpower-hook',signature),body:=payload,timeout_milliseconds:=10000);
end $$;
create function public.request_effort_records(p_owner uuid,p_retry boolean default false) returns void language plpgsql set search_path='' as $$
begin
 if p_retry then delete from public.activity_effort_bests where athlete_id=p_owner and status='error';end if;
 insert into asturpower_private.effort_jobs(athlete_id) values(p_owner) on conflict(athlete_id) do update set status=case when asturpower_private.effort_jobs.lease_until>clock_timestamp() then 'running' else 'queued' end;
 perform public.dispatch_effort_owner(p_owner);
end $$;
create function public.claim_effort_batch(p_owner uuid) returns jsonb language plpgsql set search_path='' as $$
declare token uuid=gen_random_uuid();items jsonb;
begin
 update asturpower_private.effort_jobs set status='running',lease_token=token,lease_until=clock_timestamp()+interval '100 seconds' where athlete_id=p_owner and status<>'done' and (lease_until is null or lease_until<clock_timestamp());
 if not found then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into items from(
  select s.activity_id,s.sha256,s.byte_size from public.garmin_activity_series s
  left join public.activity_effort_bests c on c.activity_id=s.activity_id and c.athlete_id=s.athlete_id and c.source_sha=s.sha256 and c.algorithm_version=1
  where s.athlete_id=p_owner and s.status='ready' and c.activity_id is null order by s.activity_id limit 16
 )t;
 return jsonb_build_object('token',token,'items',items);
end $$;
create function public.finish_effort_batch(p_owner uuid,p_token uuid) returns void language plpgsql set search_path='' as $$
declare remaining boolean;
begin
 if not exists(select 1 from asturpower_private.effort_jobs where athlete_id=p_owner and lease_token=p_token) then return;end if;
 select exists(select 1 from public.garmin_activity_series s left join public.activity_effort_bests c on c.activity_id=s.activity_id and c.athlete_id=s.athlete_id and c.source_sha=s.sha256 and c.algorithm_version=1 where s.athlete_id=p_owner and s.status='ready' and c.activity_id is null) into remaining;
 update asturpower_private.effort_jobs set status=case when remaining then 'queued' else 'done' end,lease_token=null,lease_until=null where athlete_id=p_owner and lease_token=p_token;
 if remaining then perform public.dispatch_effort_owner(p_owner,true);end if;
end $$;
create function public.dispatch_pending_effort_jobs() returns void language plpgsql set search_path='' as $$
declare owner uuid;
begin
 for owner in select athlete_id from asturpower_private.effort_jobs where status<>'done' and (lease_until is null or lease_until<clock_timestamp()) order by last_dispatched_at nulls first limit 10 loop perform public.dispatch_effort_owner(owner);end loop;
end $$;
revoke all on function public.dispatch_effort_owner(uuid,boolean),public.request_effort_records(uuid,boolean),public.claim_effort_batch(uuid),public.finish_effort_batch(uuid,uuid),public.dispatch_pending_effort_jobs() from public,anon,authenticated;
grant execute on function public.dispatch_effort_owner(uuid,boolean),public.request_effort_records(uuid,boolean),public.claim_effort_batch(uuid),public.finish_effort_batch(uuid,uuid),public.dispatch_pending_effort_jobs() to service_role;

create function asturpower_private.queue_effort_series() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='ready' and (tg_op='INSERT' or old.status is distinct from new.status or old.sha256 is distinct from new.sha256) then perform public.request_effort_records(new.athlete_id);end if;
 return new;
end $$;
revoke all on function asturpower_private.queue_effort_series() from public,anon,authenticated;
create trigger effort_series_ready after insert or update of status,sha256 on public.garmin_activity_series for each row execute function asturpower_private.queue_effort_series();
insert into asturpower_private.effort_jobs(athlete_id) select distinct athlete_id from public.garmin_activity_series where status='ready' on conflict do nothing;

-- Invoker + owner filter: only a user's own records, never another athlete's cache.
create function public.my_effort_records(p_sport text default 'cycling') returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if p_sport not in ('all','cycling','running','swimming','strength','walking','other') then raise exception 'invalid_sport';end if;
 with eligible as(
  select a.id,a.title,a.started_at,a.sport,s.status series_status,c.status cache_status,c.bests,c.record_count
  from public.activities a left join public.garmin_activity_series s on s.activity_id=a.id and s.athlete_id=a.athlete_id
  left join public.activity_effort_bests c on c.activity_id=a.id and c.athlete_id=a.athlete_id and c.source_sha=s.sha256 and c.algorithm_version=1
  where a.athlete_id=(select auth.uid()) and (p_sport='all' or a.sport=p_sport)
 ), ranked as(
  select e.*,b.value,row_number() over(partition by b.value->>'metric',(b.value->>'seconds')::integer order by (b.value->>'mean')::numeric desc,e.started_at,e.id,b.value->>'start_at') rank
  from eligible e cross join lateral jsonb_array_elements(e.bests) b where e.cache_status='ready' and e.series_status='ready'
 )
 select jsonb_build_object('total_activities',(select count(*) from eligible),'with_series',(select count(*) from eligible where series_status='ready'),'analysed',(select count(*) from eligible where series_status='ready' and cache_status is not null),'failed',(select count(*) from eligible where series_status='ready' and cache_status='error'),'without_samples',(select count(*) from eligible where cache_status='ready' and record_count=0),'records',coalesce((select jsonb_agg(value||jsonb_build_object('activity_id',id,'title',title,'sport',sport,'activity_date',(started_at at time zone 'Europe/Madrid')::date) order by value->>'metric',(value->>'seconds')::integer) from ranked where rank=1),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.my_effort_records(text) from public,anon;
grant execute on function public.my_effort_records(text) to authenticated,service_role;
