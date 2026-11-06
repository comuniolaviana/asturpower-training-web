-- Fix private Garmin original upload: Supabase Storage can evaluate INSERT RLS
-- before object size metadata is populated, so an INSERT condition requiring
-- metadata.size rejects the first 4 MiB chunk with AccessDenied/400.
-- Keep ownership, exact reserved chunk path, active reservation, and private bucket.
-- Every completed part's size remains checked by complete_garmin_original;
-- client downloads verify SHA-256 of every part.
begin;
alter policy garmin_originals_reserved_insert on storage.objects
with check (
 bucket_id='garmin-originals'
 and split_part(name,'/',1)=(select auth.uid())::text
 and exists(
  select 1 from public.garmin_original_archives a,
   jsonb_array_elements(a.chunks) with ordinality c(value,n)
  where a.owner_id=(select auth.uid())
   and a.status='uploading'
   and name=a.owner_id::text||'/'||a.archive_id||'/'||
     lpad((n-1)::text,6,'0')||'-'||(c.value->>'sha256')||'.bin'
 )
);
comment on policy garmin_originals_reserved_insert on storage.objects is
'Exact reserved owner/chunk path only. Storage sets upload metadata during object creation, so do not require metadata.size at INSERT. The bucket caps each object at 4 MiB; complete_garmin_original checks each persisted part size.';
commit;
