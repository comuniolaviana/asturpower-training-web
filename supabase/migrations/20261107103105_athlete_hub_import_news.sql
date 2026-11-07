-- Group historical imports without overwhelming the inbox or push service.
create or replace function asturpower_private.activity_news() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.source='garmin_api' then
  insert into public.app_notifications(recipient_id,athlete_id,kind,entity_id,event_date,title,message)
  select recipient,new.athlete_id,'activity',new.id,(new.started_at at time zone 'Europe/Madrid')::date,'Actividad sincronizada',left(new.title,400)
  from (select new.athlete_id recipient union select ca.coach_id from public.coach_athletes ca where ca.athlete_id=new.athlete_id and ca.status='active') recipients
  on conflict(recipient_id,kind,entity_id) do nothing;
 else
  -- A historical batch has one shared news item, throttled to avoid a push for every file.
  insert into public.app_notifications(recipient_id,athlete_id,kind,entity_id,event_date,title,message)
  select recipient,new.athlete_id,'activity',new.athlete_id,(new.started_at at time zone 'Europe/Madrid')::date,'Historial actualizado','Hay nuevas actividades en tu calendario.'
  from (select new.athlete_id recipient union select ca.coach_id from public.coach_athletes ca where ca.athlete_id=new.athlete_id and ca.status='active') recipients
  on conflict(recipient_id,kind,entity_id) do update set event_date=excluded.event_date,message=excluded.message,occurred_at=clock_timestamp(),read_at=null
  where public.app_notifications.occurred_at<clock_timestamp()-interval '2 minutes';
 end if;
 return new;
end $$;
