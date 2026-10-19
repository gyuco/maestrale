#!/usr/bin/env python3
"""Genera le fixture della pipeline Worker (E01-S03).

Uso:

    python3 tests/fixtures/gen_pipeline_fixtures.py

I valori sono prodotti dal **codice Python reale** (la baseline), non scritti a
mano:

- ``round_cases.json`` — corpus ``{value, digits, expected}`` prodotto da
  ``round()`` di Python. Serve al port TS ``roundHalfEven``: ``round()`` è
  half-to-even sulla rappresentazione decimale del double (es. ``round(0.125, 2)
  == 0.12``, ``round(2.675, 2) == 2.67``), comportamento che i metodi JS comuni
  non riproducono.
- ``agg_cases.json`` — casi per ``mean``, ``circular_mean``, ``sea_state`` (tutti
  i confini Douglas/WMO) e ``direction_name`` (tutti i confini della rosa a 8
  settori), generati dalle funzioni di ``previsioni_mare.py``.
- ``request_urls.json`` — gli URL costruiti da ``urlencode`` sui parametri di
  ``data_sources.py``, per verificare la query string del port ``fetchJson``.

I dati sono deterministici (seed fisso): rigenerare produce byte identici.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import previsioni_mare  # noqa: E402
from data_sources import MARINE_SOURCE, WEATHER_SOURCE  # noqa: E402

FIXTURES = Path(__file__).resolve().parent

REFERENCE = {"latitude": 39.688153, "longitude": 8.450613}
DAYS = 7
TIMEZONE = "Europe/Rome"

# Valori scelti perché "al limite" per l'arrotondamento half-to-even: i tie
# esatti in binario (0.125 = 1/8) e i tie *decimali* che in binario non lo sono
# (2.675, 1.005 sono appena sotto/sopra), più i classici casi dei centesimi.
CRAFTED_ROUND_VALUES: tuple[float, ...] = (
    0.125,
    0.375,
    0.625,
    0.875,
    2.675,
    1.005,
    0.005,
    0.015,
    0.025,
    0.035,
    0.045,
    0.5,
    1.5,
    2.5,
    3.5,
    -0.125,
    -2.675,
    35.855,
    285.5,
    122.5,
    0.1,
    0.2,
    0.3,
    0.999999999,
    1234.5678,
    123456.5,
    1e15,
    1e-7,
    5e-324,
    -0.0,
    0.0,
)

FIXTURE_SLUGS = ("torre-dei-corsari", "cagliari")
FIXTURE_KINDS = ("marine", "weather")


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def round_cases() -> dict[str, Any]:
    """Corpus di ``round(value, digits)`` con seed fisso e deduplicazione."""

    random.seed(20261019)
    cases: list[dict[str, Any]] = []
    seen: set[tuple[float, int]] = set()

    def add(value: float, digits: int) -> None:
        key = (value, digits)
        if key in seen:
            return
        seen.add(key)
        cases.append({"value": value, "digits": digits, "expected": round(value, digits)})

    for value in CRAFTED_ROUND_VALUES:
        for digits in (0, 1, 2, 3, 4):
            add(value, digits)

    # Valori realistici presi dalle risposte grezze committate (onde, temperature,
    # vento, direzioni), arrotondati alle cifre effettivamente usate dal port.
    for slug in FIXTURE_SLUGS:
        for kind in FIXTURE_KINDS:
            payload = load_json(FIXTURES / f"open_meteo_{kind}_{slug}.json")
            for field, series in payload["hourly"].items():
                if field == "time":
                    continue
                for value in series:
                    if value is None:
                        continue
                    add(float(value), random.choice((0, 1, 2)))

    # Valori casuali su più ordini di grandezza, cifre 0..4.
    for _ in range(4000):
        magnitude = random.choice((1e-6, 1e-4, 1e-2, 1, 10, 100, 1000))
        add(random.uniform(-magnitude, magnitude), random.randint(0, 4))

    return {
        "description": (
            "Corpus {value, digits, expected} di round() di Python (E01-S03): "
            "verifica del port roundHalfEven del Worker."
        ),
        "cases": cases,
    }


def agg_cases() -> dict[str, Any]:
    mean_inputs: list[list[float | None]] = [
        [],
        [None],
        [None, None],
        [12.5],
        [1.0, 2.0, 3.0],
        [None, 1.0, None, 2.0],
        [-0.0],
        [10.0, 20.0, 30.0, 40.0],
        [-5.5, 5.5],
        [1e9, -1e9],
        [0.0, 0.0, 0.0],
    ]
    circular_inputs: list[list[float | None]] = [
        [],
        [None],
        [0.0, 90.0, 180.0, 270.0],
        [350.0, 10.0],
        [359.0, 1.0],
        [None, 45.0, None],
        [0.0, 180.0],
        [90.0, 270.0],
        [10.0, 20.0, 30.0],
        [337.5, 22.5],
        [180.0, 0.0, 90.0],
    ]
    sea_state_inputs: list[float | None] = [
        None,
        -5.0,
        -0.001,
        0.0,
        0.05,
        0.1,
        0.1000001,
        0.5,
        0.5000001,
        1.25,
        1.2500001,
        2.5,
        2.5000001,
        4.0,
        4.0000001,
        6.0,
        6.0000001,
        9.0,
        9.0000001,
        14.0,
        14.0000001,
        20.0,
        100.0,
    ]
    direction_name_inputs: list[float | None] = [
        None,
        0.0,
        22.4,
        22.5,
        22.5000001,
        44.999,
        45.0,
        67.4,
        67.5,
        90.0,
        112.4,
        112.5,
        135.0,
        157.5,
        180.0,
        202.5,
        225.0,
        247.5,
        270.0,
        292.5,
        315.0,
        337.4,
        337.5,
        359.9,
        360.0,
        359.999,
        -0.1,
        -22.5,
        -45.0,
        720.5,
        1080.25,
    ]

    return {
        "description": (
            "Casi di mean/circular_mean/sea_state/direction_name generati da "
            "previsioni_mare.py (E01-S03)."
        ),
        "mean": [
            {"input": values, "expected": previsioni_mare.mean(values)}
            for values in mean_inputs
        ],
        "circular_mean": [
            {"input": values, "expected": previsioni_mare.circular_mean(values)}
            for values in circular_inputs
        ],
        "sea_state": [
            {"input": value, "expected": previsioni_mare.sea_state(value)}
            for value in sea_state_inputs
        ],
        "direction_name": [
            {"input": value, "expected": previsioni_mare.direction_name(value)}
            for value in direction_name_inputs
        ],
    }


def request_urls() -> dict[str, Any]:
    latitude = float(REFERENCE["latitude"])
    longitude = float(REFERENCE["longitude"])
    return {
        "description": (
            "URL costruiti con urlencode() sui parametri di data_sources.py "
            "(E01-S03): verifica della query string del port fetchJson."
        ),
        "marine": f"{MARINE_SOURCE.endpoint}?"
        f"{urlencode(MARINE_SOURCE.request_params(latitude, longitude, DAYS, TIMEZONE))}",
        "weather": f"{WEATHER_SOURCE.endpoint}?"
        f"{urlencode(WEATHER_SOURCE.request_params(latitude, longitude, DAYS, TIMEZONE))}",
    }


def write(name: str, payload: dict[str, Any]) -> None:
    path = FIXTURES / name
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Scritto {path}")


def main() -> None:
    write("round_cases.json", round_cases())
    write("agg_cases.json", agg_cases())
    write("request_urls.json", request_urls())


if __name__ == "__main__":
    main()
