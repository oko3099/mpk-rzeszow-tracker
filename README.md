# MPK Rzeszów – Live Bus Tracker 🚌

Aplikacja Node.js do śledzenia autobusów MPK Rzeszów w czasie rzeczywistym.
Dane pobierane z GTFS Realtime: `https://www.mpkrzeszow.pl/gtfs/rt/gtfsrt.pb`

## Wymagania

- **Node.js 18+** (brak zewnętrznych zależności – tylko wbudowane moduły!)
- Połączenie z internetem

## Uruchomienie

```bash
node server.js
```

Następnie otwórz przeglądarkę: **http://localhost:3000**

## Tryb deweloperski (auto-restart)

```bash
node --watch server.js
```

## Zmiana portu

```bash
PORT=8080 node server.js
```

## API

| Endpoint         | Opis                                    |
|------------------|-----------------------------------------|
| `GET /api/vehicles` | Wszystkie pojazdy w formacie JSON    |
| `GET /api/status`   | Status serwera i cache               |

### Przykład odpowiedzi `/api/vehicles`

```json
{
  "feedTimestamp": 1709119200,
  "count": 42,
  "vehicles": [
    {
      "id": "entity_id",
      "vehicleId": "1234",
      "vehicleLabel": "456",
      "routeId": "1",
      "tripId": "trip_123",
      "directionId": 0,
      "headsign": "Drabinianka",
      "startTime": "08:00:00",
      "lat": 50.0413,
      "lon": 21.9990,
      "speed": 35.5,
      "bearing": 270,
      "delay": 120,
      "currentStatus": "Jedzie do przystanku",
      "stopId": "stop_42",
      "occupancy": "Zajęte"
    }
  ]
}
```

### Pola pojazdu

| Pole           | Opis                                              |
|----------------|---------------------------------------------------|
| `vehicleLabel` | Numer taborowy (widoczny na autobusie)            |
| `routeId`      | Numer linii (np. "1", "34")                      |
| `headsign`     | Kierunek / tabliczka kierunkowa                  |
| `delay`        | Opóźnienie w sekundach (+ = opóźnienie, - = przed czasem) |
| `speed`        | Prędkość w km/h                                  |
| `bearing`      | Kierunek jazdy w stopniach (0–360)               |
| `occupancy`    | Zapełnienie pojazdu (jeśli dostępne)             |

## Struktura projektu

```
mpk-rzeszow-tracker/
├── server.js        ← Serwer HTTP + parser GTFS-RT
├── package.json
├── README.md
└── public/
    └── index.html   ← Interfejs webowy z mapą
```

## Jak to działa

1. **Serwer** pobiera binarny feed GTFS-RT (Protocol Buffer) z MPK Rzeszów
2. **Parser protobuf** jest napisany od zera – bez zewnętrznych bibliotek
3. Dane są **cachowane 15 sekund** aby nie przeciążać serwera MPK
4. **Frontend** odpytuje `/api/vehicles` co 15 sekund i aktualizuje mapę
5. Markery na mapie są **kolorowane wg opóźnienia**

## Kolory markerów

- 🟢 Zielony – na czasie lub przed czasem
- 🟡 Żółty – małe opóźnienie (30s – 3 min)
- 🔴 Czerwony – duże opóźnienie (> 3 min)
- 🟠 Pomarańczowy – brak danych o opóźnieniu
