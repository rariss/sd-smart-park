#!/usr/bin/env python3
"""
SD Smart Parking - Data Preprocessing Script
Downloads and processes San Diego parking meter data into a fast lookup table.

Usage:
    pip install pandas requests tqdm
    python preprocess.py

Output:
    ../data/meter_locations.json   - All meter locations with zone info
    ../data/availability_scores.json - Per-meter availability by day/hour
    ../data/citation_hotspots.json  - Citation density by area
"""

import pandas as pd
import requests
import json
import os
from io import StringIO
from collections import defaultdict

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(DATA_DIR, exist_ok=True)

# --- Data Sources (Socrata SODA API) ---
METER_LOCATIONS_URL = "https://seshat.datasd.org/parking_meters/parking_meter_locations_datasd_v1.csv"
TRANSACTIONS_2024_DAY_URL = "https://seshat.datasd.org/parking_meters/treas_parking_payments_2024_datasd.csv"
TRANSACTIONS_2025_DAY_URL = "https://seshat.datasd.org/parking_meters/treas_parking_payments_2025_datasd.csv"
CITATIONS_URL = "https://seshat.datasd.org/pd/parking_citations_2024_datasd.csv"


def download_csv(url, label):
    print(f"  Downloading {label}...")
    try:
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        df = pd.read_csv(StringIO(r.text))
        print(f"  ✓ {label}: {len(df):,} rows")
        return df
    except Exception as e:
        print(f"  ✗ Failed to download {label}: {e}")
        return None


def process_meter_locations(df):
    """Clean and export meter location data."""
    print("\n[1/3] Processing meter locations...")

    # Normalize column names (vary slightly across years)
    df.columns = [c.lower().strip() for c in df.columns]

    # Find lat/lon columns
    lat_col = next((c for c in df.columns if "lat" in c), None)
    lon_col = next((c for c in df.columns if "lon" in c or "lng" in c), None)
    id_col = next((c for c in df.columns if "meter" in c and "id" in c), "meter_id")

    if not lat_col or not lon_col:
        print(f"  Columns available: {list(df.columns)}")
        raise ValueError("Could not find lat/lon columns")

    df = df.rename(columns={lat_col: "lat", lon_col: "lon", id_col: "meter_id"})

    # Drop rows without geo
    df = df.dropna(subset=["lat", "lon"])
    df = df[df["lat"].between(32.5, 33.2) & df["lon"].between(-117.4, -116.9)]

    # Keep useful columns
    keep = ["meter_id", "lat", "lon"]
    for col in ["zone", "area", "sub_area", "rate_type", "rate_range", "street_address", "on_off_street"]:
        if col in df.columns:
            keep.append(col)

    meters = df[keep].drop_duplicates(subset=["meter_id"])

    out = meters.to_dict(orient="records")
    with open(os.path.join(DATA_DIR, "meter_locations.json"), "w") as f:
        json.dump(out, f)

    print(f"  ✓ Saved {len(out):,} meters")
    return meters


def process_transactions(dfs):
    """Compute availability scores per meter by day-of-week and hour."""
    print("\n[2/3] Processing transaction history...")

    all_rows = []
    for df in dfs:
        if df is None:
            continue
        df.columns = [c.lower().strip() for c in df.columns]

        # Find date/time column
        date_col = next((c for c in df.columns if "date" in c or "time" in c), None)
        meter_col = next((c for c in df.columns if "meter" in c and "id" in c), None)

        if not date_col or not meter_col:
            print(f"  Skipping df - columns: {list(df.columns)}")
            continue

        df = df.rename(columns={date_col: "trans_date", meter_col: "meter_id"})
        df["trans_date"] = pd.to_datetime(df["trans_date"], errors="coerce")
        df = df.dropna(subset=["trans_date", "meter_id"])
        df["dow"] = df["trans_date"].dt.dayofweek   # 0=Mon, 6=Sun
        df["hour"] = df["trans_date"].dt.hour
        all_rows.append(df[["meter_id", "dow", "hour"]])

    if not all_rows:
        print("  No transaction data available - generating sample data")
        return generate_sample_scores()

    combined = pd.concat(all_rows, ignore_index=True)

    # Count transactions per (meter, dow, hour)
    counts = combined.groupby(["meter_id", "dow", "hour"]).size().reset_index(name="tx_count")

    # Normalize to 0-1 occupancy score within each (dow, hour) bucket
    # High transaction count = high occupancy = low availability
    bucket_max = counts.groupby(["dow", "hour"])["tx_count"].transform("max")
    counts["occupancy"] = counts["tx_count"] / bucket_max.clip(lower=1)
    counts["availability"] = (1 - counts["occupancy"]).round(2)

    # Build lookup dict: meter_id -> list of {dow, hour, availability}
    scores = defaultdict(list)
    for _, row in counts.iterrows():
        scores[str(row["meter_id"])].append({
            "dow": int(row["dow"]),
            "hour": int(row["hour"]),
            "avail": float(row["availability"])
        })

    with open(os.path.join(DATA_DIR, "availability_scores.json"), "w") as f:
        json.dump(scores, f)

    print(f"  ✓ Scored {len(scores):,} meters across day/hour buckets")
    return scores


def generate_sample_scores():
    """Fallback: generate realistic-looking sample scores for demo."""
    import random, math
    random.seed(42)

    # Simulate ~2000 meters with realistic patterns
    scores = {}
    for i in range(2000):
        meter_id = f"SAMPLE_{i:04d}"
        entries = []
        for dow in range(7):
            for hour in range(6, 23):
                # Base pattern: busy midday weekdays, busy evenings/weekends
                base = 0.5
                if dow < 5:  # Weekday
                    if 11 <= hour <= 14:
                        base = 0.2  # lunch rush
                    elif 8 <= hour <= 9:
                        base = 0.3  # morning
                else:  # Weekend
                    if 18 <= hour <= 21:
                        base = 0.15  # evening
                    elif 12 <= hour <= 17:
                        base = 0.3

                avail = max(0.05, min(0.95, base + random.gauss(0, 0.15)))
                entries.append({"dow": dow, "hour": hour, "avail": round(avail, 2)})
        scores[meter_id] = entries

    with open(os.path.join(DATA_DIR, "availability_scores.json"), "w") as f:
        json.dump(scores, f)

    print(f"  ✓ Generated sample scores for {len(scores):,} meters")
    return scores


def process_citations(df):
    """Compute citation density by geo grid cell."""
    print("\n[3/3] Processing citations...")

    if df is None:
        print("  No citation data - skipping")
        with open(os.path.join(DATA_DIR, "citation_hotspots.json"), "w") as f:
            json.dump({}, f)
        return

    df.columns = [c.lower().strip() for c in df.columns]

    lat_col = next((c for c in df.columns if "lat" in c), None)
    lon_col = next((c for c in df.columns if "lon" in c or "lng" in c), None)

    if not lat_col or not lon_col:
        print(f"  No geo columns in citations. Columns: {list(df.columns)}")
        with open(os.path.join(DATA_DIR, "citation_hotspots.json"), "w") as f:
            json.dump({}, f)
        return

    df = df.rename(columns={lat_col: "lat", lon_col: "lon"})
    df = df.dropna(subset=["lat", "lon"])
    df = df[df["lat"].between(32.5, 33.2) & df["lon"].between(-117.4, -116.9)]

    # Bucket into ~100m grid cells
    GRID = 0.001
    df["grid_lat"] = (df["lat"] / GRID).round() * GRID
    df["grid_lon"] = (df["lon"] / GRID).round() * GRID

    hotspots = df.groupby(["grid_lat", "grid_lon"]).size().reset_index(name="citations")

    # Normalize 0-1
    max_c = hotspots["citations"].max()
    hotspots["risk"] = (hotspots["citations"] / max_c).round(2)

    # Only keep high-risk cells
    hotspots = hotspots[hotspots["risk"] > 0.1]

    out = hotspots.to_dict(orient="records")
    with open(os.path.join(DATA_DIR, "citation_hotspots.json"), "w") as f:
        json.dump(out, f)

    print(f"  ✓ Saved {len(out):,} citation hotspot cells")


def main():
    print("=" * 50)
    print("SD Smart Parking — Data Preprocessor")
    print("=" * 50)

    # Download
    print("\nDownloading datasets from data.sandiego.gov...")
    locations_df = download_csv(METER_LOCATIONS_URL, "Meter Locations")
    tx_2024 = download_csv(TRANSACTIONS_2024_DAY_URL, "Transactions 2024")
    tx_2025 = download_csv(TRANSACTIONS_2025_DAY_URL, "Transactions 2025")
    citations_df = download_csv(CITATIONS_URL, "Citations 2024")

    # Process
    if locations_df is not None:
        process_meter_locations(locations_df)
    else:
        print("⚠️  No location data — frontend will use sample data")

    process_transactions([tx_2024, tx_2025])
    process_citations(citations_df)

    print("\n✅ All done! Data written to /data/")
    print("   meter_locations.json")
    print("   availability_scores.json")
    print("   citation_hotspots.json")


if __name__ == "__main__":
    main()