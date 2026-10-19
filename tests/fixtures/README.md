# Fixtures della baseline (E01-S00)

Artefatti congelati dell'implementazione Python, usati come riferimento per la
migrazione a Cloudflare Workers. Vivono qui (e non in `data/`) perché
`data/*.json` è in `.gitignore`.

## File

| File | Cosa contiene |
|---|---|
| `open_meteo_marine_<slug>.json` | Risposta grezza Open-Meteo Marine per la località |
| `open_meteo_weather_<slug>.json` | Risposta grezza Open-Meteo Weather per la località |
| `golden_forecasts.json` | Snapshot del cache prodotto da `update_forecasts.py` (`schema_version: 1`) |
| `golden_forecast_torre-dei-corsari.json` | Esattamente il corpo restituito da `GET /forecast?localita=torre-dei-corsari` |
| `forecast.schema.json` | JSON Schema draft 2020-12 del payload (contratto congelato) |
| `regenerate.py` | Script che ricrea fixture e golden |

Località coperte: `torre-dei-corsari`, `cagliari`.

Le richieste grezze usano gli stessi parametri di `data_sources.py`
(`hourly`/`daily`, `timezone=Europe/Rome`, `forecast_days=7`,
`cell_selection=sea|land`, `models=best_match`).

I campi `generated_at` / `fetched_at` sono normalizzati a un valore fisso
(`2026-10-19T09:00:00+00:00`) così i golden restano riproducibili e il test di
contratto non dipende dal momento dello scaricamento.

## Rigenerare

```bash
# Ricostruisce i golden dalle fixture già committate (nessuna rete):
python3 tests/fixtures/regenerate.py

# Riscarica le risposte reali da Open-Meteo e poi ricostruisce i golden:
python3 tests/fixtures/regenerate.py --fetch

# Verifica:
python3 -m unittest discover -s tests -v
```

Quando si riscarica con `--fetch` conviene rieseguire i test e, se lo schema non
valida più, verificare se il provider o l'aggregazione sono cambiati.
