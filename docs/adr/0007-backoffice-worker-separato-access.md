---
id: ADR-0007
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-11-02
---

# ADR-0007: Backoffice come Worker separato su origine propria, SSR e Cloudflare Access

Allineato al PRD v0.7: sito web **separato** per browser desktop (OQ-44, FR-118), accesso con
**Cloudflare Access** (OQ-39, FR-93/FR-94), un solo ruolo (OQ-38), scritture accettate solo
dall'origine del backoffice con cookie SameSite (decisione owner 2026-11-02, NFR-27).

## Context
- **FR-92**: due aree (catalogo, esecuzioni), più registro operazioni e "Esegui ora".
- **FR-93**: 401/403 per richieste non autenticate/non autorizzate; nessun dato nella risposta;
  rifiuto anche delle chiamate che aggirano Access.
- **FR-94**: elenco amministratori in Access, revoca entro 15 min, nessuna gestione utenti dal
  backoffice.
- **FR-118**: origine propria, distinta dall'API pubblica; browser desktop recenti; nessuna funzione
  admin nell'app Flutter.
- **NFR-27, NFR-28**: HTTPS, nessun segreto nel repository, CORS limitato all'origine del backoffice,
  il backoffice non degrada l'API pubblica.
- **NFR-13**: accesso, gestione catalogo e registri testabili in locale senza account Cloudflare né
  identity provider reale.
- **NFR-31**: p95 < 1 s (proposta) per elenco con 500 località, pagina di esecuzioni e salvataggio.
- **NFR-10**: interfaccia e messaggi in italiano; istanti mostrati in Europe/Rome.
- **FR-121**: backup e ripristino senza funzioni di export nel backoffice.

## Options
1. **Secondo Worker (`maestrale-admin`) con Hono JSX renderizzato lato server** sull'origine
   `admin.<dominio>`, davanti a Cloudflare Access; form HTML classici (POST + redirect).
   - Pro: nessun framework client né build frontend; superficie minima (niente token CSRF da gestire:
     l'origine è verificata, decisione owner); stesso linguaggio e stesse dipendenze del Worker
     pubblico; pagine veloci (NFR-31); testabili con richieste HTTP normali; isolamento reale
     dall'API pubblica (NFR-28).
   - Contro: interattività limitata (ricerche e filtri sono ricariche di pagina); serve un secondo
     deploy e una seconda configurazione wrangler.
2. **SPA (React/Preact + Vite) servita da Workers Assets, API admin nello stesso Worker**
   - Pro: UX più ricca; stato client.
   - Contro: build e dipendenze in più, CSRF e token lato client, superficie e test più ampi, nessun
     requisito che la richieda (1–3 utenti, desktop).
3. **Sezione dell'app Flutter (build web)**
   - Pro: riuso dei modelli.
   - Contro: escluso da FR-118 (nessuna funzione di amministrazione nell'app) e inadatto a un
     backoffice desktop.
4. **Stesso Worker dell'API su un path `/admin`**
   - Pro: un solo deploy.
   - Contro: viola FR-118 (origine distinta) e mescola la superficie di scrittura con l'API pubblica
     (NFR-28); Access andrebbe applicato a un path, con rischi di bypass.

## Decision
**Opzione 1.**

- **Due entrypoint, un pacchetto**: `worker/src/index.ts` (pubblico, invariato) e
  `worker/src/admin/index.ts` (backoffice), con `worker/wrangler.jsonc` e
  `worker/wrangler.admin.jsonc`. Il Worker admin ha il binding `CORE` (D1), `FORECASTS` (KV, per il
  catalogo) e le variabili di accesso; **non** ha Open-Meteo né il binding `HISTORY`.
- **Origine**: custom domain `admin.<dominio>` (valore in `ADMIN_ORIGIN`); l'API pubblica resta
  sull'origine attuale. Nessun CORS sul Worker admin; l'API pubblica non cambia.
- **Access**: applicazione Zero Trust sull'hostname admin, policy con le 1–3 email degli
  amministratori (Google/GitHub o codice monouso via email), sessione 8 h, revoca entro 15 min
  (documentata nel runbook, FR-94).
- **Verifica dell'identità nel Worker** (difesa in profondità, FR-93): a ogni richiesta si valida
  `Cf-Access-Jwt-Assertion` con `jose` (RS256, JWKS di `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
  memoizzate 1 h, controllo di `aud` = `ACCESS_AUD`, `exp`, `iss`); l'email si legge da
  `Cf-Access-Authenticated-User-Email` **solo dopo** la verifica. JWT assente/non valido → 401;
  email non nella policy (verificata dal JWT) → 403. In test l'identità è iniettata da un
  `AccessVerifier` finto (NFR-13).
- **Pagine** (SSR, italiano, date in Europe/Rome):
  - `/` → redirect a `/catalogo`;
  - `/catalogo` — elenco con `slug`, `name`, `latitude`, `longitude`, stato, totale e totale attive
    (FR-96); filtri `?q=` (nome o slug) e `?stato=attive|disattivate|tutte`, ordinamento per `name`;
  - `/catalogo/nuovo`, `/catalogo/:slug` — form di aggiunta/modifica con errori per campo (FR-97,
    FR-98, FR-99); `slug` non modificabile in modifica;
  - `/catalogo/:slug/disattiva`, `/catalogo/:slug/riattiva` — POST con pagina di conferma che mostra
    slug e nome (FR-100, FR-119);
  - `/esecuzioni` — elenco paginato (20 per pagina, `?page=`) con filtri esito e intervallo date
    (FR-108); `/esecuzioni/:id` — dettaglio (FR-109);
  - `/registro` — registro operazioni, filtrabile per slug e amministratore (FR-113);
  - `/esegui` — conferma e avvio di "Esegui ora" (tutte le località o una sola) con l'esito
    dell'accettazione o del rifiuto (FR-114..FR-116, ADR-0009).
- **Forme**: solo `POST` per le scritture, con `303` e messaggio flash ("Località aggiunta", ecc.);
  validazione fallita → stessa pagina con i messaggi per campo e stato `400`/`200`; conflitto di
  versione → `409` con invito a ricaricare (FR-103).
- **Sicurezza**: controllo `Origin`/`Referer` = `ADMIN_ORIGIN` su ogni richiesta non `GET` (NFR-27,
  decisione owner 2026-11-02); nessun token CSRF; `Cache-Control: no-store` su tutte le pagine;
  CSP `default-src 'self'; frame-ancestors 'none'`; `X-Content-Type-Options: nosniff`. Nessun
  endpoint admin è raggiungibile dall'origine pubblica: il Worker admin non è instradato lì e
  l'API pubblica non ha route di scrittura.
- **Deploy**: `wrangler deploy -c wrangler.admin.jsonc` come passo separato; il runbook descrive
  creazione di `maestrale-core`, seed, migrazioni, configurazione Access e revoca.

## Consequences
- **Più semplice**: nessun build frontend, nessuna gestione di token CSRF, isolamento netto
  dall'API pubblica, test HTTP normali (NFR-13).
- **Più difficile**: due deploy da coordinare (catalogo/migrazioni prima del backoffice); UX a
  ricarica di pagina; la verifica JWT aggiunge una dipendenza (`jose`) e una fetch JWKS per isolate
  (memoizzata).
- **Rischio residuo**: un errore di configurazione di Access (policy troppo larga) apre il
  backoffice: mitigato dalla verifica JWT nel Worker e dal runbook; la revoca è efficace entro la
  durata della sessione (NFR-27, 8 h) salvo revoca esplicita delle sessioni (15 min).
