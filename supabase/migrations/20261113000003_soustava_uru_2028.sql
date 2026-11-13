-- Soustava ÚRÚ od 1. 1. 2028: ústřední úřad, 14 krajů; územní pracoviště (205, podle ORP) doplní číselník
-- Názvy krajských úřadů jsou pracovní, oficiální podobu převzít ze zákona a z RPP.
create type uroven_uradu as enum ('uru', 'kraj', 'uzemni_pracoviste');

create table public.urady (
  kod text primary key,
  nazev text not null,
  uroven uroven_uradu not null,
  nadrizeny text references public.urady(kod),
  kraj text,
  orp text
);
alter table public.urady enable row level security;
create policy urady_cteni on public.urady for select to anon, authenticated using (true);

insert into public.urady (kod, nazev, uroven, nadrizeny, kraj) values
  ('URU', 'Úřad rozvoje území České republiky', 'uru', null, null),
  ('URUK-PHA', 'Úřad rozvoje území – Hlavní město Praha', 'kraj', 'URU', 'Hlavní město Praha'),
  ('URUK-STC', 'Úřad rozvoje území – Středočeský kraj', 'kraj', 'URU', 'Středočeský kraj'),
  ('URUK-JHC', 'Úřad rozvoje území – Jihočeský kraj', 'kraj', 'URU', 'Jihočeský kraj'),
  ('URUK-PLK', 'Úřad rozvoje území – Plzeňský kraj', 'kraj', 'URU', 'Plzeňský kraj'),
  ('URUK-KVK', 'Úřad rozvoje území – Karlovarský kraj', 'kraj', 'URU', 'Karlovarský kraj'),
  ('URUK-ULK', 'Úřad rozvoje území – Ústecký kraj', 'kraj', 'URU', 'Ústecký kraj'),
  ('URUK-LBK', 'Úřad rozvoje území – Liberecký kraj', 'kraj', 'URU', 'Liberecký kraj'),
  ('URUK-HKK', 'Úřad rozvoje území – Královéhradecký kraj', 'kraj', 'URU', 'Královéhradecký kraj'),
  ('URUK-PAK', 'Úřad rozvoje území – Pardubický kraj', 'kraj', 'URU', 'Pardubický kraj'),
  ('URUK-VYS', 'Úřad rozvoje území – Kraj Vysočina', 'kraj', 'URU', 'Kraj Vysočina'),
  ('URUK-JHM', 'Úřad rozvoje území – Jihomoravský kraj', 'kraj', 'URU', 'Jihomoravský kraj'),
  ('URUK-OLK', 'Úřad rozvoje území – Olomoucký kraj', 'kraj', 'URU', 'Olomoucký kraj'),
  ('URUK-ZLK', 'Úřad rozvoje území – Zlínský kraj', 'kraj', 'URU', 'Zlínský kraj'),
  ('URUK-MSK', 'Úřad rozvoje území – Moravskoslezský kraj', 'kraj', 'URU', 'Moravskoslezský kraj');

alter table public.rizeni add column if not exists urad_kod text references public.urady(kod);
create index if not exists rizeni_urad_kod_idx on public.rizeni (urad_kod);
