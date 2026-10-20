---
id: E04
title: "CI/CD: integrazione continua su GitHub Actions e deploy automatico del Worker"
status: planned
requirements: []
---

# E04: CI/CD: integrazione continua e deploy automatico del Worker

## Value
Ogni push e ogni pull request verso `develop` e `main` esegue automaticamente le stesse verifiche che
oggi si lanciano a mano (Worker, script Node, app Flutter), così le regressioni emergono prima del
merge. Su `main`, dopo una CI verde, il Worker viene distribuito senza passi manuali ripetitivi,
rispettando l'ordine con le migrazioni D1 e con un rollback documentato.

Epic di infrastruttura: **nessun FR** (`requirements: []`).

## Riferimento ai requisiti non funzionali
Il PRD (`docs/PRD.md`, v0.5) **non contiene alcun NFR su CI/CD o deploy automatico**. Le sole
attinenze indirette sono:
- **NFR-13** (Testabilità), target *Proposto*: "suite backend e Flutter verdi su ogni modifica" ->
  E04-S01 lo rende verificabile in automatico.
- **NFR-8** (nessun segreto applicativo, i provider non hanno API key) e **NFR-11** (nessun endpoint
  di scrittura): E04-S01 non introduce segreti; E04-S02 può introdurne di infrastrutturali solo se
  l'owner sceglie GitHub Actions + wrangler-action.
- Il PRD (sezione decisioni) assegna "configurazione di deploy" e "strategia di rilascio"
  all'architect; non esiste ADR sul deploy automatico.

**Segnalazione per analyst/architect (il planner non cambia requisiti né architettura):** manca un
NFR esplicito su CI/CD; se l'owner lo vuole tracciato, va aggiunto al PRD, e la scelta di E04-S02 è
una decisione architetturale da registrare in un ADR (`docs/adr/`) quando presa.

## Stories
| ID | Title | Depends on | Status |
|---|---|---|---|
| E04-S01 | CI con GitHub Actions (worker, scripts, app Flutter) | — | ready |
| E04-S02 | CD: deploy automatico del Worker su `main` dopo CI verde | E04-S01 | blocked |

Ordine di esecuzione: S01, poi S02 (bloccata finché S01 non è `done` e l'owner non risponde alla
domanda aperta).

## Out of scope
- Pubblicazione dell'app sugli store e build di artefatti mobile (APK/IPA).
- Deploy dell'app Flutter.
- Custom domain, CORS ristretto, passaggio a Workers Paid (restano nei *Passi futuri* del runbook).
- Modifiche a codice applicativo, test esistenti o requisiti.
