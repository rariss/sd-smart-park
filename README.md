# 🅿️ SD Smart Park
### Claude AI × City of San Diego Open Data Hackathon

> **Find the best parking in San Diego** — using 7+ years of historical meter transaction data to predict availability, combined with citation hotspot analysis and Claude AI recommendations.

---

## What It Does

You tell it where you're going and when. It tells you:
- Which nearby meters are **historically most available** at that time
- **Citation risk** zones to avoid
- A **Claude-powered plain-English recommendation** with reasoning

---

## Architecture

```
Frontend (React)  →  FastAPI Backend  →  Claude API
                           ↓
                    pre-processed JSON
                    (meter locations +
                     availability scores +
                     citation hotspots)
                           ↑
                    preprocess.py
                           ↑
              data.sandiego.gov SODA API
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- [Poetry](https://python-poetry.org/docs/#installation)
- Node.js 18+

### 1. Data Preprocessing

```bash
# Install deps and create .venv in project root
poetry install

# Preprocess data (run once — detects local CSV in data/ automatically)
poetry run python scripts/preprocess.py
```

### 2. Backend (Python)
```bash
# Start backend
cp .env.example .env  # then fill in your Anthropic API key
poetry run uvicorn backend.main:app --reload --port 8000
```

### 2. Frontend (npm, separate)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

### Notes on preprocessing

`preprocess.py` checks for `data/meter_temporal_occupancy.csv` first. If found and valid, it builds `meter_locations.json` and `availability_scores.json` locally — no downloads needed. Citation hotspots are always fetched from the SODA API.

If the local CSV is not present, all data is downloaded from `data.sandiego.gov`:
- `meter_locations.json` — ~3,800 active meters with lat/lon and zone info
- `availability_scores.json` — per-meter availability by day-of-week + hour
- `citation_hotspots.json` — citation density grid cells

---

## Data Sources

| Dataset | URL | Used For |
|---|---|---|
| Parking Meter Locations | data.sandiego.gov/datasets/parking-meters-locations | Map markers, zone/rate info |
| Parking Meter Transactions (2020–2026) | data.sandiego.gov/datasets/parking-meters-transactions | Historical availability model |
| Parking Citations (2012–2025) | data.sandiego.gov/datasets/parking-citations | Citation risk scoring |

All data is public domain (PDDL license) via City of San Diego Open Data Portal.

---

## How Availability Is Computed

For each meter, we compute average transaction volume broken down by **(day_of_week × hour)**. High transaction volume = high occupancy = **low availability**. We normalize within each time bucket so the score is relative to the busiest meters in that time slot.

The result: `meter_id → {mon_9am: 0.72, mon_10am: 0.81, ...}`

This is **predictive**, not live — framed honestly as "historically X% likely available."

---

## API Endpoints

```
POST /find-parking
  body: { query, lat, lon, radius_m }
  → { recommendation (Claude text), meters [] }

GET /meters/area?lat=&lon=&radius_m=
  → meters [] with availability scores

GET /meter/{id}/curve
  → full availability curve across the week

GET /health
  → { status, meters_loaded }
```

---

## Demo Script (for judges)

1. Select **Gaslamp Quarter**
2. Type: `"Padres game tonight"`
3. Map lights up — green = likely available, red = usually full
4. Claude panel: specific street recommendation + citation warning + free parking tip
5. Click any meter → shows availability sparkline across the day

---

## Tech Stack

| Layer | Tool |
|---|---|
| Data prep | Python + pandas |
| Backend | FastAPI + Anthropic SDK |
| Frontend | React + Tailwind (CDN) |
| Maps | SVG (no API key needed for demo) |
| AI | Claude Sonnet |
| Data | City of San Diego SODA API |

---

## Team

Built at the Claude Community × City of San Diego Hackathon 2025