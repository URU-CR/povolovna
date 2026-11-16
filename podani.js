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
let user = null, R = null, batch = false;
const sel = { dok: null, pri: [] }, api = {};
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
document.addEventListener("click", e => { if (e.target.id === "extract") extractAll(); });
document.addEventListener("change", e => { if (e.target.id === "att" && e.target.files.length) addAttachments([...e.target.files]); });
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
const PART_NAME = { priloha: "Přidané přílohy", zadost: "Žádost z portálu", A: "A Průvodní list", B: "B Souhrnná technická zpráva", C: "C Situační výkresy", D: "D Dokumentace objektů", doklad: "Doklady", jine: "Mimo manifest" };
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

/* ---------- příslušnost v roce 2027, orientační ---------- */
function prislusnost(z){
  const d = ((z?.druh || "") + " " + (z?.nazev || "")).toLowerCase();
  if (/dálnic|dráh|drah|nádraž|železni|tramvaj|trolejbus|letišt|letec|jadern/.test(d)) return { uroven: "uru", urad: "Úřad rozvoje území ČR", duvod: "podle druhu stavby jde zřejmě o vyhrazenou stavbu (příloha č. 3)" };
  return { uroven: "jiny", urad: "obecní nebo krajský stavební úřad", duvod: "podle druhu stavby zřejmě nejde o vyhrazenou stavbu; do 31. 12. 2027 ji povoluje dosavadní stavební úřad a tato ukázka pro ni určená není" };
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
    const rec = { nazev: name, cesta: nfc(f.name), part: mi?.part || "jine", velikost: bytes.length, sha256: sha, md5ok: mi ? SparkMD5.ArrayBuffer.hash(buf) === mi.md5 : null, pdf: /\.pdf$/i.test(name), bytes };
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
  R = { balicek: file.name, manifest, files, zadost, A, prislusnost: prislusnost(zadost) };
  R.nalezy = compare(R); R.kontroly = checks(R);
  if (!batch){ if ($("#progress")) $("#progress").hidden = true; render(); }
}

/* ---------- další přílohy ---------- */
async function addAttachments(list){
  if (!R) return;
  const items = [];
  for (const file of list){
    if (/\.zip$/i.test(file.name)){
      if (batch) step(`Rozbaluji přílohy: ${file.name}`);
      const zip = await JSZip.loadAsync(file, { decodeFileName: b => new TextDecoder("utf-8").decode(b) });
      for (const f of Object.values(zip.files)) if (!f.dir && !/(^|\/)(\.|__MACOSX)/.test(f.name)) items.push({ name: base(f.name), bytes: await f.async("uint8array") });
    } else items.push({ name: nfc(file.name), bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  let n = 0;
  for (const { name, bytes } of items){
    if (batch) step(`Čtu přílohy ${++n} z ${items.length}: ${name}`);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(b => b.toString(16).padStart(2, "0")).join("");
    if (R.files.some(f => f.sha256 === sha)){ if (!batch) toast(`${name} už v podání je.`); continue; }
    const rec = { nazev: name, cesta: name, part: "priloha", velikost: bytes.length, sha256: sha, md5ok: null, pdf: /\.pdf$/i.test(name), bytes };
    if (rec.pdf){
      Object.assign(rec, pdfMarks(bytes));
      try { const t = await pdfLines(bytes, 2); rec.stran = t.numPages; rec.maText = t.pages.flat().join(" ").length > 40; } catch (e){ rec.chyba = "PDF se nepodařilo otevřít"; }
    }
    R.files.push(rec);
  }
  R.saved = null; R.kontroly = checks(R); if (!batch){ await keep(); render(); }
}

/* ---------- čtení skenů a vytěžení dokladů ---------- */
let ocrWorker = null;
async function ocrPdf(bytes, maxPages){
  if (!window.Tesseract) throw new Error("Čtení skenů není v této verzi k dispozici.");
  ocrWorker = ocrWorker || await Tesseract.createWorker("ces", 1, { workerPath: "vendor/ocr/worker.min.js", corePath: "vendor/ocr/", langPath: "vendor/ocr/lang", workerBlobURL: false, gzip: true });
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; let text = "";
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++){
    const pg = await doc.getPage(p), vp = pg.getViewport({ scale: 2 }), c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    text += (await ocrWorker.recognize(c)).data.text + "\n";
    c.width = c.height = 0;
  }
  await doc.destroy(); return text;
}
const MES = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
function extractDoc(text, parcely, skip){
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean), head = lines.slice(0, 30).join("\n"), now = Date.now();
  // datum: přednost má popisek DATUM, jinak první datum v záhlaví, které není „ze dne" (datum žádosti) ani platnost
  const dates = [];
  for (const m of head.matchAll(new RegExp("(\\d{1,2})\\.\\s?(?:(\\d{1,2})\\.|(" + MES.join("|") + "))\\s?(20\\d{2})", "gi"))){
    const mm = m[2] ? +m[2] : MES.indexOf(m[3].toLowerCase()) + 1, dt = new Date(+m[4], mm - 1, +m[1]);
    if (isNaN(dt) || dt.getTime() > now || /(ze dne|platnost\w*|do)\s*:?\s*$/i.test(head.slice(Math.max(0, m.index - 14), m.index))) continue;
    dates.push(dt);
  }
  const lab = /DATUM\s*:?\s*(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})/i.exec(head);
  const d = lab ? new Date(+lab[3], +lab[2] - 1, +lab[1]) : dates[0];
  const zn = /NAŠE\s+(?:Č\.\s?J\.|ZN(?:AČKA)?\.?)\s*:?\s*([A-Z0-9][\w\/\-.]{3,40})/i.exec(head) || /(?:č\.\s?j\.|sp\.\s?zn\.|zn(?:ačka)?\.?)\s*:\s*([A-Z0-9][\w\/\-.]{3,40})/i.exec(head);
  const vydal = lines.slice(0, 8).filter(l => /^[A-ZÁ-Ž][\wá-žÁ-Ž.,\- ]{6,70}$/.test(l) && l.split(" ").length >= 2 && !/^(VÁŠ|NAŠE|ZE DNE|SPIS|VYŘIZUJE|TELEFON|DATUM|Dobrý den|Vážen)/i.test(l) && !(skip || []).some(x => x && l.toLowerCase().includes(x))).slice(0, 2).join(", ");
  const neg = /(?<![a-zá-ž])nesouhlas(í|íme)(?![a-zá-ž])/i.test(text), pos = /(?<![a-zá-ž])souhlas(í|íme)(?![a-zá-ž])|souhlasné|bez připomínek|nemá(me)? (námitek|připomínek)/i.test(text);
  const cond = /do doby splnění|za podmín|při (dodržení|splnění) [^.\n]{0,30}podmín|podmín(ky|ek|kami)\s*:|s podmínkami/i.test(text);
  const stanovisko = neg ? (cond ? "nesouhlas do splnění podmínky" : "nesouhlas") : pos ? (cond ? "souhlas s podmínkami" : "souhlas") : /nedojde ke střetu|nedochází ke střetu|se nenachází|nenacház[íe]jí|není dotčen/i.test(text) ? "bez dotčení" : "neurčeno";
  const druh = /závazné stanovisko/i.test(head) ? "závazné stanovisko" : /plná moc|plnou moc|zmocňuj/i.test(head) ? "plná moc" : /existenc[ei] (podzemních )?sítí|poloze sítě|o existenci/i.test(head) ? "existence sítí" : /vyjádření/i.test(head) ? "vyjádření" : /stanovisko/i.test(head) ? "stanovisko" : /sdělení/i.test(head) ? "sdělení" : /souhlas/i.test(head) ? "souhlas" : "jiné";
  const vlastnik = /jako vlastník\w* (dotčen|pozemk)|vlastníka (dotčen\w+ )?pozemk|souhlas vlastníka/i.test(text);
  const pl = /platnost[^.\n]{0,40}?(\d+)\s*(rok|let|měsíc)/i.exec(text);
  return { druh, vydal: vydal || null, znacka: zn ? zn[1].replace(/[.,]$/, "") : null, datum: d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null,
    stanovisko, podminky: cond, vlastnik, platnost: pl ? pl[1] + " " + pl[2] : null,
    parcely: parcely.filter(k => new RegExp("(?<![\\d/])" + k.replace("/", "\\/") + "(?![\\d/])").test(text)) };
}
let extracting = false;
async function extractAll(){
  if (!R || extracting) return; extracting = true;
  const docs = R.files.filter(f => f.pdf && (f.part === "doklad" || f.part === "priloha") && !f.vyt && !f.chyba);
  const parcely = [...new Set([...(R.A?.pozemky || []), ...(R.zadost?.pozemky || [])].map(p => p.parcela))];
  const skip = [R.zadost?.zadatel?.nazev, R.zadost?.zastupce?.nazev].filter(Boolean).map(x => x.toLowerCase().replace(/,?\s*(a\.\s?s\.|s\.\s?r\.\s?o\.|spol\. s r\.\s?o\.)\s*$/i, "").trim());
  let n = 0;
  for (const f of docs){
    const msg = `Vytěžuji doklady a přílohy ${++n} z ${docs.length}: ${f.nazev}${f.maText === false ? " (sken)" : ""}`, st = $("#extstate");
    if (batch) step(msg); else if (st) st.textContent = msg;
    try {
      const text = f.maText === false ? await ocrPdf(f.bytes, 3) : (await pdfLines(f.bytes, 6)).pages.flat().join("\n");
      f.vyt = extractDoc(text, parcely, skip); f.ocr = f.maText === false;
    } catch (e){ f.vyt = { druh: "jiné", stanovisko: "neurčeno", parcely: [], chyba: e.message || String(e) }; }
  }
  extracting = false; R.vytezeno = true; R.saved = null; R.kontroly = checks(R); if (!batch){ await keep(); render(); }
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
  if (r.vytezeno){
    const vy = r.files.filter(f => f.vyt), cz = d => d ? d.split("-").reverse().map(Number).join(". ") : "bez data";
    const vl = vy.filter(f => f.vyt.vlastnik).sort((a, b) => (b.vyt.datum || "").localeCompare(a.vyt.datum || ""));
    const vse = [...new Set([...(r.A?.pozemky || []), ...(r.zadost?.pozemky || [])].map(p => p.parcela))];
    if (!vl.length) add("souhlas_vlastnika", "Souhlas vlastníka pozemků", "blokuje", true, "Mezi doklady ani přílohami není vyjádření vlastníka pozemků. Nahrajte ho jako přílohu.");
    else {
      const f = vl[0], v = f.vyt, chybi = vse.filter(k => !v.parcely.includes(k));
      if (/^nesouhlas/.test(v.stanovisko)) add("souhlas_vlastnika", "Souhlas vlastníka pozemků", "blokuje", true, `Nejnovější vyjádření vlastníka (${f.nazev}, ${cz(v.datum)}) zní: ${v.stanovisko}. Nahrajte platný souhlas jako přílohu.`);
      else if (!/^souhlas/.test(v.stanovisko)) add("souhlas_vlastnika", "Souhlas vlastníka pozemků", "upozorneni", true, `Z vyjádření vlastníka (${f.nazev}, ${cz(v.datum)}) se nepodařilo určit, zda souhlasí. Ověřte ručně.`);
      else add("souhlas_vlastnika", "Souhlas vlastníka pozemků", chybi.length ? "upozorneni" : "ok", true, `Vlastník souhlasí (${f.nazev}, ${cz(v.datum)}${v.podminky ? ", s podmínkami" : ""}).` + (chybi.length ? ` Ve vyjádření nejsou zmíněny parcely ${chybi.join(", ")}.` : ` Zmiňuje všech ${vse.length} parcel.`) + (vl.length > 1 ? ` Starší vyjádření: ${vl.length - 1}.` : ""));
    }
    const c = x => vy.filter(f => !f.vyt.vlastnik && x.test(f.vyt.stanovisko)).length, ne = c(/^nesouhlas/);
    add("stanoviska", "Stanoviska v dokladech a přílohách", ne ? "upozorneni" : "ok", false, `Z ${vy.length} dokumentů: ${c(/^souhlas$/)} souhlas, ${c(/^souhlas s/)} souhlas s podmínkami, ${c(/^bez/)} bez dotčení, ${ne} nesouhlas, ${c(/^neurč/)} neurčeno. Pravidla jsou orientační, výsledek ověřte.`);
  }
  return k;
}

/* ---------- zobrazení ---------- */
const PILL = { ok: ["ok", "V pořádku"], upozorneni: ["warn", "Upozornění"], blokuje: ["bad", "Brání odeslání"], neprovedeno: ["idle", "Neprovedeno"] };
const yes = (v, t = "ano", f = "ne") => v ? `<span class="pill ok">${t}</span>` : `<span class="pill warn">${f}</span>`;
const BLOCKS = [
  ["soubory", "Balíček a soubory", ["manifest", "uplnost"]],
  ["zadost", "Žádost", []],
  ["pozemky", "Pozemky", ["shoda_pozemku", "shoda_udaju"]],
  ["format", "Formát a autorizace souborů", ["format_pdfa3", "autorizacni_razitko", "casove_razitko", "textova_vrstva"]],
  ["doklady", "Doklady a přílohy", ["souhlas_vlastnika", "stanoviska"]]
];
const RANK = { blokuje: 3, upozorneni: 2, neprovedeno: 1, ok: 0 };
const openBlocks = new Set();
document.addEventListener("toggle", e => { const id = e.target.dataset && e.target.dataset.block; if (id) e.target.open ? openBlocks.add(id) : openBlocks.delete(id); }, true);
document.addEventListener("click", e => {
  const m = e.target.dataset && e.target.dataset.expand; if (!m || !R) return;
  openBlocks.clear();
  const has = (rules, v) => R.kontroly.some(k => rules.includes(k.pravidlo) && k.vysledek === v);
  for (const [id, , rules] of BLOCKS) if (m === "vse" || (m === "chyby" && has(rules, "blokuje")) || (m === "upozorneni" && has(rules, "upozorneni"))) openBlocks.add(id);
  render();
});
function blockState(rules){ return R.kontroly.filter(k => rules.includes(k.pravidlo)).reduce((w, k) => RANK[k.vysledek] > RANK[w] ? k.vysledek : w, "ok"); }
function render(){
  if (!R || !$("#out")) return;
  const r = R, z = r.zadost, a = r.A, blokK = r.kontroly.filter(k => k.vysledek === "blokuje"), upoK = r.kontroly.filter(k => k.vysledek === "upozorneni");
  const parts = ["zadost", "A", "B", "C", "D", "doklad", "priloha", "jine"].map(p => [p, r.files.filter(f => f.part === p)]).filter(x => x[1].length);
  const os = (n, o) => o ? `<dt>${n}</dt><dd>${esc(o.nazev)}${o.ico ? `, IČO ${esc(o.ico)}` : ""} <span class="src">žádost XML</span></dd>` : "";
  const dp = r.files.filter(f => f.part === "doklad" || f.part === "priloha");
  const body = {
    soubory: `<p class="small">Balíček ${esc(r.balicek)}: ${r.files.length} souborů${r.manifest ? `, formát BPP ${esc(r.manifest.verze)}, vytvořil ${esc(r.manifest.vytvoril)}` : ""}.</p>
      <div class="tblwrap"><table><tr><th>Část</th><th class="r">Souborů</th></tr>${parts.map(([p, fs]) => `<tr><td>${PART_NAME[p]}</td><td class="r num">${fs.length}</td></tr>`).join("")}</table></div>`,
    zadost: z ? `<dl class="kv">
      <dt>Číslo záměru</dt><dd class="mono">${esc(z.pid)}</dd>
      <dt>Název</dt><dd>${esc(z.nazev)} <span class="src">žádost XML</span></dd>
      ${a?.nazev ? `<dt>Název v dokumentaci</dt><dd>${esc(a.nazev)} <span class="src">A, průvodní list</span></dd>` : ""}
      <dt>Místo</dt><dd>${esc(z.misto)}${a?.ku ? `, k. ú. ${esc(a.ku)} [${a.kuKod}]` : ""}</dd>
      <dt>Druh stavby</dt><dd>${z.novaStavba ? "nová stavba, " : ""}${esc(z.druh)}</dd>
      <dt>Příslušný úřad</dt><dd>${esc(r.prislusnost.urad)} <span class="pill info">odhad systému</span> <span class="small muted">${esc(r.prislusnost.duvod)}.</span></dd>
      <dt>Termíny</dt><dd>${esc(z.zahajeni)} až ${esc(z.dokonceni)}</dd>
      ${os("Stavebník", z.zadatel)}${os("Zástupce", z.zastupce)}${os("Stavební podnikatel", z.podnikatel)}
      ${a?.autorizace.length ? `<dt>Autorizace</dt><dd>${a.autorizace.map(esc).join(", ")} <span class="src">A, průvodní list</span></dd>` : ""}
    </dl>` : `<p class="small muted">Žádost v XML nebyla v balíčku nalezena.</p>`,
    pozemky: z || a ? `<div class="tblwrap"><table><tr><th>Parcela</th><th class="r">Výměra v dokumentaci</th><th class="r">Výměra v žádosti</th><th>Druh</th><th>Stav</th></tr>
      ${[...new Set([...(a?.pozemky || []), ...(z?.pozemky || [])].map(p => p.parcela))].map(k => { const p = a?.pozemky.find(x => x.parcela === k), q = z?.pozemky.find(x => x.parcela === k);
        const st = !a || !z ? `<span class="pill idle">neporovnáno</span>` : !q ? `<span class="pill bad">chybí v žádosti</span>` : !p ? `<span class="pill bad">chybí v dokumentaci</span>` : p.vymera !== q.vymera ? `<span class="pill warn">jiná výměra</span>` : `<span class="pill ok">souhlasí</span>`;
        return `<tr><td class="mono">${esc(k)}</td><td class="r num">${p?.vymera ?? "–"}</td><td class="r num">${q?.vymera ?? "–"}</td><td>${esc(p?.druh || q?.druh || "")}</td><td>${st}</td></tr>`; }).join("")}
      </table></div>` : "",
    format: `<p class="small muted">Kontroluje se deklarace v souboru, ne plná validace. Tyto kontroly běží ve zkušebním režimu a neblokují.</p>
      <div class="tblwrap"><table><tr><th>Část</th><th class="r">Souborů</th><th class="r">PDF/A-3</th><th class="r">S podpisem</th><th class="r">S časovým razítkem</th><th class="r">Skenů bez textu</th></tr>
      ${parts.map(([p, fs]) => { const pd = fs.filter(f => f.pdf); return `<tr><td>${PART_NAME[p]}</td><td class="r num">${fs.length}</td><td class="r num">${pd.filter(f => f.pdfa && f.pdfa[0] === "3").length}</td><td class="r num">${pd.filter(f => f.podpisy).length}</td><td class="r num">${pd.filter(f => f.razitko).length}</td><td class="r num">${pd.filter(f => f.maText === false).length}</td></tr>`; }).join("")}
      </table></div>
      <details class="inner" style="margin-top:12px"><summary>Všech ${r.files.length} souborů</summary>
      <div class="tblwrap" style="margin-top:8px"><table><tr><th>Soubor</th><th>Část</th><th>Otisk dle manifestu</th><th>PDF/A</th><th>Podpis</th><th>Čas. razítko</th><th>Text</th></tr>
      ${r.files.map(f => `<tr><td class="small">${esc(f.nazev)}${f.chyba ? `<br><span class="pill bad">${esc(f.chyba)}</span>` : ""}</td><td class="small">${p_short(f.part)}</td><td>${f.md5ok === null ? `<span class="pill idle">není v manifestu</span>` : yes(f.md5ok, "souhlasí", "nesouhlasí")}</td>${f.pdf ? `<td>${f.pdfa ? `<span class="pill ${f.pdfa[0] === "3" ? "ok" : "warn"}">${esc(f.pdfa)}</span>` : `<span class="pill warn">ne</span>`}</td><td>${yes(f.podpisy)}</td><td>${yes(f.razitko)}</td><td>${f.maText === undefined ? "" : yes(f.maText, "ano", "sken")}</td>` : `<td colspan="4" class="small muted">není PDF</td>`}</tr>`).join("")}
      </table></div></details>`,
    doklady: `<p class="small">${dp.filter(f => f.part === "doklad").length} dokladů v balíčku, ${dp.filter(f => f.part === "priloha").length} přidaných příloh. Další přílohy můžete přidat i teď, jako ZIP nebo jednotlivá PDF.</p>
      <div class="row"><label class="btn" for="att">Přidat přílohy</label><input id="att" type="file" accept=".pdf,.zip" multiple hidden>
        ${dp.some(f => f.pdf && !f.vyt) ? `<button class="btn brand" id="extract">Vytěžit ${r.vytezeno ? "nově přidané" : "doklady a přílohy"}</button>` : ""}
        <span class="small muted" id="extstate">${dp.some(f => f.pdf && !f.vyt) ? "některé dokumenty ještě nejsou vytěžené" : "vše vytěženo"}</span></div>
      ${(() => {
        const head = `<tr><th>Soubor</th><th>Druh</th><th>Vydal (odhad)</th><th>Značka</th><th>Datum</th><th>Stanovisko</th><th>Zmíněné parcely</th></tr>`;
        const row = f => { const v = f.vyt;
          const pill = !v ? `<span class="pill idle">nevytěženo</span>` : `<span class="pill ${/^nesouhlas/.test(v.stanovisko) ? "bad" : /podm/.test(v.stanovisko) ? "warn" : /^souhlas|^bez/.test(v.stanovisko) ? "ok" : "idle"}">${esc(v.stanovisko)}</span>`;
          return `<tr><td class="small">${esc(f.nazev)}${f.part === "priloha" ? ` <span class="pill info">příloha</span>` : ""}${f.ocr ? ` <span class="src">sken</span>` : ""}${v?.chyba ? `<br><span class="pill bad">${esc(v.chyba)}</span>` : ""}</td><td class="small">${esc(v?.druh || "")}${v?.vlastnik ? `<br><b>vlastník pozemků</b>` : ""}</td><td class="small">${esc(v?.vydal || "")}</td><td class="small mono">${esc(v?.znacka || "")}</td><td class="small num">${v?.datum ? v.datum.split("-").reverse().map(Number).join(". ") : ""}</td><td>${pill}</td><td class="small mono">${esc((v?.parcely || []).join(", "))}</td></tr>`; };
        const key = f => f.part === "priloha" || !f.vyt || f.vyt.vlastnik || f.vyt.chyba || /^nesouhlas/.test(f.vyt.stanovisko);
        const top = dp.filter(key).sort((x, y) => (y.vyt?.vlastnik || 0) - (x.vyt?.vlastnik || 0)), rest = dp.filter(f => !key(f));
        return (top.length ? `<p class="small muted" style="margin-top:6px">Přílohy, vyjádření vlastníka a dokumenty s nesouhlasem nebo chybou:</p><div class="tblwrap"><table>${head}${top.map(row).join("")}</table></div>` : "")
          + (rest.length ? `<details class="inner" style="margin-top:12px"><summary>Ostatní doklady (${rest.length})</summary><div class="tblwrap" style="margin-top:8px"><table>${head}${rest.map(row).join("")}</table></div></details>` : "");
      })()}`
  };
  const cnt = st => (st === "blokuje" ? blokK : upoK).length;
  $("#out").innerHTML = `
  <div class="issue ${blokK.length ? "" : upoK.length ? "soft" : "fixed"}">
    <b>${blokK.length ? `Odeslání brání ${blokK.length} ${blokK.length === 1 ? "věc" : blokK.length < 5 ? "věci" : "věcí"}` : "Nic nebrání odeslání"}${upoK.length ? `, ${upoK.length} upozornění` : ""}.</b>
    ${blokK.length ? `<ul class="find" style="margin-top:8px">${blokK.map(k => `<li><span class="pill bad">${esc(k.nazev)}</span><span class="small">${esc(k.zduvodneni)}</span></li>`).join("")}</ul>` : ""}
  </div>
  <div class="row"><span class="small muted">Rozbalit</span>
    <button class="btn" data-expand="chyby" ${cnt("blokuje") ? "" : "disabled"}>Chyby (${cnt("blokuje")})</button>
    <button class="btn" data-expand="upozorneni" ${cnt("upozorneni") ? "" : "disabled"}>Upozornění (${cnt("upozorneni")})</button>
    <button class="btn" data-expand="vse">Vše</button>
    <button class="btn link small" data-expand="nic">Sbalit vše</button></div>
  ${BLOCKS.map(([id, title, rules]) => { const ks = r.kontroly.filter(k => rules.includes(k.pravidlo)), st = blockState(rules), n = x => ks.filter(k => k.vysledek === x).length;
    return `<details class="blk st-${st}" data-block="${id}" ${openBlocks.has(id) ? "open" : ""}>
      <summary><span class="bt">${title}</span><span class="row" style="gap:6px">${n("blokuje") ? `<span class="pill bad">chyby: ${n("blokuje")}</span>` : ""}${n("upozorneni") ? `<span class="pill warn">upozornění: ${n("upozorneni")}</span>` : ""}${ks.length && !n("blokuje") && !n("upozorneni") ? `<span class="pill ok">v pořádku</span>` : ""}${!ks.length ? `<span class="pill idle">k nahlédnutí</span>` : ""}</span></summary>
      <div class="stack" style="margin-top:12px">
        ${ks.length ? `<ul class="find">${ks.map(k => `<li><span class="pill ${PILL[k.vysledek][0]}">${PILL[k.vysledek][1]}</span><span class="small"><b>${esc(k.nazev)}.</b> ${esc(k.zduvodneni)}${k.blokujici ? "" : ` <span class="muted">Zkušební režim, neblokuje.</span>`}</span></li>`).join("")}</ul>` : ""}
        ${body[id]}
      </div></details>`; }).join("")}
  <section class="card stack" id="savebox"></section>`;
  renderSave();
}
const p_short = p => ({ zadost: "žádost", doklad: "doklad", priloha: "příloha", jine: "mimo" }[p] || p);
function renderSave(){
  const b = $("#savebox"); if (!b) return;
  b.innerHTML = `<h3>Uložit do databáze</h3>
    <p class="small">Uloží se údaje žádosti, pozemky, výsledky kontrol, vytěžené údaje z dokladů a příloh a u každého souboru název, otisk a zjištěné vlastnosti. Samotné soubory zůstávají ve vašem počítači.</p>
    <p class="small muted">${R.ulozenoLokalne ? "Soubory jsou uschované v tomto prohlížeči, takže je po obnovení stránky najdete znovu, včetně pohledu úřadu. Smažete je tlačítkem pro nahrání jiných souborů." : "Soubory se nepodařilo uschovat v prohlížeči; po obnovení stránky je bude potřeba nahrát znovu."}</p>
    ${R.saved ? `<p><span class="pill ok">Uloženo</span> <span class="mono small">${esc(R.saved)}</span></p>`
      : user ? `<div><button class="btn pri" id="save">Uložit řízení jako koncept</button></div>`
      : `<p class="small muted">Pro uložení se nahoře přihlaste odkazem z e-mailu. Výsledky analýzy vidíte i bez přihlášení.</p>`}`;
}

/* ---------- uložení ---------- */
async function save(){
  const r = R, z = r.zadost || {}, btn = $("#save"); btn.disabled = true;
  const must = async q => { const { data, error } = await q; if (error) throw error; return data; };
  try {
    const row = await must(sb.from("rizeni").insert({ typ: "povoleni_zrychlene", nazev: z.nazev || r.A?.nazev || r.balicek, cislo_zameru: z.pid || null, stav: "koncept", zalozil: user.id, urad: r.prislusnost?.urad || null, utvar: r.prislusnost?.uroven || null,
      zadost: { zadost: r.zadost, pruvodni_list: r.A, nalezy: r.nalezy } }).select("id").single());
    const id = row.id, poz = r.A?.pozemky.length ? r.A.pozemky : (z.pozemky || []);
    if (poz.length) await must(sb.from("pozemky").insert(poz.map(p => ({ rizeni: id, katastr_kod: r.A?.kuKod || 0, parcela: p.parcela, vymera: p.vymera, druh: p.druh }))));
    const sou = await must(sb.from("soubory").insert(r.files.map(f => ({ rizeni: id, nazev: f.nazev, cast_dokumentace: f.part, sha256: f.sha256, ma_text: f.maText ?? null, pdfa: f.pdfa ?? null, pocet_podpisu: f.podpisy ?? null, ma_casove_razitko: f.razitko ?? null }))).select("id,sha256"));
    const sid = new Map(sou.map(x => [x.sha256, x.id])), vy = r.files.filter(f => f.vyt && !f.vyt.chyba);
    if (vy.length) await must(sb.from("vyjadreni").insert(vy.map(f => ({ rizeni: id, soubor: sid.get(f.sha256), druh: f.vyt.vlastnik ? "vyjádření vlastníka" : f.vyt.druh, vydal_nazev: f.vyt.vydal, znacka: f.vyt.znacka, ze_dne: f.vyt.datum, stanovisko: f.vyt.stanovisko,
      souhlasne: /^souhlas|^bez/.test(f.vyt.stanovisko) ? true : /^nesouhlas/.test(f.vyt.stanovisko) ? false : null, podminky: { obsahuje_podminky: f.vyt.podminky, parcely: f.vyt.parcely, platnost: f.vyt.platnost, cteno_ze_skenu: !!f.ocr } }))));
    await must(sb.from("kontroly").insert(r.kontroly.map(k => ({ rizeni: id, pravidlo: k.pravidlo, vysledek: k.vysledek, blokujici: k.blokujici, zduvodneni: k.zduvodneni }))));
    await must(sb.from("udalosti").insert({ rizeni: id, typ: "balicek.analyzovan", puvodce: user.id, data: { souboru: r.files.length, blokuje: r.kontroly.filter(k => k.vysledek === "blokuje").length } }));
    R.saved = id; renderSave(); toast("Řízení uloženo jako koncept.");
  } catch (e){ btn.disabled = false; toast("Uložení se nepodařilo: " + (e.message || e)); }
}

/* ---------- úschova v prohlížeči (IndexedDB): soubory přežijí obnovení stránky, nikam se neodesílají ---------- */
function idb(){ return new Promise((ok, no) => { const q = indexedDB.open("povolovna", 1); q.onupgradeneeded = () => q.result.createObjectStore("podani"); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); }
async function idbPut(val){ try { const d = await idb(); await new Promise((ok, no) => { const t = d.transaction("podani", "readwrite"); val ? t.objectStore("podani").put(val, "posledni") : t.objectStore("podani").delete("posledni"); t.oncomplete = ok; t.onerror = () => no(t.error); }); d.close(); return true; } catch (e){ return false; } }
async function idbGet(){ try { const d = await idb(); const v = await new Promise((ok, no) => { const q = d.transaction("podani").objectStore("podani").get("posledni"); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); d.close(); return v || null; } catch (e){ return null; } }
async function keep(){ if (R) R.ulozenoLokalne = await idbPut(Object.assign({}, R, { saved: null })); }

/* ---------- vstup: dokumentace + přílohy, pak vše naráz ---------- */
function mountUpload(){
  const b = $("#upbox"); if (!b) return;
  b.innerHTML = `<div class="up2">
    <label class="drop upt" data-up="dok" for="f-dok"><b>1 · Dokumentace</b><span class="small muted">ZIP z Portálu stavebníka (žádost, dokumentace, doklady)</span><span class="btn">Vybrat dokumentaci</span><span class="small">${sel.dok ? `<span class="pill ok">vybráno</span> ${esc(sel.dok.name)}` : "nevybráno"}</span></label>
    <input id="f-dok" type="file" accept=".zip" hidden>
    <label class="drop upt" data-up="pri" for="f-pri"><b>2 · Přílohy</b><span class="small muted">ZIP nebo jednotlivá PDF: souhlasy vlastníků, plné moci, další vyjádření</span><span class="btn">Vybrat přílohy</span><span class="small">${sel.pri.length ? `<span class="pill ok">${sel.pri.length}</span> ${sel.pri.map(f => esc(f.name)).join(", ")}` : "nepovinné"}</span></label>
    <input id="f-pri" type="file" accept=".zip,.pdf" multiple hidden>
  </div>
  <div class="row" style="margin-top:14px"><button class="btn pri big" id="runall" ${sel.dok ? "" : "disabled"}>Vytěžit vše</button>${sel.dok || sel.pri.length ? `<button class="btn" id="clearsel">Zrušit výběr</button>` : ""}<span class="small muted">Soubory se zpracují ve vašem prohlížeči a nikam se neodesílají. Čtení skenů potrvá několik minut.</span></div>`;
}
function pick(kind, files){
  if (!files.length) return;
  if (kind === "dok"){ const z = files.find(f => /\.zip$/i.test(f.name)); if (!z) return toast("Dokumentace musí být ZIP z Portálu stavebníka."); sel.dok = z; }
  else for (const f of files) if (/\.(zip|pdf)$/i.test(f.name) && !sel.pri.some(x => x.name === f.name && x.size === f.size)) sel.pri.push(f);
  mountUpload();
}
async function run(){
  if (!sel.dok) return toast("Nejdřív vyberte ZIP s dokumentací.");
  if (api.onStart) api.onStart();
  if ($("#upbox")) $("#upbox").hidden = true;
  batch = true;
  try { await analyze(sel.dok); await addAttachments(sel.pri); await extractAll(); }
  catch (e){ R = null; if ($("#out")) $("#out").innerHTML = `<div class="issue"><b>Soubory se nepodařilo zpracovat.</b> ${esc(e.message || e)} Zkontrolujte, že dokumentace je ZIP z Portálu stavebníka.</div>`; if ($("#upbox")) $("#upbox").hidden = false; }
  batch = false; if ($("#progress")) $("#progress").hidden = true;
  await keep(); render(); if (R && api.onDone) api.onDone();
}
document.addEventListener("change", e => {
  if (e.target.id === "f-dok") pick("dok", [...e.target.files]);
  if (e.target.id === "f-pri") pick("pri", [...e.target.files]);
});
document.addEventListener("click", e => {
  if (e.target.id === "runall") run();
  if (e.target.id === "clearsel"){ sel.dok = null; sel.pri = []; mountUpload(); }
});
for (const ev of ["dragover", "dragenter", "dragleave", "drop"]) document.addEventListener(ev, e => {
  const t = e.target.closest && e.target.closest("[data-up]"); if (!t) return;
  e.preventDefault(); t.classList.toggle("over", ev === "dragover" || ev === "dragenter");
  if (ev === "drop") pick(t.dataset.up, [...e.dataTransfer.files]);
});
Object.assign(api, { mountUpload, render, reset(){ R = null; sel.dok = null; sel.pri = []; idbPut(null); } });
Object.defineProperty(api, "result", { get: () => R });
window.Povolovna = api;
mountUpload();
api.restored = idbGet().then(v => { if (v && !R){ R = v; R.kontroly = checks(R); if (document.body.dataset.page === "podani"){ if ($("#upbox")) $("#upbox").hidden = true; render(); } if (api.onRestore) api.onRestore(); } return !!v; });
})();
