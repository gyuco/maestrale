---
id: ADR-0011
status: accepted     # proposed | accepted | superseded by ADR-XXXX
date: 2026-11-02
---

# ADR-0011: Località iniziale dell'app per slug, con migrazione una tantum del nome salvato

Allineato al PRD v0.7: l'app salva lo **slug** della località iniziale e converte una volta il nome
salvato dalle versioni precedenti (OQ-43, OQ-54, FR-41, FR-42, FR-117).

## Context
- **FR-41**: "Stabilisci come pagina iniziale" salva la località mostrata; da v0.6.1 salva
  `location.slug` e il confronto avviene per slug.
- **FR-42**: all'avvio la previsione è richiesta con lo slug salvato
  (`/forecast?localita=<slug>`), così una rinomina di `name` dal backoffice non impedisce il
  caricamento.
- **FR-117**: se la preferenza è nel formato precedente (un nome), l'app la converte **una sola
  volta** nello slug della località del catalogo il cui slug o nome normalizzato (FR-22) coincide con
  il valore salvato; se nessuna corrisponde, la preferenza resta invariata e la conversione è
  ritentata all'avvio successivo (OQ-54).
- **FR-100**: una località disattivata non è più nel catalogo e `/forecast` risponde 404 (FR-33):
  l'app resta utilizzabile.
- **ADR-0005**: `LocationRepository` fornisce subito la copia locale o lo snapshot e poi il catalogo
  di rete (FR-65); la preferenza vive in `shared_preferences` (`maestrale_home_location`).
- Oggi il valore salvato è il **nome**; un cambio di nome romperebbe l'avvio (R-14, ora mitigato).

## Options
1. **Chiave unica `maestrale_home_location` che contiene lo slug; migrazione euristica all'avvio**
   - Pro: nessuna doppia chiave da mantenere; la conversione usa il catalogo già disponibile dal
     repository (snapshot o copia locale), quindi funziona anche offline; nessuna perdita di dati.
   - Contro: il formato non è esplicito; l'euristica ("è uno slug valido? altrimenti è un nome") va
     testata sui casi limite (nome uguale a uno slug, maiuscole, accenti).
2. **Seconda chiave `maestrale_home_location_kind` (`name` | `slug`)**
   - Pro: formato esplicito, nessuna ambiguità.
   - Contro: due chiavi da mantenere sincronizzate; una migrazione di dati comunque necessaria; più
     stato per un valore che il PRD vuole comunque slug.
3. **Salvare un oggetto JSON `{ slug, name }`**
   - Pro: il nome è disponibile subito senza catalogo.
   - Contro: il nome è solo una cache e può essere obsoleto; il PRD richiede lo slug e il nome corrente
     dal catalogo (FR-42); formato più complesso senza un requisito che lo chieda.

## Decision
**Opzione 1**, con una funzione pura per la migrazione.

- **Formato**: `maestrale_home_location` contiene **solo lo slug** (stringa, come oggi).
- **Scrittura** (FR-41): al salvataggio si scrive `forecast.location.slug`; la conferma mostra il
  nome (`<località> sarà mostrata all'avvio`).
- **Lettura** (FR-42): si usa il valore salvato direttamente come `localita` della richiesta
  `/forecast`; il campo di ricerca è precompilato con il nome corrente risolto dal catalogo del
  repository, con fallback al valore salvato.
- **Migrazione** (FR-117), funzione pura `resolveSavedHomeLocation(saved, catalog)`:
  1. se `saved` coincide con uno slug del catalogo → è già uno slug, nessuna scrittura;
  2. altrimenti, se esiste **una sola** località il cui nome normalizzato (FR-22) coincide con il
     valore normalizzato di `saved` → si scrive il suo slug;
  3. altrimenti la preferenza resta invariata e la conversione è ritentata al prossimo avvio (OQ-54).
  La migrazione avviene all'avvio, **dopo** che il repository ha reso disponibile il catalogo locale
  o lo snapshot (non attende la rete, FR-65); una conversione riuscita è persistita subito.
- **Località disattivata** (FR-100): se lo slug non è più nel catalogo, l'app conserva la preferenza e
  `/forecast` risponde 404; la schermata mostra l'errore di FR-33 e resta utilizzabile. Se la località
  viene riattivata, l'avvio successivo la ritrova senza altre azioni.
- **Test** (NFR-13): la funzione pura è testata con: slug esatto, nome esatto, nome con maiuscole e
  accenti, nome uguale a uno slug di un'altra località, nessuna corrispondenza (preferenza invariata),
  catalogo vuoto; un widget test verifica che un nome salvato produca una richiesta con lo slug e che
  una preferenza non risolvibile non blocchi l'avvio.

## Consequences
- **Più semplice**: una rinomina dal backoffice non rompe più l'avvio; la preferenza è stabile e
  indipendente dal nome; la migrazione funziona offline.
- **Più difficile**: l'euristica va mantenuta allineata a `slugify` (FR-22) e coperta da test; un
  valore ambiguo (nome uguale a uno slug altrui) è risolto a favore dello **slug** (regola 1), che è
  il caso più probabile per una preferenza già migrata.
- **Nessuna migrazione di massa**: la conversione avviene per dispositivo, al primo avvio dopo
  l'aggiornamento dell'app.
