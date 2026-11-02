-- ASTURPOWER TRAINING — ESQUEMA INICIAL APLICADO
-- Aplicado el 2026-11-02 mediante migración asturpower_initial_profiles_roles_coach_athletes.
-- Proyecto independiente de AsturPower; no ejecutar en otros proyectos.
-- Snapshot para bases vacías; no es idempotente ni debe ejecutarse otra vez en la base existente.
-- No contiene datos de usuarios ni credenciales.
-- Diferencias respecto al borrador:
-- 1. Solo display_name es editable por el cliente; created_at lo fija la base.
-- 2. FK compuestas verifican que cada vínculo una coach con athlete.
-- 3. Privilegios explícitos y mínimos también para el proceso servidor.
-- 4. Un rol por usuario en este MVP; administración futura desde servidor.
-- Comprobaciones: 36 pruebas transaccionales superadas; fixtures revertidas; 0 avisos de seguridad.
begin;
-- AsturPower Training: base de usuarios y vínculos. Sin datos ni credenciales.
create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
 created_at timestamptz not null default now()
);
create table public.user_roles (
 user_id uuid primary key references public.profiles(user_id) on delete cascade,
 role text not null check (role in ('admin','coach','athlete')),
 created_at timestamptz not null default now(),
 constraint user_roles_user_role_unique unique (user_id, role)
);
create table public.coach_athletes (
 coach_id uuid not null,
 athlete_id uuid not null,
 coach_role text not null default 'coach' check (coach_role='coach'),
 athlete_role text not null default 'athlete' check (athlete_role='athlete'),
 status text not null default 'pending' check (status in ('pending','active','revoked')),
 created_at timestamptz not null default now(),
 primary key (coach_id,athlete_id),
 constraint distinct_coach_athlete check (coach_id<>athlete_id),
 constraint coach_athletes_coach_role_fk foreign key (coach_id,coach_role) references public.user_roles(user_id,role) on delete cascade,
 constraint coach_athletes_athlete_role_fk foreign key (athlete_id,athlete_role) references public.user_roles(user_id,role) on delete cascade
);
create index coach_athletes_by_coach_idx on public.coach_athletes(coach_id,coach_role,status);
create index coach_athletes_by_athlete_idx on public.coach_athletes(athlete_id,athlete_role,status);
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.coach_athletes enable row level security;

revoke all on public.profiles,public.user_roles,public.coach_athletes from public,anon,authenticated,service_role;
grant select on public.profiles,public.user_roles,public.coach_athletes to authenticated;
grant insert(user_id,display_name) on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select,insert,update,delete on public.profiles,public.user_roles,public.coach_athletes to service_role;

create policy profiles_create_self on public.profiles for insert to authenticated
 with check(user_id=(select auth.uid()));
create policy profiles_select_self_or_assigned_coach on public.profiles for select to authenticated
 using(user_id=(select auth.uid()) or exists (
  select 1 from public.coach_athletes ca where ca.athlete_id=profiles.user_id
  and ca.coach_id=(select auth.uid()) and ca.status='active'
 ));
create policy profiles_update_self on public.profiles for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy user_roles_read_self on public.user_roles for select to authenticated
 using(user_id=(select auth.uid()));
create policy coach_athletes_read_participants on public.coach_athletes for select to authenticated
 using(coach_id=(select auth.uid()) or athlete_id=(select auth.uid()));

comment on table public.profiles is 'Perfil mínimo. El cliente crea su perfil y solo modifica display_name.';
comment on table public.user_roles is 'Un rol por usuario en este MVP. Asignación exclusiva desde servidor autorizado; nunca desde user_metadata.';
comment on table public.coach_athletes is 'Vínculos gestionados por servidor autorizado. Solo active permite lectura del perfil del deportista por su entrenador. Los participantes deben tener roles válidos.';

commit;
