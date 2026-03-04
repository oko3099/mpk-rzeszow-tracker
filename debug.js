/**
 * debug.js – uruchom: node debug.js
 * Pobiera feed i pokazuje dokładną strukturę pierwszych encji
 * Pomaga zdiagnozować dlaczego pojazdy nie są parsowane
 */
'use strict';

const https = require('https');
const GTFS_URL = 'https://www.mpkrzeszow.pl/gtfs/rt/gtfsrt.pb';

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 GTFSDebugger/1.0', 'Accept': '*/*' },
      timeout: 12000,
    }, (res) => {
      console.log(`HTTP Status: ${res.statusCode}`);
      console.log(`Content-Type: ${res.headers['content-type']}`);
      console.log(`Content-Length: ${res.headers['content-length']}`);
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Iteracyjny scanner po bajtach ──
function hexByte(b) { return b.toString(16).padStart(2, '0'); }

function readVarint(buf, pos) {
  let result = BigInt(0), shift = 0n;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7F) << shift;
    shift += 7n;
    if ((b & 0x80) === 0) break;
  }
  return { value: result, pos };
}

function readFloat32(buf, pos) {
  const ab = buf.buffer.slice(buf.byteOffset + pos, buf.byteOffset + pos + 4);
  return { value: new DataView(ab).getFloat32(0, true), pos: pos + 4 };
}

function readFloat64(buf, pos) {
  const ab = buf.buffer.slice(buf.byteOffset + pos, buf.byteOffset + pos + 8);
  return { value: new DataView(ab).getFloat64(0, true), pos: pos + 8 };
}

const WIRE = ['varint', '64bit', 'len', 'sgroup', 'egroup', '32bit'];

function dumpMessage(buf, start, end, depth = 0) {
  const indent = '  '.repeat(depth);
  let pos = start;
  while (pos < end) {
    const tagStart = pos;
    let v = readVarint(buf, pos);
    pos = v.pos;
    if (pos > end) break;
    const tag = Number(v.value);
    const fieldNum = tag >> 3;
    const wireType = tag & 7;

    if (wireType === 0) {
      v = readVarint(buf, pos); pos = v.pos;
      // Próbuj jako signed int32 (opóźnienie może być ujemne)
      const asUint = Number(v.value);
      const asSigned = asUint > 2147483647 ? asUint - 4294967296 : asUint;
      console.log(`${indent}F${fieldNum} [varint] = ${asUint} (signed: ${asSigned})`);
    } else if (wireType === 2) {
      v = readVarint(buf, pos); pos = v.pos;
      const len = Number(v.value);
      if (pos + len > end) { console.log(`${indent}F${fieldNum} [len] overrun`); break; }
      const sub = buf.slice(pos, pos + len);
      pos += len;

      // Spróbuj zdekodować jako string
      let asStr = '';
      let isAscii = true;
      for (let i = 0; i < sub.length; i++) {
        if (sub[i] < 0x20 && sub[i] !== 0x09 && sub[i] !== 0x0A) { isAscii = false; break; }
        asStr += String.fromCharCode(sub[i]);
      }

      // Sprawdź czy to float (lat/lon)
      let maybeFloat = '';
      if (sub.length >= 4) {
        const f = new DataView(sub.buffer, sub.byteOffset).getFloat32(0, true);
        if (Math.abs(f) > 0.001 && Math.abs(f) < 999) maybeFloat = ` [float32: ${f.toFixed(6)}]`;
      }

      if (depth < 3 && len > 0 && len < 500 && !isAscii) {
        // Rekurencja – embedded message
        console.log(`${indent}F${fieldNum} [msg, ${len}B]:`);
        try { dumpMessage(sub, 0, sub.length, depth + 1); } catch(e) { console.log(`${indent}  (parse error: ${e.message})`); }
      } else if (isAscii && len > 0) {
        console.log(`${indent}F${fieldNum} [str, ${len}B] = "${asStr.slice(0,80)}"`);
      } else {
        console.log(`${indent}F${fieldNum} [bytes, ${len}B]${maybeFloat} hex:${sub.slice(0,8).toString('hex')}...`);
      }
    } else if (wireType === 5) {
      const f = readFloat32(buf, pos); pos = f.pos;
      // Sprawdź czy to też int32
      const dv = new DataView(buf.buffer, buf.byteOffset + pos - 4, 4);
      const asInt = dv.getInt32(0, true);
      console.log(`${indent}F${fieldNum} [fixed32] float=${f.value.toFixed(6)} int=${asInt}`);
    } else if (wireType === 1) {
      const f = readFloat64(buf, pos); pos = pos + 8;
      const dv = new DataView(buf.buffer, buf.byteOffset + pos - 8, 8);
      const asInt = dv.getBigInt64(0, true);
      console.log(`${indent}F${fieldNum} [fixed64] double=${f.value} int64=${asInt}`);
    } else {
      console.log(`${indent}F${fieldNum} [UNKNOWN wire=${wireType}] – przerywam`);
      break;
    }
  }
}

async function main() {
  console.log(`\nPobieram: ${GTFS_URL}\n${'─'.repeat(60)}`);
  let buf;
  try {
    buf = await fetchRaw(GTFS_URL);
    console.log(`Pobrano ${buf.length} bajtów\n`);
  } catch(e) {
    console.error(`BŁĄD pobierania: ${e.message}`);
    return;
  }

  if (buf.length < 4) { console.log('Za mało danych!'); return; }

  console.log(`Pierwsze 16 bajtów hex: ${buf.slice(0,16).toString('hex')}`);
  console.log(`Pierwsze 16 bajtów dec: ${Array.from(buf.slice(0,16)).join(' ')}\n`);

  // Sprawdź czy to skompresowane (gzip: 1f 8b)
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    console.log('⚠️  Dane są skompresowane GZIP! Trzeba odczytać z zlib.gunzip');
  }

  // Sprawdź czy to JSON
  if (buf[0] === 0x7b || buf[0] === 0x5b) {
    console.log('⚠️  To wygląda jak JSON!');
    console.log(buf.slice(0, 500).toString('utf8'));
    return;
  }

  console.log('─── Dump całego FeedMessage (max 5 encji):');
  console.log('─'.repeat(60));

  // Parsuj FeedMessage ręcznie, wypisując tylko pierwsze 5 entity
  let pos = 0;
  let entityCount = 0;
  const MAX_ENTITIES = 5;

  while (pos < buf.length && entityCount < MAX_ENTITIES) {
    const tagStart = pos;
    let v = readVarint(buf, pos);
    pos = v.pos;
    const tag = Number(v.value);
    const fieldNum = tag >> 3;
    const wireType = tag & 7;

    if (wireType === 2) {
      v = readVarint(buf, pos); pos = v.pos;
      const len = Number(v.value);
      const sub = buf.slice(pos, pos + len);
      pos += len;

      if (fieldNum === 1) {
        console.log(`\n[FeedHeader, ${len}B]:`);
        dumpMessage(sub, 0, sub.length, 1);
      } else if (fieldNum === 2) {
        entityCount++;
        console.log(`\n[FeedEntity #${entityCount}, ${len}B]:`);
        dumpMessage(sub, 0, sub.length, 1);
        console.log('─'.repeat(40));
      } else {
        console.log(`[field ${fieldNum}, ${len}B] skip`);
      }
    } else if (wireType === 0) {
      v = readVarint(buf, pos); pos = v.pos;
      console.log(`[field ${fieldNum} varint = ${v.value}]`);
    } else {
      console.log(`Nieznany wire type ${wireType} przy polu ${fieldNum}`);
      break;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Całkowita liczba encji w feedzie:`);

  // Policz encje
  pos = 0; entityCount = 0;
  while (pos < buf.length) {
    let v = readVarint(buf, pos); pos = v.pos;
    const tag = Number(v.value);
    const fieldNum = tag >> 3;
    const wireType = tag & 7;
    if (wireType === 2) {
      v = readVarint(buf, pos); pos = v.pos;
      const len = Number(v.value);
      if (fieldNum === 2) entityCount++;
      pos += len;
    } else if (wireType === 0) {
      v = readVarint(buf, pos); pos = v.pos;
    } else if (wireType === 1) { pos += 8; }
    else if (wireType === 5) { pos += 4; }
    else break;
  }
  console.log(`Encji (field 2): ${entityCount}`);
}

main().catch(console.error);
