'use strict';

const BASE = '';  // same origin

// ── STAN ────────────────────────────────────────────────────────
let allRoutes = [];
let allStops  = [];
let schedule  = null;   // { lineNr, variants }
let activeVariant = '';
let activeTrip    = null;
let activeStop    = { id:'', name:'' };

// ── HELPERS ─────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const loading = show => $('loading').classList.toggle('hidden', !show);

async function apiFetch(url) {
  loading(true);
  try {
    const r = await fetch(BASE + url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    loading(false);
  }
}

function now() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

// ── TABS ────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

// ══════════════════════════════════════════════════════════════════
// ZAKŁADKA: LINIE
// ══════════════════════════════════════════════════════════════════

// ── Krok 1: Ładuj linie ─────────────────────────────────────────
async function loadRoutes() {
  if (allRoutes.length) return;
  const data = await apiFetch('/api/routes');
  allRoutes = data.routes || [];
  renderLinesGrid(allRoutes);
}

function renderLinesGrid(routes) {
  const grid = $('lines-grid');
  grid.innerHTML = '';
  if (!routes.length) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon">🚌</div>Brak linii (serwer pobiera dane...)</div>';
    return;
  }
  routes.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'line-btn';
    btn.textContent = r.lineNr;
    btn.addEventListener('click', () => pickRoute(r));
    grid.appendChild(btn);
  });
}

$('search-lines').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  renderLinesGrid(q ? allRoutes.filter(r => r.lineNr.toLowerCase().includes(q)) : allRoutes);
});

// ── Krok 2: Kierunek ────────────────────────────────────────────
async function pickRoute(r) {
  const data = await apiFetch('/api/schedule?line_nr=' + encodeURIComponent(r.lineNr));
  schedule = data;
  $('lines-grid').classList.add('hidden');
  $('search-lines').parentElement.classList.add('hidden');

  $('variant-line-nr').textContent = r.lineNr;
  const list = $('variants-list');
  list.innerHTML = '';
  const variants = Object.keys(data.variants || {});
  if (!variants.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>Brak kursów dziś</div>';
  } else {
    variants.forEach(head => {
      const trips = data.variants[head];
      const first = trips[0]?.stops[0]?.departure?.slice(0,5) || '';
      const last  = trips[trips.length-1]?.stops[0]?.departure?.slice(0,5) || '';
      const card = document.createElement('div');
      card.className = 'variant-card';
      card.innerHTML = `
        <span class="variant-arrow">→</span>
        <div class="variant-info">
          <div class="variant-name">${head}</div>
          <div class="variant-meta">${trips.length} kursów · ${first} – ${last}</div>
        </div>
        <span class="variant-chevron">›</span>`;
      card.addEventListener('click', () => pickVariant(r.lineNr, head));
      list.appendChild(card);
    });
  }
  showPanel('variants-panel');
}

$('back-to-lines').addEventListener('click', () => {
  hidePanel('variants-panel');
  $('lines-grid').classList.remove('hidden');
  $('search-lines').parentElement.classList.remove('hidden');
});

// ── Krok 3: Przystanki ──────────────────────────────────────────
function pickVariant(lineNr, head) {
  activeVariant = head;
  const trips = schedule.variants[head] || [];
  const refTrip = trips[0];

  $('stops-line-nr').textContent = lineNr;
  $('stops-variant-name').textContent = '→ ' + head;

  const list = $('stops-list');
  list.innerHTML = '';
  if (!refTrip || !refTrip.stops.length) {
    list.innerHTML = '<div class="empty">Brak przystanków</div>';
  } else {
    refTrip.stops.forEach((s, i) => {
      const isTerminal = i === 0 || i === refTrip.stops.length - 1;
      const row = document.createElement('div');
      row.className = 'stop-row';
      row.innerHTML = `
        <div class="stop-line-col">
          <div class="stop-dot ${isTerminal ? 'terminal' : ''}"></div>
          ${i < refTrip.stops.length - 1 ? '<div class="stop-connector"></div>' : ''}
        </div>
        <div class="stop-name-wrap">
          <span class="stop-name ${isTerminal ? 'terminal' : ''}">${s.stopName}</span>
          <span class="stop-dep">${s.dep5 || s.departure?.slice(0,5) || ''}</span>
        </div>`;
      row.addEventListener('click', () => pickStop(lineNr, head, s.stopId, s.stopName, refTrip));
      list.appendChild(row);
    });
  }

  hidePanel('variants-panel');
  showPanel('stops-panel');
}

$('back-to-variants').addEventListener('click', () => {
  hidePanel('stops-panel');
  showPanel('variants-panel');
});

// ── Krok 4: Rozkład ─────────────────────────────────────────────
function pickStop(lineNr, head, stopId, stopName, refTrip) {
  activeStop = { id: stopId, name: stopName };
  const trips = schedule.variants[head] || [];
  const nowMins = now();

  // Zbierz godziny z tego przystanku ze wszystkich tripów
  const byHour = {};
  for (const t of trips) {
    const st = t.stops.find(s => s.stopId === stopId);
    if (!st) continue;
    const dep = st.departure || st.dep5 || '';
    const parts = dep.split(':');
    if (parts.length < 2) continue;
    const h = parseInt(parts[0]);
    const m = parts[1].slice(0, 2);
    if (isNaN(h)) continue;
    (byHour[h] = byHour[h] || []).push(m);
  }

  $('tt-line-nr').textContent = lineNr;
  $('tt-stop-name').textContent = stopName;
  $('tt-variant').textContent = '→ ' + head;

  const grid = $('timetable-grid');
  grid.innerHTML = '';
  const hours = Object.keys(byHour).map(Number).sort((a,b)=>a-b);

  if (!hours.length) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon">🕐</div>Brak kursów przez ten przystanek</div>';
  } else {
    const curH = new Date().getHours();
    hours.forEach(h => {
      const mins = [...byHour[h]].sort();
      const isCur = h === curH;
      const row = document.createElement('div');
      row.className = 'hour-row' + (isCur ? ' current' : '');
      const minsHtml = mins.map(m => {
        const isPast = h * 60 + parseInt(m) < nowMins;
        return `<span class="min-chip ${isPast ? 'past' : ''}">${m}</span>`;
      }).join('');
      row.innerHTML = `<div class="hour-cell">${h}</div><div class="minutes-cell">${minsHtml}</div>`;
      grid.appendChild(row);
    });
  }

  hidePanel('stops-panel');
  showPanel('timetable-panel');
}

$('back-to-stops').addEventListener('click', () => {
  hidePanel('timetable-panel');
  showPanel('stops-panel');
});

// ══════════════════════════════════════════════════════════════════
// ZAKŁADKA: PRZYSTANKI
// ══════════════════════════════════════════════════════════════════

async function loadStops() {
  if (allStops.length) return;
  const data = await apiFetch('/api/stops?limit=9999');
  allStops = data.stops || [];
  renderStopsList(allStops);
}

function renderStopsList(stops) {
  const list = $('stops-all-list');
  const count = $('stops-count');
  count.textContent = stops.length + ' przystanków';
  list.innerHTML = '';
  if (!stops.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">📍</div>Brak przystanków</div>';
    return;
  }
  stops.forEach(s => {
    const item = document.createElement('div');
    item.className = 'stop-list-item';
    item.innerHTML = `
      <span class="stop-list-icon">📍</span>
      <span class="stop-list-name">${s.name}</span>
      <span class="stop-list-chevron">›</span>`;
    item.addEventListener('click', () => pickStopForDepartures(s));
    list.appendChild(item);
  });
}

$('search-stops').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  renderStopsList(q ? allStops.filter(s => s.name.toLowerCase().includes(q)) : allStops);
});

async function pickStopForDepartures(s) {
  $('dep-stop-name').textContent = s.name;
  $('stops-all-list').classList.add('hidden');
  $('search-stops').parentElement.classList.add('hidden');
  $('stops-count').classList.add('hidden');

  const data = await apiFetch('/api/departures?stop_id=' + encodeURIComponent(s.id));
  const deps = data.departures || [];
  const list = $('departures-list');
  list.innerHTML = '';

  if (!deps.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">🕐</div>Brak odjazdów w najbliższych 3h</div>';
  } else {
    deps.forEach(d => {
      const item = document.createElement('div');
      item.className = 'dep-card';
      const diff = d.diffMins;
      let badgeClass = 'ok', badgeText = diff + ' min';
      if (diff <= 0)  { badgeClass = 'gone';   badgeText = 'Odjeżdża'; }
      else if (diff <= 2) { badgeClass = 'soon'; }
      else if (diff <= 5) { badgeClass = 'medium'; }
      else if (diff >= 60) { badgeText = Math.floor(diff/60) + 'h ' + (diff%60) + 'min'; }
      item.innerHTML = `
        <div class="dep-line">${d.lineNr}</div>
        <div class="dep-info">
          <div class="dep-head">${d.headsign}</div>
          <div class="dep-time">${(d.departure||'').slice(0,5)}</div>
        </div>
        <div class="dep-badge ${badgeClass}">${badgeText}</div>`;
      list.appendChild(item);
    });
  }

  showPanel('departures-panel');
}

$('back-to-stops-list').addEventListener('click', () => {
  hidePanel('departures-panel');
  $('stops-all-list').classList.remove('hidden');
  $('search-stops').parentElement.classList.remove('hidden');
  $('stops-count').classList.remove('hidden');
});

// ── PANEL HELPERS ───────────────────────────────────────────────
function showPanel(id) { $(id).classList.remove('hidden'); }
function hidePanel(id) { $(id).classList.add('hidden'); }

// ── INIT ────────────────────────────────────────────────────────
loadRoutes();

// Lazy-load przystanków gdy tab aktywny
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'stops') loadStops();
  });
});
