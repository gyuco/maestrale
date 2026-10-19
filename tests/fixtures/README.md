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

**L'elenco delle località è un pin intenzionale delle fixture.** Il catalogo operativo
(`locations.json`) contiene 13 località, ma le fixture ne coprono solo due (la più "ricca" come
celle mare/terra e una seconda per esercitare la logica multi-località). I golden contengono
l'intero cache e i test lo confrontano con essi: cambiare il catalogo delle fixture
richiederebbe di rigenerare i golden, quindi il sottoinsieme è fissato qui, non derivato dal
catalogo.

Anche `timezone=Europe/Rome` è un **pin intenzionale**: è il default del modulo operativo
(`DEFAULT_TIMEZONE` in `previsioni_mare.py`) e il valore passato esplicitamente da
`update_forecasts.py`; lo schema lo dichiara come `const`. Se la pipeline cambiasse fuso orario,
i golden andrebbero rigenerati.

`location.slug` **non** è prodotto da `build_forecast` (che restituisce solo `name`,
`latitude`, `longitude`, oltre a celle, fuso, `generated_at`, sources e daily):
è `update_forecasts.py` ad aggiungerlo dopo la chiamata
(`forecast["location"]["slug"] = location["slug"]`). Le fixture rappresentano quindi il payload
unito del job, non l'output del solo builder.

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
