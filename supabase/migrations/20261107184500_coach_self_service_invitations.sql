
-- Vinculacion autogestionada: invitaciones de entrenador de un solo uso.
-- Los codigos viajan exclusivamente por el endpoint autenticado; solo se guarda su SHA-256.
create table if not exists asturpower_private.coach_invitations (
  invite_hash text primary key check (invite_hash ~ '^[0-9a-f]{64}$'),
  coach_id uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles(user_id),
  constraint redeemed_together check ((redeemed_at is null) = (redeemed_by is null)),
  constraint valid_expiry check (expires_at > created_at)
);
create index if not exists coach_invitations_open_idx
  on asturpower_private.coach_invitations (coach_id,expires_at)
  where redeemed_at is null;
alter table asturpower_private.coach_invitations enable row level security;
revoke all on asturpower_private.coach_invitations from public, anon, authenticated;
-- RLS no tiene politicas: ni el navegador ni los usuarios autenticados leen codigos.

create or replace function public.create_coach_invitation(p_coach_id uuid, p_hash text)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare v_expires timestamptz := now() + interval '7 days';
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
     or not exists (select 1 from public.user_roles where user_id=p_coach_id and role='coach')
  then raise exception 'invite_invalid' using errcode='P0001'; end if;
  -- A lo sumo cinco codigos activos por entrenador. Evita solicitudes sin limite.
  perform pg_advisory_xact_lock(hashtextextended(p_coach_id::text, 1385));
  if (select count(*) from asturpower_private.coach_invitations
      where coach_id=p_coach_id and redeemed_at is null and expires_at > now()) >= 5
  then raise exception 'invite_limit' using errcode='P0001'; end if;
  insert into asturpower_private.coach_invitations(invite_hash,coach_id,expires_at)
    values(p_hash,p_coach_id,v_expires);
  return v_expires;
end; $$;

create or replace function public.redeem_coach_invitation(p_athlete_id uuid, p_hash text)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_inv asturpower_private.coach_invitations%rowtype;
declare v_coach_name text;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
     or not exists (select 1 from public.user_roles where user_id=p_athlete_id and role='athlete')
  then raise exception 'invite_invalid' using errcode='P0001'; end if;
  select * into v_inv from asturpower_private.coach_invitations
    where invite_hash=p_hash for update;
  if not found or v_inv.redeemed_at is not null or v_inv.expires_at <= now()
  then raise exception 'invite_invalid' using errcode='P0001'; end if;
  if p_athlete_id=v_inv.coach_id
     or not exists(select 1 from public.user_roles where user_id=v_inv.coach_id and role='coach')
  then raise exception 'invite_invalid' using errcode='P0001'; end if;
  if exists(select 1 from public.coach_athletes where coach_id=v_inv.coach_id
     and athlete_id=p_athlete_id and status='active')
  then raise exception 'already_linked' using errcode='P0001'; end if;

  -- Misma transaccion: vinculacion activa solo con invitacion del entrenador
  -- Y consentimiento expreso del deportista en el endpoint autenticado.
  insert into public.coach_athletes(coach_id,athlete_id,status)
    values(v_inv.coach_id,p_athlete_id,'active')
    on conflict (coach_id,athlete_id) do update set status='active';
  update asturpower_private.coach_invitations
    set redeemed_at=now(), redeemed_by=p_athlete_id
    where invite_hash=p_hash;
  select display_name into v_coach_name from public.profiles where user_id=v_inv.coach_id;
  return coalesce(v_coach_name,'Tu entrenador');
end; $$;

-- Funciones publicas en el esquema pero invocables SOLAMENTE con clave del servidor.
revoke all on function public.create_coach_invitation(uuid,text) from public, anon, authenticated;
revoke all on function public.redeem_coach_invitation(uuid,text) from public, anon, authenticated;
grant execute on function public.create_coach_invitation(uuid,text) to service_role;
grant execute on function public.redeem_coach_invitation(uuid,text) to service_role;
