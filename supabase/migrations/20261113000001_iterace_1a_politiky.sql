-- Iterace 1a: soubory se neukládají (cesta nepovinná), typ řízení, oprávnění vlastníka řízení
alter table public.soubory alter column cesta drop not null;

insert into public.typy_rizeni (kod, nazev, pravidla, sablony, verze)
values ('povoleni_zrychlene', 'Povolení záměru ve zrychleném řízení', '{}'::jsonb, '{}'::jsonb, '0.1')
on conflict (kod) do nothing;

create policy typy_rizeni_cteni on public.typy_rizeni for select to authenticated using (true);

create policy rizeni_uprava on public.rizeni for update to authenticated
  using (zalozil = (select auth.uid())) with check (zalozil = (select auth.uid()));
create policy rizeni_smazani on public.rizeni for delete to authenticated
  using (zalozil = (select auth.uid()) and stav = 'koncept');

do $$ declare t text; begin
  foreach t in array array['soubory','extrakce','pozemky','kontroly','vyjadreni','souhlasy','platby','lhuty'] loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (exists (select 1 from public.rizeni r where r.id = %I.rizeni and r.zalozil = (select auth.uid())))
         with check (exists (select 1 from public.rizeni r where r.id = %I.rizeni and r.zalozil = (select auth.uid())))',
      t || '_vlastnik', t, t, t);
  end loop;
end $$;

create policy udalosti_cteni on public.udalosti for select to authenticated
  using (exists (select 1 from public.rizeni r where r.id = udalosti.rizeni and r.zalozil = (select auth.uid())));
create policy udalosti_zapis on public.udalosti for insert to authenticated
  with check (exists (select 1 from public.rizeni r where r.id = udalosti.rizeni and r.zalozil = (select auth.uid())));

create index if not exists rizeni_zalozil_idx on public.rizeni (zalozil);
create index if not exists soubory_rizeni_idx on public.soubory (rizeni);
create index if not exists pozemky_rizeni_idx on public.pozemky (rizeni);
create index if not exists kontroly_rizeni_idx on public.kontroly (rizeni);
create index if not exists extrakce_rizeni_idx on public.extrakce (rizeni);
