import { processGarminInbox } from '../lib/garmin-activity-service.mjs';
// Scheduled functions cannot be invoked through their HTTP URL on Netlify.
// Until ACTIVITY_ENABLED is enabled this returns before touching the database.
export default async ()=>{
  const env=process.env;
  return new Response(JSON.stringify(await processGarminInbox({env})),{
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
  });
};
export const config={schedule:'*/10 * * * *'};
