"""Catalogo centralizzato delle sorgenti dati operative.

Questo modulo e l'unico punto in cui sono dichiarati endpoint, variabili,
selezione del modello, attribuzione e condizioni d'uso dei provider esterni.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DataSource:
    id: str
    provider: str
    service: str
    endpoint: str
    documentation_url: str
    license_url: str
    attribution: str
    model_selection: str
    cell_selection: str
    hourly_variables: tuple[str, ...]
    daily_variables: tuple[str, ...] = ()

    def request_params(
        self,
        latitude: float,
        longitude: float,
        days: int,
        timezone_name: str,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": ",".join(self.hourly_variables),
            "timezone": timezone_name,
            "forecast_days": days,
            "cell_selection": self.cell_selection,
            "models": "best_match",
        }
        if self.daily_variables:
            params["daily"] = ",".join(self.daily_variables)
        return params

    def provenance(
        self,
        response: dict[str, Any],
        requested_latitude: float,
        requested_longitude: float,
        fetched_at: str,
    ) -> dict[str, Any]:
        cell: dict[str, Any] = {
            "latitude": response.get("latitude"),
            "longitude": response.get("longitude"),
        }
        if response.get("elevation") is not None:
            cell["elevation_m"] = response["elevation"]
        return {
            "id": self.id,
            "provider": self.provider,
            "service": self.service,
            "endpoint": self.endpoint,
            "model_selection": self.model_selection,
            "variables": {
                "hourly": list(self.hourly_variables),
                "daily": list(self.daily_variables),
            },
            "requested_coordinates": {
                "latitude": requested_latitude,
                "longitude": requested_longitude,
            },
            "resolved_cell": cell,
            "fetched_at": fetched_at,
            "attribution": self.attribution,
            "documentation_url": self.documentation_url,
            "license_url": self.license_url,
        }


MARINE_SOURCE = DataSource(
    id="open_meteo_marine",
    provider="Open-Meteo",
    service="Marine Weather API",
    endpoint="https://marine-api.open-meteo.com/v1/marine",
    documentation_url="https://open-meteo.com/en/docs/marine-weather-api",
    license_url="https://open-meteo.com/en/terms",
    attribution="Marine data by Open-Meteo.com",
    model_selection="best_match, scelto dinamicamente dal provider",
    cell_selection="sea",
    hourly_variables=(
        "wave_height",
        "wave_direction",
        "wave_period",
        "sea_surface_temperature",
    ),
)


WEATHER_SOURCE = DataSource(
    id="open_meteo_weather",
    provider="Open-Meteo",
    service="Weather Forecast API",
    endpoint="https://api.open-meteo.com/v1/forecast",
    documentation_url="https://open-meteo.com/en/docs",
    license_url="https://open-meteo.com/en/terms",
    attribution="Weather data by Open-Meteo.com",
    model_selection="best_match, scelto dinamicamente dal provider",
    cell_selection="land",
    hourly_variables=(
        "temperature_2m",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
    ),
    daily_variables=(
        "weather_code",
        "temperature_2m_min",
        "temperature_2m_max",
        "wind_speed_10m_max",
        "wind_gusts_10m_max",
    ),
)


DATA_SOURCES = (MARINE_SOURCE, WEATHER_SOURCE)
