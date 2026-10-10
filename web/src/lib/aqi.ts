// CPCB National AQI categories.
export const AQI_BANDS = [
  { max: 50, label: "Good", color: "#4fb26b" },
  { max: 100, label: "Satisfactory", color: "#a3c853" },
  { max: 200, label: "Moderate", color: "#e9cf47" },
  { max: 300, label: "Poor", color: "#f29c33" },
  { max: 400, label: "Very poor", color: "#e8483a" },
  { max: 500, label: "Severe", color: "#a8233a" },
] as const;

export function aqiBand(v: number) {
  return AQI_BANDS.find((b) => v <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

export const fmt = (v: number, d = 0) => v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });

export function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
