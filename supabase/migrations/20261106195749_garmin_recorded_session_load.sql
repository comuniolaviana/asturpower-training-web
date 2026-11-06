-- Preserve load actually recorded by the device separately from recalculations.
-- Existing ownership, active-coach consent and source filename restrictions remain.
alter table public.garmin_fit_analysis
 add column device_intensity_factor numeric(7,4) check(device_intensity_factor between 0 and 10),
 add column device_tss numeric(9,3) check(device_tss between 0 and 5000),
 add column device_ftp_watts numeric(7,2) check(device_ftp_watts between 1 and 2500);
grant select(device_intensity_factor,device_tss,device_ftp_watts) on public.garmin_fit_analysis to authenticated;
grant update(device_intensity_factor,device_tss,device_ftp_watts) on public.garmin_fit_analysis to authenticated;
