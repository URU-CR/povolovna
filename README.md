# Povolovna

Ukázka, jak dnešní technologie omezí ruční vstupy v povolování staveb tak, jak poběží v roce 2027: nad dokumentací a doklady v podobě, v jaké dnes chodí. Pracuje s řízeními Úřadu rozvoje území ČR o vyhrazených stavbách, prvním krokem je povolení záměru ve zrychleném řízení.

Není to maketa DSŘ 2.0 ani návrh jeho architektury. Jádro postavené na záměru, rolích a pravidlech jako datech se ověřuje v samostatném projektu DSŘ 3.0.

- **Stavebník** – e-shop ve čtyřech krocích: vyberu, nahraju dokumentaci, zkontroluju, zaplatím a odešlu.
- **Úřad** – systém připraví vše, co může; úředník rozhoduje a podepisuje.
- **Koncept** – rozbor skutečného spisu, navržené změny legislativy, architektura a další kroky.

Vzhled vychází z tokenů GOV.CZ Design Systemu 4.7.3 (barvy, písmo Roboto, zaoblení); nepoužívá jeho komponenty.

Stav: klikací prototyp. Analýza dokumentace, registry a platba jsou simulované na anonymizovaných datech skutečného spisu.

## Obsah

| Cesta | Co to je |
|---|---|
| `index.html` | prototyp (jedna stránka, bez sestavování) |
| `podani.html`, `podani.js` | skutečné zpracování balíčku BPP v prohlížeči, kontroly, uložení do Supabase; `podani.js` používá i e-shop v `index.html` |
| `vendor/` | knihovny (JSZip, pdf.js, SparkMD5, supabase-js), písmo Roboto, `vendor/ocr/` čtení skenů (Tesseract.js s českými daty) |
| `supabase/migrations/` | datový model, nasazený v projektu Supabase `povolovna` |
| `tools/pdfcheck.py` | kontrola deklarace PDF/A, podpisů a časových razítek ve složce s PDF |

## Další kroky

1. Skutečné nahrání balíčku do Supabase a vytěžení údajů z průvodního listu a souhrnné zprávy.
2. Kontroly zrychleného řízení jako pravidla, generátor rozhodnutí.
3. Účet řízení pro účastníky: doručení, souhlas, vzdání se odvolání.
4. Standardní řízení.
5. JES a EIA, společná řízení, kolaudace.
