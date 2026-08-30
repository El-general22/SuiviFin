// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  Consult-Gherio — Gestion Financière                                    ║
// ║  app.js — Full application logic (Firebase 10 modular SDK)              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import { initializeApp }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, addDoc, getDocs,
         query, orderBy, deleteDoc, Timestamp, updateDoc }
                                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInAnonymously, signOut, onAuthStateChanged }
                                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── CONFIG ─────────────────────────────────────────────────────────────────
// Only the projectId lives here. Everything else is fetched from Firestore.
// Replace with your actual Firebase project ID.
const PROJECT_ID = "YOUR_PROJECT_ID";

// ── STATE ──────────────────────────────────────────────────────────────────
let db, auth;
let DATA = { recettes: [], depenses: [], justifs: [] };
let editingId = { recettes: null, depenses: null, justifs: null };

// ── BOOT ───────────────────────────────────────────────────────────────────
async function boot() {
  try {
    // Bootstrap app to read _config/app from Firestore
    const bootstrap = initializeApp({ projectId: PROJECT_ID, apiKey: "bootstrap" }, "bootstrap");
    const bDb = getFirestore(bootstrap);

    const [cfgSnap, authSnap] = await Promise.all([
      getDoc(doc(bDb, "_config", "app")),
      getDoc(doc(bDb, "_config", "auth")),
    ]);

    if (!cfgSnap.exists()) throw new Error("Document _config/app introuvable dans Firestore.");
    if (!authSnap.exists()) throw new Error("Document _config/auth introuvable dans Firestore.");

    const app = initializeApp(cfgSnap.data(), "main");
    db   = getFirestore(app);
    auth = getAuth(app);

    window._storedHash = authSnap.data().passwordHash;

    // Watch auth state
    onAuthStateChanged(auth, user => {
      if (user) {
        showApp();
      } else {
        hide("loading-screen");
        show("login-screen");
      }
    });

  } catch (e) {
    document.getElementById("loading-screen").innerHTML = `
      <div style="color:#FCA5A5;font-size:14px;text-align:center;max-width:340px;padding:32px;line-height:1.7">
        ❌ <strong>Erreur de démarrage Firebase</strong><br><br>
        <code style="font-size:11px;opacity:.7">${e.message}</code><br><br>
        Vérifiez que <strong>_config/app</strong> et <strong>_config/auth</strong> existent dans Firestore,
        et que les règles autorisent leur lecture publique.
      </div>`;
  }
}

// ── AUTH ───────────────────────────────────────────────────────────────────
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

window.doLogin = async function () {
  const pwd = val("pwd-input");
  const btn = document.getElementById("login-btn");
  if (!pwd) return;
  btn.disabled = true;
  setText("login-btn-text", "Vérification…");
  hide("login-error");
  try {
    const hash = await sha256(pwd);
    if (hash !== window._storedHash) throw new Error("wrong password");
    await signInAnonymously(auth);
    // onAuthStateChanged will call showApp()
  } catch {
    show("login-error");
    btn.disabled = false;
    setText("login-btn-text", "Accéder");
  }
};

window.doLogout = async function () {
  await signOut(auth);
  location.reload();
};

// ── SHOW APP ───────────────────────────────────────────────────────────────
async function showApp() {
  hide("login-screen");
  hide("loading-screen");
  const app = document.getElementById("app");
  app.style.display = "flex";
  setDate("r-date"); setDate("d-date"); setDate("j-date");
  await loadAll();
}

// ── LOAD ALL ───────────────────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadCollection("recettes"), loadCollection("depenses"), loadCollection("justifs")]);
  buildDashboard();
}

async function loadCollection(col) {
  const snap = await getDocs(query(collection(db, col), orderBy("date", "desc")));
  DATA[col] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render[col]();
}

// ── ID GENERATION ──────────────────────────────────────────────────────────
function generateId(prefix) {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}-${y}-${m}-${rand}`;
}

function prefillId(fieldId, prefix) {
  const field = document.getElementById(fieldId);
  if (!field.value) field.value = generateId(prefix);
}

// ── SAVE / UPDATE ──────────────────────────────────────────────────────────
window.saveRecette = async function () {
  const ht  = parseFloat(val("r-ht")) || 0;
  const tva = parseFloat(val("r-tva")) || 0;
  const ttc = val("r-ttc") ? parseFloat(val("r-ttc")) : ht + tva;
  const data = {
    ref:         val("r-ref") || generateId("FAC"),
    date:        val("r-date"),
    client:      val("r-client"),
    prestation:  val("r-prestation"),
    facture:     val("r-facture"),
    ht, tva, ttc,
    mode:        val("r-mode"),
    encaisse:    val("r-enc"),
    commentaire: val("r-comment"),
    updatedAt:   Timestamp.now(),
  };
  if (!data.date || !data.client || !data.prestation) { toast("Champs obligatoires manquants *", "error"); return; }
  await upsert("recettes", data);
  resetForm("recette");
};

window.saveDepense = async function () {
  const data = {
    ref:         val("d-ref") || generateId("DEP"),
    date:        val("d-date"),
    categorie:   val("d-cat"),
    souscat:     val("d-subcat"),
    fournisseur: val("d-fournisseur"),
    description: val("d-desc"),
    ttc:         parseFloat(val("d-ttc")) || 0,
    tva:         parseFloat(val("d-tva")) || 0,
    mode:        val("d-mode"),
    nojustif:    val("d-just"),
    projet:      val("d-projet"),
    statut:      val("d-statut"),
    averifier:   val("d-verif"),
    commentaire: val("d-comment"),
    updatedAt:   Timestamp.now(),
  };
  if (!data.date || !data.categorie || !data.fournisseur) { toast("Champs obligatoires manquants *", "error"); return; }
  await upsert("depenses", data);
  resetForm("depense");
};

window.saveJustif = async function () {
  const link = val("j-link").trim();
  const data = {
    ref:      val("j-ref") || generateId("JUST"),
    numero:   val("j-num") || generateId("JUST"),
    date:     val("j-date"),
    type:     val("j-type"),
    fourn:    val("j-fourn"),
    montant:  parseFloat(val("j-montant")) || 0,
    depense:  val("j-depense"),
    format:   val("j-format"),
    fichier:  val("j-fichier"),
    onedriveLink: link,
    statut:   val("j-statut"),
    updatedAt: Timestamp.now(),
  };
  if (!data.date || !data.fourn) { toast("Champs obligatoires manquants *", "error"); return; }
  await upsert("justifs", data);
  resetForm("justif");
};

async function upsert(col, data) {
  const id = editingId[col];
  try {
    if (id) {
      await updateDoc(doc(db, col, id), data);
      toast("Mise à jour effectuée ✓", "success");
      editingId[col] = null;
    } else {
      data.createdAt = Timestamp.now();
      await addDoc(collection(db, col), data);
      toast("Enregistrement sauvegardé ✓", "success");
    }
    await loadCollection(col);
    buildDashboard();
  } catch (e) {
    toast("Erreur Firebase : " + e.message, "error");
  }
}

// ── DELETE ──────────────────────────────────────────────────────────────────
window.deleteRecord = async function (col, id) {
  if (!confirm("Supprimer cet enregistrement ? Cette action est irréversible.")) return;
  try {
    await deleteDoc(doc(db, col, id));
    toast("Supprimé ✓", "success");
    await loadCollection(col);
    buildDashboard();
  } catch (e) {
    toast("Erreur : " + e.message, "error");
  }
};

// ── EDIT (pre-fill form) ────────────────────────────────────────────────────
window.editRecord = function (col, id) {
  const item = DATA[col].find(d => d.id === id);
  if (!item) return;
  editingId[col] = id;

  if (col === "recettes") {
    setVal("r-ref", item.ref || "");
    setVal("r-date", item.date || "");
    setVal("r-client", item.client || "");
    setVal("r-prestation", item.prestation || "");
    setVal("r-facture", item.facture || "");
    setVal("r-ht", item.ht || "");
    setVal("r-tva", item.tva || "");
    setVal("r-ttc", item.ttc || "");
    setVal("r-mode", item.mode || "");
    setVal("r-enc", item.encaisse || "");
    setVal("r-comment", item.commentaire || "");
    openForm("form-recette");
  } else if (col === "depenses") {
    setVal("d-ref", item.ref || "");
    setVal("d-date", item.date || "");
    setVal("d-cat", item.categorie || "");
    setVal("d-subcat", item.souscat || "");
    setVal("d-fournisseur", item.fournisseur || "");
    setVal("d-desc", item.description || "");
    setVal("d-ttc", item.ttc || "");
    setVal("d-tva", item.tva || "");
    setVal("d-mode", item.mode || "");
    setVal("d-just", item.nojustif || "");
    setVal("d-projet", item.projet || "");
    setVal("d-statut", item.statut || "");
    setVal("d-verif", item.averifier || "Non");
    setVal("d-comment", item.commentaire || "");
    openForm("form-depense");
  } else if (col === "justifs") {
    setVal("j-ref", item.ref || "");
    setVal("j-num", item.numero || "");
    setVal("j-date", item.date || "");
    setVal("j-type", item.type || "");
    setVal("j-fourn", item.fourn || "");
    setVal("j-montant", item.montant || "");
    setVal("j-depense", item.depense || "");
    setVal("j-format", item.format || "");
    setVal("j-fichier", item.fichier || "");
    setVal("j-link", item.onedriveLink || "");
    setVal("j-statut", item.statut || "");
    openForm("form-justif");
  }
  toast("Mode édition activé — modifiez puis sauvegardez", "info");
};

// ── RENDER ──────────────────────────────────────────────────────────────────
const encBadge  = v => v === "Oui" ? '<span class="badge badge-green">✅ Oui</span>' : v === "Non" ? '<span class="badge badge-red">Non</span>' : '<span class="badge badge-orange">⏳ Attente</span>';
const statBadge = v => !v ? "—" : (v.includes("Reçu") || v.includes("Classé")) ? `<span class="badge badge-green">${v}</span>` : (v.includes("Manquant") || v.includes("Attente") || v.includes("Introuvable")) ? `<span class="badge badge-orange">${v}</span>` : `<span class="badge badge-grey">${v}</span>`;
const verifBadge= v => v === "Oui" ? '<span class="badge badge-orange">⚠️ Oui</span>' : '<span class="badge badge-green">Non</span>';
const linkBtn   = (url) => url ? `<a href="${url}" target="_blank" rel="noopener" class="btn btn-sea btn-sm" title="Ouvrir OneDrive">🔗</a>` : "";

const render = {
  recettes() {
    const tb = document.getElementById("recettes-table-body");
    document.getElementById("recettes-count").textContent = DATA.recettes.length + " entrées";
    if (!DATA.recettes.length) {
      tb.innerHTML = emptyRow(9, "💰", "Aucune recette", 'Cliquez sur "+ Nouvelle recette"');
      return;
    }
    tb.innerHTML = DATA.recettes.map(r => `
      <tr data-s="${esc(r.client)} ${esc(r.prestation)} ${esc(r.facture)} ${esc(r.ref)} ${esc(r.date)}">
        <td><span class="badge badge-sea mono">${esc(r.ref || "—")}</span></td>
        <td>${fmt_date(r.date)}</td>
        <td><strong>${esc(r.client || "—")}</strong></td>
        <td class="grey-sm">${esc(r.prestation || "—")}</td>
        <td><span class="badge badge-grey mono">${esc(r.facture || "—")}</span></td>
        <td class="td-amount positive">${fmt(r.ht)}</td>
        <td class="td-amount">${fmt(r.ttc)}</td>
        <td class="grey-sm">${esc(r.mode || "—")}</td>
        <td>${encBadge(r.encaisse)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" onclick="editRecord('recettes','${r.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRecord('recettes','${r.id}')">🗑</button>
        </td>
      </tr>`).join("");
  },

  depenses() {
    const tb = document.getElementById("depenses-table-body");
    document.getElementById("depenses-count").textContent = DATA.depenses.length + " entrées";
    if (!DATA.depenses.length) {
      tb.innerHTML = emptyRow(10, "💳", "Aucune dépense", 'Cliquez sur "+ Nouvelle dépense"');
      return;
    }
    tb.innerHTML = DATA.depenses.map(d => `
      <tr data-s="${esc(d.categorie)} ${esc(d.fournisseur)} ${esc(d.description)} ${esc(d.ref)} ${esc(d.date)}">
        <td><span class="badge badge-sea mono">${esc(d.ref || "—")}</span></td>
        <td>${fmt_date(d.date)}</td>
        <td><span class="badge badge-sand sm">${esc(d.categorie || "—")}</span></td>
        <td><strong>${esc(d.fournisseur || "—")}</strong></td>
        <td class="grey-sm">${esc(d.description || "—")}</td>
        <td class="td-amount negative">${fmt(d.ttc)}</td>
        <td class="grey-sm">${esc(d.mode || "—")}</td>
        <td class="mono sm">${esc(d.nojustif || "—")}</td>
        <td>${statBadge(d.statut)}</td>
        <td>${verifBadge(d.averifier)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" onclick="editRecord('depenses','${d.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRecord('depenses','${d.id}')">🗑</button>
        </td>
      </tr>`).join("");
  },

  justifs() {
    const tb = document.getElementById("justifs-table-body");
    document.getElementById("justifs-count").textContent = DATA.justifs.length + " entrées";
    if (!DATA.justifs.length) {
      tb.innerHTML = emptyRow(10, "📎", "Aucun justificatif", 'Cliquez sur "+ Nouveau justificatif"');
      return;
    }
    tb.innerHTML = DATA.justifs.map(j => `
      <tr data-s="${esc(j.numero)} ${esc(j.fourn)} ${esc(j.type)} ${esc(j.ref)} ${esc(j.date)}">
        <td><span class="badge badge-sea mono">${esc(j.ref || j.numero || "—")}</span></td>
        <td>${fmt_date(j.date)}</td>
        <td class="grey-sm">${esc(j.type || "—")}</td>
        <td><strong>${esc(j.fourn || "—")}</strong></td>
        <td class="td-amount">${fmt(j.montant)}</td>
        <td class="grey-sm">${esc(j.depense || "—")}</td>
        <td class="grey-sm">${esc(j.format || "—")}</td>
        <td class="grey-sm truncate" title="${esc(j.fichier || "")}">${esc(j.fichier || "—")}</td>
        <td>${linkBtn(j.onedriveLink)}</td>
        <td>${statBadge(j.statut)}</td>
        <td class="actions-cell">
          <button class="btn btn-ghost btn-sm" onclick="editRecord('justifs','${j.id}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteRecord('justifs','${j.id}')">🗑</button>
        </td>
      </tr>`).join("");
  },
};

// ── DASHBOARD ───────────────────────────────────────────────────────────────
function buildDashboard() {
  const caA  = DATA.recettes.reduce((s,r) => s + (r.ttc||0), 0);
  const enc  = DATA.recettes.filter(r => r.encaisse === "Oui").reduce((s,r) => s + (r.ht||0), 0);
  const dep  = DATA.depenses.reduce((s,d) => s + (d.ttc||0), 0);
  const treso= enc - dep;
  const miss = DATA.depenses.filter(d => d.statut?.includes("Manquant")).length
             + DATA.justifs.filter(j => j.statut?.includes("Attente") || j.statut?.includes("Introuvable")).length;
  const cm   = new Date().getMonth();
  const caMois = DATA.recettes.filter(r => r.date && new Date(r.date).getMonth()===cm).reduce((s,r) => s+(r.ttc||0),0);
  const dMois  = DATA.depenses.filter(d => d.date && new Date(d.date).getMonth()===cm).reduce((s,d) => s+(d.ttc||0),0);

  setText("kpi-ca",    fmt(caMois));
  setText("kpi-dep",   fmt(dMois));
  setText("kpi-justif",miss);
  setText("d-ca-annual", fmt(caA));
  setText("d-encaisse",  fmt(enc));
  setText("d-depenses",  fmt(dep));
  const te = document.getElementById("d-treso");
  te.textContent = fmt(treso);
  te.className = "synth-value " + (treso >= 0 ? "positive" : "negative");
  setText("d-missing",  miss);
  setText("d-nb-fac",   DATA.recettes.length);

  // Recent activity
  const recent = [
    ...DATA.recettes.slice(0,6).map(r => ({...r, _t:"r"})),
    ...DATA.depenses.slice(0,6).map(d => ({...d, _t:"d"})),
  ].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,10);

  setText("recent-count", recent.length + " entrées récentes");
  const rb = document.getElementById("recent-table-body");
  if (!recent.length) {
    rb.innerHTML = emptyRow(6, "📋", "Aucune activité", "Commencez par saisir une recette ou une dépense");
    return;
  }
  rb.innerHTML = recent.map(r => {
    const isR = r._t === "r";
    return `<tr>
      <td><span class="badge badge-sea mono sm">${esc(r.ref||"—")}</span></td>
      <td>${fmt_date(r.date)}</td>
      <td>${isR ? '<span class="badge badge-green">Recette</span>' : '<span class="badge badge-orange">Dépense</span>'}</td>
      <td class="grey-sm">${esc((isR ? r.prestation : r.description)||"—")}</td>
      <td><strong>${esc((isR ? r.client : r.fournisseur)||"—")}</strong></td>
      <td class="td-amount ${isR?"positive":"negative"}">${isR?"+":"−"} ${fmt(r.ttc)}</td>
      <td>${isR ? encBadge(r.encaisse) : statBadge(r.statut)}</td>
    </tr>`;
  }).join("");
}

// ── SYNTHÈSE ────────────────────────────────────────────────────────────────
window.buildSynthese = function () {
  const caA = DATA.recettes.reduce((s,r)=>s+(r.ttc||0),0);
  const enc = DATA.recettes.filter(r=>r.encaisse==="Oui").reduce((s,r)=>s+(r.ht||0),0);
  const dep = DATA.depenses.reduce((s,d)=>s+(d.ttc||0),0);
  const tr  = enc - dep;
  setText("s-ca",  fmt(caA));
  setText("s-enc", fmt(enc));
  setText("s-dep", fmt(dep));
  const te = document.getElementById("s-treso");
  te.textContent = fmt(tr);
  te.className = "synth-value " + (tr>=0 ? "positive" : "negative");

  const mois = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const mCA = Array(12).fill(0);
  DATA.recettes.forEach(r => { if(r.date) mCA[new Date(r.date).getMonth()] += r.ttc||0; });
  const maxCA = Math.max(...mCA, 1);
  document.getElementById("monthly-bars").innerHTML = mois.map((m,i) => {
    const pct = ((mCA[i]/maxCA)*100).toFixed(1);
    const nb  = DATA.recettes.filter(r => r.date && new Date(r.date).getMonth()===i).length;
    return `<div class="month-row">
      <div class="month-name">${m}${mCA[i]===maxCA&&maxCA>0?" ⭐":""}</div>
      <div class="month-bar-wrap"><div class="month-bar" style="width:${pct}%"></div></div>
      <div class="month-amount">${mCA[i]>0?fmt(mCA[i]):"—"}</div>
      <div class="month-count">${nb>0?nb+" fac.":""}</div>
    </div>`;
  }).join("");

  const cats = {};
  DATA.depenses.forEach(d => { if(d.categorie) cats[d.categorie] = (cats[d.categorie]||0)+(d.ttc||0); });
  const total = Object.values(cats).reduce((a,b)=>a+b,0)||1;
  const cb = document.getElementById("cat-table-body");
  const sorted = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  cb.innerHTML = sorted.length
    ? sorted.map(([c,v]) => `<tr>
        <td><span class="badge badge-sea">${esc(c)}</span></td>
        <td class="td-amount">${fmt(v)}</td>
        <td class="td-amount grey-sm">${((v/total)*100).toFixed(1)} %</td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="text-align:center;padding:32px;color:var(--grey-500)">Aucune dépense enregistrée</td></tr>`;
};

// ── EXPORT ──────────────────────────────────────────────────────────────────
window.exportData = function () {
  const rows = [
    ["=== RECETTES ==="],
    ["Ref","Date","Client","Prestation","Facture","HT","TVA","TTC","Mode","Encaissé","Commentaire"],
    ...DATA.recettes.map(r=>[r.ref,r.date,r.client,r.prestation,r.facture,r.ht,r.tva,r.ttc,r.mode,r.encaisse,r.commentaire]),
    [],
    ["=== DÉPENSES ==="],
    ["Ref","Date","Catégorie","Fournisseur","Description","TTC","TVA","Mode","N°Justif","Statut","À vérifier"],
    ...DATA.depenses.map(d=>[d.ref,d.date,d.categorie,d.fournisseur,d.description,d.ttc,d.tva,d.mode,d.nojustif,d.statut,d.averifier]),
    [],
    ["=== JUSTIFICATIFS ==="],
    ["Ref","N°","Date","Type","Fournisseur","Montant","Lié à","Format","Fichier","Lien OneDrive","Statut"],
    ...DATA.justifs.map(j=>[j.ref,j.numero,j.date,j.type,j.fourn,j.montant,j.depense,j.format,j.fichier,j.onedriveLink,j.statut]),
  ];
  const tsv = rows.map(r => r.join("\t")).join("\n");
  const a = document.createElement("a");
  a.href = "data:text/tab-separated-values;charset=utf-8,\uFEFF" + encodeURIComponent(tsv);
  a.download = `Gestion_CG_${new Date().toISOString().slice(0,10)}.tsv`;
  a.click();
  toast("Export TSV téléchargé ✓", "success");
};

// ── PANEL NAV ───────────────────────────────────────────────────────────────
window.showPanel = function (name) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.getElementById("panel-" + name).classList.add("active");
  const order = ["dashboard","recettes","depenses","justifs","synthese"];
  const idx = order.indexOf(name);
  const btns = document.querySelectorAll(".nav-item");
  if (idx >= 0 && btns[idx]) btns[idx].classList.add("active");
  if (name === "synthese") window.buildSynthese();
};

window.toggleForm = function (id) {
  const el = document.getElementById(id);
  el.style.display = el.style.display === "none" ? "block" : "none";
};

function openForm(id) {
  document.getElementById(id).style.display = "block";
  document.getElementById(id).scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm(name) {
  const map = {
    recette: ["r-ref","r-client","r-prestation","r-facture","r-ht","r-tva","r-ttc","r-comment"],
    depense: ["d-ref","d-subcat","d-fournisseur","d-desc","d-ttc","d-tva","d-just","d-projet","d-comment"],
    justif:  ["j-ref","j-num","j-fourn","j-montant","j-depense","j-fichier","j-link"],
  };
  (map[name]||[]).forEach(id => setVal(id,""));
  const selects = {
    recette: ["r-mode","r-enc"],
    depense: ["d-cat","d-mode","d-statut","d-verif"],
    justif:  ["j-type","j-format","j-statut"],
  };
  (selects[name]||[]).forEach(id => setVal(id,""));
  editingId[name === "recette" ? "recettes" : name === "depense" ? "depenses" : "justifs"] = null;
  const formId = "form-" + name;
  document.getElementById(formId).style.display = "none";
  // Re-prefill date
  setDate(`${name[0]}-date`);
}

window.filterTable = function (tbodyId, q) {
  document.getElementById(tbodyId).querySelectorAll("tr[data-s]").forEach(r => {
    r.style.display = r.dataset.s.toLowerCase().includes(q.toLowerCase()) ? "" : "none";
  });
};

// ── HELPERS ─────────────────────────────────────────────────────────────────
const fmt      = n => new Intl.NumberFormat("fr-FR", { style:"currency", currency:"EUR" }).format(n||0);
const fmt_date = d => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
const val      = id => { const el=document.getElementById(id); return el?el.value.trim():""; };
const setVal   = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
const setText  = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
const show     = id => { const el=document.getElementById(id); if(el) el.classList.remove("hidden"); };
const hide     = id => { const el=document.getElementById(id); if(el) el.classList.add("hidden"); };
const esc      = s => (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const emptyRow = (cols,icon,title,sub) => `<tr><td colspan="${cols}"><div class="empty-state"><div class="empty-icon">${icon}</div><div class="empty-title">${title}</div><div class="empty-sub">${sub}</div></div></td></tr>`;
const setDate  = id => { const el=document.getElementById(id); if(el&&!el.value) el.value=new Date().toISOString().split("T")[0]; };

function toast(msg, type="info", ms=3800) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{success:"✅",error:"❌",info:"ℹ️"}[type]||"ℹ️"}</span><span>${msg}</span>`;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Auto-calc TTC = HT + TVA on recettes form
function wireCalc() {
  ["r-ht","r-tva"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => {
      const ht  = parseFloat(val("r-ht")) || 0;
      const tva = parseFloat(val("r-tva")) || 0;
      setVal("r-ttc", (ht+tva).toFixed(2));
    });
  });
  // Validate OneDrive link format on blur
  const linkEl = document.getElementById("j-link");
  if (linkEl) linkEl.addEventListener("blur", () => {
    const v = linkEl.value.trim();
    if (v && !v.startsWith("http")) {
      linkEl.style.borderColor = "var(--color-error)";
      toast("Le lien doit commencer par https://", "error", 2500);
    } else {
      linkEl.style.borderColor = "";
    }
  });
  // Enter key on login
  const pwdEl = document.getElementById("pwd-input");
  if (pwdEl) pwdEl.addEventListener("keydown", e => { if(e.key==="Enter") window.doLogin(); });
}

// Auto-generate IDs when forms open
window.openNewRecette = function () {
  editingId.recettes = null;
  document.getElementById("form-recette").style.display === "none"
    ? (document.getElementById("form-recette").style.display = "block", prefillId("r-ref","FAC"), setDate("r-date"))
    : (document.getElementById("form-recette").style.display = "none");
};
window.openNewDepense = function () {
  editingId.depenses = null;
  document.getElementById("form-depense").style.display === "none"
    ? (document.getElementById("form-depense").style.display = "block", prefillId("d-ref","DEP"), setDate("d-date"))
    : (document.getElementById("form-depense").style.display = "none");
};
window.openNewJustif = function () {
  editingId.justifs = null;
  document.getElementById("form-justif").style.display === "none"
    ? (document.getElementById("form-justif").style.display = "block", prefillId("j-ref","JUST"), prefillId("j-num","JUST"), setDate("j-date"))
    : (document.getElementById("form-justif").style.display = "none");
};

// ── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  wireCalc();
  boot();
});
