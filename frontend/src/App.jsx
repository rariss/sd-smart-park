import { useState, useEffect, useCallback } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";

// ── Constants ──────────────────────────────────────────────────────────────────
const API_BASE = "";

const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];


function availColor(score) {
  if (score >= 0.65) return "#22c55e";
  if (score >= 0.35) return "#f59e0b";
  return "#ef4444";
}

function availLabel(score) {
  if (score >= 0.65) return "Likely Available";
  if (score >= 0.35) return "Moderate";
  return "Usually Full";
}

function riskLabel(risk) {
  if (risk > 0.6) return { text: "High Ticket Risk", color: "#ef4444" };
  if (risk > 0.3) return { text: "Some Enforcement", color: "#f59e0b" };
  return { text: "Low Risk", color: "#22c55e" };
}

// ── Sample data generator (for demo without backend) ───────────────────────────
function generateSampleMeters(centerLat, centerLon) {
  const meters = [];
  const streets = ["Broadway", "5th Ave", "6th Ave", "Market St", "G St", "F St", "Island Ave"];
  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = Math.random() * 0.004;
    const avail = Math.random();
    meters.push({
      meter_id: `METER_${i}`,
      lat: centerLat + Math.cos(angle) * dist,
      lon: centerLon + Math.sin(angle) * dist,
      distance_m: Math.round(50 + Math.random() * 350),
      availability: parseFloat(avail.toFixed(2)),
      citation_risk: parseFloat((Math.random() * 0.8).toFixed(2)),
      street_address: `${100 + i * 10} ${streets[i % streets.length]}`,
      zone: ["Downtown", "Gaslamp", "Core"][i % 3],
      rate_range: ["$1.25/hr", "$1.50/hr", "$2.00/hr", "Free (2hr)"][i % 4],
    });
  }
  return meters.sort((a, b) => b.availability - a.availability);
}

const SAMPLE_RECOMMENDATION = `Your best bet is the meters on 5th Ave near Market St — historically around 68% available on weekend evenings at this hour. They're a 2-minute walk and run $1.25/hr.

⚠️ The Broadway corridor has moderate citation risk after 6pm — enforcement patrols regularly there.

💡 Tip: Free 2-hour street parking opens up on Island Ave after 6pm, about a 4-minute walk south.`;

// ── Map Components ─────────────────────────────────────────────────────────────
function MapController({ centerLat, centerLon, selectedMeter }) {
  const map = useMap();
  // Pan to neighborhood center when it changes
  useEffect(() => { map.setView([centerLat, centerLon], 15); }, [centerLat, centerLon]);
  // Pan + zoom to selected meter when changed via list click
  useEffect(() => {
    if (selectedMeter) map.setView([selectedMeter.lat, selectedMeter.lon], 17);
  }, [selectedMeter?.meter_id]);
  return null;
}

function ParkingMap({ meters, centerLat, centerLon, onSelectMeter, selectedMeter }) {
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
      <MapContainer
        center={[centerLat, centerLon]}
        zoom={15}
        style={{ height: 380, width: "100%" }}
        zoomControl={true}
      >
        {/* CartoDB Dark Matter — free, no API key */}
        <TileLayer
          url="https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          maxZoom={19}
        />

        <MapController centerLat={centerLat} centerLon={centerLon} selectedMeter={selectedMeter} />

        {meters.map((m) => {
          const color = availColor(m.availability);
          const isSelected = selectedMeter?.meter_id === m.meter_id;
          const risk = riskLabel(m.citation_risk);
          return (
            <CircleMarker
              key={m.meter_id}
              center={[m.lat, m.lon]}
              radius={isSelected ? 10 : 6}
              fillColor={color}
              color={isSelected ? "#fff" : color}
              weight={isSelected ? 2 : 1}
              fillOpacity={0.9}
              eventHandlers={{ click: () => onSelectMeter(m) }}
            >
              <Tooltip sticky>
                <div style={{ fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}>
                  <strong>{m.street_address || m.meter_id}</strong><br />
                  Zone: {m.zone || "—"} · {m.rate_range || "Rate unknown"}<br />
                  Availability: <span style={{ color: availColor(m.availability) }}>{Math.round(m.availability * 100)}%</span>
                  {" · "}{availLabel(m.availability)}<br />
                  Citation risk: {risk.text}
                  {m.distance_m != null && <><br />Distance: {m.distance_m}m</>}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

// ── Shared hook: fetch availability curve for a meter ─────────────────────────
function useAvailCurve(meterId) {
  const todayDow = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const [byHour, setByHour] = useState(null); // { dow -> { hour -> avail } }

  useEffect(() => {
    setByHour(null);
    fetch(`${API_BASE}/meter/${meterId}/curve`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const map = {};
        for (const e of data.curve) {
          if (!map[e.dow]) map[e.dow] = {};
          map[e.dow][e.hour] = e.avail;
        }
        setByHour(map);
      })
      .catch(() => null);
  }, [meterId]);

  return { byHour, todayDow };
}

function hourLabel(h) {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

// ── Compact sparkline for meter cards (full 24h, hoverable) ───────────────────
function AvailSparkline({ meter }) {
  const hours = Array.from({ length: 24 }, (_, i) => i); // 0–23
  const nowHour = new Date().getHours();
  const { byHour, todayDow } = useAvailCurve(meter.meter_id);
  const [hoverIdx, setHoverIdx] = useState(null);

  const todayData = byHour?.[todayDow] ?? null;
  const displayCurve = hours.map((h) =>
    todayData ? (todayData[h] ?? meter.availability) : (() => {
      const noise = Math.sin(h * 0.8 + meter.lat * 100) * 0.15;
      return Math.max(0.05, Math.min(0.95, meter.availability + noise));
    })()
  );

  const W = 200, H = 36;
  const xOf = (i) => (i / (hours.length - 1)) * W;
  const yOf = (v) => H - v * H;
  const pts = displayCurve.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
  const color = availColor(meter.availability);
  const nowX = xOf(nowHour);

  const hoverH = hoverIdx !== null ? hours[hoverIdx] : null;
  const hoverV = hoverIdx !== null ? displayCurve[hoverIdx] : null;

  return (
    <div style={{ marginTop: 8, position: "relative" }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontFamily: "monospace" }}>
        AVAILABILITY TODAY (24H)
      </div>
      <svg
        width={W} height={H}
        style={{ overflow: "visible", cursor: "crosshair", display: "block" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const idx = Math.round((x / W) * (hours.length - 1));
          setHoverIdx(Math.max(0, Math.min(hours.length - 1, idx)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`sg_${meter.meter_id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${H} ${pts} ${W},${H}`}
          fill={`url(#sg_${meter.meter_id})`}
        />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
        {/* Now line */}
        <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeDasharray="2,2" />
        {/* Hover */}
        {hoverIdx !== null && (
          <>
            <line x1={xOf(hoverIdx)} y1={0} x2={xOf(hoverIdx)} y2={H} stroke="rgba(255,255,255,0.5)" strokeWidth={1} />
            <circle cx={xOf(hoverIdx)} cy={yOf(hoverV)} r={3} fill={color} />
            <rect x={Math.min(xOf(hoverIdx) + 4, W - 64)} y={yOf(hoverV) - 18} width={60} height={16} rx={3} fill="rgba(15,23,42,0.9)" />
            <text x={Math.min(xOf(hoverIdx) + 7, W - 61)} y={yOf(hoverV) - 6} fill="#e2e8f0" fontSize={9} fontFamily="monospace">
              {hourLabel(hoverH)} · {Math.round(hoverV * 100)}%
            </text>
          </>
        )}
        {/* X axis labels every 6h */}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={xOf(h)} y={H + 11} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="monospace">
            {hourLabel(h)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ── Full availability chart for selected meter detail panel ───────────────────
function AvailChart({ meter }) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const nowHour = new Date().getHours();
  const { byHour, todayDow } = useAvailCurve(meter.meter_id);
  const [hoverIdx, setHoverIdx] = useState(null);

  const todayData = byHour?.[todayDow] ?? null;
  const displayCurve = hours.map((h) =>
    todayData ? (todayData[h] ?? meter.availability) : (() => {
      const noise = Math.sin(h * 0.8 + meter.lat * 100) * 0.15;
      return Math.max(0.05, Math.min(0.95, meter.availability + noise));
    })()
  );

  const PAD = { top: 12, right: 8, bottom: 28, left: 36 };
  const W = 420, H = 130;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xOf = (i) => PAD.left + (i / (hours.length - 1)) * innerW;
  const yOf = (v) => PAD.top + (1 - v) * innerH;

  const pts = displayCurve.map((v, i) => `${xOf(i)},${yOf(v)}`).join(" ");
  const color = availColor(meter.availability);
  const yTicks = [0, 0.25, 0.5, 0.75, 1.0];

  const hoverV = hoverIdx !== null ? displayCurve[hoverIdx] : null;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 6, fontFamily: "monospace" }}>
        AVAILABILITY TODAY (24H)
      </div>
      <svg
        width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ overflow: "visible", cursor: "crosshair" }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const scaleX = W / rect.width;
          const x = (e.clientX - rect.left) * scaleX - PAD.left;
          const idx = Math.round((x / innerW) * (hours.length - 1));
          setHoverIdx(Math.max(0, Math.min(hours.length - 1, idx)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id={`cg_${meter.meter_id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Y-axis grid + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left} y1={yOf(v)} x2={PAD.left + innerW} y2={yOf(v)}
              stroke="rgba(255,255,255,0.07)" strokeWidth={1}
            />
            <text x={PAD.left - 4} y={yOf(v) + 4} textAnchor="end" fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="monospace">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}

        {/* Area fill */}
        <polygon
          points={`${xOf(0)},${yOf(0)} ${pts} ${xOf(hours.length - 1)},${yOf(0)}`}
          fill={`url(#cg_${meter.meter_id})`}
        />

        {/* Line */}
        <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

        {/* Now line */}
        <line
          x1={xOf(nowHour)} y1={PAD.top} x2={xOf(nowHour)} y2={PAD.top + innerH}
          stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="3,3"
        />
        <text x={xOf(nowHour)} y={PAD.top - 3} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize={8} fontFamily="monospace">
          now
        </text>

        {/* Hover */}
        {hoverIdx !== null && (
          <>
            <line
              x1={xOf(hoverIdx)} y1={PAD.top} x2={xOf(hoverIdx)} y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.45)" strokeWidth={1}
            />
            <circle cx={xOf(hoverIdx)} cy={yOf(hoverV)} r={4} fill={color} stroke="#080f18" strokeWidth={1.5} />
            <rect
              x={Math.min(xOf(hoverIdx) + 6, PAD.left + innerW - 74)} y={yOf(hoverV) - 20}
              width={70} height={18} rx={4} fill="rgba(15,23,42,0.95)"
            />
            <text
              x={Math.min(xOf(hoverIdx) + 9, PAD.left + innerW - 71)} y={yOf(hoverV) - 7}
              fill="#e2e8f0" fontSize={10} fontFamily="monospace"
            >
              {hourLabel(hours[hoverIdx])} · {Math.round(hoverV * 100)}%
            </text>
          </>
        )}

        {/* X axis labels every 6h */}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} x={xOf(h)} y={PAD.top + innerH + 14} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="monospace">
            {hourLabel(h)}
          </text>
        ))}

        {/* Y axis border */}
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
      </svg>
    </div>
  );
}

// ── Meter Card ─────────────────────────────────────────────────────────────────
function MeterCard({ meter, isSelected, onClick }) {
  const risk = riskLabel(meter.citation_risk);
  const avail = meter.availability;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        background: isSelected ? "rgba(96,165,250,0.08)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${isSelected ? "rgba(96,165,250,0.3)" : "rgba(255,255,255,0.07)"}`,
        cursor: "pointer",
        transition: "all 0.15s ease",
        marginBottom: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: "monospace" }}>
            {meter.street_address || meter.meter_id}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            {meter.zone} · {meter.rate_range || "Rate unknown"} · {meter.distance_m}m walk
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: 20, fontWeight: 700,
            color: availColor(avail),
            fontFamily: "monospace", lineHeight: 1
          }}>
            {Math.round(avail * 100)}%
          </div>
          <div style={{ fontSize: 9, color: availColor(avail), marginTop: 1 }}>
            {availLabel(avail)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{
          fontSize: 9, padding: "2px 7px", borderRadius: 4,
          background: "rgba(255,255,255,0.05)",
          color: risk.color, border: `1px solid ${risk.color}40`,
          fontFamily: "monospace"
        }}>
          {risk.text}
        </span>
        {meter.time_start && meter.time_end && (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "monospace" }}>
            {meter.time_start}–{meter.time_end}
          </span>
        )}
        {meter.time_limit && (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "monospace" }}>
            {meter.time_limit}
          </span>
        )}
        {meter.days_in_operation && (
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "monospace" }}>
            {meter.days_in_operation}
          </span>
        )}
      </div>

      {isSelected && <AvailSparkline meter={meter} />}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState("");
  const [areas, setAreas] = useState([]);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState(null);
  const [meters, setMeters] = useState([]);       // search results for left panel
  const [mapMeters, setMapMeters] = useState([]); // all area meters for map
  const [recommendation, setRecommendation] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedMeter, setSelectedMeter] = useState(null);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [resolvedLocation, setResolvedLocation] = useState(null); // { area, reasoning }
  const selectedAreaRef = useCallback((node) => { if (node) node.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [selectedNeighborhood]);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayStr = DOW_NAMES[now.getDay() === 0 ? 6 : now.getDay() - 1];

  // Load areas from API on mount
  useEffect(() => {
    fetch(`${API_BASE}/areas`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setAreas(data);
          setSelectedNeighborhood(data[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Load all meters in the selected neighborhood whenever it changes
  useEffect(() => {
    if (!selectedNeighborhood) return;
    const { lat, lon } = selectedNeighborhood;
    fetch(`${API_BASE}/meters/area?lat=${lat}&lon=${lon}&radius_m=1500&limit=500`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setMapMeters(Array.isArray(data) ? data : []))
      .catch(() => setMapMeters([]));
    setSelectedMeter(null);
  }, [selectedNeighborhood]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setSelectedMeter(null);
    setResolvedLocation(null);

    // Resolve location from natural language query
    let targetArea = selectedNeighborhood;
    try {
      const locRes = await fetch(`${API_BASE}/resolve-location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (locRes.ok) {
        const locData = await locRes.json();
        if (locData.area) {
          targetArea = locData.area;
          setResolvedLocation(locData);
          // Match against the areas array so the selector button highlights correctly
          const matched = areas.find((a) => a.name === locData.area.name) || locData.area;
          setSelectedNeighborhood(matched);
        }
      }
    } catch {
      // If resolve fails, fall through to use selectedNeighborhood
    }

    if (!targetArea) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/find-parking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          lat: targetArea.lat,
          lon: targetArea.lon,
          radius_m: 500,
        }),
      });

      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      setMeters(data.meters);
      setRecommendation(data.recommendation);
      setUsingSampleData(false);
    } catch {
      // Fall back to sample data for demo
      const sampleMeters = generateSampleMeters(targetArea.lat, targetArea.lon);
      setMeters(sampleMeters);
      setRecommendation(SAMPLE_RECOMMENDATION);
      setUsingSampleData(true);
    } finally {
      setLoading(false);
    }
  }, [query, selectedNeighborhood]);

  // Selecting a meter — unified handler for both list and map clicks
  const handleSelectMeter = useCallback((m) => {
    setSelectedMeter((prev) => prev?.meter_id === m.meter_id ? null : m);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  // Quick searches
  const QUICK = [
    "Padres game tonight",
    "Dinner in Little Italy",
    "Weekend brunch Hillcrest",
    "Quick errand downtown",
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#080f18",
      color: "#e2e8f0",
      fontFamily: "'DM Mono', 'Fira Code', 'Courier New', monospace",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(255,255,255,0.02)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #1d4ed8, #0ea5e9)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>🅿️</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.05em", color: "#f1f5f9" }}>
              SD SMART PARK
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
              POWERED BY CITY OF SAN DIEGO OPEN DATA + CLAUDE AI
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 11, color: "rgba(255,255,255,0.3)",
          background: "rgba(255,255,255,0.04)",
          padding: "4px 10px", borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.07)"
        }}>
          {dayStr} · {timeStr}
        </div>
      </div>

      {/* Body */}
      <div style={{
        display: "flex", flex: 1,
        flexDirection: window.innerWidth < 900 ? "column" : "row",
      }}>
        {/* Left Panel */}
        <div style={{
          width: window.innerWidth < 900 ? "100%" : 380,
          borderRight: "1px solid rgba(255,255,255,0.07)",
          padding: "20px",
          display: "flex", flexDirection: "column", gap: 16,
          overflowY: "auto",
        }}>
          {/* Area Selector */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em", display: "flex", justifyContent: "space-between" }}>
              <span>AREA</span>
              {areas.length > 0 && <span style={{ color: "rgba(255,255,255,0.2)" }}>{areas.length} areas</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 120, overflowY: "auto" }}>
              {areas.map((n) => (
                <button
                  key={n.name}
                  ref={selectedNeighborhood?.name === n.name ? selectedAreaRef : null}
                  onClick={() => setSelectedNeighborhood(n)}
                  style={{
                    fontSize: 10, padding: "4px 10px", borderRadius: 6,
                    background: selectedNeighborhood?.name === n.name
                      ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${selectedNeighborhood?.name === n.name
                      ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.08)"}`,
                    color: selectedNeighborhood?.name === n.name ? "#93c5fd" : "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                >
                  {n.name}
                  <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.5 }}>{n.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em" }}>
              WHERE ARE YOU HEADING?
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='e.g. "Dinner at 7pm in Gaslamp"'
                style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, color: "#e2e8f0",
                  fontSize: 12, fontFamily: "inherit",
                  outline: "none",
                }}
              />
              <button
                onClick={handleSearch}
                disabled={loading || !query.trim()}
                style={{
                  padding: "10px 16px",
                  background: loading ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.8)",
                  border: "none", borderRadius: 8,
                  color: "#fff", fontSize: 12, cursor: "pointer",
                  fontFamily: "inherit", fontWeight: 600,
                  transition: "all 0.15s",
                  minWidth: 60,
                }}
              >
                {loading ? "..." : "GO"}
              </button>
            </div>

            {/* Quick searches */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => { setQuery(q); }}
                  style={{
                    fontSize: 9, padding: "3px 8px", borderRadius: 4,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    color: "rgba(255,255,255,0.35)", cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Resolved location badge */}
            {resolvedLocation && (
              <div style={{
                marginTop: 8, padding: "6px 10px",
                background: "rgba(16,185,129,0.08)",
                border: "1px solid rgba(16,185,129,0.25)",
                borderRadius: 6,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span style={{ fontSize: 10, color: "#34d399" }}>⌖</span>
                <span style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>
                  {resolvedLocation.location_name || resolvedLocation.area.name}
                </span>
                {resolvedLocation.location_name && (
                  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)" }}>
                    → nearest area: {resolvedLocation.area.name}
                  </span>
                )}
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", flex: 1 }}>
                  — {resolvedLocation.reasoning}
                </span>
              </div>
            )}
          </div>

          {/* AI Recommendation */}
          {recommendation && (
            <div style={{
              padding: "14px 16px",
              background: "rgba(59,130,246,0.07)",
              border: "1px solid rgba(59,130,246,0.2)",
              borderRadius: 10,
            }}>
              <div style={{
                fontSize: 9, letterSpacing: "0.1em",
                color: "#60a5fa", marginBottom: 8, fontWeight: 600,
              }}>
                ✦ CLAUDE RECOMMENDATION
              </div>
              <div style={{
                fontSize: 12, lineHeight: 1.6,
                color: "rgba(255,255,255,0.75)",
                whiteSpace: "pre-line",
              }}>
                {recommendation}
              </div>
              {usingSampleData && (
                <div style={{
                  fontSize: 9, color: "rgba(255,255,255,0.3)",
                  marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)",
                  paddingTop: 8
                }}>
                  ⚠ Demo mode — start backend for live data
                </div>
              )}
            </div>
          )}

          {/* Meter list — search results */}
          {meters.length > 0 && (
            <div>
              <div style={{
                fontSize: 10, color: "rgba(255,255,255,0.4)",
                marginBottom: 8, letterSpacing: "0.08em",
                display: "flex", justifyContent: "space-between"
              }}>
                <span>NEARBY METERS</span>
                <span style={{ color: "rgba(255,255,255,0.25)" }}>
                  {meters.length} matched · {mapMeters.length} in area
                </span>
              </div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {meters.slice(0, 12).map((m) => (
                  <MeterCard
                    key={m.meter_id}
                    meter={m}
                    isSelected={selectedMeter?.meter_id === m.meter_id}
                    onClick={() => handleSelectMeter(m)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Panel — Map */}
        <div style={{
          flex: 1, padding: "20px",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em" }}>
            MAP VIEW — {selectedNeighborhood ? selectedNeighborhood.name.toUpperCase() : "LOADING..."}
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { color: "#22c55e", label: "Likely Available (65%+)" },
              { color: "#f59e0b", label: "Moderate (35-65%)" },
              { color: "#ef4444", label: "Usually Full (<35%)" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                {label}
              </div>
            ))}
          </div>

          {selectedNeighborhood && <>
            <ParkingMap
              meters={mapMeters.length > 0 ? mapMeters : meters}
              centerLat={selectedNeighborhood.lat}
              centerLon={selectedNeighborhood.lon}
              onSelectMeter={handleSelectMeter}
              selectedMeter={selectedMeter}
            />

              {/* Stats row — shown after search */}
              {hasSearched && meters.length > 0 && (
                <div style={{ display: "flex", gap: 12 }}>
                  {[
                    {
                      label: "AVG AVAILABILITY",
                      value: `${Math.round((meters.reduce((s, m) => s + m.availability, 0) / meters.length) * 100)}%`,
                      color: availColor(meters.reduce((s, m) => s + m.availability, 0) / meters.length),
                    },
                    {
                      label: "BEST OPTION",
                      value: `${Math.round(meters[0]?.availability * 100)}%`,
                      color: "#22c55e",
                    },
                    {
                      label: "NEARBY METERS",
                      value: meters.length,
                      color: "#60a5fa",
                    },
                    {
                      label: "HIGH RISK ZONES",
                      value: meters.filter((m) => m.citation_risk > 0.6).length,
                      color: "#ef4444",
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{
                      flex: 1, padding: "12px 14px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)",
                    }}>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.08em" }}>{label}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Selected meter detail panel */}
              {selectedMeter && (
                <div style={{
                  padding: "16px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 10,
                  border: "1px solid rgba(59,130,246,0.2)",
                }}>
                  <div style={{ fontSize: 10, color: "#60a5fa", marginBottom: 8, letterSpacing: "0.08em" }}>
                    SELECTED METER
                  </div>
                  <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                        {selectedMeter.street_address || selectedMeter.meter_id}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                        Zone: {selectedMeter.zone || "—"} · {selectedMeter.rate_range || "Rate unknown"}
                        {selectedMeter.distance_m != null && ` · ${selectedMeter.distance_m}m away`}
                      </div>
                      <div style={{ fontSize: 11, color: riskLabel(selectedMeter.citation_risk).color, marginTop: 4 }}>
                        {riskLabel(selectedMeter.citation_risk).text}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: availColor(selectedMeter.availability), fontFamily: "monospace" }}>
                        {Math.round(selectedMeter.availability * 100)}%
                      </div>
                      <div style={{ fontSize: 10, color: availColor(selectedMeter.availability) }}>
                        {availLabel(selectedMeter.availability)}
                      </div>
                    </div>
                  </div>
                  <AvailChart meter={selectedMeter} />
                </div>
              )}
          </>}
        </div>
      </div>
    </div>
  );
}