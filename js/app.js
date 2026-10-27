/* Belize Flood Story — MapLibre GL + deck.gl 3D story map */
'use strict';

const { MapboxOverlay, ColumnLayer, ScatterplotLayer, GeoJsonLayer, BitmapLayer } = deck;

/* ---------- keyless, CORS-enabled vector basemap (OpenFreeMap) ----------
   MapLibre fetches tiles with CORS; OpenFreeMap serves keyless styles with
   access-control-allow-origin:*, unlike Esri/CARTO raster endpoints. */
const STYLE_URL = {
  dark:  'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron'
};

/* ---------- color helpers ---------- */
const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
function ramp(stops){ const c = stops.map(hex); return t => {
  t = Math.max(0, Math.min(1, t)); const x = t*(c.length-1); const i = Math.floor(x); const f = x-i;
  const a = c[i], b = c[Math.min(i+1,c.length-1)];
  return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f];
};}
// neutral (population): slate -> pale ice
const POP_RAMP = ramp(['#2c3a4d','#5a6f86','#9fb2c6','#dfe8f2','#ffffff']);
// red severity (exposed people)
const RED_RAMP = ramp(['#fdbba0','#fc8a6a','#ef5133','#c3161a','#7c0007']);

/* ---------- state ---------- */
let map, overlay, meta, DATA = {}, time = 0, raf;
let theme = 'dark';
let current = 0;

const CHAPTERS = [
  {
    no:'01', title:'The land & its people', layers:['pop'],
    cam:{ pitch:58, bearing:-18, zoom:8.2 },
    narr:`Belize is small and low-lying. These peaks are its people — each column a
      1&nbsp;km cell, its height the number of residents (WorldPop 2025).
      <span class="big">342,870</span><span class="sub">people nationally · tallest peaks are Belize City & the north</span>`,
    legend:{type:'grad', colors:['#2c3a4d','#ffffff'], labels:['fewer','more people / km²'], ttl:'Population density'}
  },
  {
    no:'02', title:'Where the water goes', layers:['flood'],
    cam:{ pitch:40, bearing:-8, zoom:8.3 },
    narr:`Modelled riverine flooding for a 1-in-100-year event (WRI Aqueduct).
      Deeper, darker reds mean more severe inundation — the river valleys and the
      low coastal plain take the worst of it.
      <span class="big">≥ 0.15 m</span><span class="sub">flood depth shown · fading reds scale with severity</span>`,
    legend:{type:'grad', colors:['#fcbba1','#67000d'], labels:['shallow','severe'], ttl:'Flood depth / severity'}
  },
  {
    no:'03', title:'People in the water', layers:['flood','exposed'],
    cam:{ pitch:58, bearing:-18, zoom:8.4 },
    narr:`Overlay the people on the flood. These red peaks are residents standing
      inside the 100-year footprint — exposure, not just hazard.
      <span class="big">~49,200</span><span class="sub">people exposed · about 1 in 7 Belizeans</span>`,
    legend:{type:'grad', colors:['#fdbba0','#7c0007'], labels:['few','many exposed'], ttl:'Exposed population / km²'}
  },
  {
    no:'04', title:'Can the warning reach them?', layers:['coverage','ping','exposed'],
    cam:{ pitch:50, bearing:-18, zoom:8.4 },
    narr:`Each telecom mast can carry an alert about 5&nbsp;km (buffered in UTM&nbsp;16N
      for true distance). Watch the signal pulse outward. Where the pulse never
      reaches the red peaks, people are flooded <em>and</em> unwarned.
      <span class="big">~7,450</span><span class="sub">exposed people outside early-warning coverage</span>
      <span class="ping-badge"><span class="pulse"></span>132 masts · 5 km reach</span>`,
    legend:{type:'cat', ttl:'Early-warning coverage', items:[
      {color:'rgba(59,209,196,.55)', label:'Within 5 km of a mast'},
      {color:'#7c0007', label:'Exposed population'}]}
  }
];

/* ---------- build deck layers for the active chapter ---------- */
function buildLayers(){
  const vis = new Set(CHAPTERS[current].layers);
  const L = [];

  if(vis.has('flood') && DATA.floodBounds){
    L.push(new BitmapLayer({ id:'flood', image:'data/overlays/flood_severity.png',
      bounds:DATA.floodBounds, opacity:0.9 }));
  }
  if(vis.has('coverage') && DATA.coverage){
    L.push(new GeoJsonLayer({ id:'coverage', data:DATA.coverage, stroked:true, filled:true,
      getFillColor:[59,209,196,70], getLineColor:[59,209,196,180], lineWidthMinPixels:1 }));
  }
  if(vis.has('pop') && DATA.pop){
    const m = meta.population.max;
    L.push(new ColumnLayer({ id:'pop', data:DATA.pop, diskResolution:6, radius:460, extruded:true,
      elevationScale:2.2, radiusUnits:'meters',
      getPosition:d=>[d[0],d[1]], getElevation:d=>d[2],
      getFillColor:d=>{ const c=POP_RAMP(Math.sqrt(d[2]/m)); return [c[0],c[1],c[2],235]; },
      material:{ambient:.6,diffuse:.6,shininess:20,specularColor:[255,255,255]} }));
  }
  if(vis.has('exposed') && DATA.exp){
    const m = meta.exposed.max;
    L.push(new ColumnLayer({ id:'exposed', data:DATA.exp, diskResolution:6, radius:470, extruded:true,
      elevationScale:3.4, radiusUnits:'meters',
      getPosition:d=>[d[0],d[1]], getElevation:d=>d[2],
      getFillColor:d=>{ const c=RED_RAMP(Math.sqrt(d[2]/m)); return [c[0],c[1],c[2],248]; },
      material:{ambient:.65,diffuse:.6,shininess:30,specularColor:[255,220,210]} }));
  }
  if(vis.has('ping') && DATA.masts){
    // three expanding rings, phase-offset, for a continuous pulse
    for(let k=0;k<3;k++){
      const prog = ((time/2600) + k/3) % 1;             // 0..1
      L.push(new ScatterplotLayer({ id:'ping'+k, data:DATA.masts,
        stroked:true, filled:false, radiusUnits:'meters',
        getPosition:d=>d, getRadius:prog*5000, lineWidthMinPixels:1.5,
        getLineColor:[59,209,196, 210*(1-prog)], updateTriggers:{getRadius:time, getLineColor:time} }));
    }
    L.push(new ScatterplotLayer({ id:'masts', data:DATA.masts, filled:true, radiusUnits:'pixels',
      getPosition:d=>d, getRadius:3, getFillColor:[180,255,245,230] }));
  }
  return L;
}

/* ---------- animation loop (only needed while a ping chapter is active) ---------- */
function animate(){
  time = performance.now();
  if(CHAPTERS[current].layers.includes('ping')){
    overlay.setProps({ layers: buildLayers() });
    raf = requestAnimationFrame(animate);
  }
}
function startAnim(){ cancelAnimationFrame(raf); if(CHAPTERS[current].layers.includes('ping')) raf = requestAnimationFrame(animate); }

/* ---------- chapter rendering ---------- */
function legendHTML(lg){
  if(!lg) return '';
  let inner = `<div class="ttl">${lg.ttl}</div>`;
  if(lg.type==='grad'){
    inner += `<div class="grad" style="background:linear-gradient(90deg,${lg.colors[0]},${lg.colors[1]})"></div>`+
      `<div class="glabels"><span>${lg.labels[0]}</span><span>${lg.labels[1]}</span></div>`;
  } else {
    inner += lg.items.map(i=>`<div class="lrow"><span class="sw" style="background:${i.color}"></span>${i.label}</div>`).join('');
  }
  return `<div class="legend">${inner}</div>`;
}

function goTo(i){
  current = Math.max(0, Math.min(CHAPTERS.length-1, i));
  const ch = CHAPTERS[current];
  document.getElementById('cno').textContent = ch.no;
  document.getElementById('ctitle').textContent = ch.title;
  document.getElementById('narr').innerHTML = ch.narr + legendHTML(ch.legend);
  document.querySelectorAll('.dot').forEach((d,idx)=>d.classList.toggle('on', idx<=current));
  document.getElementById('prev').disabled = current===0;
  document.getElementById('next').textContent = current===CHAPTERS.length-1 ? 'Restart ↺' : 'Next →';

  const c = meta.center;
  map.flyTo({ center:c, zoom:ch.cam.zoom, pitch:ch.cam.pitch, bearing:ch.cam.bearing,
              duration:1800, essential:true });
  overlay.setProps({ layers: buildLayers() });
  startAnim();
}

/* ---------- boot ---------- */
function boot(){
  map = new maplibregl.Map({
    container:'map', style:STYLE_URL.dark,
    center:[-88.37,17.19], zoom:7.6, pitch:50, bearing:-18, antialias:true, attributionControl:true
  });
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'bottom-right');
  overlay = new MapboxOverlay({ interleaved:true, layers:[] });
  map.addControl(overlay);

  const mapReady = new Promise(res=>{ if(map.loaded()) res(); else map.once('load', res); });

  Promise.all([
    mapReady,
    fetch('data/story_meta.json').then(r=>r.json()),
    fetch('data/population_points.json').then(r=>r.json()),
    fetch('data/exposed_points.json').then(r=>r.json()),
    fetch('data/masts.json').then(r=>r.json()),
    fetch('data/mast_coverage.geojson').then(r=>r.json())
  ]).then(([_,m,pop,exp,masts,cov])=>{
    meta = m;
    DATA.pop = pop; DATA.exp = exp; DATA.masts = masts; DATA.coverage = cov;
    const b = m.flood.bounds; DATA.floodBounds = [b[0],b[1],b[2],b[3]];
    // build chapter rail
    const rail = document.getElementById('rail');
    CHAPTERS.forEach((_,i)=>{ const d=document.createElement('div'); d.className='dot';
      d.onclick=()=>goTo(i); rail.appendChild(d); });
    goTo(0);
    setTimeout(()=>{ const h=document.getElementById('hint'); if(h) h.style.opacity=0; }, 6000);
  }).catch(err=>{
    console.error(err);
    document.getElementById('narr').innerHTML =
      '<p style="color:#e34a33">Could not load data. Serve this over <b>http</b> '+
      '(a local server or GitHub Pages), not as a <code>file://</code> path.</p>';
  });
}

/* ---------- controls ---------- */
window.addEventListener('DOMContentLoaded', ()=>{
  boot();
  document.getElementById('next').onclick = ()=> goTo(current===CHAPTERS.length-1 ? 0 : current+1);
  document.getElementById('prev').onclick = ()=> goTo(current-1);
  document.getElementById('replay').onclick = ()=> goTo(current);
  document.getElementById('open').onclick = ()=> document.getElementById('story').classList.toggle('hidden');
  document.getElementById('theme').onclick = ()=>{
    theme = theme==='dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    map.setStyle(STYLE_URL[theme]);
    map.once('styledata', ()=> overlay.setProps({ layers: buildLayers() }));
  };
  window.addEventListener('keydown', e=>{
    if(e.key==='ArrowRight') goTo(current+1);
    if(e.key==='ArrowLeft') goTo(current-1);
  });
});
