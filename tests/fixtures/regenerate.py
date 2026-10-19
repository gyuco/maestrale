#!/usr/bin/env python3
"""Rigenera le fixture Open-Meteo e i golden della baseline E01-S00.

Uso:

    # Solo ricostruzione dei golden dalle fixture già committate (nessuna rete)
    python3 tests/fixtures/regenerate.py

    # Aggiorna le risposte grezze dal vivo, poi ricostruisce i golden
    python3 tests/fixtures/regenerate.py --fetch

I parametri delle richieste vengono da ``data_sources.py`` (stesse variabili,
``cell_selection``, ``models=best_match``, ``forecast_days=7`` e
``timezone=Europe/Rome`` usati in produzione), così le fixture restano
rappresentative del contratto reale.

I timestamp ``generated_at`` / ``fetched_at`` sono normalizzati a un valore
fisso per rendere i golden riproducibili: il test sul contratto non dipende
dall'ora in cui è stata scaricata la fixture.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import previsioni_mare  # noqa: E402
from data_sources import MARINE_SOURCE, WEATHER_SOURCE  # noqa: E402

FIXTURES = Path(__file__).resolve().parent
DAYS = 7
TIMEZONE = "Europe/Rome"
FIXED_TIMESTAMP = "2026-10-19T09:00:00+00:00"

LOCATIONS: tuple[dict[str, Any], ...] = (
    {"slug": "cagliari", "name": "Cagliari", "latitude": 39.17, "longitude": 9.15},
    {
        "slug": "torre-dei-corsari",
        "name": "Torre dei Corsari",
        "latitude": 39.688153,
        "longitude": 8.450613,
    },
)

CACHE_PATH = FIXTURES / "golden_forecasts.json"
FORECAST_PATH = FIXTURES / "golden_forecast_torre-dei-corsari.json"


def fixture_path(kind: str, slug: str) -> Path:
    return FIXTURES / f"open_meteo_{kind}_{slug}.json"


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def fetch_raw() -> None:
    """Scarica le risposte grezze reali con i parametri di ``data_sources``."""
    for location in LOCATIONS:
        slug = location["slug"]
        for source, kind in ((MARINE_SOURCE, "marine"), (WEATHER_SOURCE, "weather")):
            params = source.request_params(
                float(location["latitude"]),
                float(location["longitude"]),
                DAYS,
                TIMEZONE,
            )
            print(f"Scarico {kind} per {slug}…")
            payload = previsioni_mare.fetch_json(source.endpoint, params)
            previsioni_mare.write_json_atomic(fixture_path(kind, slug), payload)


def build_forecast_from_fixtures(location: dict[str, Any]) -> dict[str, Any]:
    slug = location["slug"]
    marine = load_json(fixture_path("marine", slug))
    weather = load_json(fixture_path("weather", slug))

    def fake_fetch(base_url: str, params: dict[str, Any], retries: int = 3) -> dict[str, Any]:
        if base_url == MARINE_SOURCE.endpoint:
            return marine
        if base_url == WEATHER_SOURCE.endpoint:
            return weather
        raise AssertionError(f"Endpoint inatteso: {base_url}")

    with patch.object(previsioni_mare, "fetch_json", fake_fetch):
        forecast = previsioni_mare.build_forecast(
            location["name"],
            float(location["latitude"]),
            float(location["longitude"]),
            DAYS,
            TIMEZONE,
        )

    forecast["location"]["slug"] = slug
    forecast["generated_at"] = FIXED_TIMESTAMP
    for source in forecast["sources"].values():
        source["fetched_at"] = FIXED_TIMESTAMP
    return forecast


def build_golden() -> None:
    forecasts = {
        location["slug"]: build_forecast_from_fixtures(location)
        for location in LOCATIONS
    }
    payload = {
        "schema_version": 1,
        "generated_at": FIXED_TIMESTAMP,
        "updated_locations": sorted(forecasts),
        "errors": {},
        "locations": forecasts,
    }
    previsioni_mare.write_json_atomic(CACHE_PATH, payload)
    previsioni_mare.write_json_atomic(
        FORECAST_PATH, forecasts["torre-dei-corsari"]
    )
    print(f"Golden cache: {CACHE_PATH}")
    print(f"Golden /forecast: {FORECAST_PATH}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fetch",
        action="store_true",
        help="Riscarica le fixture grezze da Open-Meteo prima di ricostruire i golden.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.fetch:
        fetch_raw()
    build_golden()


if __name__ == "__main__":
    main()
