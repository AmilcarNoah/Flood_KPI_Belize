/* Belize Flood Story — MapLibre GL + deck.gl 3D story map */
'use strict';

const { MapboxOverlay, ColumnLayer, ScatterplotLayer, GeoJsonLayer, BitmapLayer } = deck;

/* ---------- keyless, CORS-enabled vector basemap (OpenFreeMap) ----------
   MapLibre fetches tiles with CORS; OpenFreeMap serves keyless styles with
   access-control-allow-origin:*, unlike Esri/CARTO raster endpoints. */
// Basemaps (all keyless, CORS-enabled). Satellite = Esri World Imagery.
const BASEMAPS = {
  satellite:{ kind:'raster', dark:true,
    tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attr:'Imagery © Esri, Maxar, Earthstar Geographics · WRI Aqueduct · WorldPop' },
  dark:{  kind:'style', url:'https://tiles.openfreemap.org/styles/dark',     dark:true },
  light:{ kind:'style', url:'https://tiles.openfreemap.org/styles/positron',  dark:false }
};
function basemapStyle(key){
  const d = BASEMAPS[key];
  if(d.kind==='style') return d.url;
  return { version:8, sources:{ sat:{ type:'raster', tileSize:256, tiles:d.tiles, attribution:d.attr } },
           layers:[{ id:'sat', type:'raster', source:'sat' }] };
}

/* ---------- color helpers ---------- */
const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
function ramp(stops){ const c = stops.map(hex); return t => {
  t = Math.max(0, Math.min(1, t)); const x = t*(c.length-1); const i = Math.floor(x); const f = x-i;
  const a = c[i], b = c[Math.min(i+1,c.length-1)];
  return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f];
};}
// Kontur-style population peaks: dark teal (low) -> green -> yellow -> white (high)
const PEAK_RAMP = ramp(['#0a2a3a','#0e6b7a','#1aa3a3','#5fcf7a','#c3e84b','#fbe94e','#fff4c2','#ffffff']);
// exposed people: deep red -> orange -> amber -> white-hot ("alarm" peaks)
const RED_RAMP  = ramp(['#7c1d0a','#d44a1a','#f5873b','#ffd24a','#fff2c0','#ffffff']);

/* Build a pair of deck layers per dataset: a wide additive GLOW halo + a thin
   bright CORE, giving the luminous Kontur "light-beam" spike look.            */
function peakLayers(id, data, maxVal, cramp, elevScale, coreR, glowR){
  const col = (v, a)=>{ const c = cramp(Math.pow(v/maxVal, 0.45)); return [c[0],c[1],c[2],a]; };
  const common = { data, diskResolution:20, extruded:true, radiusUnits:'meters',
    elevationScale:elevScale*rise, getPosition:d=>[d[0],d[1]], getElevation:d=>d[2]+40,
    updateTriggers:{ getElevation: rise } };
  // glow halo doubles as the (large, easy-to-hover) pick target for tooltips
  const glow = new ColumnLayer({ ...common, id:id+'-glow', radius:glowR, pickable:true,
    getFillColor:d=>col(d[2], 34),
    parameters:{ depthTest:false, depthMask:false, blend:true,
      blendColorOperation:'add', blendColorSrcFactor:'src-alpha', blendColorDstFactor:'one',
      blendAlphaOperation:'add', blendAlphaSrcFactor:'one', blendAlphaDstFactor:'one' } });
  const core = new ColumnLayer({ ...common, id:id, radius:coreR,
    getFillColor:d=>col(d[2], 255),
    material:{ ambient:.85, diffuse:.25, shininess:50, specularColor:[255,255,255] } });
  return [glow, core];
}

/* ---------- state ---------- */
let map, overlay, meta, DATA = {}, time = 0, raf;
let currentBase = 'dark';
let current = 0;
let rise = 1, rising = false, riseStart = 0;   // grow-in animation factor for peaks
const easeOut = t => 1 - Math.pow(1 - t, 3);

const CHAPTERS = [
  {
    no:'01', title:'The land & its people', layers:['pop'],
    cam:{ pitch:32, bearing:-10 },
    narr:`Belize is small and low-lying. These peaks are its people — each column a
      1&nbsp;km cell, its height the number of residents (WorldPop 2025).
      <span class="big">342,870</span><span class="sub">people nationally · tallest peaks are Belize City & the north</span>`,
    legend:{type:'peaks', colors:['#0e6b7a','#1aa3a3','#5fcf7a','#c3e84b','#fbe94e','#ffffff'],
      labels:['low','dense'], ttl:'Population peaks',
      caption:'Spike <b>height</b> &amp; <b>colour</b> = residents per 1&nbsp;km² cell (WorldPop 2025).'}
  },
  {
    no:'02', title:'Where the water goes', layers:['flood'],
    cam:{ pitch:22, bearing:-6 },
    narr:`Modelled riverine flooding for a 1-in-100-year event (WRI Aqueduct).
      Deeper, darker blues mean more severe inundation — the river valleys and the
      low coastal plain take the worst of it.
      <span class="big">≥ 0.15 m</span><span class="sub">flood depth shown · fading blues scale with severity</span>`,
    legend:{type:'cat', ttl:'Flood depth (WRI Aqueduct)', items:[
        {color:'#4ba3d6', label:'Shallow',   range:'0.15–0.25 m'},
        {color:'#2171b5', label:'Moderate',  range:'0.25–0.35 m'},
        {color:'#08519c', label:'Deep',      range:'0.35–0.50 m'},
        {color:'#08306b', label:'Very deep', range:'≥ 0.50 m'}],
      caption:'Modelled inundation depth per 100&nbsp;m cell, 1-in-100-yr riverine flood.'}
  },
  {
    no:'03', title:'People in the water', layers:['flood','exposed'], fit:'exposed',
    cam:{ pitch:46, bearing:-12 },
    narr:`Overlay the people on the flood. These red peaks are residents standing
      inside the 100-year footprint — exposure, not just hazard.
      <span class="big">~49,200</span><span class="sub">people exposed · about 1 in 7 Belizeans</span>`,
    legend:{type:'peaks', colors:['#7c1d0a','#d44a1a','#f5873b','#ffd24a','#fff2c0','#ffffff'],
      labels:['few','many'], ttl:'Exposed population peaks',
      caption:'Spike <b>height</b> &amp; <b>colour</b> = flood-exposed residents per 500&nbsp;m cell. Blue = flood extent.'}
  },
  {
    no:'04', title:'Can the warning reach them?', layers:['coverage','ping','exposed'],
    cam:{ pitch:34, bearing:-10 },
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

  // flood is drawn as native MapLibre glow layers (see addFloodLayers), not deck
  if(vis.has('coverage') && DATA.coverage){
    L.push(new GeoJsonLayer({ id:'coverage', data:DATA.coverage, stroked:true, filled:true,
      getFillColor:[59,209,196,70], getLineColor:[59,209,196,180], lineWidthMinPixels:1 }));
  }
  if(vis.has('pop') && DATA.pop){
    L.push(...peakLayers('pop', DATA.pop, meta.population.max, PEAK_RAMP, 6.5, 130, 430));
  }
  if(vis.has('exposed') && DATA.exp){
    const m = meta.exposed.max;
    // soft additive ground footprint connects the spikes into a readable field
    L.push(new ScatterplotLayer({ id:'exp-foot', data:DATA.exp, radiusUnits:'meters',
      getPosition:d=>[d[0],d[1]], getRadius:320,
      getFillColor:d=>{ const c=RED_RAMP(Math.pow(d[2]/m,0.4)); return [c[0],c[1],c[2],40]; },
      parameters:{ depthTest:false, blend:true, blendColorOperation:'add',
        blendColorSrcFactor:'src-alpha', blendColorDstFactor:'one' } }));
    L.push(...peakLayers('exposed', DATA.exp, m, RED_RAMP, 14.0, 150, 340));
  }
  if(vis.has('ping') && DATA.masts){
    // three expanding rings, phase-offset, for a continuous pulse
    for(let k=0;k<3;k++){
      const prog = ((time/5200) + k/3) % 1;             // 0..1 (slower pulse)
      L.push(new ScatterplotLayer({ id:'ping'+k, data:DATA.masts,
        stroked:true, filled:false, radiusUnits:'meters',
        getPosition:d=>d, getRadius:prog*5000, lineWidthMinPixels:1.5,
        getLineColor:[59,209,196, 210*(1-prog)], updateTriggers:{getRadius:time, getLineColor:time} }));
    }
    L.push(new ScatterplotLayer({ id:'masts', data:DATA.masts, filled:true, radiusUnits:'pixels',
      pickable:true, getPosition:d=>d, getRadius:4, getFillColor:[180,255,245,230] }));
  }
  return L;
}

/* ---------- unified animation loop: grow-in of peaks + mast ping ---------- */
function loop(){
  const now = performance.now(); time = now;
  if(rising){
    const t = Math.min(1, (now - riseStart) / 900);
    rise = 0.02 + 0.98 * easeOut(t);
    if(t >= 1){ rising = false; rise = 1; }
  }
  overlay.setProps({ layers: buildLayers() });
  if(rising || CHAPTERS[current].layers.includes('ping')) raf = requestAnimationFrame(loop);
}
// start a scene: peaks rise from the ground; keep looping if the chapter pings
function startScene(){
  cancelAnimationFrame(raf);
  const hasPeaks = CHAPTERS[current].layers.some(l=>l==='pop'||l==='exposed');
  if(hasPeaks){ rising = true; riseStart = performance.now(); rise = 0.02; }
  else { rising = false; rise = 1; }
  raf = requestAnimationFrame(loop);
}

/* ---------- glowing blue flood vectors (native MapLibre layers) ---------- */
const FLOOD_IDS = ['flood-glow3','flood-glow2','flood-glow1','flood-fill','flood-edge'];
function addFloodLayers(){
  if(!DATA.floodVec || map.getSource('flood')) return;
  map.addSource('flood', { type:'geojson', data:DATA.floodVec });
  // three stacked blurred lines = soft outer glow
  map.addLayer({ id:'flood-glow3', type:'line', source:'flood', layout:{visibility:'none'},
    paint:{'line-color':'#8fe6ff','line-width':16,'line-blur':20,'line-opacity':0.25} });
  map.addLayer({ id:'flood-glow2', type:'line', source:'flood', layout:{visibility:'none'},
    paint:{'line-color':'#5fd0ff','line-width':8,'line-blur':10,'line-opacity':0.45} });
  map.addLayer({ id:'flood-glow1', type:'line', source:'flood', layout:{visibility:'none'},
    paint:{'line-color':'#3bc0ff','line-width':3.5,'line-blur':4,'line-opacity':0.7} });
  // graduated blue fill by depth class
  map.addLayer({ id:'flood-fill', type:'fill', source:'flood', layout:{visibility:'none'},
    paint:{'fill-color':['match',['get','cls'],1,'#4ba3d6',2,'#2171b5',3,'#08519c',4,'#08306b','#2171b5'],
           'fill-opacity':0.62} });
  // crisp bright edge
  map.addLayer({ id:'flood-edge', type:'line', source:'flood', layout:{visibility:'none'},
    paint:{'line-color':'#cdeeff','line-width':1,'line-opacity':0.9} });
  setupFloodHover();
}

// hover the flood to read its depth class (native MapLibre features)
const DEPTH_CLASS = {1:['Shallow','0.15–0.25 m'],2:['Moderate','0.25–0.35 m'],3:['Deep','0.35–0.50 m'],4:['Very deep','≥ 0.50 m']};
function setupFloodHover(){
  const tip = document.getElementById('tooltip');
  map.on('mousemove','flood-fill', e=>{
    const f = e.features && e.features[0]; if(!f) return;
    const c = DEPTH_CLASS[f.properties.cls] || ['Flood',''];
    map.getCanvas().style.cursor = 'crosshair';
    tip.innerHTML = `<div class="tv">${c[1]}</div><div class="tl">${c[0]} · flood depth</div>`;
    tip.style.left = (e.originalEvent.clientX + 14) + 'px';
    tip.style.top  = (e.originalEvent.clientY + 14) + 'px';
    tip.classList.add('show'); tipOwner = 'flood';
  });
  map.on('mouseleave','flood-fill', ()=>{ map.getCanvas().style.cursor='';
    if(tipOwner==='flood'){ tip.classList.remove('show'); tipOwner=null; } });
}

// deck.gl hover-to-inspect for the 3D peaks and masts -> styled #tooltip div
function tooltipHTML(id, o){
  const n = v => Math.round(v).toLocaleString();
  if(id==='pop-glow')     return `<div class="tv">${n(o[2])}</div><div class="tl">residents · 1 km² cell</div>`;
  if(id==='exposed-glow') return `<div class="tv" style="color:#ffb27a">${n(o[2])}</div><div class="tl">exposed · 500 m cell</div>`;
  if(id==='masts')        return `<div class="tv">Telecom mast</div><div class="tl">~5 km alert reach</div>`;
  return null;
}
let tipOwner = null;  // 'deck' | 'flood' — so the two hover sources don't fight
function handleHover(info){
  const tip = document.getElementById('tooltip');
  if(info && info.object && info.layer){
    const html = tooltipHTML(info.layer.id, info.object);
    if(html){
      tip.innerHTML = html;
      tip.style.left = (info.x + 16) + 'px';
      tip.style.top  = (info.y + 16) + 'px';
      tip.classList.add('show'); tipOwner = 'deck';
      if(map) map.getCanvas().style.cursor = 'pointer';
      return;
    }
  }
  if(tipOwner === 'deck'){ tip.classList.remove('show'); tipOwner = null; if(map) map.getCanvas().style.cursor=''; }
}
// mode: null = hidden, 'full' = glowing hero (ch2), 'base' = dim context under peaks (ch3)
function setFloodVisible(mode){
  const show = !!mode, glow = mode==='full';
  const vis = (id,on)=>{ if(map.getLayer(id)) map.setLayoutProperty(id,'visibility', on?'visible':'none'); };
  const paint = (id,p,val)=>{ if(map.getLayer(id)) map.setPaintProperty(id,p,val); };
  vis('flood-glow3', glow); vis('flood-glow2', glow); vis('flood-glow1', glow);
  vis('flood-fill', show);  vis('flood-edge', show);
  paint('flood-fill','fill-opacity', mode==='base' ? 0.30 : 0.62);
  paint('flood-edge','line-opacity', mode==='base' ? 0.35 : 0.9);
  paint('flood-edge','line-color', mode==='base' ? '#7fb8e0' : '#cdeeff');
}
function floodMode(ch){
  if(!ch.layers.includes('flood')) return null;
  return ch.layers.includes('exposed') ? 'base' : 'full';
}

/* ---------- panel-aware padding so Belize is never hidden by the panel ---------- */
function getPadding(){
  if(window.innerWidth <= 760){
    return { top:40, left:24, right:24, bottom:Math.round(window.innerHeight*0.42) };
  }
  const w = document.getElementById('scrolly')?.offsetWidth || 470;
  // the scrim fades out, so the usable centre sits a little left of the column edge
  return { top:36, left:Math.round(w*0.82), right:40, bottom:64 };
}

/* ---------- per-chapter framing bounds ---------- */
function chapterBounds(ch){
  if(ch.fit==='exposed' && DATA.exp && DATA.exp.length){
    let w=1e9,s=1e9,e=-1e9,n=-1e9;
    for(const d of DATA.exp){ w=Math.min(w,d[0]); e=Math.max(e,d[0]); s=Math.min(s,d[1]); n=Math.max(n,d[1]); }
    const m=0.06;
    return [[w-m,s-m],[e+m,n+m]];
  }
  // trim all edges inward (open sea / outer cayes to the east, sparse corners
  // elsewhere) so the mainland centres, fills the free area and frames closer
  const west  = Math.max(meta.bounds[0], -89.12);
  const south = Math.max(meta.bounds[1],  16.02);
  const east  = Math.min(meta.bounds[2], -87.98);
  const north = Math.min(meta.bounds[3],  18.42);
  return [[west, south], [east, north]];
}

/* ---------- chapter rendering ---------- */
function legendHTML(lg){
  if(!lg) return '';
  let inner = `<div class="ttl">${lg.ttl}</div>`;
  if(lg.type==='peaks'){
    // mini spikes rising left→right, coloured along the ramp: shows that both
    // HEIGHT and COLOUR encode the value
    const hs = [8,15,23,33,44,50];
    const bars = lg.colors.map((c,i)=>`<span style="height:${hs[i]||50}px;background:${c}"></span>`).join('');
    inner += `<div class="peaks-bars">${bars}</div>`+
      `<div class="glabels"><span>${lg.labels[0]}</span><span>${lg.labels[1]}</span></div>`;
    if(lg.caption) inner += `<div class="leg-cap">${lg.caption}</div>`;
  } else if(lg.type==='grad'){
    inner += `<div class="grad" style="background:linear-gradient(90deg,${lg.colors.join(',')})"></div>`+
      `<div class="glabels"><span>${lg.labels[0]}</span><span>${lg.labels[1]}</span></div>`;
    if(lg.caption) inner += `<div class="leg-cap">${lg.caption}</div>`;
  } else {
    inner += lg.items.map(i=>`<div class="lrow"><span class="sw" style="background:${i.color}"></span>`+
      `${i.label}${i.range?`<span class="rng">${i.range}</span>`:''}</div>`).join('');
    if(lg.caption) inner += `<div class="leg-cap">${lg.caption}</div>`;
  }
  return `<div class="legend">${inner}</div>`;
}

// activate a chapter's SCENE (camera + layers). The narrative lives in the
// scrolling column; this only drives the map.
function setChapter(i, force){
  i = Math.max(0, Math.min(CHAPTERS.length-1, i));
  if(i===current && !force && map) { /* fall through to re-render on force only */ }
  current = i;
  const ch = CHAPTERS[i];
  document.querySelectorAll('#progress .pdot').forEach((d,idx)=>d.classList.toggle('on', idx===i));

  const pad = getPadding();
  const bb = chapterBounds(ch);
  // fit flat so the country fills the free area, then apply a modest pitch
  let cam = null;
  try { cam = map.cameraForBounds(bb, { padding: pad, bearing: ch.cam.bearing, maxZoom: 11.5 }); } catch(e){}
  const pitchEase = ch.cam.pitch >= 40 ? 0.5 : (ch.cam.pitch >= 25 ? 0.25 : 0.1);
  map.flyTo({ center: cam ? cam.center : meta.center, zoom: (cam ? cam.zoom : 7.0) - pitchEase,
              pitch: ch.cam.pitch, bearing: ch.cam.bearing,
              padding: pad, duration: 1600, essential: true });
  setFloodVisible(floodMode(ch));
  startScene();
}

/* ---------- build the scrolling narrative + progress rail ---------- */
function buildStory(){
  const sc = document.getElementById('scrolly');
  let html = `<section class="step intro active" data-ch="0"><div class="card hero">
    <div class="kicker">Belize · Flood Risk</div>
    <h1>When the rivers rise</h1>
    <p>A data story about who lives where the water goes — and whether a warning can reach them in time.</p>
    <div class="scrollhint"><span class="chev">↓</span> scroll to explore · hover the map to inspect</div>
  </div></section>`;
  CHAPTERS.forEach((ch,i)=>{
    html += `<section class="step" data-ch="${i}"><div class="card">
      <div class="chnum">CHAPTER ${ch.no}</div>
      <h2>${ch.title}</h2>
      <div class="body">${ch.narr}</div>
      ${legendHTML(ch.legend)}
    </div></section>`;
  });
  html += `<section class="step outro" data-ch="3"><div class="card">
    <h2>Reading the risk</h2>
    <div class="body">Hazard and people together. About <em>49,200</em> Belizeans live inside the
      1-in-100-year flood footprint, and roughly <em>7,450</em> of them fall outside modelled
      early-warning range — the gap this map is built to expose.</div>
    <div class="src">Data: <b>WRI Aqueduct</b> riverine floods · <b>WorldPop 2025</b> ·
      OpenStreetMap masts (5 km buffers in EPSG:32616).<br>Basemaps © OpenFreeMap / Esri.
      Built from the Belize training notebooks.</div>
  </div></section>`;
  sc.innerHTML = html;

  const pg = document.getElementById('progress');
  pg.innerHTML = CHAPTERS.map((ch,i)=>`<div class="pdot" data-ch="${i}" data-label="${ch.no} · ${ch.title}"></div>`).join('');
  pg.querySelectorAll('.pdot').forEach(d=> d.onclick = ()=>{
    const s = sc.querySelector(`.step[data-ch="${d.dataset.ch}"]:not(.intro)`);
    if(s) s.scrollIntoView({ behavior:'smooth' });
  });
}

function setupObserver(){
  const sc = document.getElementById('scrolly');
  const steps = [...sc.querySelectorAll('.step')];
  const io = new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(en.isIntersecting && en.intersectionRatio >= 0.5){
        steps.forEach(s=>s.classList.toggle('active', s===en.target));
        const ch = +en.target.dataset.ch;
        if(ch !== current) setChapter(ch);
      }
    });
  }, { root:sc, threshold:[0.5] });
  steps.forEach(s=>io.observe(s));
}

/* ---------- boot ---------- */
function boot(){
  map = new maplibregl.Map({
    container:'map', style:basemapStyle(currentBase),
    center:[-88.37,17.19], zoom:8, pitch:30, bearing:-10, antialias:true, attributionControl:true
  });
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'bottom-right');
  overlay = new MapboxOverlay({ interleaved:true, layers:[], onHover:handleHover, pickingRadius:8 });
  map.addControl(overlay);

  const mapReady = new Promise(res=>{ if(map.loaded()) res(); else map.once('load', res); });

  Promise.all([
    mapReady,
    fetch('data/story_meta.json').then(r=>r.json()),
    fetch('data/population_points.json').then(r=>r.json()),
    fetch('data/exposed_points.json').then(r=>r.json()),
    fetch('data/masts.json').then(r=>r.json()),
    fetch('data/mast_coverage.geojson').then(r=>r.json()),
    fetch('data/flood_vectors.geojson').then(r=>r.json())
  ]).then(([_,m,pop,exp,masts,cov,flood])=>{
    meta = m;
    DATA.pop = pop; DATA.exp = exp; DATA.masts = masts; DATA.coverage = cov; DATA.floodVec = flood;
    addFloodLayers();
    buildStory();
    setupObserver();
    setChapter(0, true);
  }).catch(err=>{
    console.error(err);
    document.getElementById('scrolly').innerHTML =
      '<section class="step"><div class="card"><h2>Could not load data</h2>'+
      '<div class="body">Serve this over <b>http</b> (a local server or GitHub Pages), '+
      'not as a <code>file://</code> path.</div></div></section>';
  });
}

/* ---------- basemap switching ---------- */
function setBasemap(key){
  if(key===currentBase) return;
  currentBase = key;
  document.documentElement.setAttribute('data-theme', BASEMAPS[key].dark ? 'dark' : 'light');
  document.querySelectorAll('#basemaps button').forEach(b=>b.classList.toggle('on', b.dataset.base===key));
  map.setStyle(basemapStyle(key));
  map.once('styledata', ()=>{
    addFloodLayers();
    setFloodVisible(floodMode(CHAPTERS[current]));
    overlay.setProps({ layers: buildLayers() });
  });
}

// scroll the narrative to a given chapter step
function scrollToChapter(i){
  i = Math.max(0, Math.min(CHAPTERS.length-1, i));
  const s = document.querySelector(`#scrolly .step[data-ch="${i}"]:not(.intro)`);
  if(s) s.scrollIntoView({ behavior:'smooth' });
}

/* ---------- controls ---------- */
window.addEventListener('DOMContentLoaded', ()=>{
  boot();
  document.getElementById('replay').onclick = ()=> setChapter(current, true);
  document.querySelectorAll('#basemaps button').forEach(b=> b.onclick = ()=> setBasemap(b.dataset.base));
  window.addEventListener('keydown', e=>{
    if(e.key==='ArrowDown' || e.key==='ArrowRight'){ e.preventDefault(); scrollToChapter(current+1); }
    if(e.key==='ArrowUp'   || e.key==='ArrowLeft'){  e.preventDefault(); scrollToChapter(current-1); }
  });
  let rz; window.addEventListener('resize', ()=>{ clearTimeout(rz); rz=setTimeout(()=>{ if(meta) setChapter(current, true); }, 250); });
});
