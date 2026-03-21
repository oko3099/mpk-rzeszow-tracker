'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');
const zlib  = require('zlib');

let JSZip;
try { JSZip = require('jszip'); } catch(e) { console.warn('[warn] JSZip niedostępny:', e.message); }

const { buildVehicleDb } = require('./vehicledb');

const PORT     = process.env.PORT || 3000;
const GTFS_RT  = 'https://www.mpkrzeszow.pl/gtfs/rt/gtfsrt.pb';
const GTFS_ZIP = 'https://www.mpkrzeszow.pl/gtfs/latest.zip';
const DEBUG    = process.env.DEBUG === '1';

let tripMap   = {};   // tripId  → { routeId, headsign, serviceId }
let routeMap  = {};   // routeId → { shortName }
let stopMap   = {};   // stopId  → { name, lat, lon }
let stopTimes = {};   // stopId  → [ { tripId, departure, stopSeq } ]
let tripStops = {};   // tripId  → [ { stopId, departure, stopSeq } ]
let serviceIds= new Set();
let vehicleDb = buildVehicleDb();
let gtfsLoaded    = false;
let gtfsLoadedAt  = 0;
const GTFS_TTL    = 6 * 3600_000;

// ─── PROTOBUF ────────────────────────────────────────────────────────────────
function readVarint(buf, pos) {
  let lo = 0, hi = 0, shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    if (shift < 28) lo |= (b & 0x7F) << shift; else hi |= (b & 0x7F) << (shift - 28);
    shift += 7; if (!(b & 0x80)) break;
  }
  return { value: hi * 0x10000000 + (lo >>> 0), pos };
}
function readF32(buf, pos) { return { value: new DataView(buf.buffer, buf.byteOffset + pos, 4).getFloat32(0, true), pos: pos + 4 }; }
function s32(v)   { return v > 0x7FFFFFFF ? v - 0x100000000 : v; }
function str(b)   { return b ? b.toString('utf8') : ''; }

function eachField(buf, cb) {
  let pos = 0; const end = buf.length;
  while (pos < end) {
    let v; try { v = readVarint(buf, pos); } catch(e) { break; }
    pos = v.pos; if (pos > end) break;
    const fn = v.value >>> 3, wt = v.value & 7;
    try {
      if      (wt===0) { v=readVarint(buf,pos); pos=v.pos; cb(fn,0,v.value,null); }
      else if (wt===1) { const lo=(buf[pos]|(buf[pos+1]<<8)|(buf[pos+2]<<16)|(buf[pos+3]<<24))>>>0; pos+=8; cb(fn,1,lo,null); }
      else if (wt===2) { v=readVarint(buf,pos); pos=v.pos; const len=v.value; if(len>end-pos+10)break; const sub=buf.slice(pos,pos+len); pos+=len; cb(fn,2,len,sub); }
      else if (wt===5) { v=readF32(buf,pos); pos=v.pos; cb(fn,5,v.value,null); }
      else break;
    } catch(e) { if(DEBUG)console.warn('[proto]',e.message); break; }
  }
}

// ─── PARSERY RT ──────────────────────────────────────────────────────────────
function parseTripDesc(buf) {
  const r={tripId:'',routeId:'',directionId:-1,startTime:'',startDate:''};
  eachField(buf,(fn,wt,val,sub)=>{
    if(fn===1&&wt===2)r.tripId=str(sub);
    else if(fn===2&&wt===2)r.startTime=str(sub);
    else if(fn===3&&wt===2)r.startDate=str(sub);
    else if(fn===4&&wt===0)r.directionId=val;
    else if(fn===5&&wt===2)r.routeId=str(sub);
    else if(fn===6&&wt===0)r.directionId=val;
  });
  return r;
}
function parseVehicleDesc(buf) {
  const r={id:'',label:''};
  eachField(buf,(fn,wt,val,sub)=>{
    if(fn===1&&wt===2)r.id=str(sub);
    else if(fn===2&&wt===2)r.label=str(sub);
  });
  if(!r.label)r.label=r.id;
  return r;
}
function parsePosition(buf) {
  const r={lat:0,lon:0,bearing:0,speed:0};
  eachField(buf,(fn,wt,val)=>{
    if(fn===1&&(wt===5||wt===1))r.lat=val;
    else if(fn===2&&(wt===5||wt===1))r.lon=val;
    else if(fn===3&&wt===5)r.bearing=val;
    else if((fn===4||fn===5)&&wt===5)r.speed=val;
  });
  return r;
}
function parseTripUpdate(buf) {
  const r={trip:null,vehicle:null,delay:null};
  eachField(buf,(fn,wt,val,sub)=>{
    if(fn===1&&wt===2)r.trip=parseTripDesc(sub);
    else if(fn===3&&wt===2)r.vehicle=parseVehicleDesc(sub);
    else if(fn===5&&wt===0)r.delay=s32(val);
    else if(fn===2&&wt===0)r.delay=s32(val);
    else if(fn===4&&wt===2){
      // StopTimeUpdate – wyciągnij delay z arrival/departure
      eachField(sub,(sf,sw,sv,ss)=>{
        if((sf===2||sf===3)&&sw===2&&r.delay===null){
          eachField(ss,(xf,xw,xv)=>{ if(xf===1&&xw===0&&r.delay===null)r.delay=s32(xv); });
        }
      });
    }
  });
  return r;
}
function parseVehiclePos(buf) {
  // MPK Rzeszów: F1=Trip, F2=Position, F3=currentStatus(varint), F5=timestamp, F8=VehicleDesc
  const r={trip:null,vehicle:null,position:null,currentStatus:-1,timestamp:0,occupancy:-1};
  eachField(buf,(fn,wt,val,sub)=>{
    if(fn===1&&wt===2)r.trip=parseTripDesc(sub);
    else if(fn===2&&wt===2)r.position=parsePosition(sub);
    else if(fn===3&&wt===0)r.currentStatus=val;
    else if(fn===5&&wt===0)r.timestamp=val;
    else if(fn===6&&wt===0)r.currentStatus=val; // standard fallback
    else if(fn===7&&wt===0)r.timestamp=val;     // standard fallback
    else if(fn===8&&wt===2)r.vehicle=parseVehicleDesc(sub);
    else if(fn===9&&wt===0)r.occupancy=val;
  });
  return r;
}
function parseFeedEntity(buf) {
  const r={id:'',tripUpdate:null,vehiclePosition:null};
  eachField(buf,(fn,wt,val,sub)=>{
    if(fn===1&&wt===2)r.id=str(sub);
    else if(fn===3&&wt===2)r.tripUpdate=parseTripUpdate(sub);
    else if(fn===4&&wt===2)r.vehiclePosition=parseVehiclePos(sub);
  });
  return r;
}
function parseFeedMessage(buf) {
  const feed={header:{timestamp:0},entities:[]};
  eachField(buf,(fn,wt,val,sub)=>{
    if(fn===1&&wt===2){
      eachField(sub,(hf,hw,hv,hs)=>{
        if(hf===3)(hw===0?feed.header.timestamp=hv:feed.header.timestamp=hv);
      });
    } else if(fn===2&&wt===2) feed.entities.push(parseFeedEntity(sub));
  });
  return feed;
}

// ─── GTFS STATIC ─────────────────────────────────────────────────────────────
function fetchBuffer(targetUrl) {
  return new Promise((resolve, reject) => {
    const req = https.get(targetUrl, {
      headers:{'User-Agent':'MPKTracker/5.0','Accept':'*/*','Accept-Encoding':'gzip, deflate'},
      timeout: 20_000,
    }, res => {
      if(res.statusCode===301||res.statusCode===302){ fetchBuffer(res.headers.location).then(resolve).catch(reject); res.resume(); return; }
      if(res.statusCode!==200){ reject(new Error('HTTP '+res.statusCode)); res.resume(); return; }
      const enc=(res.headers['content-encoding']||'').toLowerCase();
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const raw=Buffer.concat(chunks);
        if(enc==='gzip'||(raw[0]===0x1f&&raw[1]===0x8b)) zlib.gunzip(raw,(e,d)=>e?reject(e):resolve(d));
        else resolve(raw);
      });
    });
    req.on('error',reject);
    req.on('timeout',()=>{ req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseCSV(text) {
  const lines = text.replace(/\r/g,'').split('\n').filter(Boolean);
  if(!lines.length) return [];
  const headers = lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map(line=>{
    const fields=[]; let cur='',inQ=false;
    for(let i=0;i<=line.length;i++){
      const ch=line[i];
      if(ch==='"')inQ=!inQ;
      else if(ch===','&&!inQ){fields.push(cur.trim());cur='';}
      else if(i===line.length)fields.push(cur.trim());
      else cur+=ch;
    }
    const obj={};
    headers.forEach((h,i)=>{ obj[h]=(fields[i]||'').replace(/^"|"$/g,''); });
    return obj;
  });
}

function loadGTFSFromFiles(tripsPath, routesPath) {
  const tripsText  = fs.readFileSync(tripsPath,  'utf8');
  const routesText = fs.readFileSync(routesPath, 'utf8');
  const tripsRows  = parseCSV(tripsText);
  const routesRows = parseCSV(routesText);

  tripMap  = {};
  routeMap = {};

  for(const r of routesRows)
    if(r.route_id) routeMap[r.route_id] = { shortName: r.route_short_name || '' };

  for(const r of tripsRows)
    if(r.trip_id) tripMap[r.trip_id] = {
      routeId:   r.route_id      || '',
      headsign:  r.trip_headsign || '',
      brigade:   r.brigade       || '',
      serviceId: r.service_id    || '',
    };


  gtfsLoaded   = true;
  gtfsLoadedAt = Date.now();
  console.log(`[gtfs] Załadowano: ${tripsRows.length} kursów, ${routesRows.length} linii`);
}


async function loadGTFSStatic() {
  if(gtfsLoaded && Date.now()-gtfsLoadedAt < GTFS_TTL) return;

  // 1. Najpierw spróbuj z lokalnych plików (szybkie, niezawodne)
  const localTrips     = path.join(__dirname, 'gtfs_trips.txt');
  const localRoutes    = path.join(__dirname, 'gtfs_routes.txt');
  if(fs.existsSync(localTrips) && fs.existsSync(localRoutes)) {
    try {
      loadGTFSFromFiles(localTrips, localRoutes);
    } catch(e) {
      console.error('[gtfs] Błąd ładowania plików lokalnych:', e.message);
    }
  }

  // 2. W tle spróbuj pobrać świeży ZIP i zapisz pliki lokalnie
  if(JSZip) {
    setImmediate(async () => {
      console.log('[gtfs] Próbuję pobrać świeży ZIP w tle...');
      try {
        const zipBuf = await fetchBuffer(GTFS_ZIP);
        const zip    = await JSZip.loadAsync(zipBuf);

        const tripsFile     = zip.file('trips.txt');
        const routesFile    = zip.file('routes.txt');
        if(tripsFile && routesFile){
          const tripsText  = await tripsFile.async('string');
          const routesText = await routesFile.async('string');
          fs.writeFileSync(localTrips,  tripsText,  'utf8');
          fs.writeFileSync(localRoutes, routesText, 'utf8');
          loadGTFSFromFiles(localTrips, localRoutes);
          console.log('[gtfs] ZIP pobrany i załadowany, cache zaktualizowany');
        }
      } catch(e) {
        console.log('[gtfs] Brak dostępu do ZIP (OK - używam lokalnych):', e.message);
      }
    });
  }
}

// ─── STATUS / PĘTLA ──────────────────────────────────────────────────────────
// currentStatus: 0=INCOMING_AT, 1=STOPPED_AT, 2=IN_TRANSIT_TO
// "Pętla" = stoi (status 1 lub prędkość ~0) NA pętli (pierwszym/ostatnim przystanku)
// Nie mamy stop_id→is_terminal, więc heurystyka:
//   jeśli headsign zawiera "Pętla" LUB speed < 1 km/h I status = STOPPED_AT → "NA PĘTLI"
// Lepsza heurystyka z GTFS: trip zaczyna/kończy na tym stop_id
// Na razie: status = "Na pętli" gdy stopped_at + speed ≈ 0 + delay jest bardzo małe (autobus czeka)

const OCCUPANCY_PL = ['Puste','Mało zajęte','Zajęte','Tłoczno','Bardzo tłoczno','Pełne','Nie przyjmuje'];

function getStatusLabel(vp, speed) {
  const cs = vp.currentStatus;
  // Na przystanku + prędkość zerowa = pętla lub przystanek
  if(cs === 1) {
    if(speed < 1) return '🔴 Na pętli / przystanku';
    return 'Na przystanku';
  }
  if(cs === 0) return 'Podjeżdża';
  if(cs === 2) return 'W trasie';
  return '';
}

// ─── NORMALIZACJA ─────────────────────────────────────────────────────────────
function normalize(entity, delayMap) {
  const vp  = entity.vehiclePosition; if(!vp) return null;
  const pos = vp.position  || {};
  const trp = vp.trip      || {};
  const veh = vp.vehicle   || {};

  const lat = pos.lat||0, lon=pos.lon||0;
  if(!lat||!lon) return null;
  if(lat<48||lat>55||lon<14||lon>25) return null;

  const speed_ms  = pos.speed || 0;
  const speed_kmh = Math.round(speed_ms * 3.6 * 10) / 10;

  const tabor = veh.label || veh.id || '';

  // GTFS static
  const tripInfo  = tripMap[trp.tripId]   || {};
  const routeId   = tripInfo.routeId      || trp.routeId || '';
  const headsign  = tripInfo.headsign     || '';
  const brigade   = tripInfo.brigade      || '';
  const lineNr    = routeMap[routeId]?.shortName || routeId || '';

  // Przejazd techniczny — linia pusta lub zaczyna się od '0' bez headsign
  const isTechnical = !lineNr || lineNr === '0' || lineNr === '' ||
                      (headsign === '' && !lineNr.match(/^\d+[A-Z]?$/));

  // Model z bazy
  const vdb = vehicleDb[tabor] || {};

  // Najbliższy przystanek (z stopMap jeśli załadowany)
  let nearestStop = null;
  if (Object.keys(stopMap).length > 0) {
    let bestDist = Infinity;
    for (const [sid, s] of Object.entries(stopMap)) {
      const dlat = (s.lat - lat) * 111320;
      const dlon = (s.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180);
      const dist = Math.sqrt(dlat*dlat + dlon*dlon);
      if (dist < bestDist) { bestDist = dist; nearestStop = { id: sid, name: s.name, dist: Math.round(dist) }; }
    }
    // Pokaż tylko jeśli w rozsądnej odległości (500m)
    if (nearestStop && nearestStop.dist > 500) nearestStop = null;
  }

  // Opóźnienie
  const delay = delayMap[trp.tripId] ?? null;

  // Status z uwzględnieniem pętli
  const statusLabel = getStatusLabel(vp, speed_kmh);
  // "Na pętli" gdy stoi (prędkość < 1 km/h, status STOPPED_AT lub INCOMING_AT)
  const atTerminus = speed_kmh < 1 && (vp.currentStatus === 1 || vp.currentStatus === 0);

  return {
    id:          entity.id,
    vehicleId:   veh.id    || '',
    vehicleLabel: tabor,
    brand:       vdb.brand || '',
    model:       vdb.model || '',
    modelNote:   vdb.note  || '',
    year:        vdb.year  || null,
    nearestStop,
    routeId,
    lineNr,
    headsign,
    brigade,
    isTechnical,
    tripId:      trp.tripId   || '',
    startDate:   trp.startDate || '',
    lat, lon,
    speed:       speed_kmh,
    bearing:     Math.round(pos.bearing || 0),
    delay,
    atTerminus,                          // ← PĘTLA
    statusLabel,
    occupancy:   vp.occupancy >= 0 ? (OCCUPANCY_PL[vp.occupancy]||null) : null,
  };
}

// ─── RT CACHE ─────────────────────────────────────────────────────────────────
let cache = { data: null, ts: 0 };
const CACHE_TTL = 15_000;

async function getVehicles() {
  const now = Date.now();
  if(cache.data && now-cache.ts < CACHE_TTL) return cache.data;
  if(!gtfsLoaded) await loadGTFSStatic().catch(e=>console.error('[gtfs]',e.message));

  const raw  = await fetchBuffer(GTFS_RT);
  const feed = parseFeedMessage(raw);

  const delayMap = {};
  for(const e of feed.entities)
    if(e.tripUpdate?.trip?.tripId && e.tripUpdate.delay!==null)
      delayMap[e.tripUpdate.trip.tripId] = e.tripUpdate.delay;

  const vehicles = feed.entities.map(e=>normalize(e,delayMap)).filter(Boolean);
  const atTerminus = vehicles.filter(v=>v.atTerminus).length;

  const result = {
    feedTimestamp: feed.header.timestamp || Math.floor(now/1000),
    fetchedAt:     Math.floor(now/1000),
    totalEntities: feed.entities.length,
    vehiclePositions: feed.entities.filter(e=>e.vehiclePosition).length,
    tripUpdates:   feed.entities.filter(e=>e.tripUpdate).length,
    gtfsLoaded,
    tripsInDb:     Object.keys(tripMap).length,
    count:         vehicles.length,
    atTerminus,
    vehicles,
  };

  cache = { data: result, ts: now };
  console.log(`[${new Date().toLocaleTimeString('pl')}] ${vehicles.length} pojazdów | pętla: ${atTerminus} | gtfs: ${gtfsLoaded}`);
  return result;
}

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png' };

function sendJSON(res, code, obj) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-cache'});
  res.end(JSON.stringify(obj, null, 2));
}
function serveFile(res, fp) {
  fs.readFile(fp, (err, data) => {
    if(err){ res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(fp)]||'application/octet-stream'});
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname  = parsedUrl.pathname;
  if(pathname==='/api/vehicles'){
    try   { sendJSON(res,200,await getVehicles()); }
    catch (e){ console.error('[API]',e.message); sendJSON(res,502,{error:e.message,vehicles:[],count:0}); }
    return;
  }
  if(pathname==='/api/status'){
    sendJSON(res,200,{ok:true,gtfsLoaded,trips:Object.keys(tripMap).length,routes:Object.keys(routeMap).length,vehicles:Object.keys(vehicleDb).length});
    return;
  }
  if(pathname==='/api/debug-gtfs'){
    const tripSample = Object.entries(tripMap).slice(0,5).map(([k,v])=>({trip_id:k,...v,line:routeMap[v.routeId]?.shortName||'?'}));
    const rtSample = (cache.data?.vehicles||[]).slice(0,3).map(v=>({id:v.id,tripId:v.tripId,lineNr:v.lineNr,inTripMap:!!tripMap[v.tripId]}));
    const stopTimesSample = Object.entries(stopTimes).slice(0,3).map(([k,v])=>({stop_id:k,count:v.length}));
    const tripStopsSample = Object.entries(tripStops).slice(0,3).map(([k,v])=>({trip_id:k,stops:v.length}));
    sendJSON(res,200,{gtfsLoaded,tripsCount:Object.keys(tripMap).length,routesCount:Object.keys(routeMap).length,stopsCount:Object.keys(stopMap).length,stopTimesCount:Object.keys(stopTimes).length,tripStopsCount:Object.keys(tripStops).length,serviceIdsCount:serviceIds.size,tripSample,rtSample,stopTimesSample,tripStopsSample});
    return;
  }
  if(pathname==='/api/reload-gtfs'){
    gtfsLoaded=false;
    loadGTFSStatic().then(()=>sendJSON(res,200,{ok:true})).catch(e=>sendJSON(res,500,{error:e.message}));
    return;
  }

  const safePath = pathname.replace(/^\/+/, '') || 'index.html';
  const fp = (safePath === '' || safePath === 'index.html')
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(__dirname, 'public', safePath);
  if (!fp.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); res.end('Forbidden'); return; }
  serveFile(res, fp);

}).listen(PORT, async () => {
  console.log(`\n  MPK Rzeszów Tracker v5\n  http://localhost:${PORT}\n`);
  await loadGTFSStatic().catch(e=>console.error('[start-gtfs]',e.message));
  getVehicles().catch(e=>console.error('[start-rt]',e.message));
});
