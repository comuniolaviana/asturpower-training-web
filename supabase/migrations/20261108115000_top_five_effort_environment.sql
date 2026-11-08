-- Individual top-five rankings by duration and explicitly classified activity environment.
-- Existing version-1 bests remain visible as 'unknown' until their source series are
-- re-evaluated by the existing authenticated / leased batch processor.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.activity_effort_bests
 add column if not exists environment text not null default 'unknown'
 check(environment in ('indoor','outdoor','unknown'));
alter table public.activity_effort_bests drop constraint if exists activity_effort_bests_bests_check;
alter table public.activity_effort_bests
 add constraint activity_effort_bests_bests_check
 check(jsonb_typeof(bests)='array' and jsonb_array_length(bests)<=14);

create or replace function public.claim_effort_batch(p_owner uuid) returns jsonb language plpgsql set search_path='' as $$
declare token uuid=gen_random_uuid();items jsonb;
begin
 update asturpower_private.effort_jobs set status='running',lease_token=token,lease_until=clock_timestamp()+interval '100 seconds' where athlete_id=p_owner and status<>'done' and (lease_until is null or lease_until<clock_timestamp());
 if not found then return null;end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into items from(
  select s.activity_id,s.sha256,s.byte_size from public.garmin_activity_series s
  left join public.activity_effort_bests c on c.activity_id=s.activity_id and c.athlete_id=s.athlete_id and c.source_sha=s.sha256 and c.algorithm_version=2
  where s.athlete_id=p_owner and s.status='ready' and c.activity_id is null order by s.activity_id limit 16
 )t;
 return jsonb_build_object('token',token,'items',items);
end $$;

create or replace function public.finish_effort_batch(p_owner uuid,p_token uuid) returns void language plpgsql set search_path='' as $$
declare remaining boolean;
begin
 if not exists(select 1 from asturpower_private.effort_jobs where athlete_id=p_owner and lease_token=p_token) then return;end if;
 select exists(select 1 from public.garmin_activity_series s
  left join public.activity_effort_bests c on c.activity_id=s.activity_id and c.athlete_id=s.athlete_id and c.source_sha=s.sha256 and c.algorithm_version=2
  where s.athlete_id=p_owner and s.status='ready' and c.activity_id is null) into remaining;
 update asturpower_private.effort_jobs set status=case when remaining then 'queued' else 'done' end,lease_token=null,lease_until=null where athlete_id=p_owner and lease_token=p_token;
 if remaining then perform public.dispatch_effort_owner(p_owner,true);end if;
end $$;

-- SECURITY INVOKER, owner-scoped. One best window per activity/duration; rank
-- independently across all environments and within each environment.
create or replace function public.my_effort_records(p_sport text default 'cycling') returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if p_sport not in ('all','cycling','running','swimming','strength','walking','other') then raise exception 'invalid_sport';end if;
 with eligible as(
  select a.id,a.title,a.started_at,a.sport,s.status series_status,c.status cache_status,
   c.bests,c.record_count,c.algorithm_version,coalesce(c.environment,'unknown') environment
  from public.activities a
  left join public.garmin_activity_series s on s.activity_id=a.id and s.athlete_id=a.athlete_id
  left join public.activity_effort_bests c on c.activity_id=a.id and c.athlete_id=a.athlete_id
   and c.source_sha=s.sha256 and c.algorithm_version in (1,2)
  where a.athlete_id=(select auth.uid()) and (p_sport='all' or a.sport=p_sport)
 ),ranked as(
  select e.*,b.value,
   row_number() over(partition by b.value->>'metric',(b.value->>'seconds')::integer
    order by (b.value->>'mean')::numeric desc,e.started_at,e.id,b.value->>'start_at') overall_rank,
   row_number() over(partition by b.value->>'metric',(b.value->>'seconds')::integer,e.environment
    order by (b.value->>'mean')::numeric desc,e.started_at,e.id,b.value->>'start_at') environment_rank
  from eligible e cross join lateral jsonb_array_elements(e.bests) b
  where e.cache_status='ready' and e.series_status='ready'
 )
 select jsonb_build_object(
  'total_activities',(select count(*) from eligible),
  'with_series',(select count(*) from eligible where series_status='ready'),
  'analysed',(select count(*) from eligible where series_status='ready' and cache_status is not null),
  'current_analysed',(select count(*) from eligible where series_status='ready' and cache_status is not null and algorithm_version=2),
  'failed',(select count(*) from eligible where series_status='ready' and cache_status='error'),
  'without_samples',(select count(*) from eligible where cache_status='ready' and record_count=0),
  'records',coalesce((select jsonb_agg(value||jsonb_build_object(
   'activity_id',id,'title',title,'sport',sport,
   'activity_date',(started_at at time zone 'Europe/Madrid')::date,
   'environment',environment,'rank',overall_rank,'environment_rank',environment_rank)
   order by value->>'metric',(value->>'seconds')::integer,overall_rank,environment_rank)
   from ranked where overall_rank<=5 or environment_rank<=5),'[]'::jsonb)
 ) into result;
 return result;
end $$;
-- The old grants remain unchanged; spell out owner-only access defensively.
revoke all on function public.my_effort_records(text) from public,anon;
grant execute on function public.my_effort_records(text) to authenticated,service_role;
commit;
