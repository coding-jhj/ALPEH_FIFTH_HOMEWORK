-- ALEPH T04 저장 스키마
-- 핵심: (signal_id, record_date) 유니크 제약이 "하루 한 줄"을 DB 차원에서 강제합니다 (T04-C20).

create table if not exists daily_readings (
  record_id        text primary key,
  signal_id        text not null,
  record_date      date not null,
  normalized_value double precision not null,
  unit             text not null,
  source_name      text not null,
  source_url       text not null,
  source_time      timestamptz,
  first_fetched_at timestamptz not null,
  last_fetched_at  timestamptz not null,
  constraint daily_readings_signal_date_key unique (signal_id, record_date)
);

create table if not exists reading_status (
  signal_id           text primary key,
  freshness           text not null check (freshness in ('fresh','stale')),
  error_code          text not null check (error_code in ('none','timeout','auth','rate_limit','offline','schema_error')),
  last_run_at         timestamptz,
  retry_after_seconds integer,
  -- reading-status.schema.json 의 oneOf 를 DB에서도 강제합니다.
  constraint reading_status_pairing check ((freshness = 'fresh') = (error_code = 'none'))
);

-- 공개 심사 화면은 서버 라우트를 통해서만 읽고 쓰므로 anon 직접 접근은 막아 둡니다.
alter table daily_readings enable row level security;
alter table reading_status enable row level security;
