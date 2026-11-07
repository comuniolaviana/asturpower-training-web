-- Server roles only where the extension owner allows changing its ACLs.
-- Managed Supabase may retain its PUBLIC extension grants; never place a reusable
-- credential in that queue. The following signer migration enforces that invariant.
revoke all on table net.http_request_queue,net._http_response from public,anon,authenticated;
grant select on table net.http_request_queue,net._http_response to service_role;
