/* Belize Flood Risk Explorer — map logic */
'use strict';

const STATS = [
  {v:"342,870", l:"National population"},
  {v:"~49,200", l:"Exposed · 1:100-yr"},
  {v:"~20,000", l:"Exposed · 1:25-yr"},
  {v:"~7,450",  l:"Outside EWS coverage"},
];

// Basemaps — all KEYLESS (CARTO now watermarks its tiles "API KEY REQUIRED").
// Esri's neutral gray canvas needs no key and is ideal under data overlays;
// plain OpenStreetMap is the automatic fallback.
const ESRI_ATTR='Tiles &copy; <a href="https://www.esri.com/">Esri</a> · WRI Aqueduct · WorldPop';
const OSM_ATTR='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · WRI Aqueduct · WorldPop';
const BASES = {
  light:{url:"https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
         opts:{maxZoom:16, attribution:ESRI_ATTR}},
  dark: {url:"https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
         opts:{maxZoom:16, attribution:ESRI_ATTR}},
  osm:  {url:"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
         opts:{subdomains:'abc', maxZoom:19, attribution:OSM_ATTR}}
};

// Belize fallback view so the basemap always renders, even before data loads.
const BELIZE_CENTER = [17.19, -88.49];
const GROUPS = [
  {key:'hazard',   title:'Flood hazard'},
  {key:'exposure', title:'Exposure & early warning'},
  {key:'context',  title:'Context'},
];

const map = L.map('map',{zoomControl:true,attributionControl:true,minZoom:6,maxZoom:14})
  .setView(BELIZE_CENTER, 8);               // <-- set a view immediately

// Build a basemap tile layer; if its tiles fail to load (host blocked),
// fall back to plain OpenStreetMap so the map is never blank.
let base, usingFallback=false;
function setBase(key){
  const def = BASES[key];
  if(base) map.removeLayer(base);
  base = L.tileLayer(def.url, def.opts);
  if(key!=='osm'){
    let errs=0;
    base.on('tileerror', ()=>{ if(!usingFallback && ++errs>=4){ usingFallback=true; setBase('osm'); } });
  }
  base.addTo(map);
}
setBase('light');
L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);

const overlays = {};
let activeIds = new Set();
let towerLayer=null, boundaryLayer=null;
const root=document.documentElement;

function renderStats(){
  document.getElementById('stats').innerHTML = STATS.map(s=>
    `<div class="stat"><b>${s.v}</b><span>${s.l}</span></div>`).join('');
}
function legendHTML(lg){
  if(!lg) return '';
  if(lg.type==='categorical'){
    return `<div class="legend">`+lg.items.map(i=>
      `<div class="lrow"><span class="sw" style="background:${i.color}"></span>${i.label}</div>`).join('')+`</div>`;
  }
  if(lg.type==='gradient'){
    return `<div class="legend"><div class="grad" style="background:linear-gradient(90deg,${lg.colors[0]},${lg.colors[1]})"></div>`+
      `<div class="glabels"><span>${lg.labels[0]}</span><span>${lg.labels[1]}</span></div></div>`;
  }
  return '';
}
const opVal = ()=>document.getElementById('op').value/100;
function setOpacity(v){ activeIds.forEach(id=>overlays[id] && overlays[id].setOpacity(v)); }

function loadBoundary(){
  fetch('data/belize_boundary.geojson').then(r=>r.json()).then(gj=>{
    boundaryLayer=L.geoJSON(gj,{style:{color:getComputedStyle(root).getPropertyValue('--ink'),
      weight:1.4,fill:false,opacity:.55,dashArray:'3 3'}}).addTo(map);
  }).catch(()=>{});
}
function loadTowers(){
  fetch('data/towers.geojson').then(r=>r.json()).then(gj=>{
    towerLayer=L.geoJSON(gj,{pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:4,color:'#fff',weight:1,
      fillColor:'#00897b',fillOpacity:.95}).bindPopup('<div class="tower-pop"><b>Telecom mast</b><br>Alert dissemination site</div>')}).addTo(map);
  }).catch(()=>{});
}

function buildUI(meta){
  renderStats();
  if(meta.bounds) map.fitBounds(meta.bounds,{padding:[20,20]});

  meta.layers.forEach(l=>{
    overlays[l.id] = L.imageOverlay(l.file, l.bounds, {opacity:.85, interactive:false, className:'ov-'+l.id});
  });

  const host = document.getElementById('layers');
  GROUPS.forEach(g=>{
    const items = meta.layers.filter(l=>l.group===g.key);
    const extra = g.key==='context' ? [
      {id:'__towers', name:`Telecom masts (${meta.n_towers||''})`, about:'OSM communication sites — proxy for alert dissemination infrastructure.',
       legend:{type:'categorical',items:[{color:'#00897b',label:'Telecom mast'}]}},
      {id:'__boundary', name:'National boundary', about:'Belize administrative outline.', legend:null},
    ] : [];
    if(!items.length && !extra.length) return;
    const wrap=document.createElement('div'); wrap.className='group';
    wrap.innerHTML=`<h2>${g.title}</h2>`;
    [...items,...extra].forEach(l=>{
      const row=document.createElement('label'); row.className='lyr';
      row.innerHTML=`<input type="checkbox" ${l.default?'checked':''} data-id="${l.id}">
        <div class="meta"><div class="nm">${l.name}</div>
        <div class="ab">${l.about||''}</div>${legendHTML(l.legend)}</div>`;
      wrap.appendChild(row);
    });
    host.appendChild(wrap);
  });

  host.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change',e=>toggle(e.target.dataset.id,e.target.checked));
    if(cb.checked) toggle(cb.dataset.id,true);
  });
  document.getElementById('op').addEventListener('input',e=>setOpacity(e.target.value/100));
}

function toggle(id,on){
  if(id==='__towers'){
    if(on){ if(!towerLayer){loadTowers();} else towerLayer.addTo(map);} else if(towerLayer) map.removeLayer(towerLayer);
    return;
  }
  if(id==='__boundary'){
    if(on){ if(!boundaryLayer){loadBoundary();} else boundaryLayer.addTo(map);} else if(boundaryLayer) map.removeLayer(boundaryLayer);
    return;
  }
  const ov=overlays[id]; if(!ov) return;
  if(on){ ov.setOpacity(opVal()); ov.addTo(map); activeIds.add(id);} else { map.removeLayer(ov); activeIds.delete(id);}
  if(boundaryLayer) boundaryLayer.bringToFront();
  if(towerLayer) towerLayer.bringToFront();
}

// theme toggle
function applyTheme(t){
  root.setAttribute('data-theme',t);
  if(!usingFallback) setBase(t==='dark'?'dark':'light');
  if(boundaryLayer){ boundaryLayer.setStyle({color:getComputedStyle(root).getPropertyValue('--ink')}); boundaryLayer.bringToFront(); }
  if(towerLayer) towerLayer.bringToFront();
}
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark':'light';
applyTheme(theme);
document.getElementById('theme').onclick=()=>{theme=theme==='dark'?'light':'dark';applyTheme(theme);};
document.getElementById('collapse').onclick=()=>document.getElementById('panel').classList.toggle('hidden');

// load data (requires http:// — fetch is blocked on file://)
fetch('data/layers.json')
  .then(r=>{ if(!r.ok) throw new Error(r.status); return r.json(); })
  .then(buildUI)
  .catch(err=>{
    console.error('Could not load data/layers.json:', err);
    renderStats();
    const b=document.getElementById('banner');
    b.classList.add('show');
    b.innerHTML = (location.protocol==='file:')
      ? '⚠ Open this page over <b>http</b>, not as a file. Run a local server (<code>python -m http.server</code>) or use the GitHub Pages URL — browsers block data loading on <code>file://</code>.'
      : '⚠ Could not load map layers (<code>data/layers.json</code>). The basemap is shown; check that the <code>data/</code> folder deployed.';
  });
