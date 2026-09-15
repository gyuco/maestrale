from __future__ import annotations

import json
import os
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE_PATH = ROOT / "data" / "forecasts.json"


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return "-".join(normalized.lower().strip().split()).replace("_", "-")


class ForecastStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._mtime_ns: int | None = None
        self._payload: dict[str, Any] | None = None

    def read(self) -> dict[str, Any] | None:
        try:
            mtime_ns = self.path.stat().st_mtime_ns
        except FileNotFoundError:
            return None
        with self._lock:
            if self._payload is None or self._mtime_ns != mtime_ns:
                try:
                    with self.path.open(encoding="utf-8") as source:
                        self._payload = json.load(source)
                except (OSError, json.JSONDecodeError) as exc:
                    raise RuntimeError(f"Cache forecast non leggibile: {exc}") from exc
                self._mtime_ns = mtime_ns
            return self._payload


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def create_app(cache_path: Path | None = None) -> FastAPI:
    app = FastAPI(
        title="Sardegna Mare API",
        version="0.1.0",
        description="Forecast marini e meteorologici giornalieri per localita costiere.",
    )
    path = cache_path or Path(os.getenv("FORECAST_CACHE_PATH", DEFAULT_CACHE_PATH))
    app.state.forecast_store = ForecastStore(path)
    max_age_hours = float(os.getenv("FORECAST_MAX_AGE_HOURS", "12"))

    origins = [item.strip() for item in os.getenv("CORS_ORIGINS", "*").split(",") if item.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, Any]:
        try:
            payload = app.state.forecast_store.read()
        except RuntimeError as exc:
            return {"status": "degraded", "error": str(exc), "cache_path": str(path)}
        if payload is None:
            return {
                "status": "degraded",
                "error": "Cache forecast non ancora generato",
                "cache_path": str(path),
                "locations": 0,
            }
        generated_at = parse_utc(payload.get("generated_at"))
        age_hours = (
            (datetime.now(timezone.utc) - generated_at).total_seconds() / 3600
            if generated_at
            else None
        )
        stale = age_hours is None or age_hours > max_age_hours
        errors = payload.get("errors", {})
        return {
            "status": "degraded" if stale or errors else "ok",
            "generated_at": payload.get("generated_at"),
            "age_hours": round(age_hours, 2) if age_hours is not None else None,
            "stale": stale,
            "locations": len(payload.get("locations", {})),
            "update_errors": errors,
        }

    @app.get("/forecast", tags=["forecast"])
    def forecast(
        localita: Annotated[str, Query(min_length=1, description="Nome o slug della localita")],
    ) -> dict[str, Any]:
        try:
            payload = app.state.forecast_store.read()
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if payload is None:
            raise HTTPException(status_code=503, detail="Previsioni non ancora disponibili")
        locations = payload.get("locations", {})
        key = slugify(localita)
        result = locations.get(key)
        if result is None:
            for candidate in locations.values():
                if slugify(candidate.get("location", {}).get("name", "")) == key:
                    result = candidate
                    break
        if result is None:
            available = sorted(
                item.get("location", {}).get("name", slug) for slug, item in locations.items()
            )
            raise HTTPException(
                status_code=404,
                detail={"message": f"Localita '{localita}' non trovata", "available": available},
            )
        return result

    return app


app = create_app()
