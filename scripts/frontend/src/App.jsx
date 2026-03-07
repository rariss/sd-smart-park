import { useState, useEffect, useRef, useCallback } from "react";

// ── Constants ──────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:8000";

// San Diego neighborhoods with coordinates
const SD_NEIGHBORHOODS = [
  { name: "Gaslamp Quarter", lat: 32.7099, lon: -117.1607 },
  { name: "Little Italy", lat: 32.7241, lon: -117.1697 },
  { name: "Balboa Park", lat: 32.7341, lon: -117.1446 },
  { name: "Hillcrest", lat: 32.7467, lon: -117.1614 },
  { name: "Pacific Beach", lat: 32.7966, lon: -117.2359 },
  { name: "Ocean Beach", lat: 32.7446, lon: -117.2498 },
  { name: "North Park", lat: 32.7472, lon: -117.1299 },
  { name: "Mission Valley", lat: 32.7676, lon: -117.1508 },
];

const DOW_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Utility ────────────────────────────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

// ── Mini Map Component (SVG-based, no external deps) ─────────────────────────
function MiniMap({ meters, centerLat, centerLon, onSelectMeter, selectedMeter }) {
  const svgRef = useRef(null);
  const W = 520, H = 380;
  const PAD = 40;

  if (!meters.length) return null;

  const lats = meters.map((m) => m.lat);
  const lons = meters.map((m) => m.lon);
  const minLat = Math.min(...lats, centerLat) - 0.0005;
  const maxLat = Math.max(...lats, centerLat) + 0.0005;
  const minLon = Math.min(...lons, centerLon) - 0.0005;
  const maxLon = Math.max(...lons, centerLon) + 0.0005;

  const project = (lat, lon) => ({
    x: PAD + ((lon - minLon) / (maxLon - minLon)) * (W - PAD * 2),
    y: PAD + ((maxLat - lat) / (maxLat - minLat)) * (H - PAD * 2),
  });

  const center = project(centerLat, centerLon);

  return (
    <svg
      ref={svgRef}
      width={W}
      height={H}
      style={{
        background: "#0f1923",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.08)",
        cursor: "default",
        width: "100%",
        height: "auto",
      }}
    >
      {/* Grid lines */}
      {[0.2, 0.4, 0.6, 0.8].map((t) => (
        <g key={t}>
          <line
            x1={PAD + t * (W - PAD * 2)} y1={PAD}
            x2={PAD + t * (W - PAD * 2)} y2={H - PAD}
            stroke="rgba(255,255,255,0.04)" strokeWidth={1}
          />
          <line
            x1={PAD} y1={PAD + t * (H - PAD * 2)}
            x2={W - PAD} y2={PAD + t * (H - PAD * 2)}
            stroke="rgba(255,255,255,0.04)" strokeWidth={1}
          />
        </g>
      ))}

      {/* Meters */}
      {meters.map((m) => {
        const pt = project(m.lat, m.lon);
        const color = availColor(m.availability);
        const isSelected = selectedMeter?.meter_id === m.meter_id;
        return (
          <g key={m.meter_id} onClick={() => onSelectMeter(m)} style={{ cursor: "pointer" }}>
            {isSelected && (
              <circle cx={pt.x} cy={pt.y} r={14} fill="none" stroke={color} strokeWidth={2} opacity={0.5} />
            )}
            <circle
              cx={pt.x} cy={pt.y} r={isSelected ? 7 : 5}
              fill={color}
              opacity={0.9}
              stroke={isSelected ? "#fff" : "none"}
              strokeWidth={1.5}
            />
          </g>
        );
      })}

      {/* Center marker (destination) */}
      <g>
        <circle cx={center.x} cy={center.y} r={10} fill="none" stroke="#60a5fa" strokeWidth={2} />
        <circle cx={center.x} cy={center.y} r={4} fill="#60a5fa" />
        <circle cx={center.x} cy={center.y} r={16} fill="none" stroke="#60a5fa" strokeWidth={1} opacity={0.3} />
      </g>

      {/* Legend */}
      {[
        { color: "#22c55e", label: "Available" },
        { color: "#f59e0b", label: "Moderate" },
        { color: "#ef4444", label: "Full" },
      ].map(({ color, label }, i) => (
        <g key={label} transform={`translate(${PAD + i * 110}, ${H - 18})`}>
          <circle cx={6} cy={0} r={4} fill={color} />
          <text x={14} y={4} fill="rgba(255,255,255,0.5)" fontSize={10} fontFamily="monospace">
            {label}
          </text>
        </g>
      ))}

      {/* Destination label */}
      <text x={center.x} y={center.y - 18} textAnchor="middle" fill="#60a5fa" fontSize={10} fontFamily="monospace">
        DESTINATION
      </text>
    </svg>
  );
}

// ── Availability Sparkline ─────────────────────────────────────────────────────
function AvailSparkline({ meter }) {
  const hours = Array.from({ length: 17 }, (_, i) => i + 6); // 6am-10pm
  const now = new Date().getHours();

  // Mock curve based on meter availability (real app would fetch /meter/:id/curve)
  const curve = hours.map((h) => {
    const base = meter.availability;
    const noise = Math.sin(h * 0.8 + meter.lat * 100) * 0.15;
    return Math.max(0.05, Math.min(0.95, base + noise));
  });

  const W = 200, H = 40;
  const pts = curve.map((v, i) => {
    const x = (i / (curve.length - 1)) * W;
    const y = H - v * H;
    return `${x},${y}`;
  });

  const nowIdx = hours.indexOf(now);
  const nowX = nowIdx >= 0 ? (nowIdx / (curve.length - 1)) * W : null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontFamily: "monospace" }}>
        AVAILABILITY TODAY (6AM–10PM)
      </div>
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={`grad_${meter.meter_id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={availColor(meter.availability)} stopOpacity={0.3} />
            <stop offset="100%" stopColor={availColor(meter.availability)} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={availColor(meter.availability)}
          strokeWidth={1.5}
        />
        {nowX !== null && (
          <line x1={nowX} y1={0} x2={nowX} y2={H} stroke="rgba(255,255,255,0.4)" strokeWidth={1} strokeDasharray="2,2" />
        )}
        {hours.filter((h) => h % 3 === 0).map((h) => {
          const i = hours.indexOf(h);
          const x = (i / (curve.length - 1)) * W;
          return (
            <text key={h} x={x} y={H + 12} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize={8} fontFamily="monospace">
              {h > 12 ? `${h - 12}p` : `${h}a`}
            </text>
          );
        })}
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

      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{
          fontSize: 9, padding: "2px 7px", borderRadius: 4,
          background: "rgba(255,255,255,0.05)",
          color: risk.color, border: `1px solid ${risk.color}40`,
          fontFamily: "monospace"
        }}>
          {risk.text}
        </span>
      </div>

      {isSelected && <AvailSparkline meter={meter} />}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState("");
  const [selectedNeighborhood, setSelectedNeighborhood] = useState(SD_NEIGHBORHOODS[0]);
  const [meters, setMeters] = useState([]);
  const [recommendation, setRecommendation] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedMeter, setSelectedMeter] = useState(null);
  const [usingSampleData, setUsingSampleData] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayStr = DOW_NAMES[now.getDay() === 0 ? 6 : now.getDay() - 1];

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setSelectedMeter(null);

    try {
      const res = await fetch(`${API_BASE}/find-parking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          lat: selectedNeighborhood.lat,
          lon: selectedNeighborhood.lon,
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
      const sampleMeters = generateSampleMeters(selectedNeighborhood.lat, selectedNeighborhood.lon);
      setMeters(sampleMeters);
      setRecommendation(SAMPLE_RECOMMENDATION);
      setUsingSampleData(true);
    } finally {
      setLoading(false);
    }
  }, [query, selectedNeighborhood]);

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
              SD SMART PARKING
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
          {/* Neighborhood Selector */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em" }}>
              AREA
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SD_NEIGHBORHOODS.map((n) => (
                <button
                  key={n.name}
                  onClick={() => setSelectedNeighborhood(n)}
                  style={{
                    fontSize: 10, padding: "4px 10px", borderRadius: 6,
                    background: selectedNeighborhood.name === n.name
                      ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${selectedNeighborhood.name === n.name
                      ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.08)"}`,
                    color: selectedNeighborhood.name === n.name ? "#93c5fd" : "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                >
                  {n.name}
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

          {/* Meter list */}
          {meters.length > 0 && (
            <div>
              <div style={{
                fontSize: 10, color: "rgba(255,255,255,0.4)",
                marginBottom: 8, letterSpacing: "0.08em",
                display: "flex", justifyContent: "space-between"
              }}>
                <span>NEARBY METERS</span>
                <span style={{ color: "rgba(255,255,255,0.25)" }}>{meters.length} found</span>
              </div>
              <div style={{ maxHeight: 380, overflowY: "auto" }}>
                {meters.slice(0, 12).map((m) => (
                  <MeterCard
                    key={m.meter_id}
                    meter={m}
                    isSelected={selectedMeter?.meter_id === m.meter_id}
                    onClick={() => setSelectedMeter(selectedMeter?.meter_id === m.meter_id ? null : m)}
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
            MAP VIEW — {selectedNeighborhood.name.toUpperCase()}
          </div>

          {!hasSearched ? (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              flexDirection: "column", gap: 16,
              background: "rgba(255,255,255,0.02)",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.06)",
              minHeight: 360,
            }}>
              <div style={{ fontSize: 40 }}>🗺️</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
                Select a neighborhood and describe<br />where you're heading to see parking predictions
              </div>
              <div style={{
                display: "flex", gap: 24, marginTop: 8,
              }}>
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
            </div>
          ) : (
            <>
              <MiniMap
                meters={meters}
                centerLat={selectedNeighborhood.lat}
                centerLon={selectedNeighborhood.lon}
                onSelectMeter={(m) => setSelectedMeter(selectedMeter?.meter_id === m.meter_id ? null : m)}
                selectedMeter={selectedMeter}
              />

              {/* Stats row */}
              {meters.length > 0 && (
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
                      label: "METERS FOUND",
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

              {selectedMeter && (
                <div style={{
                  padding: "16px",
                  background: "rgba(255,255,255,0.03)",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: "0.08em" }}>
                    SELECTED METER DETAIL
                  </div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                        {selectedMeter.street_address || selectedMeter.meter_id}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                        Zone: {selectedMeter.zone} · {selectedMeter.rate_range} · {selectedMeter.distance_m}m away
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: availColor(selectedMeter.availability), fontFamily: "monospace" }}>
                        {Math.round(selectedMeter.availability * 100)}%
                      </div>
                      <div style={{ fontSize: 10, color: availColor(selectedMeter.availability) }}>
                        {availLabel(selectedMeter.availability)}
                      </div>
                    </div>
                  </div>
                  <AvailSparkline meter={selectedMeter} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}