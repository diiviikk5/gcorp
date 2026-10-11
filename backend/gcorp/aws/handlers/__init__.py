"""Code that runs inside AWS: Lambda handlers and the AgentCore Runtime entrypoint.

Stdlib + boto3 only (both are present in Lambda; boto3 is bundled for AgentCore).
"""

CPCB_PM25 = [(0, 30, 0, 50), (30, 60, 50, 100), (60, 90, 100, 200), (90, 120, 200, 300), (120, 250, 300, 400), (250, 500, 400, 500)]


def pm_to_aqi(pm: float) -> int:
    """CPCB National AQI sub-index for 24h PM2.5 (µg/m³)."""
    for lo, hi, alo, ahi in CPCB_PM25:
        if pm <= hi:
            return round(alo + (ahi - alo) * (pm - lo) / (hi - lo))
    return 500


def band(aqi: float) -> str:
    return ("Good" if aqi <= 50 else "Satisfactory" if aqi <= 100 else "Moderate" if aqi <= 200
            else "Poor" if aqi <= 300 else "Very poor" if aqi <= 400 else "Severe")
