// Recover only the public access page, never a working session or an active upload.
let checking=false,tries=0;
async function reconnect(){
 if(checking||document.visibilityState==='hidden')return;
 checking=true;
 try{
  const response=await fetch('/health',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(response.ok){const info=await response.json();if(info.service==='asturpower-garmin-app')location.replace('/');}
 }catch{/* Internet reachability is not the same as application availability. */}
 finally{checking=false;}
}
addEventListener('online',reconnect);
addEventListener('pageshow',reconnect);
document.addEventListener('visibilitychange',reconnect);
const timer=setInterval(()=>{if(++tries>12){clearInterval(timer);return;}void reconnect();},10000);
void reconnect();
