/* Povolovna: analýza balíčku BPP v prohlížeči, zobrazení výsledků, uložení do Supabase */
(function(){
"use strict";
const SUPA_URL = "https://jfdthwivurzmmxjsncru.supabase.co";
const SUPA_KEY = "sb_publishable_f5YsQTH-AiDLZWeMUQKG5A_XElA-wLw";
const sb = window.supabase ? window.supabase.createClient(SUPA_URL, SUPA_KEY) : null;
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nfc = s => (s || "").normalize("NFC");
const base = p => nfc(p.split("/").pop());
function toast(m){ const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 4000); }

/* ---------- přihlášení ---------- */
let user = null, R = null;
function renderAuth(){
  if (!$("#auth") || !sb) return;
  $("#auth").innerHTML = user
    ? `<span class="small muted">${esc(user.email)}</span><button class="btn" id="logout">Odhlásit</button>`
    : `<label class="small muted" for="email">Přihlášení</label><input id="email" type="email" placeholder="e-mail" autocomplete="email"><button class="btn" id="login">Poslat odkaz</button>`;
  if (R) renderSave();
}
document.addEventListener("click", async e => {
  if (!sb) return;
  if (e.target.id === "login"){
    const email = $("#email").value.trim(); if (!email) return toast("Zadejte e-mail.");
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    toast(error ? "Odkaz se nepodařilo odeslat: " + error.message : "Přihlašovací odkaz je na cestě do e-mailu.");
  }
  if (e.target.id === "logout") await sb.auth.signOut();
  if (e.target.id === "save") save();
});
if (sb) sb.auth.onAuthStateChange((_e, s) => { user = s?.user || null; renderAuth(); });
renderAuth();

/* ---------- čtení PDF ---------- */
const TS_OID = "060b2a864886f70d010910020e"; // časové razítko vložené v podpisu
function pdfMarks(bytes){
  const s = new TextDecoder("latin1").decode(bytes);
  const part = /pdfaid:part[>="'\s]+(\d)/.exec(s), conf = /pdfaid:conformance[>="'\s]+([A-Za-z])/.exec(s);
  const subs = [...s.matchAll(/\/SubFilter\s*\/([A-Za-z0-9.]+)/g)].map(m => m[1]);
  const docTs = subs.filter(x => /RFC3161/i.test(x)).length;
  let sigTs = 0;
  for (const m of s.matchAll(/\/Contents\s*<([0-9A-Fa-f]{2000,})>/g)) if (m[1].toLowerCase().includes(TS_OID)) sigTs++;
  return { pdfa: part ? part[1] + (conf ? conf[1].toLowerCase() : "") : null, podpisy: subs.length - docTs, razitko: docTs + sigTs > 0 };
}
async function pdfLines(bytes, maxPages){
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++){
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map();
    for (const it of tc.items){
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3) * 3;
      (rows.get(y) || rows.set(y, []).get(y)).push([it.transform[4], it.str]);
    }
    pages.push([...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(" ").replace(/\s+/g, " ").trim()));
  }
  const n = doc.numPages; await doc.destroy();
  return { pages, numPages: n };
}

/* ---------- manifest a žádost ---------- */
const PART = { Project: "zadost", AccompanyingDocuments: "A", TechnicalReport: "B", SituationDrawings: "C", StructureDocumentation: "D", Papers: "doklad" };
const PART_NAME = { zadost: "Žádost z portálu", A: "A Průvodní list", B: "B Souhrnná technická zpráva", C: "C Situační výkresy", D: "D Dokumentace objektů", doklad: "Doklady", jine: "Mimo manifest" };
function parseManifest(xml){
  const d = new DOMParser().parseFromString(xml, "application/xml");
  const txt = n => d.getElementsByTagName(n)[0]?.textContent.trim() || "";
  const items = [];
  for (const el of d.querySelectorAll("[md5]")){
    let part = "jine";
    for (let a = el.parentElement; a; a = a.parentElement) if (PART[a.localName]){ part = PART[a.localName]; break; }
    items.push({ name: nfc(el.textContent.trim()), md5: el.getAttribute("md5").toLowerCase(), part });
  }
  return { verze: txt("BPPVersion"), vytvoril: txt("CreatedBy"), vytvoreno: txt("Created"), items };
}
function parseZadost(xml){
  const d = new DOMParser().parseFromString(xml, "application/xml");
  const root = d.documentElement;
  const kid = (el, n) => el && [...el.children].find(c => c.localName === n);
  const t = (el, n) => kid(el, n)?.textContent.trim() || "";
  const osoba = n => { const o = kid(root, n); return o && t(o, "nazev") ? { nazev: t(o, "nazev"), ico: t(o, "ico"), isds: t(o, "isds") } : null; };
  const m = kid(root, "misto"), ch = kid(root, "charakteristika");
  return {
    pid: t(root, "pid"), nazev: t(root, "nazev"),
    misto: [t(m, "ulice"), t(m, "castObce"), t(m, "obec")].filter(Boolean).join(", "),
    druh: t(ch, "druhAUcelStavby"), novaStavba: t(ch, "novaStavba") === "true",
    zahajeni: t(root, "zahajeni"), dokonceni: t(root, "dokonceni"),
    zadatel: osoba("zadatelPO"), zastupce: osoba("zastupceZadatelePO"), podnikatel: osoba("stavebniPodnikatelPO"),
    pozemky: [...(kid(root, "pozemky")?.children || [])].map(p => ({ ku: t(p, "katastralniUzemi"), parcela: t(p, "parcelniCislo"), druh: t(p, "druhPozemku"), vymera: parseInt(t(p, "vymera"), 10) || null }))
  };
}

/* ---------- vytěžení průvodního listu ---------- */
const DRUHY = "orná půda|chmelnice|vinice|zahrada|ovocný sad|trvalý travní porost|lesní pozemek|vodní plocha|zastavěná plocha a nádvoří|zastavěná plocha|ostatní plocha";
function extractA(pages){
  const lines = pages.flat(), out = { nazev: null, ku: null, kuKod: null, pozemky: [], autorizace: [] };
  const i = lines.findIndex(l => /název stavby/i.test(l));
  if (i >= 0) out.nazev = (lines[i + 1] || "").replace(/\.$/, "") || null;
  const ku = /Katastrální území:\s*(.+?)\s*\[(\d{6})\]/.exec(lines.join("\n"));
  if (ku){ out.ku = ku[1]; out.kuKod = parseInt(ku[2], 10); }
  const from = lines.findIndex(l => /parcel/i.test(l) && /výměra/i.test(l));
  const to = lines.findIndex((l, k) => k > from && /předmět dokumentace/i.test(l));
  const re = new RegExp("^(\\d{1,5}(?:/\\d{1,4})?)\\s+(\\d{1,7})\\s+(" + DRUHY + ")", "i");
  const scope = from >= 0 ? lines.slice(from, to > from ? to : undefined) : lines;
  scope.forEach((l, k) => {
    const m = re.exec(l); if (!m) return;
    let druh = m[3].toLowerCase();
    if (druh === "zastavěná plocha" && /a nádvoří/i.test((scope[k + 1] || "") + (scope[k + 2] || ""))) druh = "zastavěná plocha a nádvoří";
    if (!out.pozemky.some(p => p.parcela === m[1])) out.pozemky.push({ parcela: m[1], vymera: parseInt(m[2], 10), druh });
  });
  out.autorizace = [...new Set([...lines.join("\n").matchAll(/(ČKAIT|ČKA)\s*[:\-]?\s*(\d{5,7})/g)].map(m => m[1] + " " + m[2]))];
  return out;
}

/* ---------- analýza balíčku ---------- */
function step(msg){ const p = $("#progress"); if (!p) return; p.hidden = false; p.innerHTML = `<ul class="scan"><li class="run"><span class="dot"></span><span>${esc(msg)}</span></li></ul>`; }
async function analyze(file){
  R = null; if ($("#out")) $("#out").innerHTML = "";
  step("Rozbaluji balíček…");
  const zip = await JSZip.loadAsync(file, { decodeFileName: b => new TextDecoder("utf-8").decode(b) });
  const entries = Object.values(zip.files).filter(f => !f.dir);
  const mf = entries.find(f => base(f.name).toLowerCase() === "manifest.xml");
  const manifest = mf ? parseManifest(await mf.async("string")) : null;
  const byName = new Map((manifest?.items || []).map(i => [i.name, i]));
  const files = []; let zadost = null, A = null, n = 0;
  for (const f of entries){
    const name = base(f.name); if (f === mf) continue;
    step(`Čtu soubory ${++n} z ${entries.length - (mf ? 1 : 0)}: ${name}`);
    const bytes = await f.async("uint8array"), buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(b => b.toString(16).padStart(2, "0")).join("");
    const mi = byName.get(name);
    const rec = { nazev: name, cesta: nfc(f.name), part: mi?.part || "jine", velikost: bytes.length, sha256: sha, md5ok: mi ? SparkMD5.ArrayBuffer.hash(buf) === mi.md5 : null, pdf: /\.pdf$/i.test(name) };
    if (mi) mi.found = true;
    if (rec.pdf){
      Object.assign(rec, pdfMarks(bytes));
      try {
        const t = await pdfLines(bytes, rec.part === "A" ? 6 : 2);
        rec.stran = t.numPages; rec.maText = t.pages.flat().join(" ").length > 40;
        if (rec.part === "A" && !A) A = extractA(t.pages);
      } catch (e){ rec.chyba = "PDF se nepodařilo otevřít"; }
    } else if (rec.part === "zadost" && /\.xml$/i.test(name)){
      try { zadost = parseZadost(new TextDecoder("utf-8").decode(bytes)); } catch (e){ rec.chyba = "XML žádosti se nepodařilo přečíst"; }
    }
    files.push(rec);
  }
  R = { balicek: file.name, manifest, files, zadost, A };
  R.nalezy = compare(R); R.kontroly = checks(R);
  if ($("#progress")) $("#progress").hidden = true; render();
}

function compare({ zadost, A }){
  const out = [];
  if (!zadost || !A) return out;
  const z = new Map(zadost.pozemky.map(p => [p.parcela, p])), a = new Map(A.pozemky.map(p => [p.parcela, p]));
  for (const [k] of a) if (!z.has(k)) out.push({ typ: "parcela_chybi_v_zadosti", zavazne: true, text: `Parcela ${k} je v dokumentaci, v žádosti chybí.` });
  for (const [k] of z) if (!a.has(k)) out.push({ typ: "parcela_chybi_v_dokumentaci", zavazne: true, text: `Parcela ${k} je v žádosti, v průvodním listu chybí.` });
  for (const [k, p] of a){ const q = z.get(k); if (!q) continue;
    if (p.vymera && q.vymera && p.vymera !== q.vymera) out.push({ typ: "vymera", zavazne: false, text: `Parcela ${k}: dokumentace uvádí ${p.vymera} m², žádost ${q.vymera} m².` });
    if (p.druh && q.druh && !p.druh.startsWith(q.druh.toLowerCase()) && !q.druh.toLowerCase().startsWith(p.druh)) out.push({ typ: "druh", zavazne: false, text: `Parcela ${k}: dokumentace uvádí druh ${p.druh}, žádost ${q.druh}.` });
  }
  const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9á-ž]+/gi, "");
  if (A.nazev && zadost.nazev && norm(A.nazev) !== norm(zadost.nazev)) out.push({ typ: "nazev", zavazne: false, text: `Název stavby se liší: dokumentace „${A.nazev}", žádost „${zadost.nazev}".` });
  return out;
}

function checks(r){
  const k = [], add = (pravidlo, nazev, vysledek, blokujici, zduvodneni) => k.push({ pravidlo, nazev, vysledek, blokujici, zduvodneni });
  const g = p => r.files.filter(f => f.part === p), dok = r.files.filter(f => "ABCD".includes(f.part) && f.pdf);
  if (!r.manifest) add("manifest", "Manifest balíčku", "blokuje", true, "V balíčku není manifest.xml.");
  else {
    const miss = r.manifest.items.filter(i => !i.found), bad = r.files.filter(f => f.md5ok === false);
    add("manifest", "Úplnost a otisky podle manifestu", miss.length || bad.length ? "blokuje" : "ok", true,
      miss.length || bad.length ? `Chybí ${miss.length} souborů, ${bad.length} má jiný otisk.` : `${r.manifest.items.length} souborů, všechny otisky souhlasí.`);
  }
  const need = [["A", 1], ["B", 1], ["C", 3], ["D", 1]].filter(([p, c]) => g(p).length < c).map(x => x[0]);
  add("uplnost", "Části dokumentace A až D", need.length ? "blokuje" : "ok", true, need.length ? "Chybí nebo je neúplná část " + need.join(", ") + "." : `A ${g("A").length}, B ${g("B").length}, C ${g("C").length}, D ${g("D").length} souborů.`);
  if (!r.zadost || !r.A) add("shoda_pozemku", "Shoda pozemků v žádosti a dokumentaci", "neprovedeno", true, !r.zadost ? "Žádost v XML nebyla nalezena." : "Průvodní list se nepodařilo vytěžit.");
  else {
    const z = r.nalezy.filter(n => n.zavazne), m = r.nalezy.filter(n => !n.zavazne);
    add("shoda_pozemku", "Shoda pozemků v žádosti a dokumentaci", z.length ? "blokuje" : "ok", true, z.length ? z.map(n => n.text).join(" ") : `${r.A.pozemky.length} parcel souhlasí.`);
    add("shoda_udaju", "Shoda výměr, druhů a názvu", m.length ? "upozorneni" : "ok", false, m.length ? m.map(n => n.text).join(" ") : "Bez rozdílů.");
  }
  const noA = dok.filter(f => !f.pdfa || f.pdfa[0] !== "3"), noS = dok.filter(f => !f.podpisy), vyk = dok.filter(f => f.part === "C" || f.part === "D"), noT = vyk.filter(f => !f.razitko);
  add("format_pdfa3", "Formát PDF/A-3 u dokumentace", noA.length ? "upozorneni" : "ok", false, `${dok.length - noA.length} z ${dok.length} souborů deklaruje PDF/A-3.`);
  add("autorizacni_razitko", "Elektronický podpis nebo razítko u dokumentace", noS.length ? "upozorneni" : "ok", false, `${dok.length - noS.length} z ${dok.length} souborů nese elektronický podpis. Zda jde o autorizační razítko, se zatím neověřuje.`);
  add("casove_razitko", "Časové razítko u částí C a D", noT.length ? "upozorneni" : "ok", false, `${vyk.length - noT.length} z ${vyk.length} souborů má časové razítko.`);
  const dk = g("doklad").filter(f => f.pdf), sk = dk.filter(f => f.maText === false);
  add("textova_vrstva", "Textová vrstva dokladů", sk.length ? "upozorneni" : "ok", false, `${sk.length} z ${dk.length} dokladů je sken bez textu.`);
  return k;
}

/* ---------- zobrazení ---------- */
const PILL = { ok: ["ok", "V pořádku"], upozorneni: ["warn", "Upozornění"], blokuje: ["bad", "Brání odeslání"], neprovedeno: ["idle", "Neprovedeno"] };
const yes = (v, t = "ano", f = "ne") => v ? `<span class="pill ok">${t}</span>` : `<span class="pill warn">${f}</span>`;
function render(){
  if (!R || !$("#out")) return;
  const r = R, z = r.zadost, a = r.A, blok = r.kontroly.filter(k => k.vysledek === "blokuje").length, upo = r.kontroly.filter(k => k.vysledek === "upozorneni").length;
  const parts = ["zadost", "A", "B", "C", "D", "doklad", "jine"].map(p => [p, r.files.filter(f => f.part === p)]).filter(x => x[1].length);
  const os = (n, o) => o ? `<dt>${n}</dt><dd>${esc(o.nazev)}${o.ico ? `, IČO ${esc(o.ico)}` : ""} <span class="src">žádost XML</span></dd>` : "";
  $("#out").innerHTML = `
  <div class="issue ${blok ? "" : upo ? "soft" : "fixed"}"><b>${blok ? `${blok} ${blok === 1 ? "kontrola brání" : "kontroly brání"} odeslání` : "Nic nebrání odeslání"}${upo ? `, ${upo} upozornění` : ""}.</b> Balíček ${esc(r.balicek)}: ${r.files.length} souborů${r.manifest ? `, formát BPP ${esc(r.manifest.verze)}, vytvořil ${esc(r.manifest.vytvoril)}` : ""}.</div>

  <section class="card"><div class="sec-h"><h3>Kontroly</h3><span class="small muted">${r.kontroly.length} pravidel</span></div>
    <div class="tblwrap"><table><tr><th>Kontrola</th><th>Výsledek</th><th>Zjištění</th></tr>
    ${r.kontroly.map(k => `<tr><td><b>${esc(k.nazev)}</b>${k.blokujici ? "" : `<br><span class="small muted">zkušební režim, neblokuje</span>`}</td><td><span class="pill ${PILL[k.vysledek][0]}">${PILL[k.vysledek][1]}</span></td><td class="small">${esc(k.zduvodneni)}</td></tr>`).join("")}
    </table></div></section>

  ${z ? `<section class="card"><div class="sec-h"><h3>Žádost</h3><span class="src">${esc(z.pid)}</span></div><dl class="kv">
    <dt>Název</dt><dd>${esc(z.nazev)} <span class="src">žádost XML</span></dd>
    ${a?.nazev ? `<dt>Název v dokumentaci</dt><dd>${esc(a.nazev)} <span class="src">A, průvodní list</span></dd>` : ""}
    <dt>Místo</dt><dd>${esc(z.misto)}${a?.ku ? `, k. ú. ${esc(a.ku)} [${a.kuKod}]` : ""}</dd>
    <dt>Druh stavby</dt><dd>${z.novaStavba ? "nová stavba, " : ""}${esc(z.druh)}</dd>
    <dt>Termíny</dt><dd>${esc(z.zahajeni)} až ${esc(z.dokonceni)}</dd>
    ${os("Stavebník", z.zadatel)}${os("Zástupce", z.zastupce)}${os("Stavební podnikatel", z.podnikatel)}
    ${a?.autorizace.length ? `<dt>Autorizace</dt><dd>${a.autorizace.map(esc).join(", ")} <span class="src">A, průvodní list</span></dd>` : ""}
  </dl></section>` : ""}

  ${z || a ? `<section class="card"><div class="sec-h"><h3>Pozemky</h3><span class="pill ${r.nalezy.length ? "warn" : "ok"}">${r.nalezy.length ? "nálezy: " + r.nalezy.length : "bez nálezu"}</span></div>
    <div class="tblwrap"><table><tr><th>Parcela</th><th class="r">Výměra v dokumentaci</th><th class="r">Výměra v žádosti</th><th>Druh</th><th>Stav</th></tr>
    ${[...new Set([...(a?.pozemky || []), ...(z?.pozemky || [])].map(p => p.parcela))].map(k => { const p = a?.pozemky.find(x => x.parcela === k), q = z?.pozemky.find(x => x.parcela === k);
      const st = !a || !z ? `<span class="pill idle">neporovnáno</span>` : !q ? `<span class="pill bad">chybí v žádosti</span>` : !p ? `<span class="pill bad">chybí v dokumentaci</span>` : p.vymera !== q.vymera ? `<span class="pill warn">jiná výměra</span>` : `<span class="pill ok">souhlasí</span>`;
      return `<tr><td class="mono">${esc(k)}</td><td class="r num">${p?.vymera ?? "–"}</td><td class="r num">${q?.vymera ?? "–"}</td><td>${esc(p?.druh || q?.druh || "")}</td><td>${st}</td></tr>`; }).join("")}
    </table></div></section>` : ""}

  <section class="card"><div class="sec-h"><h3>Soubory, formát a autorizace</h3><span class="small muted">kontrola deklarace v souboru, ne plná validace</span></div>
    <div class="tblwrap"><table><tr><th>Část</th><th class="r">Souborů</th><th class="r">PDF/A-3</th><th class="r">S podpisem</th><th class="r">S časovým razítkem</th><th class="r">Skenů bez textu</th></tr>
    ${parts.map(([p, fs]) => { const pd = fs.filter(f => f.pdf); return `<tr><td>${PART_NAME[p]}</td><td class="r num">${fs.length}</td><td class="r num">${pd.filter(f => f.pdfa && f.pdfa[0] === "3").length}</td><td class="r num">${pd.filter(f => f.podpisy).length}</td><td class="r num">${pd.filter(f => f.razitko).length}</td><td class="r num">${pd.filter(f => f.maText === false).length}</td></tr>`; }).join("")}
    </table></div>
    <details style="margin-top:12px"><summary>Všech ${r.files.length} souborů</summary>
    <div class="tblwrap" style="margin-top:8px"><table><tr><th>Soubor</th><th>Část</th><th>Otisk dle manifestu</th><th>PDF/A</th><th>Podpis</th><th>Čas. razítko</th><th>Text</th></tr>
    ${r.files.map(f => `<tr><td class="small">${esc(f.nazev)}${f.chyba ? `<br><span class="pill bad">${esc(f.chyba)}</span>` : ""}</td><td class="small">${p_short(f.part)}</td><td>${f.md5ok === null ? `<span class="pill idle">není v manifestu</span>` : yes(f.md5ok, "souhlasí", "nesouhlasí")}</td>${f.pdf ? `<td>${f.pdfa ? `<span class="pill ${f.pdfa[0] === "3" ? "ok" : "warn"}">${esc(f.pdfa)}</span>` : `<span class="pill warn">ne</span>`}</td><td>${yes(f.podpisy)}</td><td>${yes(f.razitko)}</td><td>${f.maText === undefined ? "" : yes(f.maText, "ano", "sken")}</td>` : `<td colspan="4" class="small muted">není PDF</td>`}</tr>`).join("")}
    </table></div></details></section>

  <section class="card stack" id="savebox"></section>`;
  renderSave();
}
const p_short = p => ({ zadost: "žádost", doklad: "doklad", jine: "mimo" }[p] || p);
function renderSave(){
  const b = $("#savebox"); if (!b) return;
  b.innerHTML = `<h3>Uložit do databáze</h3>
    <p class="small">Uloží se údaje žádosti, pozemky, výsledky kontrol a u každého souboru název, otisk a zjištěné vlastnosti. Samotné soubory zůstávají ve vašem počítači.</p>
    ${R.saved ? `<p><span class="pill ok">Uloženo</span> <span class="mono small">${esc(R.saved)}</span></p>`
      : user ? `<div><button class="btn pri" id="save">Uložit řízení jako koncept</button></div>`
      : `<p class="small muted">Pro uložení se nahoře přihlaste odkazem z e-mailu. Výsledky analýzy vidíte i bez přihlášení.</p>`}`;
}

/* ---------- uložení ---------- */
async function save(){
  const r = R, z = r.zadost || {}, btn = $("#save"); btn.disabled = true;
  const must = async q => { const { data, error } = await q; if (error) throw error; return data; };
  try {
    const row = await must(sb.from("rizeni").insert({ typ: "povoleni_zrychlene", nazev: z.nazev || r.A?.nazev || r.balicek, cislo_zameru: z.pid || null, stav: "koncept", zalozil: user.id,
      zadost: { zadost: r.zadost, pruvodni_list: r.A, nalezy: r.nalezy } }).select("id").single());
    const id = row.id, poz = r.A?.pozemky.length ? r.A.pozemky : (z.pozemky || []);
    if (poz.length) await must(sb.from("pozemky").insert(poz.map(p => ({ rizeni: id, katastr_kod: r.A?.kuKod || 0, parcela: p.parcela, vymera: p.vymera, druh: p.druh }))));
    await must(sb.from("soubory").insert(r.files.map(f => ({ rizeni: id, nazev: f.nazev, cast_dokumentace: f.part, sha256: f.sha256, ma_text: f.maText ?? null, pdfa: f.pdfa ?? null, pocet_podpisu: f.podpisy ?? null, ma_casove_razitko: f.razitko ?? null }))));
    await must(sb.from("kontroly").insert(r.kontroly.map(k => ({ rizeni: id, pravidlo: k.pravidlo, vysledek: k.vysledek, blokujici: k.blokujici, zduvodneni: k.zduvodneni }))));
    await must(sb.from("udalosti").insert({ rizeni: id, typ: "balicek.analyzovan", puvodce: user.id, data: { souboru: r.files.length, blokuje: r.kontroly.filter(k => k.vysledek === "blokuje").length } }));
    R.saved = id; renderSave(); toast("Řízení uloženo jako koncept.");
  } catch (e){ btn.disabled = false; toast("Uložení se nepodařilo: " + (e.message || e)); }
}

/* ---------- vstup ---------- */
async function take(file){
  if (!file) return;
  try { await analyze(file); }
  catch (e){ if ($("#progress")) $("#progress").hidden = true; if ($("#out")) $("#out").innerHTML = `<div class="issue"><b>Balíček se nepodařilo zpracovat.</b> ${esc(e.message || e)} Zkontrolujte, že jde o ZIP.</div>`; }
}
window.Povolovna = { take, render, get result(){ return R; } };
const drop = document.body.dataset.page === "podani" ? $("#drop") : null;
if (drop){
["dragover", "dragenter"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", ev => take(ev.dataTransfer.files[0]));
$("#file").addEventListener("change", ev => take(ev.target.files[0]));
}
})();
