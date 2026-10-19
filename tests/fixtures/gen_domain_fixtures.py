#!/usr/bin/env python3
"""Genera le fixture di domino della migrazione Worker (E01-S02).

Uso:

    python3 tests/fixtures/gen_domain_fixtures.py

I valori sono prodotti dal **codice Python reale** (la baseline), non scritti a
mano:

- ``slug_cases.json`` — ``input``/``expected`` per ``backend.main.slugify``.
- ``request_params.json`` — i parametri di ``MARINE_SOURCE.request_params`` e
  ``WEATHER_SOURCE.request_params`` per la località di riferimento, con lo
  stesso ordine di chiavi che il Worker deve riprodurre.

I test TypeScript (``worker/test/slugify.test.ts`` e
``worker/test/data_sources.test.ts``) confrontano i port con queste fixture: se
il dominio Python cambia, rigenerare e verificare.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import slugify  # noqa: E402
from data_sources import MARINE_SOURCE, WEATHER_SOURCE  # noqa: E402

FIXTURES = Path(__file__).resolve().parent

# Località di riferimento: è quella del golden /forecast di E01-S00.
REFERENCE = {"slug": "torre-dei-corsari", "latitude": 39.688153, "longitude": 8.450613}
DAYS = 7
TIMEZONE = "Europe/Rome"

# Casi scelti per coprire i comportamenti non ovvi di ``slugify``:
# apostrofi, accenti scomponibili (NFKD) e no, spazi multipli/ai bordi, ``_``,
# caratteri non-ASCII eliminati del tutto, stringhe vuote o di soli spazi.
SLUG_INPUTS: tuple[str, ...] = (
    "Santa Teresa",
    "Torre dei Corsari",
    "Cagliari",
    "La Maddalena",
    "Porto Torres",
    "Sant'Antioco",
    "Cagliarì",
    "  Chia  ",
    "Porto_Torres",
    "FOO_BAR baz",
    "A  B",
    "Città  Metropolitana",
    "12 Ètà 3",
    "Żebbuġ",
    "Chia\tPiana\nSud",
    "A\x1cB",
    "foo_",
    "under__score",
    "Łeba",
    "Ørsted",
    "\u2126 ohm",
    "Œuvre",
    "San Teodoro (OT)",
    "",
    "   ",
)


def slug_cases() -> dict[str, Any]:
    return {
        "description": "Casi di slugify generati da backend.main.slugify (E01-S02).",
        "cases": [{"input": value, "expected": slugify(value)} for value in SLUG_INPUTS],
    }


def request_params() -> dict[str, Any]:
    latitude = float(REFERENCE["latitude"])
    longitude = float(REFERENCE["longitude"])
    return {
        "description": (
            "Parametri di data_sources.py per la località di riferimento "
            "(stesse chiavi, stesso ordine)."
        ),
        "case": {
            "slug": REFERENCE["slug"],
            "latitude": latitude,
            "longitude": longitude,
            "days": DAYS,
            "timezone": TIMEZONE,
        },
        "marine": MARINE_SOURCE.request_params(latitude, longitude, DAYS, TIMEZONE),
        "weather": WEATHER_SOURCE.request_params(latitude, longitude, DAYS, TIMEZONE),
    }


def write(name: str, payload: dict[str, Any]) -> None:
    path = FIXTURES / name
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Scritto {path}")


def main() -> None:
    write("slug_cases.json", slug_cases())
    write("request_params.json", request_params())


if __name__ == "__main__":
    main()
