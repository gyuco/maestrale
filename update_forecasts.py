#!/usr/bin/env python3
"""Aggiorna il cache JSON delle previsioni consumato dal backend FastAPI.

Pensato per essere eseguito ogni sei ore da cron, systemd o un scheduler cloud:

    python3 update_forecasts.py
    python3 update_forecasts.py --location torre-dei-corsari
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from previsioni_mare import build_forecast, write_json_atomic


ROOT = Path(__file__).resolve().parent
DEFAULT_LOCATIONS = ROOT / "locations.json"
DEFAULT_OUTPUT = ROOT / "data" / "forecasts.json"


def load_locations(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as source:
        locations = json.load(source)
    required = {"slug", "name", "latitude", "longitude"}
    for location in locations:
        missing = required - set(location)
        if missing:
            raise ValueError(f"Localita non valida, campi mancanti: {sorted(missing)}")
    return locations


def load_previous(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"locations": {}}
    try:
        with path.open(encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError):
        return {"locations": {}}


def update_one(location: dict[str, Any], days: int) -> tuple[str, dict[str, Any]]:
    forecast = build_forecast(
        name=location["name"],
        latitude=float(location["latitude"]),
        longitude=float(location["longitude"]),
        days=days,
        timezone_name="Europe/Rome",
    )
    forecast["location"]["slug"] = location["slug"]
    return location["slug"], forecast


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locations-file", type=Path, default=DEFAULT_LOCATIONS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--location", action="append", help="Slug da aggiornare; ripetibile.")
    parser.add_argument("--days", type=int, default=7, choices=range(1, 9))
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    locations = load_locations(args.locations_file)
    if args.location:
        requested = set(args.location)
        locations = [location for location in locations if location["slug"] in requested]
        found = {location["slug"] for location in locations}
        if missing := requested - found:
            print(f"Localita sconosciute: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    previous = load_previous(args.output)
    forecasts = dict(previous.get("locations", {}))
    errors: dict[str, str] = {}
    updated: list[str] = []

    with ThreadPoolExecutor(max_workers=min(args.workers, len(locations) or 1)) as executor:
        futures = {executor.submit(update_one, location, args.days): location for location in locations}
        for future in as_completed(futures):
            location = futures[future]
            try:
                slug, forecast = future.result()
                forecasts[slug] = forecast
                updated.append(slug)
                print(f"Aggiornata: {location['name']}")
            except Exception as exc:  # il cache precedente resta disponibile
                errors[location["slug"]] = str(exc)
                print(f"Errore {location['name']}: {exc}", file=sys.stderr)

    payload = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "updated_locations": sorted(updated),
        "errors": errors,
        "locations": forecasts,
    }
    write_json_atomic(args.output, payload)
    print(f"Cache salvato in: {args.output}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
