-- Personal athlete tools. No accounts, roles, credentials or existing sports records change.
create table public.athlete_basics (
 athlete_id uuid primary key references public.profiles(user_id) on delete cascade,
 height_cm numeric check(height_cm between 80 and 250),
 birth_year integer check(birth_year between 1900 and 2100),
 main_sport text not null default 'cycling' check(main_sport in ('cycling','running','swimming','other'))
);
create table public.athlete_weights (
 id uuid primary key default gen_random_uuid(),
 athlete_id uuid not null references public.profiles(user_id) on delete cascade,
 measured_on date not null check(measured_on between date '1900-01-01' and date '2100-12-31'),
 weight_kg numeric not null check(weight_kg between 15 and 400),
 context text not null check(context in ('fasting','before_power_test','before_hr_test','other')),
 note text not null default '' check(length(note)<=300),
 share_with_coach boolean not null default false,
 unique(athlete_id,measured_on,context)
);
create index athlete_weights_timeline on public.athlete_weights(athlete_id,measured_on desc);
alter table public.athlete_basics enable row level security;
alter table public.athlete_weights enable row level security;
revoke all on public.athlete_basics,public.athlete_weights from public,anon,authenticated;
grant select,insert,update,delete on public.athlete_basics,public.athlete_weights to authenticated;
grant all on public.athlete_basics,public.athlete_weights to service_role;
create policy basics_owner on public.athlete_basics for all to authenticated using(athlete_id=(select auth.uid())) with check(athlete_id=(select auth.uid()));
create policy basics_coach on public.athlete_basics for select to authenticated using(exists(select 1 from public.coach_athletes ca where ca.coach_id=(select auth.uid()) and ca.athlete_id=athlete_basics.athlete_id and ca.status='active'));
create policy weights_owner on public.athlete_weights for all to authenticated using(athlete_id=(select auth.uid())) with check(athlete_id=(select auth.uid()));
create policy weights_shared_coach on public.athlete_weights for select to authenticated using(share_with_coach and exists(select 1 from public.coach_athletes ca where ca.coach_id=(select auth.uid()) and ca.athlete_id=athlete_weights.athlete_id and ca.status='active'));

create table public.app_notifications (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.profiles(user_id) on delete cascade,
 athlete_id uuid not null references public.profiles(user_id) on delete cascade,
 kind text not null check(kind in ('activity','workout','workout_cancelled','test')),
 entity_id uuid not null,
 event_date date not null,
 title text not null check(length(title)<=200),
 message text not null default '' check(length(message)<=400),
 occurred_at timestamptz not null default clock_timestamp(),
 read_at timestamptz,
 unique(recipient_id,kind,entity_id)
);
create index app_notifications_inbox on public.app_notifications(recipient_id,occurred_at desc);
create index app_notifications_athlete on public.app_notifications(athlete_id);
alter table public.app_notifications enable row level security;
revoke all on public.app_notifications from public,anon,authenticated;
grant select on public.app_notifications to authenticated;
grant update(read_at) on public.app_notifications to authenticated;
grant all on public.app_notifications to service_role;
create policy notifications_read on public.app_notifications for select to authenticated using(recipient_id=(select auth.uid()) and (athlete_id=(select auth.uid()) or exists(select 1 from public.coach_athletes ca where ca.coach_id=(select auth.uid()) and ca.athlete_id=app_notifications.athlete_id and ca.status='active')));
create policy notifications_seen on public.app_notifications for update to authenticated using(recipient_id=(select auth.uid()) and (athlete_id=(select auth.uid()) or exists(select 1 from public.coach_athletes ca where ca.coach_id=(select auth.uid()) and ca.athlete_id=app_notifications.athlete_id and ca.status='active'))) with check(recipient_id=(select auth.uid()));

create schema if not exists asturpower_private;
create function asturpower_private.activity_news() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source='garmin_api' then
  insert into public.app_notifications(recipient_id,athlete_id,kind,entity_id,event_date,title,message)
  select recipient,new.athlete_id,'activity',new.id,(new.started_at at time zone 'Europe/Madrid')::date,'Actividad sincronizada',left(new.title,400)
  from (select new.athlete_id recipient union select ca.coach_id from public.coach_athletes ca where ca.athlete_id=new.athlete_id and ca.status='active') recipients
  on conflict(recipient_id,kind,entity_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function asturpower_private.activity_news() from public,anon,authenticated;
create trigger activity_mobile_news after insert on public.activities for each row execute function asturpower_private.activity_news();
create function asturpower_private.workout_news() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.title,new.scheduled_date,new.duration_minutes,new.intensity_target,new.coach_notes,new.steps,new.status) is not distinct from (old.title,old.scheduled_date,old.duration_minutes,old.intensity_target,old.coach_notes,old.steps,old.status) then return new; end if;
 insert into public.app_notifications(recipient_id,athlete_id,kind,entity_id,event_date,title,message)
 values(new.athlete_id,new.athlete_id,'workout',new.id,new.scheduled_date,case when tg_op='INSERT' then 'Nuevo entrenamiento' else 'Entrenamiento actualizado' end,left(new.title,400))
 on conflict(recipient_id,kind,entity_id) do update set event_date=excluded.event_date,title=excluded.title,message=excluded.message,occurred_at=clock_timestamp(),read_at=null;
 return new;
end $$;
revoke all on function asturpower_private.workout_news() from public,anon,authenticated;
create trigger workout_mobile_news after insert or update on public.planned_workouts for each row execute function asturpower_private.workout_news();
-- Seed only recent real events, never thousands of historical import entries.
insert into public.app_notifications(recipient_id,athlete_id,kind,entity_id,event_date,title,message,occurred_at)
 select a.athlete_id,a.athlete_id,'activity',a.id,(a.started_at at time zone 'Europe/Madrid')::date,'Actividad sincronizada',left(a.title,400),a.imported_at from public.activities a where a.source='garmin_api' and a.imported_at>now()-interval '14 days' on conflict do nothing;
insert into public.app_notifications(recipient_id,athlete_id,kind,entity_id,event_date,title,message,occurred_at)
 select w.athlete_id,w.athlete_id,'workout',w.id,w.scheduled_date,'Entrenamiento recibido',left(w.title,400),w.updated_at from public.planned_workouts w where w.updated_at>now()-interval '14 days' on conflict do nothing;

-- Push endpoints are private delivery addresses, never visible to coaches.
create table public.app_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(user_id) on delete cascade,
 endpoint text not null check(length(endpoint)<=2048 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[^[:space:]]+$'),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87}$'),
 auth text not null check(auth ~ '^[A-Za-z0-9_-]{22}$'),
 enabled boolean not null default true,
 unique(owner_id,endpoint)
);
alter table public.app_push_subscriptions enable row level security;
revoke all on public.app_push_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.app_push_subscriptions to authenticated;
grant all on public.app_push_subscriptions to service_role;
create policy push_owner on public.app_push_subscriptions for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create table asturpower_private.push_config (
 singleton boolean primary key default true check(singleton),
 hook_secret text not null default encode(extensions.gen_random_bytes(32),'hex'),
 public_key text,
 private_key text
);
insert into asturpower_private.push_config(singleton) values(true);
alter table asturpower_private.push_config enable row level security;
revoke all on asturpower_private.push_config from public,anon,authenticated;
grant usage on schema asturpower_private to service_role;
grant all on asturpower_private.push_config to service_role;
create table asturpower_private.push_deliveries (
 notification_id uuid not null references public.app_notifications(id) on delete cascade,
 subscription_id uuid not null references public.app_push_subscriptions(id) on delete cascade,
 revision timestamptz not null,
 primary key(notification_id,subscription_id,revision)
);
alter table asturpower_private.push_deliveries enable row level security;
revoke all on asturpower_private.push_deliveries from public,anon,authenticated;
grant all on asturpower_private.push_deliveries to service_role;
-- Service-only invoker functions bridge the non-exposed private schema.
create function public.server_push_config() returns jsonb language sql set search_path='' as $$select to_jsonb(c) from asturpower_private.push_config c where singleton$$;
create function public.server_push_keys(pub text,priv text) returns jsonb language plpgsql set search_path='' as $$begin
 update asturpower_private.push_config set public_key=pub,private_key=priv where singleton and public_key is null;
 return public.server_push_config();
end $$;
create function public.server_claim_push(n uuid,s uuid,r timestamptz) returns boolean language sql set search_path='' as $$
 with claimed as(insert into asturpower_private.push_deliveries values(n,s,r) on conflict do nothing returning 1) select exists(select 1 from claimed)
$$;
revoke all on function public.server_push_config(),public.server_push_keys(text,text),public.server_claim_push(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.server_push_config(),public.server_push_keys(text,text),public.server_claim_push(uuid,uuid,timestamptz) to service_role;

create extension if not exists pg_net with schema extensions;
create function asturpower_private.enqueue_mobile_push() returns trigger language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 if not exists(select 1 from public.app_push_subscriptions s where s.owner_id=new.recipient_id and s.enabled) then return new; end if;
 select hook_secret into secret from asturpower_private.push_config where singleton;
 perform net.http_post(url:='https://drnefgxdrultneeodtsy.supabase.co/functions/v1/asturpower-push',headers:=jsonb_build_object('Content-Type','application/json','x-asturpower-hook',secret),body:=jsonb_build_object('notification_id',new.id),timeout_milliseconds:=10000);
 return new;
end $$;
revoke all on function asturpower_private.enqueue_mobile_push() from public,anon,authenticated;
create trigger mobile_push_delivery after insert or update of occurred_at on public.app_notifications for each row execute function asturpower_private.enqueue_mobile_push();
