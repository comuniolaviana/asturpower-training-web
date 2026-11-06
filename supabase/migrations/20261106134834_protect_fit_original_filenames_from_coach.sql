begin;
revoke select on public.garmin_fit_analysis from authenticated;
grant select (
 athlete_id, activity_id, archive_id, fit_started_at, sport, match_offset_seconds,
 duration_seconds, sample_count, power_seconds, power_coverage,
 normalized_power_watts, ftp_watts, ftp_effective_date,
 intensity_factor, tss, measurement_source, computed_at, calculation_version
) on public.garmin_fit_analysis to authenticated;
comment on column public.garmin_fit_analysis.file_name is
'Potentially personally identifying original filenames. SELECT is not granted to authenticated clients.';
comment on column public.garmin_fit_analysis.pack_name is
'Private original archive path. SELECT is not granted to authenticated clients.';
commit;