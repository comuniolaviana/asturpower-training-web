// Only the Vite page and bundled public assets. Netlify routing files do not apply here.
import { cp, mkdir, rm } from 'node:fs/promises';
const target=new URL('../.wrangler/garmin-app-assets/',import.meta.url);
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await cp(new URL('../dist-app/index.html',import.meta.url),new URL('index.html',target));
await cp(new URL('../dist-app/assets/',import.meta.url),new URL('assets/',target),{recursive:true});
for(const name of ['privacidad-garmin.html','garmin-privacy.css']){
  await cp(new URL('../dist-app/'+name,import.meta.url),new URL(name,target));
}
