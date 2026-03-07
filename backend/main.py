"""
SD Smart Parking - FastAPI Backend
Claude-powered parking recommendations using historical SD meter data.

Setup:
    pip install fastapi uvicorn anthropic python-dotenv

Run:
    uvicorn main:app --reload --port 8000
"""

import json
import os
import math
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anthropic
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

app = FastAPI(title="SD Smart Parking API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── Load data at startup ───────────────────────────────────────────────────────
def load_json(filename):
    path = os.path.join(DATA_DIR, filename)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}

METERS: list = load_json("meter_locations.json")
AVAILABILITY: dict = load_json("availability_scores.json")
CITATION_HOTSPOTS: list = load_json("citation_hotspots.json")

print(f"Loaded {len(METERS):,} meters, {len(AVAILABILITY):,} availability records, {len(CITATION_HOTSPOTS):,} citation cells")

# ── Helpers ────────────────────────────────────────────────────────────────────
def haversine(lat1, lon1, lat2, lon2) -> float:
    """Distance in meters between two lat/lon points."""
    R = 6371000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    Δφ = math.radians(lat2 - lat1)
    Δλ = math.radians(lon2 - lon1)
    a = math.sin(Δφ/2)**2 + math.cos(φ1)*math.cos(φ2)*math.sin(Δλ/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def get_availability(meter_id: str, dow: int, hour: int) -> float:
    """Get historical availability score (0=full, 1=empty) for a meter/time."""
    scores = AVAILABILITY.get(str(meter_id), [])
    for entry in scores:
        if entry["dow"] == dow and entry["hour"] == hour:
            return entry["avail"]
    return 0.5  # default: unknown


def get_citation_risk(lat: float, lon: float) -> float:
    """Get citation risk (0=safe, 1=high risk) near a lat/lon."""
    GRID = 0.001
    grid_lat = round(lat / GRID) * GRID
    grid_lon = round(lon / GRID) * GRID
    for cell in CITATION_HOTSPOTS:
        if abs(cell["grid_lat"] - grid_lat) < 0.0005 and abs(cell["grid_lon"] - grid_lon) < 0.0005:
            return cell["risk"]
    return 0.0


def sanitize(obj):
    """Recursively replace NaN/Inf floats with None so JSON serialization doesn't blow up."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj


def find_nearby_meters(lat: float, lon: float, radius_m: int = 400, limit: int = 20,
                       dow: int = None, hour: int = None) -> list:
    """Find meters within radius, enriched with availability and citation risk."""
    if dow is None or hour is None:
        now = datetime.now()
        if dow is None:
            dow = now.weekday()
        if hour is None:
            hour = now.hour

    results = []
    for meter in METERS:
        dist = haversine(lat, lon, meter["lat"], meter["lon"])
        if dist <= radius_m:
            meter_id = meter["meter_id"]
            avail = get_availability(meter_id, dow, hour)
            citation_risk = get_citation_risk(meter["lat"], meter["lon"])
            results.append(sanitize({
                **meter,
                "distance_m": round(dist),
                "availability": avail,
                "citation_risk": citation_risk,
                "dow": dow,
                "hour": hour,
            }))

    results.sort(key=lambda x: -(x["availability"] or 0))
    return results[:limit]


def build_claude_prompt(query: str, meters: list, dow: int, hour: int) -> str:
    DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    day_name = DAY_NAMES[dow]

    meter_summary = []
    for m in meters[:10]:  # send top 10 to Claude
        avail_pct = int(m["availability"] * 100)
        risk_label = "High" if m["citation_risk"] > 0.6 else "Medium" if m["citation_risk"] > 0.3 else "Low"
        addr = m.get("street_address", f"lat {m['lat']:.4f}, lon {m['lon']:.4f}")
        rate = m.get("rate_range", "unknown rate")
        zone = m.get("zone", "")
        meter_summary.append(
            f"- Meter {m['meter_id']} at {addr} | Zone: {zone} | Rate: {rate} | "
            f"Distance: {m['distance_m']}m | Availability: {avail_pct}% | Citation Risk: {risk_label}"
        )

    meters_text = "\n".join(meter_summary) if meter_summary else "No meter data available nearby."

    return f"""You are SD Smart Parking, an AI assistant helping San Diego residents find the best parking.

The user's request: "{query}"

Current time context: {day_name} at {hour}:00

Nearby parking meters (sorted by availability):
{meters_text}

Based on this data, provide a concise, helpful parking recommendation. Include:
1. Your top 1-2 recommended spots with specific reasoning (availability %, walking distance, cost)
2. Any citation risk warnings for the area
3. One practical tip (e.g., nearby free street parking windows, time limits to watch for)

Keep your response conversational, specific, and under 150 words. Be direct — give the actual recommendation first.
"""


# Pre-compute area centroids at startup
def _build_areas():
    from collections import defaultdict
    buckets = defaultdict(list)
    for m in METERS:
        area = m.get("area")
        if area:
            buckets[area].append(m)
    result = []
    for area, ms in buckets.items():
        lats = [m["lat"] for m in ms if m.get("lat") is not None]
        lons = [m["lon"] for m in ms if m.get("lon") is not None]
        result.append({
            "name": area,
            "count": len(ms),
            "lat": round(sum(lats) / len(lats), 6) if lats else None,
            "lon": round(sum(lons) / len(lons), 6) if lons else None,
        })
    return sorted(result, key=lambda x: -x["count"])

AREAS = _build_areas()
print(f"Built {len(AREAS)} areas")

# ── API Routes ─────────────────────────────────────────────────────────────────
class ParkingQuery(BaseModel):
    query: str
    lat: float
    lon: float
    radius_m: Optional[int] = 400
    dow: Optional[int] = None   # 0=Mon … 6=Sun; None = use server time
    hour: Optional[int] = None  # 0-23; None = use server time


class MeterDetailQuery(BaseModel):
    meter_id: str


@app.get("/health")
def health():
    return {"status": "ok", "meters_loaded": len(METERS)}


@app.get("/areas")
def list_areas():
    """Return all areas that have meter data, with centroid lat/lon and meter count."""
    return AREAS


@app.post("/find-parking")
async def find_parking(req: ParkingQuery):
    """Main endpoint: find best parking near a location with Claude recommendation."""
    now = datetime.now()
    dow = req.dow if req.dow is not None else now.weekday()
    hour = req.hour if req.hour is not None else now.hour

    nearby = find_nearby_meters(req.lat, req.lon, req.radius_m, dow=dow, hour=hour)

    if not nearby:
        raise HTTPException(status_code=404, detail="No meters found in that area")

    # Call Claude
    prompt = build_claude_prompt(req.query, nearby, dow, hour)
    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}]
        )
        recommendation = message.content[0].text
    except Exception as e:
        recommendation = f"Unable to generate AI recommendation: {str(e)}"

    return {
        "recommendation": recommendation,
        "meters": nearby,
        "query_time": {"dow": dow, "hour": hour},
    }


@app.get("/meter/{meter_id}/curve")
def meter_curve(meter_id: str):
    """Return full availability curve for a meter (for sparkline chart)."""
    scores = AVAILABILITY.get(meter_id, [])
    if not scores:
        raise HTTPException(status_code=404, detail="No data for this meter")
    return {"meter_id": meter_id, "curve": scores}


@app.get("/meters/area")
def meters_in_area(lat: float, lon: float, radius_m: int = 1000, limit: int = 400,
                   dow: Optional[int] = None, hour: Optional[int] = None):
    """Return all meters in an area (for map rendering without AI)."""
    return find_nearby_meters(lat, lon, radius_m, limit=min(limit, 500), dow=dow, hour=hour)