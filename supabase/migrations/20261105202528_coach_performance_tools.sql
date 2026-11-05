-- Additive, append-only physiological snapshots. No users or links are created.
create function public.valid_training_zone_bounds(bounds numeric[])
returns boolean language sql immutable set search_path = '' as $$
  select bounds is null or (
    array_ndims(bounds)=1 and array_lower(bounds,1)=1 and cardinality(bounds) between 2 and 9
    and not exists(select 1 from unnest(bounds) with ordinality b(v,i)
      where v is null or not (v>0 and v<=300) or (i>1 and v<=bounds[i::integer-1]))
  );
$$;
revoke all on function public.valid_training_zone_bounds(numeric[]) from public,anon;
grant execute on function public.valid_training_zone_bounds(numeric[]) to authenticated,service_role;

create table public.athlete_physiology (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  sport text not null check (sport in ('cycling','running','swimming')),
  effective_date date not null check (effective_date between date '1900-01-01' and date '2100-12-31'),
  ftp numeric check (ftp>=1 and ftp<=2500),
  lthr numeric check (lthr between 30 and 250),
  hr_max numeric check (hr_max between 30 and 250),
  hr_rest numeric check (hr_rest between 20 and 150),
  weight_kg numeric check (weight_kg between 15 and 400),
  threshold_pace_seconds numeric check (threshold_pace_seconds between 30 and 3600),
  power_zone_bounds numeric[] check(public.valid_training_zone_bounds(power_zone_bounds)),
  hr_zone_bounds numeric[] check(public.valid_training_zone_bounds(hr_zone_bounds)),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  check (hr_rest is null or hr_max is null or hr_rest<hr_max),
  check (hr_rest is null or lthr is null or hr_rest<lthr),
  check (lthr is null or hr_max is null or lthr<=hr_max),
  check (num_nonnulls(ftp,lthr,hr_max,hr_rest,weight_kg,threshold_pace_seconds,power_zone_bounds,hr_zone_bounds)>0)
);
create index athlete_physiology_history on public.athlete_physiology(athlete_id,sport,effective_date desc,created_at desc,id desc);
create index athlete_physiology_author on public.athlete_physiology(created_by);
alter table public.athlete_physiology enable row level security;
revoke all on public.athlete_physiology from public,anon,authenticated;
grant select on public.athlete_physiology to authenticated;
grant insert(athlete_id,sport,effective_date,ftp,lthr,hr_max,hr_rest,weight_kg,threshold_pace_seconds,power_zone_bounds,hr_zone_bounds,created_by) on public.athlete_physiology to authenticated;
grant all on public.athlete_physiology to service_role;
create policy physiology_read_athlete_or_active_coach on public.athlete_physiology for select to authenticated using (
  (athlete_id=(select auth.uid()) and exists(select 1 from public.user_roles ur where ur.user_id=(select auth.uid()) and ur.role='athlete'))
  or exists(select 1 from public.coach_athletes ca where ca.coach_id=(select auth.uid()) and ca.athlete_id=athlete_physiology.athlete_id and ca.status='active')
);
create policy physiology_append_athlete_or_active_coach on public.athlete_physiology for insert to authenticated with check (
  created_by=(select auth.uid()) and (
    (athlete_id=(select auth.uid()) and exists(select 1 from public.user_roles ur where ur.user_id=(select auth.uid()) and ur.role='athlete'))
    or exists(select 1 from public.coach_athletes ca where ca.coach_id=(select auth.uid()) and ca.athlete_id=athlete_physiology.athlete_id and ca.status='active')
  )
);
comment on table public.athlete_physiology is 'Complete physiological snapshots by effective date. Authenticated clients append only; empty fields mean unknown. Zone bounds are ascending upper bounds in percent of FTP/LTHR; final zone is open-ended. No diagnosis or inferred values.';
comment on column public.athlete_physiology.threshold_pace_seconds is 'Seconds per km for running/cycling; seconds per 100 m for swimming.';
