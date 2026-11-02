-- Backoffice di amministrazione (ADR-0006, ADR-0008, ADR-0009).
-- Unica migrazione dello schema: catalogo, registri delle esecuzioni e delle
-- operazioni, richieste "Esegui ora" e lock del job.

CREATE TABLE catalog_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO catalog_meta (id, version, updated_at) VALUES (1, 1, '1970-01-01T00:00:00Z');

CREATE TABLE locations (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX locations_name ON locations (name);
CREATE INDEX locations_active ON locations (active);

CREATE TABLE job_runs (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  scope TEXT NOT NULL,
  scope_slug TEXT,
  triggered_by TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  outcome TEXT,
  reject_reason TEXT,
  catalog_version INTEGER NOT NULL,
  catalog_size INTEGER NOT NULL,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  not_attempted_count INTEGER NOT NULL DEFAULT 0,
  breaker INTEGER NOT NULL DEFAULT 0,
  breaker_blocks_failed INTEGER,
  breaker_blocks_total INTEGER,
  marine_blocks_failed INTEGER,
  marine_blocks_total INTEGER,
  forecast_blocks_failed INTEGER,
  forecast_blocks_total INTEGER,
  metrics TEXT,
  history_rows INTEGER,
  history_error TEXT
);
CREATE INDEX job_runs_started_at ON job_runs (started_at DESC);

CREATE TABLE job_run_failures (
  run_id TEXT NOT NULL REFERENCES job_runs (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  message TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (run_id, slug)
);

CREATE TABLE admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  action TEXT NOT NULL,
  slug TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  outcome TEXT
);
CREATE INDEX admin_actions_at ON admin_actions (at DESC);
CREATE INDEX admin_actions_slug ON admin_actions (slug);

CREATE TABLE run_requests (
  id TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  scope TEXT NOT NULL,
  slug TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX run_requests_status ON run_requests (status, requested_at);

CREATE TABLE job_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  run_id TEXT,
  lease_until TEXT NOT NULL
);
INSERT INTO job_lock (id, lease_until) VALUES (1, '1970-01-01T00:00:00Z');
