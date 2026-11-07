-- Only a short-lived HMAC signature crosses pg_net's extension-owned queue.
-- The signing key stays in the restricted private schema and never in queue headers.
update asturpower_private.push_config set hook_secret=encode(extensions.gen_random_bytes(32),'hex') where singleton;
create or replace function asturpower_private.enqueue_mobile_push() returns trigger language plpgsql security definer set search_path='' as $$
declare secret text;payload jsonb;signature text;
begin
 if not exists(select 1 from public.app_push_subscriptions s where s.owner_id=new.recipient_id and s.enabled) then return new; end if;
 select hook_secret into secret from asturpower_private.push_config where singleton;
 payload=jsonb_build_object('notification_id',new.id,'sent_at',extract(epoch from clock_timestamp())::bigint);
 signature=encode(extensions.hmac(convert_to(payload::text,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex');
 perform net.http_post(url:='https://drnefgxdrultneeodtsy.supabase.co/functions/v1/asturpower-push',headers:=jsonb_build_object('Content-Type','application/json','x-asturpower-hook',signature),body:=payload,timeout_milliseconds:=10000);
 return new;
end $$;
