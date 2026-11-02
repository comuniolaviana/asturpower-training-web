-- ASTURPOWER TRAINING — ESQUEMA BORRADOR PARA ENTORNO DE PRUEBAS
-- Fecha: 2026-11-02
-- NO EJECUTADO: no se ha escogido aún un proyecto Supabase independiente.
-- No usar con datos reales ni en otros proyectos.
-- Este fichero es preparatorio, NO una migración aplicada.
--
-- Requisito previo: Supabase Auth habilitado y proyecto vacío creado para AsturPower.
-- Los roles (admin/coach/athlete) y las relaciones se asignan EXCLUSIVAMENTE
-- desde un proceso privilegiado del servidor tras verificar su legitimidad.
-- Nunca dar al cliente permisos de INSERT/UPDATE sobre user_roles o coach_athletes.

begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'coach', 'athlete')),
  created_at timestamptz not null default now()
);

create table public.coach_athletes (
  coach_id uuid not null references public.profiles(user_id) on delete cascade,
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  primary key (coach_id, athlete_id),
  constraint distinct_coach_athlete check (coach_id <> athlete_id)
);

create index coach_athletes_by_athlete_idx on public.coach_athletes (athlete_id, status);
create index coach_athletes_by_coach_idx on public.coach_athletes (coach_id, status);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.coach_athletes enable row level security;

-- Permisos SQL mínimos. RLS restringe las filas, pero no sustituye GRANT.
revoke all on public.profiles from anon, authenticated;
revoke all on public.user_roles from anon, authenticated;
revoke all on public.coach_athletes from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select on public.coach_athletes to authenticated;

-- Cada usuario puede registrar y consultar su propio perfil.
create policy "profiles_create_self"
on public.profiles for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "profiles_select_self_or_assigned_coach"
on public.profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.coach_athletes ca
    where ca.athlete_id = profiles.user_id
      and ca.coach_id = (select auth.uid())
      and ca.status = 'active'
  )
);

create policy "profiles_update_self"
on public.profiles for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- El usuario consulta su rol, pero jamás se lo concede o cambia a sí mismo.
create policy "user_roles_read_self"
on public.user_roles for select to authenticated
using (user_id = (select auth.uid()));

-- Solo entrenador y deportista relacionados ven la vinculación.
-- Crear, activar o revocar relaciones requiere un proceso de servidor autorizado.
create policy "coach_athletes_read_participants"
on public.coach_athletes for select to authenticated
using (
  coach_id = (select auth.uid())
  or athlete_id = (select auth.uid())
);

commit;
