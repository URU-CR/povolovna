-- Vytěžené údaje z dokladů a příloh
alter table public.vyjadreni add column if not exists vydal_nazev text, add column if not exists stanovisko text;
create index if not exists vyjadreni_rizeni_idx on public.vyjadreni (rizeni);
