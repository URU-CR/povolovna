# Povolovna

Prototyp aplikace, která automatizuje řízení o povolení stavby od podání žádosti po vydání rozhodnutí. První krok: povolení záměru ve zrychleném řízení.

- **Stavebník** – e-shop ve čtyřech krocích: vyberu, nahraju dokumentaci, zkontroluju, zaplatím a odešlu.
- **Úřad** – systém připraví vše, co může; úředník rozhoduje a podepisuje.
- **Koncept** – rozbor skutečného spisu, navržené změny legislativy, architektura a další kroky.

Stav: klikací prototyp. Analýza dokumentace, registry a platba jsou simulované na anonymizovaných datech skutečného spisu.

## Obsah

| Cesta | Co to je |
|---|---|
| `index.html` | prototyp (jedna stránka, bez sestavování) |
| `podani.html` | iterace 1a: skutečné nahrání balíčku BPP, kontroly v prohlížeči, uložení do Supabase |
| `vendor/` | knihovny (JSZip, pdf.js, SparkMD5, supabase-js) |
| `supabase/migrations/` | datový model, nasazený v projektu Supabase `povolovna` |
| `tools/pdfcheck.py` | kontrola deklarace PDF/A, podpisů a časových razítek ve složce s PDF |

## Další kroky

1. Skutečné nahrání balíčku do Supabase a vytěžení údajů z průvodního listu a souhrnné zprávy.
2. Kontroly zrychleného řízení jako pravidla, generátor rozhodnutí.
3. Účet řízení pro účastníky: doručení, souhlas, vzdání se odvolání.
4. Standardní řízení.
5. JES a EIA, společná řízení, kolaudace.
