-- ============================================================
-- RUHFEST · 02_functions.sql
-- RPC-функции: вход, выход, публичное чтение билета.
-- Выполнять ВТОРЫМ, после 01_schema.sql.
-- ============================================================
--
-- Ключевой момент защиты от двойного входа:
--   SELECT ... FOR UPDATE берёт эксклюзивную блокировку строки.
--   Если два сотрудника сканируют один QR одновременно, второй
--   запрос ЖДЁТ завершения первого и уже видит status = 'inside'.
--   Смена статуса происходит внутри одной транзакции — атомарно.
--
-- Коды ответа:
--   ENTRY_SUCCESS · EXIT_SUCCESS · ALREADY_INSIDE ·
--   ALREADY_OUTSIDE · BLOCKED · NOT_FOUND · NOT_AUTHORIZED
-- ============================================================


-- ------------------------------------------------------------
-- РЕГИСТРАЦИЯ ВХОДА
-- ------------------------------------------------------------
create or replace function public.register_ticket_entry(ticket_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t      public.tickets%rowtype;
  v_now  timestamptz := now();
  v_uid  uuid        := auth.uid();
begin
  -- Сканировать может только авторизованный сотрудник
  if v_uid is null then
    return json_build_object(
      'success', false,
      'code', 'NOT_AUTHORIZED',
      'message', 'ТРЕБУЕТСЯ АВТОРИЗАЦИЯ',
      'ticket_number', null,
      'name', null,
      'timestamp', v_now
    );
  end if;

  -- Блокируем строку билета до конца транзакции
  select * into t
  from public.tickets
  where token = ticket_token
  for update;

  -- Билет не найден
  if not found then
    insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
    values (null, 'entry', 'NOT_FOUND', v_now, v_uid);

    return json_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'БИЛЕТ НЕ НАЙДЕН',
      'ticket_number', null,
      'name', null,
      'timestamp', v_now
    );
  end if;

  -- Билет заблокирован
  if t.is_blocked then
    insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
    values (t.id, 'entry', 'BLOCKED', v_now, v_uid);

    return json_build_object(
      'success', false,
      'code', 'BLOCKED',
      'message', 'БИЛЕТ ЗАБЛОКИРОВАН',
      'ticket_number', t.ticket_number,
      'name', t.name,
      'timestamp', v_now
    );
  end if;

  -- Билет уже внутри → повторный вход запрещён
  if t.status = 'inside' then
    insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
    values (t.id, 'entry', 'ALREADY_INSIDE', v_now, v_uid);

    return json_build_object(
      'success', false,
      'code', 'ALREADY_INSIDE',
      'message', 'БИЛЕТ УЖЕ НАХОДИТСЯ НА ТЕРРИТОРИИ',
      'ticket_number', t.ticket_number,
      'name', t.name,
      'timestamp', v_now
    );
  end if;

  -- Успешный вход: outside → inside
  update public.tickets
  set status        = 'inside',
      last_entry_at = v_now
  where id = t.id;

  insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
  values (t.id, 'entry', 'ENTRY_SUCCESS', v_now, v_uid);

  return json_build_object(
    'success', true,
    'code', 'ENTRY_SUCCESS',
    'message', 'ВХОД РАЗРЕШЁН',
    'ticket_number', t.ticket_number,
    'name', t.name,
    'timestamp', v_now
  );
end;
$$;


-- ------------------------------------------------------------
-- РЕГИСТРАЦИЯ ВЫХОДА
-- ------------------------------------------------------------
create or replace function public.register_ticket_exit(ticket_token text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  t      public.tickets%rowtype;
  v_now  timestamptz := now();
  v_uid  uuid        := auth.uid();
begin
  if v_uid is null then
    return json_build_object(
      'success', false,
      'code', 'NOT_AUTHORIZED',
      'message', 'ТРЕБУЕТСЯ АВТОРИЗАЦИЯ',
      'ticket_number', null,
      'name', null,
      'timestamp', v_now
    );
  end if;

  select * into t
  from public.tickets
  where token = ticket_token
  for update;

  if not found then
    insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
    values (null, 'exit', 'NOT_FOUND', v_now, v_uid);

    return json_build_object(
      'success', false,
      'code', 'NOT_FOUND',
      'message', 'БИЛЕТ НЕ НАЙДЕН',
      'ticket_number', null,
      'name', null,
      'timestamp', v_now
    );
  end if;

  if t.is_blocked then
    insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
    values (t.id, 'exit', 'BLOCKED', v_now, v_uid);

    return json_build_object(
      'success', false,
      'code', 'BLOCKED',
      'message', 'БИЛЕТ ЗАБЛОКИРОВАН',
      'ticket_number', t.ticket_number,
      'name', t.name,
      'timestamp', v_now
    );
  end if;

  -- Вход не был зарегистрирован
  if t.status = 'outside' then
    insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
    values (t.id, 'exit', 'ALREADY_OUTSIDE', v_now, v_uid);

    return json_build_object(
      'success', false,
      'code', 'ALREADY_OUTSIDE',
      'message', 'ПО ЭТОМУ БИЛЕТУ ВХОД НЕ БЫЛ ЗАРЕГИСТРИРОВАН',
      'ticket_number', t.ticket_number,
      'name', t.name,
      'timestamp', v_now
    );
  end if;

  -- Успешный выход: inside → outside
  update public.tickets
  set status       = 'outside',
      last_exit_at = v_now
  where id = t.id;

  insert into public.scan_logs (ticket_id, action, result, scanned_at, scanned_by)
  values (t.id, 'exit', 'EXIT_SUCCESS', v_now, v_uid);

  return json_build_object(
    'success', true,
    'code', 'EXIT_SUCCESS',
    'message', 'ВЫХОД ЗАРЕГИСТРИРОВАН',
    'ticket_number', t.ticket_number,
    'name', t.name,
    'timestamp', v_now
  );
end;
$$;


-- ------------------------------------------------------------
-- ПУБЛИЧНОЕ ЧТЕНИЕ БИЛЕТА ПО ТОКЕНУ
-- Отдаёт ТОЛЬКО имя, номер и токен. Ни телефона, ни статуса,
-- ни журнала, ни списка других билетов.
-- ------------------------------------------------------------
create or replace function public.get_public_ticket(ticket_token text)
returns table (
  name          text,
  ticket_number text,
  token         text
)
language sql
stable
security definer
set search_path = public
as $$
  select t.name, t.ticket_number, t.token
  from public.tickets t
  where t.token = ticket_token
  limit 1;
$$;


-- ------------------------------------------------------------
-- ПРАВА НА ВЫПОЛНЕНИЕ
-- ------------------------------------------------------------
revoke all on function public.register_ticket_entry(text) from public, anon;
revoke all on function public.register_ticket_exit(text)  from public, anon;
grant execute on function public.register_ticket_entry(text) to authenticated;
grant execute on function public.register_ticket_exit(text)  to authenticated;

-- Публичная страница билета работает без авторизации
grant execute on function public.get_public_ticket(text) to anon, authenticated;
