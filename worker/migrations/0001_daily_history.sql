-- Storico giornaliero del giorno 0 (ADR-0002 §1, FR-69).
-- Una riga per (località, data Europe/Rome); nessun indice secondario (NFR-24).
CREATE TABLE daily_history (
  location_slug            TEXT NOT NULL,
  date                     TEXT NOT NULL,   -- YYYY-MM-DD, fuso Europe/Rome
  air_temperature_mean_c   REAL,
  air_temperature_min_c    REAL,
  air_temperature_max_c    REAL,
  water_temperature_mean_c REAL,
  state                    TEXT,            -- etichetta FR-10 o NULL
  wave_height_mean_m       REAL,
  wave_height_max_m        REAL,
  PRIMARY KEY (location_slug, date)
) WITHOUT ROWID;
