#!/usr/bin/env python3
"""Previsioni marine e meteo giornaliere per una localita costiera.

Lo script interroga Open-Meteo Marine per onde e temperatura superficiale
dell'acqua e Open-Meteo Weather per temperatura dell'aria e vento. I valori
giornalieri sono calcolati dalle serie orarie; minima e massima dell'aria sono
quelle giornaliere restituite dal servizio.

Per impostazione predefinita usa le coordinate della spiaggia di Torre dei
Corsari. Esempi:

    python previsioni_mare.py
    python previsioni_mare.py --json
    python previsioni_mare.py --output forecast.json --json
    python previsioni_mare.py --name Cagliari --latitude 39.17 --longitude 9.15
"""

from __future__ import annotations

import argparse
import json
import math
import os
import ssl
import tempfile
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from data_sources import MARINE_SOURCE, WEATHER_SOURCE

DEFAULT_NAME = "Torre dei Corsari"
DEFAULT_LATITUDE = 39.688153
DEFAULT_LONGITUDE = 8.450613
DEFAULT_TIMEZONE = "Europe/Rome"


def ssl_context() -> ssl.SSLContext:
    """Usa certifi quando presente, altrimenti i certificati di sistema."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def fetch_json(base_url: str, params: dict[str, Any], retries: int = 3) -> dict[str, Any]:
    """Scarica e valida una risposta JSON, con retry progressivo."""
    url = f"{base_url}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": "copernicus-sea-app/0.1"})
    last_error: Exception | None = None

    for attempt in range(retries):
        try:
            with urlopen(request, timeout=30, context=ssl_context()) as response:
                payload = json.load(response)
            if payload.get("error"):
                raise RuntimeError(payload.get("reason", "Errore API sconosciuto"))
            return payload
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(2**attempt)

    raise RuntimeError(f"Impossibile consultare {base_url}: {last_error}")


def valid_numbers(values: Iterable[float | None]) -> list[float]:
    return [float(value) for value in values if value is not None and math.isfinite(value)]


def mean(values: Iterable[float | None]) -> float | None:
    numbers = valid_numbers(values)
    return sum(numbers) / len(numbers) if numbers else None


def circular_mean(values: Iterable[float | None]) -> float | None:
    """Media circolare di direzioni meteorologiche espresse in gradi."""
    numbers = valid_numbers(values)
    if not numbers:
        return None
    sine = sum(math.sin(math.radians(value)) for value in numbers) / len(numbers)
    cosine = sum(math.cos(math.radians(value)) for value in numbers) / len(numbers)
    return math.degrees(math.atan2(sine, cosine)) % 360


def rounded(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None else None


def sea_state(wave_height: float | None) -> str | None:
    """Classificazione Douglas/WMO dall'altezza significativa media."""
    if wave_height is None:
        return None
    limits = (
        (0.0, "Calmo"),
        (0.1, "Quasi calmo"),
        (0.5, "Poco mosso"),
        (1.25, "Mosso"),
        (2.5, "Molto mosso"),
        (4.0, "Agitato"),
        (6.0, "Molto agitato"),
        (9.0, "Grosso"),
        (14.0, "Molto grosso"),
    )
    for upper_bound, label in limits:
        if wave_height <= upper_bound:
            return label
    return "Tempestoso"


def direction_name(degrees: float | None) -> str | None:
    if degrees is None:
        return None
    names = (
        "Tramontana",
        "Grecale",
        "Levante",
        "Scirocco",
        "Ostro",
        "Libeccio",
        "Ponente",
        "Maestrale",
    )
    return names[int((degrees + 22.5) // 45) % 8]


def hourly_by_date(payload: dict[str, Any], fields: list[str]) -> dict[str, dict[str, list[Any]]]:
    hourly = payload["hourly"]
    grouped: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(list))
    for index, timestamp in enumerate(hourly["time"]):
        date = timestamp[:10]
        for field in fields:
            grouped[date][field].append(hourly[field][index])
    return grouped


def daily_lookup(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    daily = payload["daily"]
    result: dict[str, dict[str, Any]] = {}
    for index, date in enumerate(daily["time"]):
        result[date] = {
            field: values[index]
            for field, values in daily.items()
            if field != "time"
        }
    return result


def build_forecast(
    name: str,
    latitude: float,
    longitude: float,
    days: int,
    timezone_name: str,
) -> dict[str, Any]:
    marine_fields = list(MARINE_SOURCE.hourly_variables)
    weather_fields = list(WEATHER_SOURCE.hourly_variables)

    marine = fetch_json(
        MARINE_SOURCE.endpoint,
        MARINE_SOURCE.request_params(latitude, longitude, days, timezone_name),
    )
    marine_fetched_at = datetime.now(timezone.utc).isoformat()
    weather = fetch_json(
        WEATHER_SOURCE.endpoint,
        WEATHER_SOURCE.request_params(latitude, longitude, days, timezone_name),
    )
    weather_fetched_at = datetime.now(timezone.utc).isoformat()

    marine_days = hourly_by_date(marine, marine_fields)
    weather_days = hourly_by_date(weather, weather_fields)
    official_daily = daily_lookup(weather)
    common_dates = sorted(set(marine_days) & set(weather_days) & set(official_daily))

    forecasts = []
    for date in common_dates[:days]:
        sea = marine_days[date]
        air = weather_days[date]
        wave_height_mean = mean(sea["wave_height"])
        wave_direction_mean = circular_mean(sea["wave_direction"])
        wind_direction_mean = circular_mean(air["wind_direction_10m"])
        daily = official_daily[date]

        forecasts.append(
            {
                "date": date,
                "sea": {
                    "state": sea_state(wave_height_mean),
                    "wave_height_mean_m": rounded(wave_height_mean),
                    "wave_height_max_m": rounded(max(valid_numbers(sea["wave_height"])), 2),
                    "wave_period_mean_s": rounded(mean(sea["wave_period"])),
                    "wave_direction_mean_deg": rounded(wave_direction_mean, 0),
                    "wave_direction_name": direction_name(wave_direction_mean),
                    "water_temperature_mean_c": rounded(mean(sea["sea_surface_temperature"]), 1),
                },
                "weather": {
                    "air_temperature_mean_c": rounded(mean(air["temperature_2m"]), 1),
                    "air_temperature_min_c": daily["temperature_2m_min"],
                    "air_temperature_max_c": daily["temperature_2m_max"],
                    "weather_code": daily["weather_code"],
                    "wind_speed_mean_kmh": rounded(mean(air["wind_speed_10m"]), 1),
                    "wind_speed_max_kmh": daily["wind_speed_10m_max"],
                    "wind_gust_mean_kmh": rounded(mean(air["wind_gusts_10m"]), 1),
                    "wind_gust_max_kmh": daily["wind_gusts_10m_max"],
                    "wind_direction_mean_deg": rounded(wind_direction_mean, 0),
                    "wind_name": direction_name(wind_direction_mean),
                },
            }
        )

    return {
        "location": {
            "name": name,
            "latitude": latitude,
            "longitude": longitude,
        },
        "cells": {
            "marine": {
                "latitude": marine["latitude"],
                "longitude": marine["longitude"],
            },
            "weather": {
                "latitude": weather["latitude"],
                "longitude": weather["longitude"],
                "elevation_m": weather.get("elevation"),
            },
        },
        "timezone": timezone_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "sea": MARINE_SOURCE.provenance(
                marine, latitude, longitude, marine_fetched_at
            ),
            "weather": WEATHER_SOURCE.provenance(
                weather, latitude, longitude, weather_fetched_at
            ),
        },
        "daily": forecasts,
    }


def print_table(forecast: dict[str, Any]) -> None:
    location = forecast["location"]
    print(f"\n{location['name']} ({location['latitude']:.6f}, {location['longitude']:.6f})")
    print(f"Aggiornato: {forecast['generated_at']}\n")
    header = (
        f"{'Data':<10} {'Stato mare':<14} {'Onda media/max':<16} "
        f"{'Acqua':<7} {'Aria min/max':<14} {'Vento medio':<24} {'Raffica max':<11}"
    )
    print(header)
    print("-" * len(header))
    for day in forecast["daily"]:
        sea = day["sea"]
        weather = day["weather"]
        wave = f"{sea['wave_height_mean_m']:.2f}/{sea['wave_height_max_m']:.2f} m"
        water = f"{sea['water_temperature_mean_c']:.1f} C"
        air = f"{weather['air_temperature_min_c']:.1f}/{weather['air_temperature_max_c']:.1f} C"
        wind = (
            f"{weather['wind_name']} "
            f"{weather['wind_speed_mean_kmh']:.1f} km/h"
        )
        gust = f"{weather['wind_gust_max_kmh']:.1f} km/h"
        print(
            f"{day['date']:<10} {sea['state']:<14} {wave:<16} "
            f"{water:<7} {air:<14} {wind:<24} {gust:<11}"
        )


def write_json_atomic(path: Path, forecast: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as temporary:
        json.dump(forecast, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default=DEFAULT_NAME)
    parser.add_argument("--latitude", type=float, default=DEFAULT_LATITUDE)
    parser.add_argument("--longitude", type=float, default=DEFAULT_LONGITUDE)
    parser.add_argument("--days", type=int, default=7, choices=range(1, 9))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--json", action="store_true", help="Stampa JSON su stdout.")
    parser.add_argument("--output", type=Path, help="Salva il JSON nel file indicato.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    forecast = build_forecast(
        args.name,
        args.latitude,
        args.longitude,
        args.days,
        args.timezone,
    )
    if args.output:
        write_json_atomic(args.output, forecast)
    if args.json:
        print(json.dumps(forecast, ensure_ascii=False, indent=2))
    else:
        print_table(forecast)
        if args.output:
            print(f"\nJSON salvato in: {args.output}")


if __name__ == "__main__":
    main()
