-- Garmin FIT: owner-only derived sports analysis and resumable per-package cursor.
-- The immutable original ZIP retains all raw samples, coordinates, events and messages.
-- No grants to coaches: owner must separately consent before any derived data sharing.
begin;
create table public.garmin_fit_analysis (
 athlete_id uuid not null references auth.users(id) on delete cascade,
 activity_id uuid primary key references public.activities(id) on delete cascade,
 archive_id text not null,
 pack_name text not null,
 file_name text not null,
 fit_started_at timestamptz not null,
 sport text not null check(sport in ('cycling','running','swimming','walking','strength','other')),
 match_offset_seconds integer not null check(match_offset_seconds between 0 and 300),
 duration_seconds integer not null check(duration_seconds between 1 and 172800),
 sample_count integer not null check(sample_count between 0 and 1000000),
 power_seconds integer not null check(power_seconds between 0 and 172800),
 power_coverage numeric(5,4) check(power_coverage between 0 and 1),
 normalized_power_watts numeric(8,2) check(normalized_power_watts between 0 and 3500),
 ftp_watts numeric(8,2) check(ftp_watts between 1 and 2500),
 ftp_effective_date date,
 intensity_factor numeric(7,4) check(intensity_factor between 0 and 10),
 tss numeric(9,3) check(tss between 0 and 5000),
 measurement_source text not null default 'unverified' check(length(measurement_source) between 1 and 200),
 computed_at timestamptz not null default now(),
 calculation_version integer not null default 1,
 foreign key(athlete_id,archive_id) references public.garmin_original_archives(owner_id,archive_id),
 unique(athlete_id,archive_id,pack_name,file_name),
 check((ftp_watts is null and ftp_effective_date is null and intensity_factor is null and tss is null) or
       (ftp_watts is not null and ftp_effective_date is not null and normalized_power_watts is not null and intensity_factor is not null and tss is not null))
);
create index garmin_fit_analysis_owner_start_idx on public.garmin_fit_analysis(athlete_id,fit_started_at);
create table public.garmin_fit_scan_progress (
 athlete_id uuid not null,
 archive_id text not null,
 pack_name text not null,
 next_index integer not null default 0 check(next_index between 0 and 5000),
 scanned integer not null default 0 check(scanned between 0 and 5000),
 linked integer not null default 0 check(linked between 0 and 5000),
 updated_at timestamptz not null default now(),
 primary key(athlete_id,archive_id,pack_name),
 foreign key(athlete_id,archive_id,pack_name) references public.garmin_original_catalog(owner_id,archive_id,pack_name) on delete cascade
);
alter table public.garmin_fit_analysis enable row level security;
alter table public.garmin_fit_scan_progress enable row level security;
revoke all on public.garmin_fit_analysis,public.garmin_fit_scan_progress from public,anon,authenticated,service_role;
grant select,insert on public.garmin_fit_analysis to authenticated;
grant select,insert,update on public.garmin_fit_scan_progress to authenticated;
grant all on public.garmin_fit_analysis,public.garmin_fit_scan_progress to service_role;
create policy garmin_fit_analysis_read_self on public.garmin_fit_analysis for select to authenticated
 using(athlete_id=(select auth.uid()));
create policy garmin_fit_analysis_insert_self on public.garmin_fit_analysis for insert to authenticated
 with check(
  athlete_id=(select auth.uid())
  and exists(select 1 from public.activities a where a.id=activity_id and a.athlete_id=(select auth.uid()) and a.source in ('garmin_export','garmin_api'))
  and exists(select 1 from public.garmin_original_catalog cat where cat.owner_id=(select auth.uid())
   and cat.archive_id=garmin_fit_analysis.archive_id and cat.pack_name=garmin_fit_analysis.pack_name
   and exists(select 1 from jsonb_array_elements(cat.entries) item where item->>'name'=garmin_fit_analysis.file_name and item->>'kind'='FIT'))
 );
create policy garmin_fit_scan_read_self on public.garmin_fit_scan_progress for select to authenticated
 using(athlete_id=(select auth.uid()));
create policy garmin_fit_scan_insert_self on public.garmin_fit_scan_progress for insert to authenticated
 with check(athlete_id=(select auth.uid()));
create policy garmin_fit_scan_update_self on public.garmin_fit_scan_progress for update to authenticated
 using(athlete_id=(select auth.uid())) with check(athlete_id=(select auth.uid()));
comment on table public.garmin_fit_analysis is
'Owner-only derived FIT metrics; no original raw samples, GPS or secrets. Only high-confidence matched sports sessions. NP/TSS are nullable when sensor coverage or historical FTP is missing.';
comment on table public.garmin_fit_scan_progress is
'Owner-only reanudable scan cursor for the private seven-package Garmin FIT archive.';
commit;