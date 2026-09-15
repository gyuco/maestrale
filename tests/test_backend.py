import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import httpx

from backend.main import create_app, slugify


class BackendTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.cache = Path(self.temporary.name) / "forecasts.json"
        self.cache.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "errors": {},
                    "locations": {
                        "torre-dei-corsari": {
                            "location": {"slug": "torre-dei-corsari", "name": "Torre dei Corsari"},
                            "daily": [{"date": "2026-08-23", "sea": {"wave_height_mean_m": 0.6}}],
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        self.app = create_app(self.cache)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    async def request(self, path: str, **kwargs) -> httpx.Response:
        transport = httpx.ASGITransport(app=self.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get(path, **kwargs)

    async def test_health(self) -> None:
        response = await self.request("/health")
        self.assertEqual(200, response.status_code)
        self.assertEqual("ok", response.json()["status"])
        self.assertEqual(1, response.json()["locations"])

    async def test_forecast_by_name(self) -> None:
        response = await self.request("/forecast", params={"localita": "Torre dei Corsari"})
        self.assertEqual(200, response.status_code)
        self.assertEqual(0.6, response.json()["daily"][0]["sea"]["wave_height_mean_m"])

    async def test_unknown_location(self) -> None:
        response = await self.request("/forecast", params={"localita": "Atlantide"})
        self.assertEqual(404, response.status_code)

    def test_slugify_accents(self) -> None:
        self.assertEqual("santa-teresa", slugify("Santa Teresa"))


if __name__ == "__main__":
    unittest.main()
