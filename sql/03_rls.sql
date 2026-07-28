-- ============================================================
-- RUHFEST · 03_rls.sql
-- Row Level Security.
-- Выполнять ТРЕТЬИМ, после 01_schema.sql и 02_functions.sql.
-- ============================================================
--
-- Правило простое:
--   • анонимный пользователь НЕ ВИДИТ таблицы вообще;
--     публичная страница билета работает только через
--     SECURITY DEFINER функцию get_public_ticket(token),
--     которая отдаёт лишь имя, номер и токен;
--   • авторизованный сотрудник видит и меняет билеты,
--     видит журнал сканирований.
-- ============================================================

alter table public.tickets   enable row level security;
alter table public.scan_logs enable row level security;

-- Убираем возможные старые политики
drop policy if exists tickets_select_staff   on public.tickets;
drop policy if exists tickets_insert_staff   on public.tickets;
drop policy if exists tickets_update_staff   on public.tickets;
drop policy if exists scan_logs_select_staff on public.scan_logs;
drop policy if exists scan_logs_insert_staff on public.scan_logs;

-- ------------------------------------------------------------
-- tickets: только авторизованные сотрудники
-- ------------------------------------------------------------
create policy tickets_select_staff
  on public.tickets
  for select
  to authenticated
  using (true);

create policy tickets_insert_staff
  on public.tickets
  for insert
  to authenticated
  with check (true);

create policy tickets_update_staff
  on public.tickets
  for update
  to authenticated
  using (true)
  with check (true);

-- DELETE-политики нет → удалять билеты нельзя никому.

-- ------------------------------------------------------------
-- scan_logs: чтение сотрудникам, запись — из RPC-функций
-- ------------------------------------------------------------
create policy scan_logs_select_staff
  on public.scan_logs
  for select
  to authenticated
  using (true);

create policy scan_logs_insert_staff
  on public.scan_logs
  for insert
  to authenticated
  with check (scanned_by = auth.uid());

-- ------------------------------------------------------------
-- Явно закрываем анонимный доступ к таблицам
-- ------------------------------------------------------------
revoke all on public.tickets   from anon;
revoke all on public.scan_logs from anon;

-- ------------------------------------------------------------
-- Права на таблицы и sequence для сотрудников
-- (nextval нужен для автогенерации ticket_number при INSERT)
-- ------------------------------------------------------------
grant select, insert, update on public.tickets    to authenticated;
grant select, insert         on public.scan_logs  to authenticated;
grant usage, select on sequence public.ticket_number_seq to authenticated;
grant execute on function public.generate_ticket_token() to authenticated;
