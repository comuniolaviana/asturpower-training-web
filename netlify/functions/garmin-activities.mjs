import { createGarminWebhookHandler } from '../lib/garmin-activity-service.mjs';
// context.ip is provided by Netlify, not taken from request headers.
export default createGarminWebhookHandler();
