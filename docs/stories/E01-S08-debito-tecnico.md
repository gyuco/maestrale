---
id: E01-S08
epic: E01
title: "Debito tecnico dalle review di S00/S01"
type: chore
status: done
requirements: [FR-50, NFR-13]
depends_on: [E01-S00, E01-S01]
verify:
  - python3 -m unittest discover -s tests -v
  - git check-ignore -v worker/.dev.vars
---

# E01-S08: Debito tecnico dalle review di S00/S01

## Context

Le review di E01-S00 e E01-S01 hanno lasciato aperto un piccolo debito tecnico, tutto
documentale o di test: nessuna modifica al backend Python operativo (`backend/`,
`previsioni_mare.py`, `update_forecasts.py`, `data_sources.py`), a `worker/src/**` o alle
dipendenze.

Interventi richiesti:

1. **`tests/test_fixtures.py`** — la validazione JSON Schema non passa un `format_checker`, quindi
   i `format: date-time` / `format: uri` di `tests/fixtures/forecast.schema.json` sono
   **ignorati**: il test verde non garantisce che i golden rispettino davvero quei vincoli.
   Va scelta e motivata una delle due strade: rendere operativo il `format_checker` (draft
   2020-12) oppure rimuovere i `format` dallo schema.
2. **`tests/fixtures/README.md`** — documentare che l'elenco località coperto e
   `timezone=Europe/Rome` sono un **pin intenzionale** delle fixture (non il catalogo completo,
   che ha 13 località), e che `location.slug` è aggiunto da `update_forecasts.py` e **non** da
   `build_forecast`.
3. **`worker/README.md`** — l'output di `wrangler kv namespace create` è mostrato in TOML
   (`[[kv_namespaces]]`) ma il progetto usa `wrangler.jsonc`: correggere gli esempi in JSONC.
4. **`.gitignore` (root)** — aggiungere `worker/.dev.vars` (segreti locali Wrangler).
5. **`worker/vitest.config.ts`** — lasciare un TODO commentato che rimanda a E01-S08 per la
   migrazione da `@cloudflare/vitest-pool-workers` a `@cloudflare/vitest-plugin`, motivandola
   (la `compatibility_date` è limitata dal `workerd` incluso nel pool, oggi max `2026-08-22`).
   **Non migrare ora.**

Fuori scope: refactor di `tests/fixtures/regenerate.py` (R-1/S00, verrà rimosso in E01-S07),
modifiche a `worker/src/**`, alle dipendenze e al backend Python operativo.

## Acceptance criteria

- **AC-1** — `tests/test_fixtures.py` valida davvero `format: date-time` e `format: uri` (oppure
  lo schema non li dichiara più), e un test dimostra che un payload con timestamp/URI malformato
  viene rifiutato. I golden attuali restano verdi.
- **AC-2** — `tests/fixtures/README.md` spiega che località e `timezone=Europe/Rome` sono un pin
  intenzionale e che `location.slug` è aggiunto da `update_forecasts.py`, non da `build_forecast`.
- **AC-3** — `worker/README.md` mostra il frammento KV in JSONC (niente `[[kv_namespaces]]` TOML).
- **AC-4** — `.gitignore` ignora `worker/.dev.vars`.
- **AC-5** — `worker/vitest.config.ts` contiene un TODO verso E01-S08 con la motivazione del
  rinvio della migrazione a `@cloudflare/vitest-plugin`; nessuna migrazione eseguita.
- **AC-6** — `python3 -m unittest discover -s tests -v` è verde (17 test + quelli aggiunti).

## Tasks

- [x] Scrivere i test che dimostrano il buco dei `format` e vederli fallire
- [x] Implementare `format_checker` (o rimuovere i `format`) e rendere verdi i test
- [x] Aggiornare `tests/fixtures/README.md`
- [x] Correggere gli esempi TOML → JSONC in `worker/README.md`
- [x] Aggiungere `worker/.dev.vars` a `.gitignore`
- [x] TODO migrazione plugin in `worker/vitest.config.ts`
- [x] Eseguire tutti i comandi di `verify:`

## Dev notes

**File modificati**

- `tests/test_fixtures.py` — `format_checker` operativo + 2 test nuovi (19 totali).
- `tests/fixtures/README.md` — pin di località/fuso e provenienza di `location.slug`.
- `worker/README.md` — frammento KV in JSONC.
- `worker/vitest.config.ts` — TODO migrazione plugin (solo commento).
- `.gitignore` — `worker/.dev.vars`.
- `docs/stories/E01-S08-debito-tecnico.md` — questa storia.

**Decisione sui `format` (AC-1): rendere operativo il `format_checker`, conservando i `format`**

Ho scartato la rimozione dei `format` dallo schema: `date-time`/`uri` sono il contratto
condiviso con il Worker TypeScript (dove i validatori — `ajv-formats`, Zod — li supportano
nativamente) e sostituirli con `pattern` avrebbe depotenziato lo schema. Il problema era solo che
il test Python non li applicava, quindi verde "falso".

Il dettaglio che decide l'implementazione: `jsonschema` **non** installa di default i checker dei
`format` extra; con solo `format_checker=Draft202012Validator.FORMAT_CHECKER` i `format`
`date-time` e `uri` resterebbero **comunque ignorati** (formato sconosciuto ⇒ nessun errore),
perché l'extra `jsonschema[format]` (`rfc3339-validator`, `rfc3986-validator`) non è in
`requirements-dev.txt` e aggiungere dipendenze è fuori scope. Ho quindi costruito un
`FormatChecker` con due checker equivalenti in sola libreria standard:

- `date-time` → regex RFC 3339 (separatore `T`/spazio, secondi, offset `Z`/`±hh:mm`) **più**
  `datetime.fromisoformat` per la validità del calendario (rifiuta `2026-13-45`, e rifiuta una
  data senza orario, che `fromisoformat` invece accetterebbe).
- `uri` → `urllib.parse.urlparse(...).scheme` non vuoto.

I `format` restano quindi dichiarati **e** verificati; i due test nuovi
(`test_validator_rejects_malformed_generated_at`, `test_validator_rejects_malformed_source_uri`)
dimostrano che il checker non è vacuo (prima dell'implementazione fallivano con `errors == []`).

**Perché la migrazione del plugin è rinviata (AC-5)**

`@cloudflare/vitest-pool-workers` 0.23.0 trascina un `workerd` che supporta al massimo la
`compatibility_date` `2026-08-22`: è lo stesso vincolo già annotato in `wrangler.jsonc` e nel
`worker/README.md`. Migrare a `@cloudflare/vitest-plugin` (codemod ufficiale
`vitest:pool-workers-to-vitest-plugin`) è un cambio di dipendenza e di configurazione di test:
non è il debito "documentale" di questa storia e va fatto insieme all'aggiornamento della
`compatibility_date`. Qui ho solo lasciato il TODO puntato a E01-S08 in `vitest.config.ts`,
senza toccare dipendenze o impostazioni.

**Deviazioni / note**

- `docs/stories/_template.md` non esiste in questo worktree (presente solo nella worktree
  parallela `cloudflare-migration`, non toccata). La storia è stata scritta con la stessa
  struttura/frontmatter di E01-S00/E01-S01.
- `type: chore` (il template elenca `feature|quick|bug`): è manutenzione senza nuova
  funzionalità, coerente con lo scope "debito tecnico".
- Nessuna modifica a `worker/src/**`, dipendenze, backend Python operativo o
  `tests/fixtures/regenerate.py` (rimandato a E01-S07).

**Verifica**

```bash
python3 -m unittest discover -s tests -v   # Ran 19 tests — OK (17 preesistenti + 2 nuovi)
git check-ignore -v worker/.dev.vars       # .gitignore:14:worker/.dev.vars
```

`cd worker && npm test` **non eseguito**: in questa worktree `worker/node_modules/` non esiste e
il vincolo della storia è di non installare nulla di nuovo. Le modifiche a `worker/` sono un
commento in `vitest.config.ts` e testo in `README.md`, senza effetto sul codice dei test.

## Run log

| Iterazione | Comando | Esito | Note |
|---|---|---|---|
| 1 | `python3 -m unittest discover -s tests -p test_fixtures.py -v` (test nuovi, `format_checker` assente) | rosso | 2 failure: `AssertionError: []` — i `format` erano ignorati (ragione giusta) |
| 1 | `python3 -m unittest discover -s tests -v` | verde | Ran 19 tests — OK |
| 1 | `git check-ignore -v worker/.dev.vars` | verde | `.gitignore:14` |

## Review log

### 2026-10-19 — Reviewer — Verdetto: done

Verify rieseguiti: `python3 -m unittest discover -s tests -v` → Ran 19 tests — OK (17 preesistenti + 2
nuovi); nessun warning di deprecazione con `-W error::DeprecationWarning`; `git check-ignore -v
worker/.dev.vars` → `.gitignore:14`; `git diff 8194514^..8194514` limitato ai 6 file attesi.

`format_checker` dimostrato non vacuo: con payload negativo produce i 2 errori attesi, mentre
`Draft202012Validator.FORMAT_CHECKER` e l'assenza di checker producono `[]` (conferma che i validator
extra non sono installati). Golden reali → nessun falso rosso. Nessuna riga rimossa da
`tests/test_fixtures.py`: i 17 test preesistenti non sono indeboliti.

- R-1 (nit) `tests/test_fixtures.py:72-73,80-81,89-92` — `_RFC3339_RE` accetta il separatore spazio;
  `_is_rfc3339` restituisce `False` per i non-string mentre `_is_uri` restituisce `True`. Nessun impatto
  sui golden.
- R-2 (nit) `worker/README.md:62-68` — lo snippet JSONC mostra solo `"id"` ma `wrangler.jsonc` ha anche
  `preview_id` (il passo 3 lo copre). Non è una regressione.
- R-3 (should, non bloccante) `docs/stories/E01-S08-debito-tecnico.md:5` — `type: chore` è fuori
  dall'enum del template (`feature | quick | bug`); nessun tooling lo valida. Fix: usare `feature` o
  estendere l'enum.

`npm test` non eseguito: in `worker/` sono cambiati solo un commento in `vitest.config.ts` e il README,
nessuna modifica a `src/`, dipendenze o binding (rischio residuo trascurabile).
