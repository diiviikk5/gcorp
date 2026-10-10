import type { LedgerRow } from "@/lib/types";

// Provenance ledger (mirrors the DynamoDB table behind the ledger Lambda).
// Every value here is DEMO DATA, shaped like the real rows. Replace each with a
// retrieved, verified figure before showing it to a planner.
const R = "2026-10-08T09:30:00Z";

export const LEDGER: LedgerRow[] = [
  { id: "L-001", label: "Vehicle share of ambient PM2.5 (winter)", value: "0.20", unit: "fraction", source: "Source apportionment study, Delhi (IIT Kanpur, 2016)", url: "https://www.iitk.ac.in", retrievedAt: R, scope: "City-wide, winter", status: "demo" },
  { id: "L-002", label: "Split of vehicular PM2.5 by class", value: "trucks 0.42 · 2W 0.28 · cars 0.18 · buses 0.07 · 3W 0.05", source: "Source apportionment study, Delhi (IIT Kanpur, 2016)", url: "https://www.iitk.ac.in", retrievedAt: R, scope: "City-wide", status: "demo" },
  { id: "L-003", label: "Road dust share of ambient PM2.5", value: "0.38", unit: "fraction", source: "Source apportionment study, Delhi (IIT Kanpur, 2016)", url: "https://www.iitk.ac.in", retrievedAt: R, scope: "City-wide", status: "demo" },
  { id: "L-004", label: "Construction share of ambient PM2.5", value: "0.07", unit: "fraction", source: "Source apportionment study, Delhi (IIT Kanpur, 2016)", url: "https://www.iitk.ac.in", retrievedAt: R, scope: "City-wide", status: "demo" },
  { id: "L-005", label: "Industrial point-source share of PM2.5", value: "0.11", unit: "fraction", source: "Source apportionment study, Delhi (IIT Kanpur, 2016)", url: "https://www.iitk.ac.in", retrievedAt: R, scope: "City-wide", status: "demo" },
  { id: "L-006", label: "Open waste burning share of PM2.5", value: "0.08", unit: "fraction", source: "Source apportionment study, Delhi (IIT Kanpur, 2016)", url: "https://www.iitk.ac.in", retrievedAt: R, scope: "City-wide", status: "demo" },
  { id: "L-007", label: "Regional transport share on stubble-burning peak days", value: "up to 0.40", unit: "fraction", source: "SAFAR / IITM Pune daily bulletins", url: "https://safar.tropmet.res.in", retrievedAt: R, scope: "Delhi NCR, Oct–Nov", status: "demo" },
  { id: "L-008", label: "Diesel share of Delhi auto-rickshaw fleet", value: "≈ 0", unit: "fraction", source: "Supreme Court CNG mandate for public transport (1998 order)", url: "https://main.sci.gov.in", retrievedAt: R, scope: "Delhi, 3-wheelers", status: "demo", note: "Delhi autos run on CNG. A diesel-auto ban targets almost nothing." },
  { id: "L-009", label: "Diesel share of goods vehicles entering Delhi", value: "0.94", unit: "fraction", source: "Transport Department, entry-point counts", url: "https://transport.delhi.gov.in", retrievedAt: R, scope: "Border entry points", status: "demo" },
  { id: "L-010", label: "Observed compliance with a vehicle restriction", value: "0.70", unit: "fraction", source: "Odd-even evaluation, Jan 2016", url: "https://transport.delhi.gov.in", retrievedAt: R, scope: "Delhi, private cars", status: "demo" },
  { id: "L-011", label: "Through-traffic diverted to peripheral roads", value: "0.30", unit: "fraction", source: "Traffic study after Eastern Peripheral Expressway opening", url: "https://morth.nic.in", retrievedAt: R, scope: "East Delhi corridors", status: "demo" },
  { id: "L-012", label: "Schools within 500 m of an arterial road", value: "per zone", source: "OpenStreetMap (amenity=school) + road buffer", url: "https://www.openstreetmap.org", retrievedAt: R, scope: "Per zone", status: "demo" },
  { id: "L-013", label: "Hospitals and clinics", value: "per zone", source: "OpenStreetMap (amenity=hospital|clinic)", url: "https://www.openstreetmap.org", retrievedAt: R, scope: "Per zone", status: "demo" },
  { id: "L-014", label: "Goods-vehicle operators with ≤ 2 trucks", value: "0.62", unit: "fraction of operators", source: "VAHAN registration extract", url: "https://vahan.parivahan.gov.in", retrievedAt: R, scope: "Delhi-registered goods vehicles", status: "demo" },
  { id: "L-015", label: "Truck entry window into Delhi", value: "23:00 – 07:00", source: "Delhi Traffic Police no-entry notification", url: "https://traffic.delhipolice.gov.in", retrievedAt: R, scope: "Heavy goods vehicles", status: "demo" },
  { id: "L-016", label: "Private-car share eligible on a given odd/even day", value: "0.50", unit: "fraction", source: "Odd-even scheme rules (number-plate parity)", url: "https://transport.delhi.gov.in", retrievedAt: R, scope: "Private cars, exemptions excluded", status: "demo" },
  { id: "L-017", label: "Exempted vehicles under odd-even (2W, women drivers, CNG)", value: "0.35", unit: "fraction of car+2W trips", source: "Odd-even scheme rules, Jan 2016", url: "https://transport.delhi.gov.in", retrievedAt: R, scope: "Delhi", status: "demo" },
  { id: "L-018", label: "Observed PM2.5 change during odd-even (Jan 1–15, 2016)", value: "−2% to −6%", unit: "vs. counterfactual", source: "Independent evaluations of odd-even, 2016", url: "https://transport.delhi.gov.in", retrievedAt: R, scope: "City-wide, hourly", status: "demo" },
  { id: "L-019", label: "Dust-control compliance at construction sites", value: "0.55", unit: "fraction of sites", source: "DPCC inspection drive summary", url: "https://www.dpcc.delhigovt.nic.in", retrievedAt: R, scope: "Delhi", status: "demo" },
  { id: "L-020", label: "Population by zone", value: "per zone", source: "Census 2011, projected", url: "https://censusindia.gov.in", retrievedAt: R, scope: "Per zone", status: "demo" },
  { id: "L-021", label: "Sentinel-5P tropospheric NO₂ (gap fill)", value: "gridded", source: "Copernicus Sentinel-5P TROPOMI", url: "https://sentinel.esa.int", retrievedAt: R, scope: "3.5 × 5.5 km pixels", status: "demo" },
  { id: "L-022", label: "Asthma admissions dataset for East Delhi", value: "not found", source: "Searched: state health portal, ICMR", url: "https://www.icmr.gov.in", retrievedAt: R, scope: "None", status: "demo", note: "No local dose-response data, so health-outcome claims stay as open questions." },
];

export const STATION_ROWS: LedgerRow[] = [];

export function ledgerById(id: string): LedgerRow | undefined {
  return LEDGER.find((r) => r.id === id) ?? STATION_ROWS.find((r) => r.id === id);
}
