-- User-initiated historical Garmin export summaries, no access to raw originals for coaches.
-- Keep existing uniqueness (athlete_id, source, external_id) and API policies.
begin;
alter table public.activities drop constraint activities_source_check;
alter table public.activities add constraint activities_source_check
 check (source in ('garmin_csv','garmin_api','garmin_export'));
create policy activities_insert_own_garmin_export on public.activities
 for insert to authenticated with check (
  athlete_id=(select auth.uid()) and source='garmin_export'
 );
comment on policy activities_insert_own_garmin_export on public.activities is
 'Athlete can import their own historical Garmin summary, never another person or garmin_api';
commit;
