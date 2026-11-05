import {SPORTS,physiologyAt,estimatedLoad,parseScenario,simulatePMC} from './performance.js';
import {loadPhysiology,savePhysiology} from './performance-data.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>value===null||value===undefined?'Sin dato':Number(value).toLocaleString('es',{maximumFractionDigits:2});
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const field=(name,label,{type='number',min,max,step='any',required=false,value='',placeholder=''}={})=>`<label class="perf-field"><span>${label}</span><input name="${name}" type="${type}" ${min!==undefined?`min="${min}"`:''} ${max!==undefined?`max="${max}"`:''} ${type==='number'?`step="${step}"`:''} ${required?'required':''} value="${esc(value)}" placeholder="${esc(placeholder)}" ${type==='text'?'maxlength="150"':''}></label>`;
const fields=[['ftp','FTP (W)',1,2500],['lthr','Pulso umbral (lpm)',30,250],['hr_max','Pulso máximo (lpm)',30,250],['hr_rest','Pulso en reposo (lpm)',20,150],['weight_kg','Peso (kg)',15,400],['threshold_pace_seconds','Ritmo umbral (segundos/km; natación: segundos/100 m)',30,3600]];
export async function mountPerformance({root,client,user,role,athletes=[]}) {
  if(role!=='coach'){root.replaceChildren();return;}
  let rows=[],ticket=0,selected='',truncated=false;
  root.innerHTML=`<div class="perf-space"><div class="perf-intro"><span class="eyebrow">HERRAMIENTAS DEL ENTRENADOR</span><h2>Rendimiento y planificación</h2><p>Configura la ficha deportiva de tu equipo y explora escenarios antes de planificar.</p></div>
  <section class="perf-card"><h3>Ficha deportiva e historial de umbrales</h3><p>Solo tus deportistas con vinculación activa. Cada guardado conserva una versión completa desde su fecha de vigencia.</p>
  <div class="perf-fields"><label class="perf-field"><span>Deportista</span><select data-perf-athlete><option value="">Selecciona un deportista</option>${athletes.map(a=>`<option value="${esc(a.user_id)}">${esc(a.display_name)}</option>`).join('')}</select></label><label class="perf-field"><span>Deporte de la ficha</span><select data-perf-sport>${Object.entries(SPORTS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label></div>
  ${!athletes.length?'<p class="perf-note">Aún no tienes deportistas vinculados. Las calculadoras de abajo ya están disponibles.</p>':''}
  <p data-perf-status role="status" aria-live="polite"></p><div data-perf-record hidden>
  <form data-perf-profile><div class="perf-fields">${field('effective_date','Vigente desde',{type:'date',value:today(),required:true})}${fields.map(([key,label,min,max])=>field(key,label,{min,max})).join('')}${field('power_zone_bounds','Límites superiores de zonas (% FTP)',{type:'text',placeholder:'Separados por comas'})}${field('hr_zone_bounds','Límites superiores de zonas (% pulso umbral)',{type:'text',placeholder:'Separados por comas'})}</div>
  <p class="perf-note">Las zonas se definen con límites ascendentes; la última zona queda por encima del último límite. Un campo vacío se guardará como «sin dato». Usa los valores y el modelo de zonas acordados con tu deportista.</p>
  <button class="button primary" type="submit">Guardar nueva versión de la ficha</button></form>
  <div data-perf-effective></div><details><summary>Ver versiones guardadas</summary><div data-perf-history class="perf-scroll"></div></details></div></section>
  <div class="perf-grid"><section class="perf-card"><span class="eyebrow">ESTIMACIÓN DE SESIÓN</span><h3>Calculadora de carga ciclista</h3><p>Para un esfuerzo constante a un porcentaje del FTP. No calcula potencia normalizada de una actividad.</p>
  <form data-perf-calc><div class="perf-fields">${field('date','Fecha de la sesión',{type:'date',value:today(),required:true})}${field('minutes','Duración (minutos)',{min:0.01,max:1440,required:true})}${field('percent','Intensidad (% FTP)',{min:0.01,max:300,required:true})}</div><button class="button secondary" type="submit">Estimar carga</button></form><div data-perf-calc-result role="status" aria-live="polite"></div></section>
  <section class="perf-card"><span class="eyebrow">ESCENARIO MANUAL</span><h3>Simulador de carga y frescura</h3><p>Prueba una planificación con CTL (carga crónica), ATL (carga aguda) y TSB (frescura). Este escenario no modifica el calendario ni el historial.</p>
  <form data-perf-scenario><div class="perf-fields">${field('start','Primer día',{type:'date',value:today(),required:true})}${field('days','Horizonte (días)',{min:7,max:90,step:1,value:42,required:true})}${field('ctl','CTL al terminar el día anterior',{min:0,max:5000,required:true})}${field('atl','ATL al terminar el día anterior',{min:0,max:5000,required:true})}</div><label class="perf-field"><span>Sesiones previstas: una por línea, fecha; carga estimada</span><textarea name="loads" rows="5" maxlength="8000" placeholder="AAAA-MM-DD; 72.25"></textarea></label><p class="perf-note">Los días sin sesiones se simulan como descanso (carga 0). Puedes usar 0 como inicio si eliges explícitamente partir de cero. La simulación solo dura en esta pantalla.</p><button class="button secondary" type="submit">Calcular escenario</button></form><p data-perf-scenario-message role="status" aria-live="polite"></p></section></div>
  <section class="perf-card" data-perf-chart hidden><h3>Proyección del escenario</h3><p>CTL: azul · ATL: violeta · TSB: ámbar. CTL usa 42 días y ATL 7; el TSB de cada fecha usa el CTL y ATL del día anterior. Estas cifras no diagnostican sobreentrenamiento.</p><div data-perf-svg></div><details><summary>Consultar valores por día</summary><div class="perf-scroll" data-perf-days></div></details></section>
  <section class="perf-card"><h3>Para analizar el historial real</h3><p>La importación y el cálculo desde los archivos completos de las actividades siguen pendientes. La potencia normalizada, el IF y la carga real necesitan las series temporales y el umbral vigente en cada fecha. Aquí no se muestran valores reales calculados todavía.</p></section></div>`;
  const $=s=>root.querySelector(s),profile=$('[data-perf-profile]'),sport=$('[data-perf-sport]'),status=$('[data-perf-status]');
  const alive=t=>root.isConnected&&ticket===t;
  const say=text=>{status.textContent=text;};
  function renderHistory(){
    const relevant=rows.filter(r=>r.sport===sport.value);
    const effective=physiologyAt(rows,sport.value,today());
    $('[data-perf-effective]').innerHTML=effective?`<p class="perf-note">Ficha vigente hoy desde <strong>${esc(effective.effective_date)}</strong>: FTP ${num(effective.ftp)} W · Pulso umbral ${num(effective.lthr)} lpm · Peso ${num(effective.weight_kg)} kg.</p>`:'<p class="perf-note">Sin ficha vigente para este deporte. No se han supuesto umbrales.</p>';
    $('[data-perf-history]').innerHTML=relevant.length?`<table><caption>Versiones de ${esc(SPORTS[sport.value])}${truncated?' · Consulta limitada a las 500 versiones más recientes':''}</caption><thead><tr><th>Vigente desde</th><th>Guardada (hora UTC)</th><th>FTP (W)</th><th>Umbral FC</th><th>FC máx.</th><th>FC reposo</th><th>Peso (kg)</th><th>Ritmo (s)</th><th>Zonas potencia (%)</th><th>Zonas FC (%)</th></tr></thead><tbody>${relevant.map(r=>`<tr><td>${esc(r.effective_date)}</td><td>${esc(r.created_at)}</td>${['ftp','lthr','hr_max','hr_rest','weight_kg','threshold_pace_seconds'].map(k=>`<td>${num(r[k])}</td>`).join('')}<td>${esc(r.power_zone_bounds?.join(', ')||'Sin definir')}</td><td>${esc(r.hr_zone_bounds?.join(', ')||'Sin definir')}</td></tr>`).join('')}</tbody></table>`:'<p>Sin versiones guardadas para este deporte.</p>';
  }
  function fill(){
    profile.reset();profile.elements.effective_date.value=today();
    const current=physiologyAt(rows,sport.value,today());
    if(current){for(const [name] of fields)profile.elements[name].value=current[name]??'';for(const name of ['power_zone_bounds','hr_zone_bounds'])profile.elements[name].value=current[name]?.join(', ')||'';}
    renderHistory();$('[data-perf-calc-result]').replaceChildren();
  }
  $('[data-perf-athlete]').addEventListener('change',async event=>{
    const t=++ticket;selected=event.target.value;rows=[];truncated=false;$('[data-perf-record]').hidden=true;$('[data-perf-calc-result]').replaceChildren();
    if(!selected){say('Selecciona un deportista para consultar o guardar su ficha.');return;}
    say('Cargando ficha…');
    try{const result=await loadPhysiology(client,user.id,selected);if(!alive(t))return;rows=result.rows;truncated=result.truncated;fill();$('[data-perf-record]').hidden=false;say(truncated?'Se muestran las últimas 500 versiones.':'Ficha preparada. Los campos desconocidos pueden quedar vacíos.');}
    catch(error){if(alive(t))say(error.message);}
  });
  sport.addEventListener('change',()=>{fill();});
  profile.addEventListener('submit',async event=>{
    event.preventDefault();const t=ticket,athleteId=selected,saveButton=profile.querySelector('button');if(saveButton.disabled||!athleteId)return;
    saveButton.disabled=true;say('Guardando nueva versión…');
    try{
      const values=Object.fromEntries(new root.ownerDocument.defaultView.FormData(profile));values.sport=sport.value;
      const saved=await savePhysiology(client,user.id,athleteId,values);if(!alive(t))return;
      rows=[saved,...rows];renderHistory();$('[data-perf-calc-result]').replaceChildren();say('Ficha guardada. Se conservan las versiones anteriores.');
    }catch(error){if(alive(t))say(error.message);}
    finally{saveButton.disabled=false;}
  });
  $('[data-perf-calc]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget,result=$('[data-perf-calc-result]');
    try{
      const estimate=estimatedLoad(form.elements.minutes.value,form.elements.percent.value),applicable=physiologyAt(rows,'cycling',form.elements.date.value);
      const watts=applicable?.ftp?applicable.ftp*estimate.intensityFactor:null;
      result.innerHTML=`<p class="perf-result">Carga estimada: <strong>${num(estimate.load)}</strong> · IF estimado: ${num(estimate.intensityFactor)}</p><p>${watts!==null?`${num(watts)} W según el FTP de ${num(applicable.ftp)} W vigente desde ${esc(applicable.effective_date)}.`:'Sin FTP ciclista vigente del deportista seleccionado: la estimación relativa funciona, pero no se traduce a vatios.'}</p><p class="perf-note">Fórmula: horas × (porcentaje FTP / 100)² × 100. No equivale a medir una sesión con cambios de intensidad.</p>`;
    }catch(error){result.textContent=error.message;}
  });
  // Editing a scenario invalidates its previous chart immediately.
  const scenario=$('[data-perf-scenario]');scenario.addEventListener('input',()=>{$('[data-perf-chart]').hidden=true;$('[data-perf-scenario-message]').textContent='Vuelve a calcular para ver el escenario actualizado.';});
  scenario.addEventListener('submit',event=>{
    event.preventDefault();const e=scenario.elements;
    try{
      const days=Number(e.days.value),loads=parseScenario(e.loads.value,e.start.value,days),series=simulatePMC({start:e.start.value,days,ctl:e.ctl.value,atl:e.atl.value,loads});
      renderChart($('[data-perf-svg]'),series);
      $('[data-perf-days]').innerHTML=`<table><caption>Valores estimados por fecha</caption><thead><tr><th>Fecha</th><th>Carga</th><th>CTL</th><th>ATL</th><th>TSB</th></tr></thead><tbody>${series.map(r=>`<tr><td>${r.date}</td>${['load','ctl','atl','tsb'].map(k=>`<td>${num(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      $('[data-perf-chart]').hidden=false;$('[data-perf-scenario-message]').textContent='Escenario calculado. No se ha guardado en el calendario.';
    }catch(error){$('[data-perf-chart]').hidden=true;$('[data-perf-scenario-message]').textContent=error.message;}
  });
}
function renderChart(root,series){
  const width=800,height=300,pad=48,all=series.flatMap(r=>[r.ctl,r.atl,r.tsb]),min=Math.min(0,...all),max=Math.max(1,...all),range=max-min;
  const x=i=>pad+i*(width-2*pad)/(series.length-1),y=v=>height-pad-(v-min)*(height-2*pad)/range;
  const lines=['ctl','atl','tsb'].map(key=>`<polyline class="perf-${key}" fill="none" stroke-width="3" points="${series.map((r,i)=>`${x(i).toFixed(2)},${y(r[key]).toFixed(2)}`).join(' ')}"/>`).join('');
  root.innerHTML=`<svg class="perf-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Proyección de CTL, ATL y TSB del escenario. Los valores exactos están en la tabla por día."><line x1="${pad}" y1="${y(0)}" x2="${width-pad}" y2="${y(0)}" stroke="currentColor" stroke-opacity=".25"/>${[min,(min+max)/2,max].map(v=>`<text x="4" y="${y(v)}" fill="currentColor" font-size="12">${num(v)}</text>`).join('')}${lines}<text x="${pad}" y="${height-12}" fill="currentColor" font-size="12">${series[0].date}</text><text x="${width-pad}" y="${height-12}" fill="currentColor" text-anchor="end" font-size="12">${series.at(-1).date}</text></svg>`;
}
