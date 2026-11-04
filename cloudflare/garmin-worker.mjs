// Alternative receiver only. Does not move OAuth or change its registered URL.
import { createGarminWebhookHandler, processGarminInbox } from '../netlify/lib/garmin-activity-service.mjs';
export function createWorker(dependencies={}){
  return {
    async fetch(request,env){
      const url=new URL(request.url);
      if(url.pathname==='/health'&&request.method==='GET')return Response.json({
        service:'asturpower-garmin-receiver',enabled:env.ASTURPOWER_GARMIN_ACTIVITY_ENABLED==='true',
      },{headers:{'Cache-Control':'no-store'}});
      if(url.pathname!=='/garmin/activities')return new Response('Not found',{status:404});
      // Cloudflare sets this header at ingress. Do not put this adapter behind an
      // untrusted reverse proxy or use it as a generic Node HTTP handler.
      return createGarminWebhookHandler({env,...dependencies})(request,{ip:request.headers.get('CF-Connecting-IP')});
    },
    async scheduled(event,env,context){context.waitUntil(processGarminInbox({env,...dependencies}));},
  };
}
export default createWorker();
