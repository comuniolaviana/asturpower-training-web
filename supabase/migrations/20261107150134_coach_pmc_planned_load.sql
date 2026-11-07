-- Nullable coach estimate for PMC projections; existing RLS and grants are preserved.
alter table public.planned_workouts
  add column estimated_tss numeric(7,2)
  check (estimated_tss is null or (estimated_tss >= 0 and estimated_tss <= 5000));
comment on column public.planned_workouts.estimated_tss is
  'Optional coach-provided planned TSS. Null means unknown or calculate from power-target steps; zero is explicit zero. Never completed activity load.';
