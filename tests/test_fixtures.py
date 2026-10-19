"""Test della baseline: fixture Open-Meteo, golden e JSON Schema del contratto.

I file vivono in ``tests/fixtures/`` (tracciata da git) perché ``data/*.json`` è
ignorata. I test non accedono alla rete: validano solo gli artefatti committati.
"""

from __future__ import annotations

import copy
import datetime
import json
import re
import unittest
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import jsonschema

from backend.main import create_app

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SCHEMA_PATH = FIXTURES / "forecast.schema.json"
CACHE_PATH = FIXTURES / "golden_forecasts.json"
FORECAST_PATH = FIXTURES / "golden_forecast_torre-dei-corsari.json"
TORRE_SLUG = "torre-dei-corsari"

LOCATIONS = {
    "torre-dei-corsari": {
        "name": "Torre dei Corsari",
        "latitude": 39.688153,
        "longitude": 8.450613,
    },
    "cagliari": {
        "name": "Cagliari",
        "latitude": 39.17,
        "longitude": 9.15,
    },
}

MARINE_HOURLY = (
    "wave_height",
    "wave_direction",
    "wave_period",
    "sea_surface_temperature",
)
WEATHER_HOURLY = (
    "temperature_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
)
WEATHER_DAILY = (
    "weather_code",
    "temperature_2m_min",
    "temperature_2m_max",
    "wind_speed_10m_max",
    "wind_gusts_10m_max",
)


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


# `jsonschema` non abilita `format` per default, e l'extra `jsonschema[format]`
# (rfc3339-validator / rfc3986-validator) non è installato: senza questi checker
# `format: date-time` e `format: uri` sarebbero silenziosamente ignorati. I checker
# equivalenti sono ricostruiti con la sola libreria standard (nessuna dipendenza in più).
_RFC3339_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$"
)


def _is_rfc3339(value: Any) -> bool:
    """Verifica `format: date-time` (RFC 3339) senza l'extra `jsonschema[format]`."""

    if not isinstance(value, str) or not _RFC3339_RE.match(value):
        return False
    try:
        datetime.datetime.fromisoformat(value.replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        return False
    return True


def _is_uri(value: Any) -> bool:
    """Verifica `format: uri` senza l'extra `jsonschema[format]` (basta uno schema)."""

    return not isinstance(value, str) or bool(urlparse(value).scheme)


FORMAT_CHECKER = jsonschema.FormatChecker()
FORMAT_CHECKER.checks("date-time")(_is_rfc3339)
FORMAT_CHECKER.checks("uri")(_is_uri)


class RawFixturesTest(unittest.TestCase):
    """AC-1: le risposte grezze sono complete per le due località."""

    def test_marine_fixtures_have_hourly_series(self) -> None:
        for slug in LOCATIONS:
            with self.subTest(location=slug):
                path = FIXTURES / f"open_meteo_marine_{slug}.json"
                payload = load_json(path)
                self.assertIn("hourly", payload)
                times = payload["hourly"].get("time")
                self.assertIsInstance(times, list)
                self.assertGreater(len(times), 0)
                for variable in MARINE_HOURLY:
                    self.assertIn(variable, payload["hourly"])
                    self.assertEqual(len(times), len(payload["hourly"][variable]))

    def test_weather_fixtures_have_hourly_and_daily_series(self) -> None:
        for slug in LOCATIONS:
            with self.subTest(location=slug):
                path = FIXTURES / f"open_meteo_weather_{slug}.json"
                payload = load_json(path)
                self.assertIn("hourly", payload)
                self.assertIn("daily", payload)
                times = payload["hourly"].get("time")
                self.assertIsInstance(times, list)
                self.assertGreater(len(times), 0)
                for variable in WEATHER_HOURLY:
                    self.assertIn(variable, payload["hourly"])
                    self.assertEqual(len(times), len(payload["hourly"][variable]))
                days = payload["daily"].get("time")
                self.assertIsInstance(days, list)
                self.assertGreater(len(days), 0)
                for variable in WEATHER_DAILY:
                    self.assertIn(variable, payload["daily"])
                    self.assertEqual(len(days), len(payload["daily"][variable]))

    def test_fixtures_use_rome_timezone(self) -> None:
        for slug in LOCATIONS:
            for kind in ("marine", "weather"):
                with self.subTest(location=slug, source=kind):
                    payload = load_json(FIXTURES / f"open_meteo_{kind}_{slug}.json")
                    self.assertEqual("Europe/Rome", payload["timezone"])


class GoldenContractTest(unittest.TestCase):
    """AC-2, AC-3, AC-4: golden, schema e coerenza con l'endpoint."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = load_json(SCHEMA_PATH)
        cls.cache = load_json(CACHE_PATH)
        cls.forecast = load_json(FORECAST_PATH)
        jsonschema.Draft202012Validator.check_schema(cls.schema)

    def validate(self, instance: dict[str, Any]) -> list[str]:
        validator = jsonschema.Draft202012Validator(
            self.schema, format_checker=FORMAT_CHECKER
        )
        return [
            f"{list(error.absolute_path)}: {error.message}"
            for error in sorted(validator.iter_errors(instance), key=str)
        ]

    def test_schema_is_draft_2020_12_and_freezes_version_one(self) -> None:
        self.assertEqual(
            "https://json-schema.org/draft/2020-12/schema", self.schema["$schema"]
        )
        self.assertEqual(1, self.schema["properties"]["schema_version"]["const"])

    def test_validator_rejects_malformed_generated_at(self) -> None:
        """`format: date-time` è applicato davvero: un timestamp non RFC 3339 è rifiutato."""

        instance = {
            "schema_version": 1,
            "generated_at": "19/10/2026 09:00",
            "updated_locations": [],
            "errors": {},
            "locations": {},
        }
        errors = self.validate(instance)
        self.assertTrue(any("date-time" in error for error in errors), errors)

    def test_validator_rejects_malformed_source_uri(self) -> None:
        """`format: uri` è applicato davvero: un endpoint senza schema è rifiutato."""

        forecast = copy.deepcopy(self.forecast)
        forecast["sources"]["sea"]["endpoint"] = "marine-api"
        wrapper = {
            "schema_version": 1,
            "generated_at": self.forecast["generated_at"],
            "updated_locations": [TORRE_SLUG],
            "errors": {},
            "locations": {TORRE_SLUG: forecast},
        }
        errors = self.validate(wrapper)
        self.assertTrue(any("uri" in error for error in errors), errors)

    def test_golden_cache_matches_schema(self) -> None:
        self.assertEqual([], self.validate(self.cache))

    def test_golden_forecast_matches_schema(self) -> None:
        wrapper = {
            "schema_version": 1,
            "generated_at": self.forecast["generated_at"],
            "updated_locations": [TORRE_SLUG],
            "errors": {},
            "locations": {TORRE_SLUG: self.forecast},
        }
        self.assertEqual([], self.validate(wrapper))

    def test_golden_forecast_is_the_cache_entry(self) -> None:
        self.assertEqual(self.cache["locations"][TORRE_SLUG], self.forecast)
        self.assertEqual(TORRE_SLUG, self.forecast["location"]["slug"])
        self.assertGreaterEqual(len(self.forecast["daily"]), 1)

    def test_cache_contains_both_fixture_locations(self) -> None:
        self.assertEqual(
            sorted(LOCATIONS), sorted(self.cache["locations"].keys())
        )
        self.assertEqual(sorted(LOCATIONS), self.cache["updated_locations"])
        self.assertEqual({}, self.cache["errors"])

    def test_golden_daily_blocks_have_contract_fields(self) -> None:
        sea_fields = set(self.schema["$defs"]["sea"]["required"])
        weather_fields = set(self.schema["$defs"]["weather"]["required"])
        for day in self.forecast["daily"]:
            self.assertTrue(sea_fields.issubset(day["sea"]))
            self.assertTrue(weather_fields.issubset(day["weather"]))
            self.assertIsInstance(day["sea"]["wave_direction_name"], str)
            self.assertIsInstance(day["sea"]["state"], str)
            self.assertIsInstance(day["weather"]["wind_name"], str)


class GoldenBackendContractTest(unittest.IsolatedAsyncioTestCase):
    """AC-2: il golden è esattamente il corpo restituito da /forecast."""

    async def test_forecast_endpoint_returns_golden_payload(self) -> None:
        app = create_app(CACHE_PATH)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get(
                "/forecast", params={"localita": "torre-dei-corsari"}
            )
        self.assertEqual(200, response.status_code)
        self.assertEqual(load_json(FORECAST_PATH), response.json())


if __name__ == "__main__":
    unittest.main()
