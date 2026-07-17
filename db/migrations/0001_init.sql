-- 0001_init.sql — Dental RAG core schema
-- Fact tables (ground truth for answers) + ingestion audit + conversation memory.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- optional pgvector (Qdrant is primary)

-- ---------- Clinic (one row per ingested site) ----------
CREATE TABLE IF NOT EXISTS clinic (
    id           SERIAL PRIMARY KEY,
    website_url  TEXT UNIQUE NOT NULL,
    name         TEXT,
    address      TEXT,
    city         TEXT,
    region       TEXT,
    postal_code  TEXT,
    country      TEXT,
    phone        TEXT,
    email        TEXT,
    booking_url  TEXT,
    about        TEXT,
    scraped_at   TIMESTAMPTZ DEFAULT now()
);

-- ---------- Doctors / team ----------
CREATE TABLE IF NOT EXISTS doctors (
    id           SERIAL PRIMARY KEY,
    clinic_id    INT REFERENCES clinic(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    title        TEXT,
    bio          TEXT,
    specialties  TEXT[],
    image_url    TEXT,
    source_url   TEXT,
    UNIQUE (clinic_id, name)
);

-- ---------- Services ----------
CREATE TABLE IF NOT EXISTS services (
    id           SERIAL PRIMARY KEY,
    clinic_id    INT REFERENCES clinic(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    category     TEXT,
    description  TEXT,
    source_url   TEXT,
    UNIQUE (clinic_id, name)
);

-- ---------- Pricing (grounds price answers; only quote real rows) ----------
CREATE TABLE IF NOT EXISTS pricing (
    id           SERIAL PRIMARY KEY,
    clinic_id    INT REFERENCES clinic(id) ON DELETE CASCADE,
    service_id   INT REFERENCES services(id) ON DELETE SET NULL,
    service_name TEXT NOT NULL,
    price_min    NUMERIC,
    price_max    NUMERIC,
    currency     TEXT DEFAULT 'USD',
    unit         TEXT,                 -- e.g. 'per arch', 'total', 'per visit'
    notes        TEXT,
    source_url   TEXT
);

-- ---------- Opening hours ----------
CREATE TABLE IF NOT EXISTS hours (
    id           SERIAL PRIMARY KEY,
    clinic_id    INT REFERENCES clinic(id) ON DELETE CASCADE,
    day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
    open_time    TIME,
    close_time   TIME,
    is_closed    BOOLEAN DEFAULT FALSE,
    notes        TEXT,
    UNIQUE (clinic_id, day_of_week)
);

-- ---------- FAQs ----------
CREATE TABLE IF NOT EXISTS faqs (
    id           SERIAL PRIMARY KEY,
    clinic_id    INT REFERENCES clinic(id) ON DELETE CASCADE,
    question     TEXT NOT NULL,
    answer       TEXT NOT NULL,
    category     TEXT,
    source_url   TEXT
);

-- ---------- Policies (insurance, cancellation, new-patient, etc.) ----------
CREATE TABLE IF NOT EXISTS policies (
    id           SERIAL PRIMARY KEY,
    clinic_id    INT REFERENCES clinic(id) ON DELETE CASCADE,
    policy_type  TEXT,
    title        TEXT,
    content      TEXT NOT NULL,
    source_url   TEXT
);

-- ---------- Raw + cleaned pages (source of chunks; idempotent by url_hash) ----------
CREATE TABLE IF NOT EXISTS pages_raw (
    id           SERIAL PRIMARY KEY,
    clinic_id    INT REFERENCES clinic(id) ON DELETE CASCADE,
    url          TEXT NOT NULL,
    url_hash     TEXT UNIQUE NOT NULL,
    page_type    TEXT,
    title        TEXT,
    raw_html     TEXT,
    clean_text   TEXT,
    status_code  INT,
    fetched_at   TIMESTAMPTZ DEFAULT now()
);

-- ---------- Ingestion audit ----------
CREATE TABLE IF NOT EXISTS ingestion_runs (
    id                SERIAL PRIMARY KEY,
    clinic_id         INT REFERENCES clinic(id) ON DELETE CASCADE,
    website_url       TEXT NOT NULL,
    status            TEXT DEFAULT 'running',  -- running|success|partial|failed
    pages_discovered  INT DEFAULT 0,
    pages_fetched     INT DEFAULT 0,
    pages_extracted   INT DEFAULT 0,
    chunks_indexed    INT DEFAULT 0,
    coverage          JSONB,
    error             TEXT,
    started_at        TIMESTAMPTZ DEFAULT now(),
    finished_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS page_coverage (
    id            SERIAL PRIMARY KEY,
    run_id        INT REFERENCES ingestion_runs(id) ON DELETE CASCADE,
    url           TEXT,
    page_type     TEXT,
    entities      JSONB,
    confidence    NUMERIC,
    status        TEXT
);

-- ---------- Conversation memory ----------
CREATE TABLE IF NOT EXISTS sessions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel        TEXT DEFAULT 'voice',    -- voice|text|web
    created_at     TIMESTAMPTZ DEFAULT now(),
    last_active_at TIMESTAMPTZ DEFAULT now(),
    meta           JSONB
);

CREATE TABLE IF NOT EXISTS messages (
    id          BIGSERIAL PRIMARY KEY,
    session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,               -- user|assistant|system
    content     TEXT NOT NULL,
    intents     JSONB,
    sources     JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ---------- Booking ----------
CREATE TABLE IF NOT EXISTS booking_requests (
    id              SERIAL PRIMARY KEY,
    session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,
    clinic_id       INT REFERENCES clinic(id) ON DELETE SET NULL,
    service_name    TEXT,
    preferred_date  DATE,
    preferred_time  TIME,
    patient_name    TEXT,
    patient_contact TEXT,
    status          TEXT DEFAULT 'collecting', -- collecting|confirming|booked|cancelled
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_services_clinic   ON services(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pricing_clinic     ON pricing(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pricing_service    ON pricing(service_name);
CREATE INDEX IF NOT EXISTS idx_faqs_clinic        ON faqs(clinic_id);
CREATE INDEX IF NOT EXISTS idx_pages_clinic       ON pages_raw(clinic_id);
CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_booking_session    ON booking_requests(session_id);
