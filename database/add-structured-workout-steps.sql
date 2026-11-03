-- Este cambio ya fue aplicado en el proyecto Supabase de AsturPower.
-- SQL documentado para restauración y auditoría de la base de datos.
alter table public.planned_workouts add column if not exists steps jsonb;
alter table public.planned_workouts
  add constraint planned_workouts_steps_shape check (
    steps is null or (
      jsonb_typeof(steps)='array'
      and jsonb_array_length(steps) between 1 and 30
      and octet_length(steps::text)<=15000
    )
  );
comment on column public.planned_workouts.steps is 'Pasos ordenados del entrenamiento; aún sin exportación a Garmin.';
