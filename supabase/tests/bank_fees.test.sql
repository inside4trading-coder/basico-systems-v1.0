-- Comisiones bancarias por frases.

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'owner-a@test.local', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cajero-a@test.local', 'authenticated', 'authenticated');
insert into public.tenants (id, name, slug) values ('aaaaaaaa-1111-1111-1111-111111111111', 'Tienda A', 'tienda-a');
insert into public.tenant_members (tenant_id, user_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'cajero');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tenant-id":"aaaaaaaa-1111-1111-1111-111111111111"}', true);

insert into public.finance_accounts (id, name, kind, currency, institution, opening_date) values
  ('aaaaaaaa-6666-6666-6666-666666666661', 'Banco Bs', 'bank', 'VES', 'Banesco', current_date - 30);

select lives_ok(
  $$ insert into public.bank_fee_rules (account_id, phrase, match, fee_type) values
       ('aaaaaaaa-6666-6666-6666-666666666661', 'COM. PAGO MOVIL', 'starts', 'Pago móvil'),
       ('aaaaaaaa-6666-6666-6666-666666666661', 'mantenimiento', 'contains', 'Mantenimiento') $$,
  'el dueño crea frases de comisión'
);
select throws_ok(
  $$ insert into public.bank_fee_rules (account_id, phrase) values ('aaaaaaaa-6666-6666-6666-666666666661', ' com. pago movil ') $$,
  '23505', null,
  'no repite una frase en la cuenta'
);

select set_config('test.r', public.import_bank_statement('aaaaaaaa-6666-6666-6666-666666666661', null, 'oct.csv', 'h', jsonb_build_array(
  jsonb_build_object('row', 2, 'date', current_date, 'direction', 'out', 'amount', 0.5, 'reference', '11', 'description', 'COM. PAGO MOVIL 0412'),
  jsonb_build_object('row', 3, 'date', current_date, 'direction', 'out', 'amount', 2, 'reference', '12', 'description', 'Cargo por MANTENIMIENTO mensual'),
  jsonb_build_object('row', 4, 'date', current_date, 'direction', 'out', 'amount', 100, 'reference', '13', 'description', 'Pago proveedor'),
  jsonb_build_object('row', 5, 'date', current_date, 'direction', 'in', 'amount', 1, 'reference', '14', 'description', 'COM. PAGO MOVIL devuelta')
))::text, true);
select is((current_setting('test.r')::jsonb ->> 'fees')::int, 2, 'al cargar registra las 2 salidas que coinciden');
select results_eq(
  $$ select l.row_number, l.status, l.match_kind, m.category, m.note
     from public.bank_statement_lines l left join public.finance_movements m on m.id = l.movement_id order by l.row_number $$,
  $$ values (2, 'matched'::text, 'created'::text, 'Comisiones bancarias'::text, 'Pago móvil: COM. PAGO MOVIL 0412'::text),
            (3, 'matched', 'created', 'Comisiones bancarias', 'Mantenimiento: Cargo por MANTENIMIENTO mensual'),
            (4, 'unmatched', null, null, null),
            (5, 'unmatched', null, null, null) $$,
  'las demás quedan abiertas; una entrada nunca es comisión'
);

select is(
  jsonb_array_length(public.apply_bank_fee_rules('aaaaaaaa-6666-6666-6666-666666666661') -> 'items'), 0,
  'después no queda nada por clasificar'
);
select is(
  public.reopen_bank_line((select id from public.bank_statement_lines where row_number = 2)), 'unmatched',
  'desvincular la comisión'
);
select is(
  (select count(*)::int from public.finance_movements where category = 'Comisiones bancarias' and voided_at is null), 1,
  'anula el egreso que se registró desde el banco'
);
select is(
  (public.apply_bank_fee_rules('aaaaaaaa-6666-6666-6666-666666666661') -> 'items' -> 0 ->> 'fee_type'), 'Pago móvil',
  'vista previa: vuelve a coincidir'
);
update public.bank_fee_rules set is_active = false where phrase = 'COM. PAGO MOVIL';
select is(
  jsonb_array_length(public.apply_bank_fee_rules('aaaaaaaa-6666-6666-6666-666666666661') -> 'items'), 0,
  'una frase inactiva no cuenta'
);

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.apply_bank_fee_rules('aaaaaaaa-6666-6666-6666-666666666661', true) $$,
  '42501', null,
  'el cajero no clasifica comisiones'
);
select is((select count(*)::int from public.bank_fee_rules), 0, 'ni ve las frases');

select * from finish();
rollback;
