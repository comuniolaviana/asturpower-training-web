// Only the Vite page and bundled public assets. Netlify routing files do not apply here.
import { cp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const target=new URL('../.wrangler/garmin-app-assets/',import.meta.url);
await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await cp(new URL('../dist-app/index.html',import.meta.url),new URL('index.html',target));
await cp(new URL('../dist-app/assets/',import.meta.url),new URL('assets/',target),{recursive:true});
for(const name of ['privacidad-garmin.html','garmin-privacy.css']){
  await cp(new URL('../dist-app/'+name,import.meta.url),new URL(name,target));
}
for(const name of ['manifest.webmanifest','offline.html','offline.css','icons','push-sw.js']){
  await cp(new URL('../dist-app/'+name,import.meta.url),new URL(name,target),{recursive:true});
}
const files=['/offline.html','/offline.css','/manifest.webmanifest'];
for(const directory of ['assets','icons'])for(const name of (await readdir(new URL(directory+'/',target))).sort())files.push('/'+directory+'/'+name);
const hash=createHash('sha256');
for(const path of files){hash.update(path);hash.update(await readFile(new URL('.'+path,target)));}
const template=await readFile(new URL('./pwa-worker-template.js',import.meta.url),'utf8');
hash.update(template);
await writeFile(new URL('sw.js',target),template.replace('__BUILD_ID__',hash.digest('hex').slice(0,20)).replace('__STATIC_FILES__',JSON.stringify(files)));
