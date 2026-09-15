import unittest

from data_sources import MARINE_SOURCE, WEATHER_SOURCE


class DataSourcesTest(unittest.TestCase):
    def test_marine_request_prefers_sea_cell(self) -> None:
        params = MARINE_SOURCE.request_params(39.68, 8.45, 7, "Europe/Rome")
        self.assertEqual("sea", params["cell_selection"])
        self.assertIn("wave_height", params["hourly"])

    def test_weather_request_prefers_land_cell(self) -> None:
        params = WEATHER_SOURCE.request_params(39.68, 8.45, 7, "Europe/Rome")
        self.assertEqual("land", params["cell_selection"])
        self.assertIn("temperature_2m_min", params["daily"])

    def test_provenance_contains_resolved_cell_and_license(self) -> None:
        source = MARINE_SOURCE.provenance(
            {"latitude": 39.7, "longitude": 8.46}, 39.68, 8.45, "2026-08-23T10:00:00Z"
        )
        self.assertEqual("Open-Meteo", source["provider"])
        self.assertEqual(39.7, source["resolved_cell"]["latitude"])
        self.assertTrue(source["license_url"].startswith("https://"))


if __name__ == "__main__":
    unittest.main()
