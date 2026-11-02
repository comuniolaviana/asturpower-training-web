-- AsturPower Training: adaptación incremental para múltiples roles por identidad.
-- Aplicar después del esquema inicial. No crea usuarios ni concede roles.
-- Se conserva cada fila, perfil y relación; se reconstruyen las FK dentro de
-- la misma transacción/migración para que nunca quede un estado intermedio publicado.
-- Aplicado el 2026-11-02. Snapshot incremental: ejecutar una sola vez.
begin;
alter table public.coach_athletes drop constraint coach_athletes_coach_role_fk;
alter table public.coach_athletes drop constraint coach_athletes_athlete_role_fk;
alter table public.user_roles drop constraint user_roles_pkey;
alter table public.user_roles drop constraint user_roles_user_role_unique;
alter table public.user_roles add constraint user_roles_pkey primary key (user_id, role);
alter table public.coach_athletes add constraint coach_athletes_coach_role_fk
  foreign key (coach_id, coach_role) references public.user_roles(user_id, role) on delete cascade;
alter table public.coach_athletes add constraint coach_athletes_athlete_role_fk
  foreign key (athlete_id, athlete_role) references public.user_roles(user_id, role) on delete cascade;
comment on table public.user_roles is 'Roles acumulables por identidad: coach y athlete pueden coexistir. Asignación exclusiva desde servidor autorizado; nunca desde user_metadata.';
-- Las cinco políticas RLS y los GRANT del esquema inicial se conservan:
-- perfiles propios o deportistas vinculados activamente; roles propios;
-- relaciones donde el usuario es participante. El cliente no asigna roles.
commit;
