-- ============================================================
-- RUHFEST · 01_schema.sql
-- Таблицы, sequence нумерации билетов, индексы, триггеры.
-- Выполнять в Supabase → SQL Editor ПЕРВЫМ.
-- ============================================================

-- gen_random_bytes / gen_random_uuid
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- Генератор токена билета.
-- Обёртка нужна, чтобы не зависеть от того, в какой схеме
-- установлен pgcrypto (в Supabase это "extensions").
-- 32 байта случайности → 64 hex-символа, подобрать невозможно.
-- ------------------------------------------------------------
create or replace function public.generate_ticket_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(gen_random_bytes(32), 'hex');
$$;

-- ------------------------------------------------------------
-- Последовательная нумерация билетов: RUH-000001, RUH-000002 ...
-- Генерируется базой, а не фронтендом → нет гонок и дубликатов.
-- ------------------------------------------------------------
create sequence if not exists public.ticket_number_seq
  start with 1
  increment by 1
  no maxvalue
  cache 1;

-- ------------------------------------------------------------
-- Таблица билетов
-- ------------------------------------------------------------
create table if not exists public.tickets (
  id             uuid primary key default gen_random_uuid(),

  ticket_number  text unique not null
                 default ('RUH-' || lpad(nextval('public.ticket_number_seq')::text, 6, '0')),

  token          text unique not null
                 default public.generate_ticket_token(),

  name           text not null,
  phone          text not null,

  status         text not null default 'outside'
                 check (status in ('outside', 'inside')),

  is_blocked     boolean not null default false,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  last_entry_at  timestamptz,
  last_exit_at   timestamptz
);

create index if not exists tickets_token_idx         on public.tickets (token);
create index if not exists tickets_ticket_number_idx on public.tickets (ticket_number);
create index if not exists tickets_phone_idx         on public.tickets (phone);
create index if not exists tickets_created_at_idx    on public.tickets (created_at desc);

-- ------------------------------------------------------------
-- Журнал сканирований (все попытки: успешные и нет)
-- ------------------------------------------------------------
create table if not exists public.scan_logs (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid references public.tickets (id) on delete set null,
  action      text not null check (action in ('entry', 'exit')),
  result      text not null,
  scanned_at  timestamptz not null default now(),
  scanned_by  uuid references auth.users (id) on delete set null
);

create index if not exists scan_logs_ticket_id_idx  on public.scan_logs (ticket_id);
create index if not exists scan_logs_scanned_at_idx on public.scan_logs (scanned_at desc);

-- ------------------------------------------------------------
-- Автообновление updated_at
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
  before update on public.tickets
  for each row
  execute function public.set_updated_at();
