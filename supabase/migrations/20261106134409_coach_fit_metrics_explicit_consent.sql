-- Consentimiento por entrenador para datos deportivos derivados de FIT.
-- No concede acceso a originales, archivos FIT individuales ni GPS.
begin;
create table public.athlete_coach_fit_sharing (
 athlete_id uuid not null references auth.users(id) on delete cascade,
 coach_id uuid not null references auth.users(id) on delete cascade,
 consented_at timestamptz not null default now(),
 primary key(athlete_id,coach_id),
 foreign key(coach_id,athlete_id) references public.coach_athletes(coach_id,athlete_id) on delete cascade
);
alter table public.athlete_coach_fit_sharing enable row level security;
revoke all on public.athlete_coach_fit_sharing from public,anon,authenticated,service_role;
grant select,insert,delete on public.athlete_coach_fit_sharing to authenticated;
grant all on public.athlete_coach_fit_sharing to service_role;
create policy fit_sharing_owner_read on public.athlete_coach_fit_sharing
 for select to authenticated using(athlete_id=(select auth.uid()) or coach_id=(select auth.uid()));
create policy fit_sharing_owner_grant on public.athlete_coach_fit_sharing
 for insert to authenticated with check(
 athlete_id=(select auth.uid())
 and exists(select 1 from public.coach_athletes ca where ca.athlete_id=athlete_coach_fit_sharing.athlete_id
 and ca.coach_id=athlete_coach_fit_sharing.coach_id and ca.status='active')
 );
create policy fit_sharing_owner_revoke on public.athlete_coach_fit_sharing
 for delete to authenticated using(athlete_id=(select auth.uid()));
create policy garmin_fit_analysis_coach_with_consent on public.garmin_fit_analysis
 for select to authenticated using(
 exists(select 1 from public.athlete_coach_fit_sharing permission
 join public.coach_athletes link on link.athlete_id=permission.athlete_id
 and link.coach_id=permission.coach_id and link.status='active'
 where permission.athlete_id=garmin_fit_analysis.athlete_id
 and permission.coach_id=(select auth.uid()))
 );
comment on table public.athlete_coach_fit_sharing is
'Explicit revocable per-coach permission to read derived FIT sport metrics. Never grants access to original Garmin ZIP, FIT file names, GPS tracks or private catalog.';
commit;