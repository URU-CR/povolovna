-- Povolovna – datový model první iterace (Supabase / Postgres)
-- Zásada: tabulka udalosti je jediný zdroj pravdy o průběhu řízení; spis a protokol se z ní generují.

create extension if not exists pgcrypto;

create type stav_rizeni as enum ('koncept','podano','kontroly','ceka_na_stavebnika','ceka_na_urednika','vydano','doruceno','pravomocne','zastaveno');
create type vysledek_kontroly as enum ('ok','upozorneni','blokuje','neprovedeno');
create type role_osoby as enum ('stavebnik','zastupce','projektant','podnikatel','ucastnik_vlastnik','ucastnik_soused','obec','dotceny_organ','spravce_site');

-- Typ řízení = sada pravidel a šablon (verzováno v GitHubu, sem se nahrává při nasazení)
create table typy_rizeni (
  kod text primary key,                       -- 'povoleni_zrychlene'
  nazev text not null,
  pravidla jsonb not null,                    -- deklarativní kontroly
  sablony jsonb not null,                     -- šablony písemností
  verze text not null
);

create table osoby (
  id uuid primary key default gen_random_uuid(),
  nazev text not null,
  ico text, datova_schranka text, adresa jsonb,
  overeno_v text[],                           -- {'ARES','ROS'}
  uzivatel uuid references auth.users         -- vyplní se, až si osoba založí účet
);

create table rizeni (
  id uuid primary key default gen_random_uuid(),
  typ text not null references typy_rizeni(kod),
  cislo_zameru text, cislo_rizeni text, spisova_znacka text,
  nazev text,
  stav stav_rizeni not null default 'koncept',
  urad text, utvar text, urednik uuid references auth.users,
  zadost jsonb,                               -- strukturovaná žádost sestavená z dokumentace
  podano timestamptz, vydano timestamptz, pravni_moc timestamptz,
  zalozil uuid references auth.users,
  vytvoreno timestamptz not null default now()
);

create table osoby_v_rizeni (
  rizeni uuid references rizeni on delete cascade,
  osoba uuid references osoby,
  role role_osoby not null,
  duvod text,                                 -- proč je účastníkem (pozemek, síť)
  primary key (rizeni, osoba, role)
);

create table soubory (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  cesta text not null,                        -- objekt v Supabase Storage
  nazev text not null,
  cast_dokumentace text,                      -- 'A','B','C.3','D','doklad','plna_moc'
  sha256 text not null,
  ma_text boolean, text_ocr text,
  pdfa text,                                  -- deklarovaná úroveň PDF/A, např. '3b'; null = nedeklarováno
  pocet_podpisu int, ma_casove_razitko boolean, podpis_autorizovane_osoby boolean,
  nahrano timestamptz not null default now()
);

-- Každý vytěžený údaj nese zdroj a jistotu; stavebník ho potvrzuje nebo opravuje
create table extrakce (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  pole text not null,                         -- 'stavba.nazev', 'pozemky[1].vymera'
  hodnota jsonb not null,
  soubor uuid references soubory, strana int,
  jistota numeric(3,2),
  potvrdil uuid references auth.users, opraveno_na jsonb
);

create table pozemky (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  katastr_kod int not null, parcela text not null,
  vymera int, druh text, list_vlastnictvi text,
  overeno_v_kn timestamptz
);

create table vyjadreni (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  vydal uuid references osoby,
  druh text not null,                         -- 'zavazne_stanovisko','vyjadreni','sdeleni','existence_siti'
  znacka text, ze_dne date, plati_do date,
  souhlasne boolean,
  podminky jsonb default '[]',                -- [{text, faze}]
  soubor uuid references soubory
);

-- Souhlas je vázaný na otisk konkrétního výkresu
create table souhlasy (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  osoba uuid not null references osoby,
  soubor_vykresu uuid references soubory, sha256_vykresu text,
  zpusob text,                                -- 'sken_podpisu','identita_obcana','datova_schranka'
  udelen timestamptz,
  vzdani_se_odvolani timestamptz
);

create table kontroly (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  pravidlo text not null,                     -- klíč z typy_rizeni.pravidla
  vysledek vysledek_kontroly not null,
  blokujici boolean not null default true,    -- false = zkušební režim, jen zaznamenává
  zduvodneni text, zdroje jsonb,
  provedeno timestamptz not null default now()
);

create table platby (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  castka_kc int not null, polozka_sazebniku text,
  zpusob text, variabilni_symbol text,
  uhrazeno timestamptz
);

create table dokumenty (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  druh text not null,                         -- 'potvrzeni_prijeti','rozhodnuti','dolozka_pm','stitek'
  cislo_jednaci text,
  data jsonb not null,                        -- rozhodnutí jako data
  soubor uuid references soubory,             -- vygenerované PDF
  vyhotovil text not null default 'system',
  podepsal uuid references auth.users, podepsano timestamptz
);

create table doruceni (
  id uuid primary key default gen_random_uuid(),
  dokument uuid not null references dokumenty on delete cascade,
  osoba uuid not null references osoby,
  kanal text not null,                        -- 'ucet_rizeni','datova_schranka','uredni_deska'
  odeslano timestamptz, doruceno timestamptz, fikce boolean default false
);

create table lhuty (
  id uuid primary key default gen_random_uuid(),
  rizeni uuid not null references rizeni on delete cascade,
  druh text not null, konec timestamptz not null, splneno timestamptz
);

-- Neměnný záznam všech úkonů: kdo (člověk nebo systém), co, nad čím
create table udalosti (
  id bigint generated always as identity primary key,
  rizeni uuid not null references rizeni on delete cascade,
  cas timestamptz not null default now(),
  typ text not null,                          -- 'podani.prijato','kontrola.provedena','rozhodnuti.vydano'
  puvodce text not null,                      -- 'system' nebo id uživatele
  data jsonb not null default '{}'
);
create index on udalosti (rizeni, cas);
revoke update, delete on udalosti from authenticated, anon;

-- Řádková oprávnění: zapnuto na všech tabulkách. Bez politiky není přes API vidět nic.
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- Řízení vidí ten, kdo ho založil, osoba v řízení, přidělený úředník a role urednik
create policy rizeni_cteni on rizeni for select to authenticated using (
  zalozil = (select auth.uid())
  or urednik = (select auth.uid())
  or exists (select 1 from osoby_v_rizeni r join osoby o on o.id = r.osoba
             where r.rizeni = rizeni.id and o.uzivatel = (select auth.uid()))
  or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'urednik'
);
create policy rizeni_zapis on rizeni for insert to authenticated with check (zalozil = (select auth.uid()));
-- Politiky pro ostatní tabulky přibudou s první funkcí, která je bude číst z klienta.
