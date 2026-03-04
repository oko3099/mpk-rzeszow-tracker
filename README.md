# MPK Rzeszów – Live Tracker 🚌

Tracker autobusów MPK Rzeszów w czasie rzeczywistym. Pokazuje pozycje wszystkich autobusów na mapie Rzeszowa z informacjami o opóźnieniach, brygadach, modelach pojazdów i kierunkach tras.

🔗 **[mpk-rzeszow-tracker.onrender.com](https://mpk-rzeszow-tracker.onrender.com)**

---

## Co pokazuje

- 📍 Pozycje wszystkich autobusów na żywo (odświeżanie co 15 sekund)
- 🟢🟡🔴 Kolory wg opóźnienia — zielony (na czasie), żółty (<3 min), czerwony (>3 min)
- 🟣 Fioletowy marker gdy autobus stoi na pętli
- Numer linii, kierunek, brygada i model autobusu na każdym markerze
- Lista pojazdów z filtrami (linia, kierunek, model, numer taborowy)
- Działa na telefonie i komputerze

## Dane

| Źródło | URL |
|--------|-----|
| Pozycje na żywo | `https://www.mpkrzeszow.pl/gtfs/rt/gtfsrt.pb` (GTFS Realtime) |
| Rozkład jazdy | `https://www.mpkrzeszow.pl/gtfs/latest.zip` (GTFS Static) |

## Uruchomienie lokalnie

```bash
npm install
node server.js
```

Otwórz: **http://localhost:3000**

## Stack

- **Backend:** Node.js, własny parser Protocol Buffers (bez bibliotek)
- **Frontend:** Leaflet.js, vanilla JS
- **Hosting:** Render.com (darmowy plan)

## Struktura

```
├── server.js          ← API + parser GTFS-RT
├── vehicledb.js       ← Baza modeli autobusów MPK (224 pojazdy)
├── gtfs_trips.txt     ← Kursy GTFS (cache lokalny)
├── gtfs_routes.txt    ← Linie GTFS (cache lokalny)
└── public/
    └── index.html     ← Mapa + interfejs
```

## API

```
GET /api/vehicles      ← Wszystkie pojazdy JSON
GET /api/status        ← Status serwera
GET /api/reload-gtfs   ← Przeładuj dane GTFS
```
