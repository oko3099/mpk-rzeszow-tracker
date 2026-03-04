/**
 * diagnose.js
 * Uruchom: node diagnose.js
 * Pokaże DOKŁADNIE co jest w feedzie MPK Rzeszów
 */
'use strict';
const https = require('https');
const zlib  = require('zlib');

const URL = 'https://www.mpkrzeszow.pl/gtfs/rt/gtfsrt.pb';

function fetch() {
  return new Promise((res, rej) => {
    https.get(URL, { headers:{'User-Agent':'Mozilla/5.0'}, timeout:12000 }, (r) => {
      console.log(`HTTP ${r.statusCode}  CT: ${r.headers['content-type']}  CE: ${r.headers['content-encoding']||'none'}`);
      if (r.statusCode !== 200) { rej(new Error('HTTP '+r.statusCode)); r.resume(); return; }
      const c=[]; r.on('data',d=>c.push(d)); r.on('end',()=>{
        const raw = Buffer.concat(c);
        console.log(`Rozmiar: ${raw.length}B  hex[0:8]: ${raw.slice(0,8).toString('hex')}`);
        const enc = r.headers['content-encoding']||'';
        if (enc==='gzip'||(raw[0]===0x1f&&raw[1]===0x8b)) {
          zlib.gunzip(raw,(e,d)=>e?rej(e):res(d));
        } else res(raw);
      });
    }).on('error',rej).on('timeout',function(){this.destroy();rej(new Error('timeout'));});
  });
}

function vi(b,p){let lo=0,hi=0,s=0;while(p<b.length){const x=b[p++];if(s<28)lo|=(x&127)<<s;else hi|=(x&127)<<(s-28);s+=7;if(!(x&128))break;}return{v:hi*268435456+(lo>>>0),p};}
function f32(b,p){return{v:new DataView(b.buffer,b.byteOffset+p,4).getFloat32(0,true),p:p+4};}
function f64(b,p){return{v:new DataView(b.buffer,b.byteOffset+p,8).getFloat64(0,true),p:p+8};}

function dump(buf, depth, maxDepth) {
  if (depth > maxDepth) return;
  const pad = '  '.repeat(depth);
  let p=0;
  while(p<buf.length) {
    let t;try{t=vi(buf,p);}catch(e){break;}
    p=t.p;
    const fn=t.v>>>3, wt=t.v&7;
    if(wt===0){let v=vi(buf,p);p=v.p;const s=v.v>0x7FFFFFFF?v.v-0x100000000:v.v;console.log(`${pad}[F${fn}:varint] ${v.v} (signed:${s})`);}
    else if(wt===1){let v=f64(buf,p);p=v.p;const lo=(buf[p-8]|(buf[p-7]<<8)|(buf[p-6]<<16)|(buf[p-5]<<24))>>>0;console.log(`${pad}[F${fn}:f64]   double=${v.v.toFixed(7)}  lo32=${lo}`);}
    else if(wt===2){
      let v=vi(buf,p);p=v.p;const len=v.v;
      if(len>buf.length-p+5)break;
      const sub=buf.slice(p,p+len);p+=len;
      let isStr=len>0&&len<300;
      for(let i=0;i<sub.length&&isStr;i++)if(sub[i]<32&&sub[i]!==9&&sub[i]!==10)isStr=false;
      if(isStr){console.log(`${pad}[F${fn}:str]  "${sub.toString('utf8').slice(0,100)}"`);}
      else if(len===4){const fv=new DataView(sub.buffer,sub.byteOffset).getFloat32(0,true);console.log(`${pad}[F${fn}:msg4]  hex=${sub.toString('hex')}  f32=${fv.toFixed(6)}`);if(depth<maxDepth)dump(sub,depth+1,maxDepth);}
      else{console.log(`${pad}[F${fn}:msg${len}B]  hex=${sub.slice(0,8).toString('hex')}...`);if(depth<maxDepth)dump(sub,depth+1,maxDepth);}
    }
    else if(wt===5){let v=f32(buf,p);p=v.p;console.log(`${pad}[F${fn}:f32]  ${v.v.toFixed(6)}`);}
    else{console.log(`${pad}[F${fn}:?wt${wt}] STOP`);break;}
  }
}

async function main() {
  console.log('\n=== MPK Rzeszów GTFS-RT Diagnostics ===\n');
  let buf;
  try { buf = await fetch(); } catch(e) { console.error('BŁĄD:', e.message); return; }

  console.log(`\nRozmiar po dekompresji: ${buf.length}B`);

  // Policz typy encji
  let total=0, vp=0, tu=0, other=0;
  {
    let p=0;
    while(p<buf.length){
      let t;try{t=vi(buf,p);}catch(e){break;}p=t.p;
      const fn=t.v>>>3,wt=t.v&7;
      if(wt===2){
        let v=vi(buf,p);p=v.p;const len=v.v;
        if(len>buf.length-p+5)break;
        const sub=buf.slice(p,p+len);p+=len;
        if(fn===2){
          total++;
          let hasVP=false,hasTU=false,ep=0;
          while(ep<sub.length){let et;try{et=vi(sub,ep);}catch(e){break;}ep=et.p;const ef=et.v>>>3,ew=et.v&7;
            if(ew===2){let ev=vi(sub,ep);ep=ev.p;const elen=ev.v;if(ef===4)hasVP=true;if(ef===3)hasTU=true;ep+=elen;}
            else if(ew===0){let ev=vi(sub,ep);ep=ev.p;}else break;}
          if(hasVP)vp++;else if(hasTU)tu++;else other++;
        }
      } else if(wt===0){let v=vi(buf,p);p=v.p;}
      else if(wt===1)p+=8; else if(wt===5)p+=4; else break;
    }
  }

  console.log(`\n╔══════════════════════════════╗`);
  console.log(`║ PODSUMOWANIE FEEDA           ║`);
  console.log(`║ Encji łącznie:  ${String(total).padEnd(12)}║`);
  console.log(`║ VehiclePosition:${String(vp).padEnd(12)}║`);
  console.log(`║ TripUpdate:     ${String(tu).padEnd(12)}║`);
  console.log(`║ Inne:           ${String(other).padEnd(12)}║`);
  console.log(`╚══════════════════════════════╝\n`);

  if(vp===0){
    console.log('⚠️  BRAK VehiclePosition! Autobusy nie mogą być pokazane na mapie.');
    console.log('   Feed zawiera tylko TripUpdates (opóźnienia bez pozycji GPS).');
  }

  // Dump pierwszych 3 encji
  let count=0, p=0;
  while(p<buf.length && count<3){
    let t;try{t=vi(buf,p);}catch(e){break;}p=t.p;
    const fn=t.v>>>3,wt=t.v&7;
    if(wt===2){
      let v=vi(buf,p);p=v.p;const len=v.v;
      if(len>buf.length-p+5)break;
      const sub=buf.slice(p,p+len);p+=len;
      if(fn===1){console.log('--- FeedHeader ---');dump(sub,0,3);}
      if(fn===2){count++;console.log(`\n--- Entity #${count} [${len}B] ---`);dump(sub,0,4);console.log('─'.repeat(50));}
    } else if(wt===0){vi(buf,p);p=vi(buf,p).p;}
    else if(wt===1)p+=8;else if(wt===5)p+=4;else break;
  }
}
main().catch(console.error);
