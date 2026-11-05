const D = window.RWA_DATA;
// Traduction des valeurs issues de la base (actifs, besoins, offres bancaires…)
const tData = (v) => (window.T ? window.T(v) : v);

let assets = [];          // offres chargées depuis l'API
let currentUser = null;
let currentSub = null;
const hasAccess = () => !!currentUser && !!currentSub && currentSub.statut === "actif";
const isPremium = () => hasAccess() && currentSub.plan === "premium";
const isVerified = () => !!currentUser && currentUser.kyc_statut === "valide";
const subStatus = () => (currentSub ? (currentSub.statut === "actif" ? (currentSub.plan === "premium" ? "Premium actif" : "Vérifié actif") : "En attente de validation") : "Gratuit");

// état local persistant (favoris, alertes, dossiers)
let state = JSON.parse(localStorage.getItem("aureus_state") || "null") || { favs: [], alerts: [], deals: [], compare: [] };
function saveState() { localStorage.setItem("aureus_state", JSON.stringify(state)); }
const getCompare = () => state.compare || (state.compare = []);
function toggleCompare(id) {
  const c = getCompare();
  const i = c.indexOf(String(id));
  if (i >= 0) c.splice(i, 1);
  else if (c.length < 3) c.push(String(id));
  else { alert("Maximum 3 offres à comparer."); return; }
  saveState();
  refreshCompareBar();
}
function refreshCompareBar() {
  const bar = document.getElementById("compareBar");
  if (!bar) return;
  const c = getCompare();
  bar.classList.toggle("show", c.length >= 2);
  document.getElementById("compareCount").textContent = c.length + "/3";
}
function compareBarHtml() {
  return `<div id="compareBar" class="compare-bar"><span><b id="compareCount">0/3</b> offre(s) sélectionnée(s)</span><button class="btn btn-primary btn-sm" onclick="navigate('comparateur')" style="font-size:.78rem">Comparer</button><button class="btn btn-ghost btn-sm" onclick="clearCompare()">Vider</button></div>`;
}
function clearCompare() {
  state.compare = [];
  saveState();
  refreshCompareBar();
  if (curPage === "comparateur") renderCompare();
}
const getFavs = () => state.favs || (state.favs = []);
const getAlerts = () => state.alerts || (state.alerts = []);
const getDeals = () => state.deals || (state.deals = []);

function toggleFav(id, btn) {
  const favs = getFavs();
  const i = favs.indexOf(String(id));
  if (i >= 0) favs.splice(i, 1);
  else favs.push(String(id));
  saveState();
  if (btn) { btn.classList.toggle("on"); btn.textContent = favs.includes(String(id)) ? "★" : "☆"; }
  refreshNavBadges();
}

const isFr = () => (window.currentLang ? window.currentLang() : window.AUREUS_LANG || "fr") === "fr";
const fmt = (n) => n.toLocaleString(isFr() ? "fr-FR" : "en-US");
const money = (n) => {
  if (isFr()) return n >= 1000000 ? (n / 1000000).toLocaleString("fr-FR") + " M$" : n.toLocaleString("fr-FR") + " $";
  if (n >= 1000000) return "$" + (n / 1000000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "M";
  return "$" + n.toLocaleString("en-US");
};
const pct = (n) => (isFr() ? n.toFixed(1).replace(".", ",") + " %" : n.toFixed(1) + "%");

async function api(path, method, body) {
  const r = await fetch("/api/" + path, {
    method: method || "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

function badge(type) {
  const labels = {
    obligation: "Obligation",
    credit: "Crédit",
    hedgefund: "Fonds Immobilier",
    immobilier: "Immobilier",
    usine: "Usine",
    marque: "Marque",
    ma: "M&A",
    commodity: "Matières Premières"
  };
  return `<span class="badge ${type}">${labels[type] || type}</span>`;
}

function assetSector(a) {
  if (a.type !== "commodity") return null;
  const t = a.title;
  if (/Pétrole|Gazole|Gaz|LNG|Électricité|PPA|Carburant|Jet|Diesel/.test(t)) return "Énergie";
  if (/Blé|Maïs|Riz|Orge|Avoine|Soja|Céréales/.test(t)) return "Céréales";
  if (/Or|Argent|Cuivre|Lingot|Métal|Aluminium|Zinc|Nickel/.test(t)) return "Métaux";
  if (/Café|Cacao|Sucre|Coton|Huile|Palme|Café/.test(t)) return "Agriculture";
  if (/Urée|Engrais|Ammoniac|Phosphate/.test(t)) return "Engrais";
  return "Matière Première";
}

function breadcrumbs(items) {
  return `<nav class="breadcrumbs" style="display:flex;align-items:center;gap:8px;font-size:.8rem;color:var(--muted);margin-bottom:var(--space-md);flex-wrap:wrap">
    ${items.map((item, i) => `
      <span>${i > 0 ? '<span style="margin:0 6px;color:var(--faint)">/</span>' : ''}${item.href ? `<a href="#" onclick="${item.onclick};return false" style="color:var(--muted);transition:color .2s">${item.label}</a>` : `<span style="color:var(--text);font-weight:500">${item.label}</span>`}</span>
    `).join('')}
  </nav>`;
}

const MARKETS = [
  { cat: "Indices", sym: "S&P 500", name: "États-Unis", base: 5480, prec: 0 },
  { cat: "Indices", sym: "NASDAQ 100", name: "États-Unis", base: 19850, prec: 0 },
  { cat: "Indices", sym: "CAC 40", name: "France", base: 7650, prec: 0 },
  { cat: "Indices", sym: "DAX 40", name: "Allemagne", base: 18420, prec: 0 },
  { cat: "Indices", sym: "FTSE 100", name: "Royaume-Uni", base: 8250, prec: 0 },
  { cat: "Indices", sym: "Nikkei 225", name: "Japon", base: 38900, prec: 0 },
  { cat: "Devises", sym: "EUR/USD", name: "Euro-Dollar", base: 1.084, prec: 4 },
  { cat: "Devises", sym: "GBP/USD", name: "Livre-Dollar", base: 1.274, prec: 4 },
  { cat: "Devises", sym: "USD/JPY", name: "Dollar-Yen", base: 156.2, prec: 2 },
  { cat: "Devises", sym: "USD/CHF", name: "Dollar-Franc", base: 0.902, prec: 4 },
  { cat: "Devises", sym: "USD/XOF", name: "Dollar-FCFA", base: 601.5, prec: 2 },
  { cat: "Matières", sym: "WTI", name: "Pétrole brut (baril)", base: 78.4, prec: 2 },
  { cat: "Matières", sym: "Brent", name: "Pétrole Brent (baril)", base: 82.1, prec: 2 },
  { cat: "Matières", sym: "Or", name: "Or (once)", base: 2330, prec: 0 },
  { cat: "Matières", sym: "Argent", name: "Argent (once)", base: 29.4, prec: 2 },
  { cat: "Matières", sym: "Cuivre", name: "Cuivre (lb)", base: 4.52, prec: 3 },
  { cat: "Matières", sym: "Blé", name: "Blé (boisseau)", base: 5.85, prec: 2 },
  { cat: "Matières", sym: "Café Arabica", name: "Café (lb)", base: 1.92, prec: 3 },
  { cat: "Taux", sym: "UST 10Y", name: "Trésor américain 10 ans", base: 4.24, prec: 2 },
  { cat: "Taux", sym: "Bund 10Y", name: "Allemagne 10 ans", base: 2.42, prec: 2 },
  { cat: "Taux", sym: "OAT 10Y", name: "France 10 ans", base: 2.85, prec: 2 },
  { cat: "Taux", sym: "JGB 10Y", name: "Japon 10 ans", base: 0.92, prec: 2 }
];
let marketState = [];
function initMarkets() {
  marketState = MARKETS.map((m) => {
    const v = m.base;
    const hist = [];
    for (let i = 0; i < 40; i++) hist.push(v * (1 + (Math.random() - 0.5) * 0.004));
    return { ...m, price: v, prevClose: v * (1 + (Math.random() - 0.5) * 0.006), pct: 0, hist };
  });
}
function tickMarkets() {
  marketState.forEach((m) => {
    const drift = (Math.random() - 0.5) * 0.003;
    m.price = Math.max(m.price * (1 + drift), m.base * 0.5);
    m.pct = (m.price - m.prevClose) / m.prevClose * 100;
    m.hist.push(m.price);
    if (m.hist.length > 40) m.hist.shift();
  });
}
function tickAll() {
  tickMarkets();
  const now = new Date().toLocaleTimeString("fr-FR");
  document.querySelectorAll(".ticker-item .q").forEach((el, i) => {
    const m = marketState[i];
    if (!m) return;
    const up = m.pct >= 0;
    el.textContent = m.price.toFixed(m.prec);
    el.className = "q " + (up ? "up" : "down");
  });
  const t = document.getElementById("mktTime");
  if (t) t.textContent = "Mis à jour " + now;
  document.querySelectorAll(".mkt-table tbody tr[data-i]").forEach((row) => {
    const m = marketState[Number(row.dataset.i)];
    if (!m) return;
    const up = m.pct >= 0;
    const abs = m.price - m.prevClose;
    const cls = up ? "up" : "down";
    row.querySelector(".mkt-last").textContent = m.price.toFixed(m.prec);
    row.querySelector(".mkt-abs").textContent = (up ? "+" : "") + abs.toFixed(m.prec);
    row.querySelector(".mkt-abs").className = "mkt-abs " + cls;
    row.querySelector(".mkt-pct").textContent = (up ? "▲ " : "▼ ") + Math.abs(m.pct).toFixed(2) + " %";
    row.querySelector(".mkt-pct").className = "mkt-pct " + cls;
    row.querySelector(".mkt-dot").className = "mkt-dot " + cls;
  });
}
function sparkSVG(m) {
  const h = m.hist || [m.price];
  const w = 96, hh = 28;
  let min = Math.min(...h), max = Math.max(...h);
  if (max === min) { max = min + 1; min = min - 1; }
  const pts = h.map((v, i) => `${((i / (h.length - 1)) * w).toFixed(1)},${(hh - ((v - min) / (max - min)) * (hh - 4) - 2).toFixed(1)}`).join(" ");
  const col = m.pct >= 0 ? "#1f7a4d" : "#b3261e";
  return `<svg class="spark" width="100%" height="28" viewBox="0 0 ${w} ${hh}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5"/></svg>`;
}
function marketRow(m, i) {
  const up = m.pct >= 0;
  const abs = m.price - m.prevClose;
  const cls = up ? "up" : "down";
  return `<tr data-i="${i}">
    <td><b>${m.sym}</b><div class="mkt-sub">${m.name}</div></td>
    <td class="mkt-last">${m.price.toFixed(m.prec)}</td>
    <td class="mkt-abs ${cls}">${up ? "+" : ""}${abs.toFixed(m.prec)}</td>
    <td class="mkt-pct ${cls}">${up ? "▲" : "▼"} ${Math.abs(m.pct).toFixed(2)} %</td>
    <td class="mkt-spark">${sparkSVG(m)}</td>
    <td><span class="mkt-dot ${cls}"></span></td>
  </tr>`;
}
function marketsTable(cats) {
  if (!marketState.length) initMarkets();
  const cats2 = cats || ["Indices", "Devises", "Matières", "Taux"];
  const rows = [];
  let idx = 0;
  for (const cat of cats2) {
    rows.push(`<tr class="mkt-cat"><td colspan="6">${cat}</td></tr>`);
    marketState.forEach((m) => { if (m.cat === cat) rows.push(marketRow(m, idx)); idx++; });
  }
  return `<table class="mkt-table">
    <thead><tr><th>Instrument</th><th>Dernier</th><th>Variation</th><th>Variation %</th><th>40 derniers points</th><th></th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}
function renderMarkets() {
  if (!marketState.length) initMarkets();
  tickMarkets();
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>${t("marches_titre")}</h2><p class="sub">Indices, devises, matières premières et taux — cotes indicatives mises à jour en direct</p></div>
      <span class="tag" id="mktTime">Mis à jour ${new Date().toLocaleTimeString("fr-FR")}</span>
    </div>
    ${marketsTable()}
    <div class="notice" style="margin-top:22px">Cotes à titre indicatif et de démonstration. Les transactions se concluent entre les parties auprès de contreparties agréées ; la plateforme n'exécute pas d'ordres et ne détient jamais les fonds.</div>
  </section>`;
}
function tickerStrip() {
  if (!marketState.length) initMarkets();
  tickMarkets();
  return `<div class="ticker-strip">${marketState.map((m) => {
    const up = m.pct >= 0;
    return `<div class="ticker-item"><b>${m.sym}</b> <span class="q ${up ? "up" : "down"}">${m.price.toFixed(m.prec)}</span> ${up ? "▲" : "▼"}</div>`;
  }).join("")}<div class="ticker-item"><b>Marchés en direct →</b> <a href="#" style="color:#8fd3ae" onclick="navigate('marches');return false;">consulter</a></div></div>`;
}

const REGIONS = [
  { key: "all", label: "Toutes" },
  { key: "chine", label: "Chine" },
  { key: "singapour", label: "Singapour" },
  { key: "europe", label: "Europe" },
  { key: "usa", label: "USA" },
  { key: "afrique", label: "Afrique" },
  { key: "golfe", label: "Golfe" },
  { key: "international", label: "International" }
];
function regionOf(a) {
  const p = a.pays || "";
  if (/Chine/.test(p)) return "chine";
  if (/Singapour/.test(p)) return "singapour";
  if (/France|Allemagne|Espagne|Italie|Royaume|Londres|Europe|Irlande|Suisse|Brésil/.test(p)) return "europe";
  if (/États|USA|Etats/.test(p)) return "usa";
  if (/Sénégal|Côte d'Ivoire|Kenya|Éthiopie|Maroc|Tanzanie|Ouganda|Rwanda|RDC|Zambie|Afrique|Dakar|Abidjan|Djibouti/.test(p)) return "afrique";
  if (/Qatar|Oman|Dubaï|EAU|Golfe|Koweït|Bahreïn/.test(p)) return "golfe";
  return "international";
}

const I18N = {
  fr: { 
    accueil: "Accueil", catalogue: "Catalogue", immobilier_international: "Immobilier International", entreprises: "Entreprises & M&A", marches: "Marchés", fonds: "Fonds Immo", services: "Services", societe: "Créer une société", crypto: "Crypto", prets_crypto_landing: "Prêts Crypto", mna_landing: "M&A", financement_dette: "Financement Dette", tableau_de_bord: "Tableau de bord", modele: "Modèle Éco", besoins: "Besoins", abonnement: "Abonnement", kyc: "Vérifier mon identité", favoris: "Favoris", alertes: "Alertes", dossiers: "Mes dossiers", messages: "Messages", notifications: "Notifications", publier: "Publier une offre", connexion: "Connexion", deconnexion: "Déconnexion", marches_titre: "Marchés en direct",
    footer_desc: "Plateforme internationale pour crédits, obligations, courtage actions & obligations et fonds immobiliers. Paiement classique ou en crypto.",
    footer_platform: "Plateforme", footer_become_member: "Devenir membre", footer_kyc: "Vérification d'identité (KYC)", footer_legal: "Légal", footer_cgu: "Conditions Générales", footer_cgv: "CGV abonnements", footer_mentions: "Mentions légales", footer_privacy: "Confidentialité", footer_contact: "Contact",
    nav_home: "Accueil", nav_marketplace: "Marché", nav_debt: "Financement", nav_companies: "Entreprises", nav_realestate: "Immobilier", nav_cryptoloans: "Prêts Crypto", nav_markets: "Marchés", nav_more: "Plus", nav_funds: "Fonds Immo", nav_services: "Services", nav_incorporation: "Créer société", nav_crypto: "Crypto", nav_ma: "M&A", nav_needs: "Besoins", nav_subscription: "Abonnement"
  },
  en: { 
    accueil: "Home", catalogue: "Marketplace", immobilier_international: "Intl Real Estate", entreprises: "Companies & M&A", marches: "Markets", fonds: "RE Funds", services: "Services", societe: "Start a Company", crypto: "Crypto", prets_crypto_landing: "Crypto Loans", mna_landing: "M&A", financement_dette: "Debt Financing", tableau_de_bord: "Dashboard", modele: "Business Model", besoins: "Funding Needs", abonnement: "Subscription", kyc: "Verify Identity", favoris: "Favorites", alertes: "Alerts", dossiers: "My Deals", messages: "Messages", notifications: "Notifications", publier: "Post Offer", connexion: "Sign In", deconnexion: "Logout", marches_titre: "Live Markets",
    footer_desc: "International platform for credits, bonds, brokerage & real estate funds. Classic or crypto payments.",
    footer_platform: "Platform", footer_become_member: "Become a member", footer_kyc: "Identity verification (KYC)", footer_legal: "Legal", footer_cgu: "Terms & Conditions", footer_cgv: "Subscription Terms", footer_mentions: "Legal Notices", footer_privacy: "Privacy Policy", footer_contact: "Contact",
    nav_home: "Home", nav_marketplace: "Marketplace", nav_debt: "Financing", nav_companies: "Companies", nav_realestate: "Real Estate", nav_cryptoloans: "Crypto Loans", nav_markets: "Markets", nav_more: "More", nav_funds: "RE Funds", nav_services: "Services", nav_incorporation: "Incorporation", nav_crypto: "Crypto", nav_ma: "M&A", nav_needs: "Needs", nav_subscription: "Subscription"
  },
  zh: { 
    accueil: "首页", catalogue: "资产市场", immobilier_international: "海外房产", entreprises: "企业与并购", marches: "行情中心", fonds: "不动产基金", services: "服务", societe: "设立公司", crypto: "加密货币", prets_crypto_landing: "加密贷款", mna_landing: "并购", financement_dette: "债务融资", tableau_de_bord: "控制台", modele: "商业模式", besoins: "融资需求", abonnement: "订阅", kyc: "身份认证", favoris: "收藏", alertes: "提醒", dossiers: "我的项目", messages: "消息", notifications: "通知", publier: "发布资产", connexion: "登录", deconnexion: "退出", marches_titre: "实时行情",
    footer_desc: "面向信贷、债券、经纪和房地产基金的国际平台。支持传统支付与加密货币。",
    footer_platform: "平台", footer_become_member: "成为会员", footer_kyc: "身份验证 (KYC)", footer_legal: "法律", footer_cgu: "服务条款", footer_cgv: "订阅条款", footer_mentions: "法律声明", footer_privacy: "隐私政策", footer_contact: "联系我们",
    nav_home: "首页", nav_marketplace: "市场", nav_debt: "融资", nav_companies: "企业", nav_realestate: "房产", nav_cryptoloans: "加密贷款", nav_markets: "行情", nav_more: "更多", nav_funds: "不动产基金", nav_services: "服务", nav_incorporation: "设立公司", nav_crypto: "加密货币", nav_ma: "并购", nav_needs: "需求", nav_subscription: "订阅"
  }
};
const PAYPAL_CONFIG = { mode: "sandbox" }; // "sandbox" ou "live" - mis à jour via API si besoin
let lang = (function () {
  try { return localStorage.getItem("aureusLang") || "fr"; } catch (e) { return "fr"; }
})();
let curPage = "home";
let curId = null;
let lastRoute = "";
function t(k) { return (I18N[lang] && I18N[lang][k]) || I18N.fr[k] || k; }
function toggleLang() {
  if (lang === "fr") lang = "en";
  else if (lang === "en") lang = "zh";
  else lang = "fr";
  applyLang();
}
function applyLang() {
  window.AUREUS_LANG = lang;
  try { localStorage.setItem("aureusLang", lang); } catch (e) { /* stockage indisponible */ }
  document.getElementById("htmlLang")?.setAttribute("lang", lang);
  const btn = document.getElementById("navLangBtn");
  if (btn) btn.textContent = lang === "fr" ? "EN" : (lang === "en" ? "中文" : "FR");
  
  // Update all elements with data-i18n attribute
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && I18N[lang][key]) {
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.placeholder = t(key);
      } else {
        el.textContent = t(key);
      }
    }
  });
  
  // User dropdown toggle
  const userBtn = document.getElementById("navUserBtn");
  const userMenu = document.getElementById("navUserMenu");
  if (userBtn && userMenu) {
    userBtn.onclick = (e) => { e.stopPropagation(); userMenu.classList.toggle("open"); };
    document.addEventListener("click", () => userMenu.classList.remove("open"));
  }
  
  // "Plus" dropdown close on outside click
  document.querySelectorAll(".nav-dropdown").forEach(dd => {
    dd.addEventListener("mouseleave", () => { /* keep open on hover */ });
  });
  
  // Update user name in dropdown button
  const userNameEl = document.getElementById("navUserName");
  if (userNameEl && currentUser) userNameEl.textContent = currentUser.name.split(" ")[0];
  
  // Update dynamic badge counts in user dropdown
  const favCount = document.getElementById("navFavCount");
  if (favCount && currentUser) favCount.textContent = " (" + getFavs().length + ")";
  const dealCount = document.getElementById("navDealCount");
  if (dealCount && currentUser) dealCount.textContent = " (" + getDeals().length + ")";
  const alertMatches = getAlerts().reduce((a, al2) => a + matchAlert(al2).length, 0);
  const alertCount = document.getElementById("navAlertCount");
  if (alertCount && currentUser) alertCount.textContent = alertMatches ? " (" + alertMatches + ")" : "";
  
  // Re-render current page completely for full translation
  lastRoute = "";
  if (curPage && curPage !== "home") {
    navigate(curPage, curId);
  } else {
    renderHome();
  }
  if (window.applyUiTranslation) {
    window.applyUiTranslation();
    setTimeout(() => window.applyUiTranslation(), 60);
  }
}


function assetCard(a) {
  const secteur = assetSector(a);
  const isFav = getFavs().includes(String(a.id));
  const inCmp = getCompare().includes(String(a.id));
  return `
  <div class="card ${a.a_la_une ? "featured" : ""}">
    <div class="asset-top">
      ${a.a_la_une ? `<span class="badge une">★ À la une</span>` : ""}
      ${badge(a.type)}
      <span class="token">${a.token}</span>
      ${a.verifie ? `<span class="badge verified" title="Documents vérifiés par nos partenaires">Vérifié</span>` : ""}
    </div>
    <div class="asset-body">
      <h3>${tData(a.title)}</h3>
      <div class="asset-meta">${tData(a.emetteur)} · ${tData(a.pays)} · ${a.devise}${secteur ? ` · ${tData(secteur)}` : ""}</div>
      <div class="asset-stats">
        <div class="metric"><div class="k">${a.rendement ? "Rendement" : "Type"}</div><div class="v ${a.rendement ? "green" : ""}">${a.rendement ? pct(a.rendement) : tData(a.typeLabel)}</div></div>
        <div class="metric"><div class="k">Montant</div><div class="v">${money(a.montant)}</div></div>
        <div class="metric"><div class="k">Échéance</div><div class="v">${tData(a.maturite)}</div></div>
        <div class="metric"><div class="k">Risque</div><div class="v">${a.risque}</div></div>
      </div>
      <div class="asset-foot">
        <button class="btn btn-primary" onclick="openAsset('${a.id}')">Voir la fiche</button>
        <button class="fav-btn ${isFav ? "on" : ""}" onclick="toggleFav('${a.id}', this)" title="Mettre en favori">${isFav ? "★" : "☆"}</button>
        <button class="cmp-btn ${inCmp ? "on" : ""}" onclick="toggleCompare('${a.id}')" title="Comparer">${inCmp ? "✓" : "+"}</button>
      </div>
    </div>
  </div>`;
}

function filterBar() {
  return `
  <div class="section-head">
    <div>
      <h2>Catalogue d'actifs</h2>
      <p class="sub">Obligations, crédits, immobilier, usines, marques, matières premières, fonds immobiliers & M&A — négociables en crypto</p>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-ghost" onclick="setFilter('all')" id="f-all">Tous</button>
      <button class="btn btn-ghost" onclick="setFilter('obligation')" id="f-obligation">Obligations</button>
      <button class="btn btn-ghost" onclick="setFilter('credit')" id="f-credit">Crédits</button>
      <button class="btn btn-ghost" onclick="setFilter('hedgefund')" id="f-hedgefund">Fonds Immo</button>
      <button class="btn btn-ghost" onclick="setFilter('immobilier')" id="f-immobilier">Immobilier</button>
      <button class="btn btn-ghost" onclick="setFilter('usine')" id="f-usine">Usines</button>
      <button class="btn btn-ghost" onclick="setFilter('marque')" id="f-marque">Marques</button>
      <button class="btn btn-ghost" onclick="setFilter('ma')" id="f-ma">M&A</button>
      <button class="btn btn-ghost" onclick="setFilter('commodity')" id="f-commodity">Matières Premières</button>
    </div>
  </div>
  <div class="chips" id="regionChips">
    ${REGIONS.map((r) => `<button class="chip ${r.key === "all" ? "on" : ""}" id="r-${r.key}" onclick="setRegion('${r.key}')">${r.label}</button>`).join("")}
  </div>
  <div class="searchbar">
    <input id="searchInput" type="text" placeholder="Rechercher : titre, émetteur, pays, token..." oninput="applyFilter(currentFilter)">
    <input id="fPays" type="text" placeholder="Pays" oninput="applyFilter(currentFilter)" style="max-width:130px">
    <input id="fMin" type="number" placeholder="Montant min" oninput="applyFilter(currentFilter)" style="max-width:120px">
    <input id="fMax" type="number" placeholder="Montant max" oninput="applyFilter(currentFilter)" style="max-width:120px">
    <select id="sortSelect" onchange="applyFilter(currentFilter)">
      <option value="recent">Plus récents</option>
      <option value="yield">Rendement ↓</option>
      <option value="amount">Montant ↓</option>
      <option value="pays">Pays A→Z</option>
    </select>
    <span class="search-count" id="searchCount"></span>
  </div>`;
}

let currentFilter = "all";
let currentRegion = "all";

const DEAL_STAGES = [
  { k: "contact", label: "Demande" },
  { k: "nda", label: "NDA" },
  { k: "loi", label: "LOI" },
  { k: "dd", label: "Due Diligence" },
  { k: "spa", label: "SPA" },
  { k: "closing", label: "Closing" }
];

function renderHome() {
  const s = {
    activeOffers: assets.length || D.stats.activeOffers,
    members: D.stats.members,
    countries: D.stats.countries,
    volumeM$: D.stats.volumeM$,
    avgYield: assets.length ? assets.reduce((a, x) => a + (x.rendement || 0), 0) / assets.filter((x) => x.rendement).length : D.stats.avgYield
  };
  document.getElementById("app").innerHTML = `
  ${tickerStrip()}
  <section class="hero">
    <img class="hero-logo" src="logo.svg" alt="Aureus Capital Markets">
    <span class="eyebrow">Plateforme internationale · Courtage · Crédits · RWA · Crypto</span>
    <h1>Courtage, Crédits, Obligations<br><span class="gold">et Fonds Immobiliers</span> internationaux</h1>
    <p class="lead">Exécution d'ordres sur actions et obligations, achat et échange d'actifs vérifiés : obligations souveraines, portefeuilles de crédits, parts de fonds immobiliers. Paiement classique ou en stablecoins.</p>
    <div class="hero-actions">
      <button class="btn btn-primary" onclick="navigate('catalogue')">Explorer le catalogue</button>
      <button class="btn btn-outline" onclick="navigate('services')">Courtage & services</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="num">${fmt(s.activeOffers)}</div><div class="lbl">Offres actives</div></div>
      <div class="stat"><div class="num">${fmt(s.members)}</div><div class="lbl">Membres</div></div>
      <div class="stat"><div class="num">${s.countries}</div><div class="lbl">Pays</div></div>
      <div class="stat"><div class="num">${s.volumeM$} M$</div><div class="lbl">Volume indicatif</div></div>
      <div class="stat"><div class="num">${pct(s.avgYield)}</div><div class="lbl">Rendement moyen</div></div>
    </div>
  </section>

  <section class="section container">
    ${filterBar()}
    <div class="grid" id="assetGrid"></div>
    ${compareBarHtml()}
  </section>

  <section class="section container">
    <div class="section-head"><div><h2>${t("marches_titre")}</h2><p class="sub">Indices, devises, matières premières et taux — en un coup d'œil</p></div>
      <button class="btn btn-ghost" onclick="navigate('marches')">Voir tous les marchés</button>
    </div>
    ${marketsTable(["Indices", "Devises"])}
  </section>

  <section class="section container">
    <div class="section-head"><div><h2>Nos services</h2><p class="sub">Bien plus qu'un catalogue — un accompagnement complet</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🤝</div><h3>Courtage Actions & Obligations</h3><p>Exécution d'ordres et négociation de titres pour banques et institutionnels : actions cotées, obligations souveraines et corporate.</p></div>
      <div class="bm-card"><div class="icon">🛢️</div><h3>Matières Premières & Énergie</h3><p>Contrats pétrole, gaz LNG, céréales et métaux. Mise en relation vendeur/acheteur avec documents et inspection.</p></div>
      <div class="bm-card"><div class="icon">🏭</div><h3>Immobilier, Usines & Marques</h3><p>Ventes de villas, immeubles, usines et marques premium avec mandats vérifiés.</p></div>
      <div class="bm-card"><div class="icon">🔄</div><h3>Fusions & Acquisitions (M&A)</h3><p>Mandats d'affaires, recherche d'acquéreurs et de partenaires stratégiques internationaux.</p></div>
      <div class="bm-card"><div class="icon">🛡️</div><h3>Assurance & Garanties</h3><p>Assurance de titre, garanties de recouvrement via assureurs partenaires.</p></div>
      <div class="bm-card"><div class="icon">💳</div><h3>Rachat de dettes</h3><p>Intermédiation de rachat de créances à décote avec partenaires financiers.</p></div>
      <div class="bm-card"><div class="icon">📊</div><h3>Études & Rapports</h3><p>Analyses de marchés, fiches de risque et valorisations sur mesure.</p></div>
      <div class="bm-card"><div class="icon">🔗</div><h3>API Crypto ↔ Financier</h3><p>Connectez vos produits aux exchanges crypto : paiement, distribution et tokens d'actifs.</p></div>
      <div class="bm-card"><div class="icon">🏢</div><h3>Création de sociétés & vie d'entreprise</h3><p>Sociétés internationales, comptes bancaires, licences, marques, visas d'affaires, domiciliation et comptabilité. Tout pour lancer et faire tourner votre entreprise à l'international.</p></div>
    </div>
    <div class="bm-card" style="margin-top:20px;text-align:center">
      <h3>Lancer votre entreprise à l'international</h3>
      <p class="muted">Société offshore ou locale, compte bancaire, licence commerciale, golden visa, marque, site web — un seul guichet, 15+ juridictions.</p>
      <button class="btn btn-primary" style="margin-top:14px" onclick="navigate('creer-societe')">Créer ma société</button>
      <button class="btn btn-outline" style="margin-top:14px" onclick="navigate('services')">Voir tous les services</button>
    </div>
  </section>

  <section class="section container">
    <div class="section-head"><div><h2>Comment ça marche</h2><p class="sub">Une plateforme de mise en relation simple et encadrée</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🔍</div><h3>1. Explorer</h3><p>Parcourez le catalogue filtré par type, pays, devise, rendement et échéance.</p></div>
      <div class="bm-card"><div class="icon">📄</div><h3>2. Vérifier</h3><p>Documents d'émission, prospectus et analyse transmis à l'acheteur pour vérification.</p></div>
      <div class="bm-card"><div class="icon">🤝</div><h3>3. Négocier</h3><p>Contact direct avec le vendeur. La transaction finale se conclut entre les deux parties, assistées de leurs conseils.</p></div>
      <div class="bm-card"><div class="icon">⚡</div><h3>4. Régler</h3><p>Paiement en banque ou en stablecoins (USDC / USDT). La plateforme ne détient jamais les fonds.</p></div>
    </div>
  </section>

  <section class="section container">
    <div class="section-head"><div><h2>Paiement crypto</h2><p class="sub">Stablecoins stables et pools de rendement</p></div></div>
    ${stableCards()}
  </section>
  `;
  applyFilter("all");
  refreshCompareBar();
}

function applyFilter(type) {
  currentFilter = type;
  const grid = document.getElementById("assetGrid");
  if (!grid) return;
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase().trim();
  const sort = document.getElementById("sortSelect")?.value || "recent";
  let list = type === "all" ? assets.slice() : assets.filter((a) => a.type === type);
  if (currentRegion !== "all") list = list.filter((a) => regionOf(a) === currentRegion);
  if (q) {
    list = list.filter((a) =>
      [a.title, a.emetteur, a.pays, a.devise, a.token, a.typeLabel, assetSector(a) || ""].join(" ").toLowerCase().includes(q)
    );
  }
  const fP = (document.getElementById("fPays")?.value || "").toLowerCase().trim();
  if (fP) list = list.filter((a) => String(a.pays).toLowerCase().includes(fP));
  const fMin = parseFloat(document.getElementById("fMin")?.value) || 0;
  const fMax = parseFloat(document.getElementById("fMax")?.value) || 0;
  if (fMin) list = list.filter((a) => (a.montant || 0) >= fMin);
  if (fMax) list = list.filter((a) => (a.montant || 0) <= fMax);
  if (sort === "yield") list.sort((a, b) => (b.rendement || 0) - (a.rendement || 0));
  else if (sort === "amount") list.sort((a, b) => (b.montant || 0) - (a.montant || 0));
  else if (sort === "pays") list.sort((a, b) => String(a.pays).localeCompare(String(b.pays)));
  grid.innerHTML = list.map(assetCard).join("") || `<p class="muted">Aucun actif ne correspond à votre recherche.</p>`;
  const c = document.getElementById("searchCount");
  if (c) c.textContent = list.length + " offre" + (list.length > 1 ? "s" : "");
  document.querySelectorAll("[id^='f-']").forEach((b) => b.classList.remove("btn-primary"));
  const btn = document.getElementById("f-" + type);
  if (btn) { btn.classList.remove("btn-ghost"); btn.classList.add("btn-primary"); }
  document.querySelectorAll("[id^='r-']").forEach((b) => b.classList.toggle("on", b.id === "r-" + currentRegion));
}
function setFilter(t) { applyFilter(t); }
function setRegion(r) { currentRegion = r; applyFilter(currentFilter); }

function renderCatalogue() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Catalogue" }
    ])}
    ${filterBar()}
    <div class="grid" id="assetGrid"></div>
    ${compareBarHtml()}
  </section>`;
  applyFilter("all");
  refreshCompareBar();
}

let immoRegion = "all";
function setImmoRegion(k) {
  immoRegion = k;
  const grid = document.getElementById("immoGrid");
  if (!grid) return;
  const list = assets.filter((a) => a.type === "immobilier" && (k === "all" || regionOf(a) === k));
  grid.innerHTML = list.map(assetCard).join("") || `<p class="muted">Aucun bien dans cette région pour le moment.</p>`;
  document.querySelectorAll("[id^='ir-']").forEach((b) => b.classList.toggle("on", b.id === "ir-" + k));
}
function renderImmo() {
  const list = assets.filter((a) => a.type === "immobilier");
  const regions = new Set(list.map((a) => regionOf(a)));
  const volume = list.reduce((s, a) => s + (a.montant || 0), 0);
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Immobilier" }
    ])}
    <div class="section-head">
      <div><h2>Immobilier — Opportunités dans le monde</h2>
      <p class="sub">Villas, appartements, bureaux et immeubles à vendre sur Dubaï, Doha, Singapour, Oman et plus encore. Explorez les régions ci-dessous.</p></div>
      <button class="btn btn-primary" onclick="navigate('publier')">Déposer une annonce</button>
    </div>
    <div class="immo-stats">
      <div class="immo-stat"><b>${list.length}</b><span>Biens en ligne</span></div>
      <div class="immo-stat"><b>${regions.size}</b><span>Régions couvertes</span></div>
      <div class="immo-stat"><b>${volume >= 1000000 ? Math.round(volume / 1000000) + " M$" : money(volume)}</b><span>Volume proposé</span></div>
      <div class="immo-stat"><b>100 %</b><span>Mandats vérifiés</span></div>
    </div>
    <div class="chips" id="immoChips">
      ${REGIONS.map((r) => `<button class="chip ${r.key === "all" ? "on" : ""}" id="ir-${r.key}" onclick="setImmoRegion('${r.key}')">${r.label}</button>`).join("")}
    </div>
    <div class="grid" id="immoGrid"></div>
    <div class="notice" style="margin-top:26px">Les mandats sont publiés par des mandataires agréés. Titres de propriété, évaluations notariales et certificats disponibles sur demande auprès du vendeur.</div>
  </section>`;
  setImmoRegion("all");
}

let entreprises = [];
const ENTERPRISE_MODES = [
  { k: "all", label: "Toutes" },
  { k: "vente", label: "À vendre" },
  { k: "fusion", label: "Fusion / M&A" },
  { k: "partenariat", label: "Partenariat" },
  { k: "financement", label: "Levée de fonds" }
];
const ENTERPRISE_META = {
  vente: { label: "À vendre", cls: "em-vente" },
  fusion: { label: "Fusion / M&A", cls: "em-fusion" },
  partenariat: { label: "Partenariat", cls: "em-part" },
  financement: { label: "Levée de fonds", cls: "em-fin" }
};
function enterpriseMode(a) {
  if (a.mode) return a.mode;
  const t = a.title;
  if (/fusion|Fusion/.test(t)) return "fusion";
  if (/partenariat|Partenariat|Levée|levée|financement|Financement|investisseur|rapprochement/.test(t)) return "partenariat";
  return "vente";
}
function enterpriseCard(a) {
  const mode = enterpriseMode(a);
  const meta = ENTERPRISE_META[mode] || ENTERPRISE_META.vente;
  const secteur = assetSector(a) || a.typeLabel;
  return `
  <div class="ent-card">
    <div class="ent-top">
      <span class="ent-badge ${meta.cls}">${meta.label}</span>
      <span class="token">${tData(a.pays)}</span>
    </div>
    <h3>${tData(a.title)}</h3>
    <div class="ent-meta">${tData(a.emetteur)} · ${tData(secteur)}</div>
    <div class="ent-price">${a.rendement ? pct(a.rendement) + " " + tData("rendement") + " · " : ""}${money(a.montant)}</div>
    <p class="small muted">${(tData(a.description) || "").slice(0, 110)}…</p>
    <div class="ent-foot">
      <button class="btn btn-primary" onclick="openAsset('${a.id}')">Voir la fiche</button>
      <button class="btn btn-ghost" onclick="openConversationForAsset('${a.id}', '${a.token} — mise en relation')">Contacter</button>
    </div>
  </div>`;
}
let entMode = "all";
function setEntMode(k) {
  entMode = k;
  const grid = document.getElementById("entGrid");
  if (!grid) return;
  const q = (document.getElementById("entSearch")?.value || "").toLowerCase().trim();
  const pays = (document.getElementById("entPays")?.value || "").toLowerCase().trim();
  const min = parseFloat(document.getElementById("entMin")?.value) || 0;
  const max = parseFloat(document.getElementById("entMax")?.value) || 0;
  let list = entreprises.filter((a) => k === "all" || enterpriseMode(a) === k);
  if (q) list = list.filter((a) => [a.title, a.emetteur, a.pays, a.token, assetSector(a) || ""].join(" ").toLowerCase().includes(q));
  if (pays) list = list.filter((a) => String(a.pays).toLowerCase().includes(pays));
  if (min) list = list.filter((a) => (a.montant || 0) >= min);
  if (max) list = list.filter((a) => (a.montant || 0) <= max);
  grid.innerHTML = list.map(enterpriseCard).join("") || `<p class="muted">Aucune entreprise dans cette catégorie pour le moment.</p>`;
  document.querySelectorAll("[id^='em-']").forEach((b) => { b.classList.add("btn-ghost"); b.classList.remove("btn-primary"); });
  const act = document.getElementById("em-" + k);
  if (act) { act.classList.remove("btn-ghost"); act.classList.add("btn-primary"); }
}
function renderEntreprises() {
  entreprises = assets.filter((a) => ["usine", "marque", "ma"].includes(a.type));
  const count = (m) => entreprises.filter((a) => enterpriseMode(a) === m).length;
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Entreprises & M&A" }
    ])}
    <div class="section-head">
      <div><h2>Marketplace entreprises & startups</h2>
      <p class="sub">Cessions d'entreprises, fusions, recherche de partenaires et levées de fonds — offres vérifiées par l'équipe, partout dans le monde.</p></div>
      <button class="btn btn-primary" onclick="navigate('publier')">Publier une entreprise</button>
    </div>
    <div class="ent-stats">
      <div class="ent-stat"><b>${entreprises.length}</b><span>Offres en ligne</span></div>
      <div class="ent-stat"><b>${count("vente")}</b><span>À vendre</span></div>
      <div class="ent-stat"><b>${count("fusion")}</b><span>Fusion / M&A</span></div>
      <div class="ent-stat"><b>${count("partenariat") + count("financement")}</b><span>Partenariat & levée</span></div>
    </div>
    <div class="ent-tabs">
      ${ENTERPRISE_MODES.map((m) => `<button class="btn btn-ghost" id="em-${m.k}" onclick="setEntMode('${m.k}')">${m.label}</button>`).join("")}
    </div>
    <div class="searchbar" style="margin-bottom:18px">
      <input id="entSearch" type="text" placeholder="Rechercher : titre, secteur, token..." oninput="setEntMode(entMode)">
      <input id="entPays" type="text" placeholder="Pays" oninput="setEntMode(entMode)" style="max-width:130px">
      <input id="entMin" type="number" placeholder="Montant min" oninput="setEntMode(entMode)" style="max-width:120px">
      <input id="entMax" type="number" placeholder="Montant max" oninput="setEntMode(entMode)" style="max-width:120px">
    </div>
    <div class="grid" id="entGrid"></div>
    <div class="notice" style="margin-top:26px">Chaque offre est soumise à la signature d'un NDA avant transmission du mémorandum confidentiel. La plateforme met en relation et ne détient jamais les fonds.</div>
  </section>`;
  setEntMode("all");
}

let needs = [];
let bankOffers = [];
async function loadNeeds() {
  try {
    const [n, o] = await Promise.all([api("needs"), api("bank-offers")]);
    needs = n && n.length ? n : [];
    bankOffers = o && o.length ? o : [];
  } catch (e) { needs = []; bankOffers = []; }
}
function needCard(n) {
  return `
  <div class="need-card">
    <div class="need-top">
      <span class="need-cat ${n.category}">${n.category === "financement" ? "Financement" : "Crédit"}</span>
      <span class="token">${tData(n.region) || "International"}</span>
    </div>
    <h3>${tData(n.title)}</h3>
    <div class="need-amount">${n.amount ? n.amount.toLocaleString(currentLang() === "fr" ? "fr-FR" : "en-US") + " " + (n.currency || "") : "Montant à définir"}</div>
    <p class="need-purpose">${tData(n.purpose) || ""}</p>
    <p class="small muted">${tData(n.description) || ""}</p>
    <button class="btn btn-outline full" style="margin-top:14px" onclick="contactNeed('${(n.title || "").replace(/'/g, "")}')">Proposer une solution</button>
  </div>`;
}
function offerCard(o) {
  return `
  <div class="offer-card">
    <div class="need-top">
      <span class="need-cat offer">${o.bank}</span>
      <span class="token">${tData(o.region) || "International"}</span>
    </div>
    <h3>${tData(o.product)}</h3>
    <div class="need-amount">${o.range_min ? o.range_min.toLocaleString(currentLang() === "fr" ? "fr-FR" : "en-US") + (o.range_max ? " – " + o.range_max.toLocaleString(currentLang() === "fr" ? "fr-FR" : "en-US") : "") + " " + (o.currency || "") : "Fourchette sur demande"}</div>
    ${o.rate ? `<div class="offer-rate">${o.rate.toFixed(1).replace(".", currentLang() === "fr" ? "," : ".")} %</div>` : ""}
    <p class="small muted">${tData(o.purpose) || ""}</p>
    <button class="btn btn-ghost full" style="margin-top:14px" onclick="contactNeed('${(o.bank + " — " + o.product).replace(/'/g, "")}')">Discuter avec la banque</button>
  </div>`;
}
function contactNeed(title) {
  document.getElementById("cSubject").value = "Financement : " + title;
  document.getElementById("cMsg").value = "Bonjour, je souhaite échanger au sujet de « " + title + " ». Merci de me mettre en relation avec le bon interlocuteur.";
  document.getElementById("cName").value = "";
  document.getElementById("cContact").value = "";
  document.getElementById("cOk").style.display = "none";
  document.getElementById("contactModal").classList.add("show");
}
async function submitNeed() {
  const title = document.getElementById("nTitle").value.trim();
  const purpose = document.getElementById("nPurpose").value.trim();
  const desc = document.getElementById("nDesc").value.trim();
  const amount = Number(document.getElementById("nAmount").value) || null;
  if (!title) { alert("Indiquez un titre pour votre besoin."); return; }
  const r = await api("needs", "POST", {
    category: document.getElementById("nCat").value,
    title, amount, currency: document.getElementById("nCur").value,
    purpose, description: desc, region: document.getElementById("nRegion").value
  });
  if (r.ok) { renderNeeds(); } else { alert(r.error || "Erreur"); }
}
async function submitBankOffer() {
  const bank = document.getElementById("oBank").value.trim();
  const product = document.getElementById("oProduct").value.trim();
  if (!bank || !product) { alert("Indiquez le nom de la banque et le produit."); return; }
  const r = await api("bank-offers", "POST", {
    bank, product,
    range_min: Number(document.getElementById("oMin").value) || null,
    range_max: Number(document.getElementById("oMax").value) || null,
    currency: document.getElementById("oCur").value,
    rate: Number(document.getElementById("oRate").value) || null,
    purpose: document.getElementById("oPurpose").value.trim(),
    region: document.getElementById("oRegion").value
  });
  if (r.ok) { renderNeeds(); } else { alert(r.error || "Erreur"); }
}
async function renderNeeds() {
  await loadNeeds();
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Besoins & Financement" }
    ])}
    <div class="section-head">
      <div><h2>Besoins & financement</h2>
      <p class="sub">Particuliers, entreprises et banques publient ici leurs besoins et opportunités de crédit et de financement, partout dans le monde.</p></div>
    </div>

    <div class="needs-grid">
      <div>
        <h3 style="color:var(--navy);margin-bottom:4px">Besoins de financement publiés</h3>
        <p class="sub">Crédit d'équipement, pré-export, trésorerie, immobilier…</p>
        <div class="needs-list" id="needsList">
          ${needs.length ? needs.map(needCard).join("") : '<p class="muted">Aucun besoin publié pour le moment.</p>'}
        </div>
      </div>
      <div>
        <h3 style="color:var(--navy);margin-bottom:4px">Opportunités des banques</h3>
        <p class="sub">Banques et institutions financières proposent leurs produits de financement.</p>
        <div class="needs-list" id="offersList">
          ${bankOffers.length ? bankOffers.map(offerCard).join("") : '<p class="muted">Aucune opportunité publiée pour le moment.</p>'}
        </div>
      </div>
    </div>

    ${currentUser ? `
    <div class="needs-grid" style="margin-top:40px">
      <div class="form-card" style="max-width:none">
        <h3>Publier un besoin</h3>
        <p class="muted small">Entreprise ou particulier : décrivez votre besoin de crédit ou de financement.</p>
        <div class="form-grid">
          <div><label>Catégorie</label>
            <select id="nCat"><option value="credit">Crédit</option><option value="financement">Financement / investisseur</option></select></div>
          <div><label>Titre du besoin</label><input type="text" id="nTitle" placeholder="Ex : Crédit d'équipement — Menuiserie"></div>
          <div><label>Montant</label><input type="number" id="nAmount" placeholder="Ex : 180000"></div>
          <div><label>Devise</label><select id="nCur"><option>EUR</option><option>USD</option><option>XOF</option><option>GBP</option><option>SGD</option></select></div>
          <div><label>Objet</label><input type="text" id="nPurpose" placeholder="Ex : Achat de machines CNC"></div>
          <div><label>Région</label><input type="text" id="nRegion" placeholder="Ex : Afrique, Europe, Golfe..."></div>
        </div>
        <label>Description détaillée</label>
        <textarea id="nDesc" rows="3" placeholder="Contexte, garanties, durée souhaitée..."></textarea>
        <button class="btn btn-primary full" style="margin-top:12px" onclick="submitNeed()">Publier mon besoin</button>
      </div>
      <div class="form-card" style="max-width:none">
        <h3>Publier une opportunité bancaire</h3>
        <p class="muted small">Banque ou institution financière : proposez vos produits de financement.</p>
        <div class="form-grid">
          <div><label>Nom de la banque</label><input type="text" id="oBank" placeholder="Ex : Bank of Africa"></div>
          <div><label>Produit</label><input type="text" id="oProduct" placeholder="Ex : Prêt d'équipement PME"></div>
          <div><label>Montant min.</label><input type="number" id="oMin" placeholder="Ex : 50000"></div>
          <div><label>Montant max.</label><input type="number" id="oMax" placeholder="Ex : 1000000"></div>
          <div><label>Taux indicatif (%)</label><input type="number" step="0.1" id="oRate" placeholder="Ex : 7.5"></div>
          <div><label>Devise</label><select id="oCur"><option>EUR</option><option>USD</option><option>XOF</option><option>GBP</option><option>SGD</option></select></div>
          <div><label>Région cible</label><input type="text" id="oRegion" placeholder="Ex : Afrique, Golfe..."></div>
          <div><label>Objet / conditions</label><input type="text" id="oPurpose" placeholder="Ex : jusqu'à 7 ans, garantie BPI"></div>
        </div>
        <button class="btn btn-primary full" style="margin-top:12px" onclick="submitBankOffer()">Publier l'opportunité</button>
      </div>
    </div>` : `
    <div class="notice" style="margin-top:30px">Connectez-vous pour publier un besoin de financement ou une opportunité bancaire. <a href="#" style="color:var(--accent)" onclick="openAuth();return false;">Se connecter</a></div>`}
  </section>`;
}

function renderHedgeFunds() {
  const hf = assets.filter((a) => a.type === "hedgefund");
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>Fonds Immobiliers internationaux</h2>
      <p class="sub">Parts de fonds SPV sur Dubaï, Afrique de l'Ouest et Asie. Distribution trimestrielle, token d'investissement.</p></div>
    </div>
    <div class="grid">${hf.map(assetCard).join("")}</div>
    <div class="notice" style="margin-top:26px">Souscription min ${money(hf[0]?.minimum || 10000)} par part. Documents d'offre à examiner avec un conseil local. La plateforme est une simple vitrine de mise en relation.</div>
  </section>`;
}

function stableCards() {
  return `<div class="stable-grid">
    ${D.cryptoDemo.stablecoins.map((c) => `
      <div class="stable-card">
        <div class="sym">${c.symbol}</div>
        <div class="row"><span>Prix</span><b>${c.price.toFixed(2)} $</b></div>
        <div class="row"><span>Rendement</span><b style="color:var(--green)">${pct(c.apy)}</b></div>
        <div class="row"><span>Risque</span><b>${c.risk}</b></div>
        <div class="row"><span>Réseau</span><b>${c.chain}</b></div>
      </div>`).join("")}
  </div>`;
}

function renderCrypto() {
  const p = D.cryptoDemo;
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head"><div><h2>Crypto & Stablecoins</h2><p class="sub">Stabilité du dollar, rendement en devises fortes — ${p.fees}</p></div></div>
    ${stableCards()}

    <div class="section-head" style="margin-top:44px"><div><h2>Pools de rendement & tokens d'actifs</h2><p class="sub">Investissez via des tokens représentatifs (mode démo)</p></div></div>
    ${p.yieldPool.map((y) => `
      <div class="pool-row">
        <div>
          <div class="name">${tData(y.name)}</div>
          <div class="tag">${tData(y.asset)} · Token <span style="font-family:Consolas">${y.token}</span> · Min ${money(y.min)}</div>
        </div>
        <div class="apy">${pct(y.apy)} <span style="color:var(--muted);font-size:.8rem">APY</span></div>
        <div class="invest"><button class="btn btn-primary" onclick="walletInvest('${y.token}','${y.name}','${y.apy}','${y.min}')">Investir (démo)</button></div>
      </div>`).join("")}

    <div class="wallet">
      <div class="wallet-head">
        <div>
          <div class="tag muted">Portefeuille démo (wallet fictif)</div>
          <div class="wallet-bal" id="walletBal">$0</div>
        </div>
        <div class="wallet-actions">
          <button class="btn btn-ghost" onclick="walletAction('deposit')">+ Déposer USDC</button>
          <button class="btn btn-ghost" onclick="walletAction('withdraw')">− Retirer</button>
          <button class="btn btn-outline" onclick="connectWallet()">Connecter un wallet</button>
        </div>
      </div>
      <table class="wallet-table">
        <thead><tr><th>Actif</th><th>Token</th><th>APY</th><th>Valeur investie</th><th>Rendement</th></tr></thead>
        <tbody id="walletBody">
          <tr><td colspan="5" class="muted" style="text-align:center">Aucun investissement. Connectez un wallet et investissez dans un pool.</td></tr>
        </tbody>
      </table>
    </div>
  </section>`;
}

let wallet = { connected: false, balance: 2500, holdings: [] };

function connectWallet() {
  wallet.connected = true;
  alert("Wallet connecté (simulation) : 0x7B3e...A91c\n\nSur la vraie plateforme : connexion via MetaMask / WalletConnect.");
  refreshWallet();
}
function walletAction(a) {
  const amount = prompt(a === "deposit" ? "Montant USDC à déposer (démo) :" : "Montant à retirer (démo) :");
  if (!amount) return;
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return alert("Montant invalide.");
  if (a === "deposit") wallet.balance += n;
  else if (n <= wallet.balance) wallet.balance -= n;
  else return alert("Solde insuffisant.");
  refreshWallet();
}
function walletInvest(token, name, apy, min) {
  if (!wallet.connected) { alert("Connectez d'abord un wallet (bouton ci-dessus)."); return; }
  const amount = prompt(`Montant à investir dans « ${name} » (min ${money(min)}) :`);
  if (!amount) return;
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return alert("Montant invalide.");
  if (n > wallet.balance) return alert("Solde USDC insuffisant dans le wallet démo.");
  wallet.balance -= n;
  wallet.holdings.push({ token, name, apy: parseFloat(apy), amount: n });
  refreshWallet();
}
function refreshWallet() {
  const bal = document.getElementById("walletBal");
  const body = document.getElementById("walletBody");
  if (bal) bal.textContent = "$" + wallet.balance.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (body) {
    if (!wallet.holdings.length) {
      body.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center">Aucun investissement.</td></tr>`;
    } else {
      body.innerHTML = wallet.holdings.map((h) => {
        const yieldVal = h.amount * (h.apy / 100) / 12;
        return `<tr>
          <td>${h.name}</td>
          <td style="font-family:Consolas">${h.token}</td>
          <td style="color:var(--green)">${pct(h.apy)}</td>
          <td>$${h.amount.toLocaleString("fr-FR")}</td>
          <td style="color:var(--green)">+$${yieldVal.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}/mois</td>
        </tr>`;
      }).join("");
    }
  }
}

function renderServices() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head"><div><h2>Nos services</h2><p class="sub">Bien plus qu'un catalogue — un accompagnement complet</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">📈</div><h3>Courtage Actions</h3><p>Exécution d'ordres sur actions cotées (USA, Europe, MENA, Asie) pour comptes propres et comptes clients institutionnels. Accès marché direct.</p><div class="fee">Commission 0,25 – 1 % par ordre</div></div>
      <div class="bm-card"><div class="icon">📜</div><h3>Courtage Obligations</h3><p>Placement et négociation d'obligations souveraines, eurobonds et corporate. Exécution OTC avec contreparties bancaires, règlement vs livraison.</p><div class="fee">Commission 0,1 – 0,75 % du nominal</div></div>
      <div class="bm-card"><div class="icon">🏦</div><h3>Services Banques & Institutionnels</h3><p>Intégration du flux de produits, lignes de crédit, accès aux émissions primaires et au marché secondaire pour banques, assurances et fonds.</p><div class="fee">Contrat de prestation annuel</div></div>
      <div class="bm-card"><div class="icon">🛢️</div><h3>Courtage Matières Premières</h3><p>Intermédiation sur contrats physiques et papiers : pétrole, gaz LNG, blé, maïs, or, café. Mise en relation vendeur / acheteur certifiée.</p><div class="fee">0,25 – 1,5 % du contrat</div></div>
      <div class="bm-card"><div class="icon">🤝</div><h3>Broker & Mise en relation</h3><p>Négociation pour le compte de gros clients sur tous types d'actifs : obligations, crédits, immobilier, usines, marques.</p><div class="fee">1 – 3 % commission</div></div>
      <div class="bm-card"><div class="icon">🛡️</div><h3>Assurance & Garanties</h3><p>Assurance de titre pour l'immobilier, garantie de recouvrement pour les crédits. Via assureurs partenaires agréés.</p><div class="fee">10 – 20 % des primes</div></div>
      <div class="bm-card"><div class="icon">💳</div><h3>Rachat de dettes</h3><p>Intermédiation de rachat de créances à décote avec nos partenaires financiers. Vous cédez, ils financent.</p><div class="fee">1 – 4 % honoraires</div></div>
      <div class="bm-card"><div class="icon">📊</div><h3>Études & intelligence économique</h3><p>Analyses de marchés, fiches de risque par actif, valorisations et rapports pays sur mesure.</p><div class="fee">50 – 200 € / rapport</div></div>
      <div class="bm-card"><div class="icon">🔗</div><h3>API Crypto ↔ Financier</h3><p>Connectez vos produits aux exchanges crypto : paiement en stablecoin, distribution de rendement, tokens d'actifs.</p><div class="fee">500 – 5 000 €/mois</div></div>
      <div class="bm-card"><div class="icon">📑</div><h3>Packs de vérification</h3><p>Audit préalable des documents par nos partenaires notaires et juristes. Badge « vérifié » sur les offres.</p><div class="fee">300 – 1 500 € / dossier</div></div>
      <div class="bm-card"><div class="icon">🏢</div><h3>Création de sociétés</h3><p>Ouverture d'entreprises dans le monde entier : Dubaï, USA, UK, Singapour, Hong Kong, Suisse, offshore.</p><div class="fee">À partir de 700 €</div></div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Création & vie de l'entreprise</h2><p class="sub">Toute l'administration pour lancer et faire tourner votre société à l'international</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🏦</div><h3>Compte bancaire d'entreprise</h3><p>Ouverture de compte auprès de banques traditionnelles, néobanques et banques crypto-friendly, dans la juridiction de votre choix.</p><div class="fee">300 – 1 200 € / compte</div></div>
      <div class="bm-card"><div class="icon">💳</div><h3>Comptes de paiement & merchant</h3><p>Activation de Stripe, PayPal, Wise, Payoneer, marchands et passerelles de paiement pour encaisser vos clients du monde entier.</p><div class="fee">200 – 900 € / dossier</div></div>
      <div class="bm-card"><div class="icon">🏢</div><h3>Siège social & domiciliation</h3><p>Adresse de siège physique et juridique, gestion du courrier, salle de réunion à la demande dans les grandes places (Dubaï, Singapour, Londres...).</p><div class="fee">60 – 300 € / mois</div></div>
      <div class="bm-card"><div class="icon">🛂</div><h3>Licences commerciales</h3><p>Licences d'exploitation, licences import-export, trading, e-commerce ou profession libérale selon votre activité et votre juridiction.</p><div class="fee">À partir de 400 €</div></div>
      <div class="bm-card"><div class="icon">🪪</div><h3>Visas d'affaires & golden visa</h3><p>Visa investisseur et résidence longue durée : Dubaï golden visa, Qatar, Oman, Singapour, visas entrepreneur des États-Unis (E2) et d'Europe.</p><div class="fee">500 – 3 000 € / dossier</div></div>
      <div class="bm-card"><div class="icon">📜</div><h3>Marques & propriété intellectuelle</h3><p>Dépôt de marque internationale (Madrid), marques nationales, design, domaine internet premium. Protection de vos marques et logos partout dans le monde.</p><div class="fee">300 – 1 200 € / dépôt</div></div>
      <div class="bm-card"><div class="icon">🧾</div><h3>Comptabilité & conformité</h3><p>Tenue comptable annuelle, déclarations TVA et fiscales, compliance CRS / FATCA et renouvellement d'agréments par nos experts partenaires.</p><div class="fee">40 – 150 € / mois</div></div>
      <div class="bm-card"><div class="icon">🔑</div><h3>Holding & structure patrimoniale</h3><p>Structuration de holding, répartition des parts, protection du patrimoine et séparation d'activités avec des cabinets juridiques partenaires.</p><div class="fee">800 – 3 500 € / dossier</div></div>
      <div class="bm-card"><div class="icon">🗂️</div><h3>Sociétés prêtes (shelf companies)</h3><p>Sociétés déjà constituées et propres, disponibles immédiatement pour déposer un compte bancaire ou démarrer une activité sans attendre.</p><div class="fee">900 – 2 500 €</div></div>
      <div class="bm-card"><div class="icon">🏠</div><h3>Installation & relocation</h3><p>Déménagement, logement, scolarité, transport, installation complète de l'entrepreneur et de sa famille à Dubaï, Doha, Mascate ou Singapour.</p><div class="fee">500 – 2 000 € / accompagnement</div></div>
      <div class="bm-card"><div class="icon">🌐</div><h3>Site web & visibilité internationale</h3><p>Création de site web, boutique e-commerce, pages professionnelles et référencement pour vendre à l'international dès le premier jour.</p><div class="fee">500 – 3 000 €</div></div>
      <div class="bm-card"><div class="icon">📄</div><h3>Notarisation & apostille</h3><p>Légalisation de documents (diplômes, actes, contrats), apostille de La Haye et traductions assermentées dans 20+ langues.</p><div class="fee">80 – 250 € / document</div></div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Administration & préparation de votre société</h2><p class="sub">Tout ce qu'il faut pour rester en règle, convaincre les banques et préparer vos dossiers</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🏷️</div><h3>Réservation de nom & statuts</h3><p>Vérification et réservation du nom, rédaction des statuts, immatriculation au registre (RCCM, ACRA, DED, CIPC, Companies House).</p><div class="fee">150 – 600 € / dossier</div></div>
      <div class="bm-card"><div class="icon">🔢</div><h3>Numéro fiscal & EIN</h3><p>Obtention du numéro fiscal, EIN américain, numéro de TVA et inscriptions auprès des administrations locales.</p><div class="fee">100 – 400 €</div></div>
      <div class="bm-card"><div class="icon">✅</div><h3>Certificat de bonne tenue</h3><p>Certificate of Good Standing délivré par le registre : indispensable pour ouvrir un compte bancaire ou signer un contrat.</p><div class="fee">120 – 350 € / certificat</div></div>
      <div class="bm-card"><div class="icon">👤</div><h3>Agent local enregistré</h3><p>Registered agent dans chaque juridiction : obligatoire aux USA, BVI, Seychelles, Dubaï, Singapour et Hong Kong.</p><div class="fee">250 – 900 € / an</div></div>
      <div class="bm-card"><div class="icon">🧑‍💼</div><h3>Secrétariat juridique</h3><p>Assemblées générales, registres des actionnaires et directeurs, mise à jour des bénéficiaires effectifs (UBO), procès-verbaux.</p><div class="fee">60 – 200 € / mois</div></div>
      <div class="bm-card"><div class="icon">📊</div><h3>Dépôt de comptes annuels</h3><p>Préparation et dépôt des comptes auprès du registre, certification, publication dans les délais légaux.</p><div class="fee">150 – 800 € / an</div></div>
      <div class="bm-card"><div class="icon">🕵️</div><h3>KYB & due diligence</h3><p>Vérification de vos partenaires, fournisseurs ou vendeurs : registres, sanctions, presse, solvabilité, UBO.</p><div class="fee">150 – 700 € / dossier</div></div>
      <div class="bm-card"><div class="icon">💱</div><h3>FX & correspondants bancaires</h3><p>Mise en relation avec des facilitateurs de change et correspondants pour encaisser et convertir en devises étrangères.</p><div class="fee">200 – 800 € / dossier</div></div>
      <div class="bm-card"><div class="icon">🏭</div><h3>Licences sectorielles</h3><p>Agréments spéciaux : alimentaire, pharmaceutique, trading énergie, e-commerce, prestations, activités réglementées.</p><div class="fee">400 – 2 500 €</div></div>
      <div class="bm-card"><div class="icon">📦</div><h3>Permis douane & entrepôts</h3><p>Enregistrement douanier, entrepôt agréé, quotas et permis d'importation / exportation pour vos marchandises.</p><div class="fee">300 – 1 500 €</div></div>
      <div class="bm-card"><div class="icon">👷</div><h3>EOR & payroll international</h3><p>Employer of record : embauchez vos premiers salariés à l'étranger sans créer de filiale, paie et conformité incluses.</p><div class="fee">150 – 500 € / salarié / mois</div></div>
      <div class="bm-card"><div class="icon">📜</div><h3>Certificats d'origine & carnets ATA</h3><p>Certificats d'origine pour les douanes, carnets ATA pour les exportations et expositions temporaires.</p><div class="fee">50 – 200 € / document</div></div>
      <div class="bm-card"><div class="icon">🏦</div><h3>Attestations bancaires</h3><p>Attestations de compte, de solvabilité et références bancaires pour appuyer vos négociations et dossiers.</p><div class="fee">100 – 350 € / attestation</div></div>
      <div class="bm-card"><div class="icon">📝</div><h3>Business plan & étude de marché</h3><p>Dossier complet pour banques, investisseurs ou licences : étude, projections financières, packaging investisseur.</p><div class="fee">800 – 4 000 €</div></div>
      <div class="bm-card"><div class="icon">🛡️</div><h3>Assurance professionnelle</h3><p>Mise en relation avec des assureurs partenaires : responsabilité civile pro, flotte, locaux, protection des dirigeants.</p><div class="fee">Sur devis</div></div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Courtage pour banques & institutionnels</h2><p class="sub">Grille de commissions — exécution sur actions et obligations</p></div></div>
    <table class="econ">
      <thead><tr><th>Instrument</th><th>Type d'exécution</th><th>Commission</th><th>Minimum</th></tr></thead>
      <tbody>
        <tr><td>Actions cotées (USA / UE / MENA / Asie)</td><td>Marché secondaire, accès direct</td><td>0,25 – 1 %</td><td>10 000 $ par ordre</td></tr>
        <tr><td>Obligations souveraines & eurobonds</td><td>OTC, contreparties bancaires</td><td>0,10 – 0,75 % du nominal</td><td>50 000 $</td></tr>
        <tr><td>Obligations corporate & convertibles</td><td>OTC / placement privé</td><td>0,15 – 1 % du nominal</td><td>100 000 $</td></tr>
        <tr><td>Émissions primaires (syndication)</td><td>Co-placement avec banques d'affaires</td><td>0,5 – 1,5 % levé</td><td>Sur dossier</td></tr>
        <tr><td>Matières premières (énergie, céréales, métaux)</td><td>Contrats physiques & papier</td><td>0,25 – 1,5 % du contrat</td><td>50 000 $</td></tr>
        <tr><td>Services banques (flux, custody, reporting)</td><td>Contrat annuel</td><td>Forfait mensuel</td><td>5 000 € / mois</td></tr>
      </tbody>
    </table>

    <div class="bm-grid">
      <div class="bm-card" style="grid-column: 1 / -1; text-align:center">
        <h3>Créer votre société internationale</h3>
        <p class="muted">Ouvrez une entreprise dans plus de 15 juridictions. Nous nous occupons de tout : constitution, compte bancaire, licences, siège social.</p>
        <button class="btn btn-primary" style="margin-top:14px" onclick="navigate('creer-societe')">Commencer maintenant</button>
      </div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Mise en relation</h2><p class="sub">Comment fonctionne une opération sur la plateforme</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">📋</div><h3>1. Annonce</h3><p>Le vendeur publie son actif avec documents et prix indicatif.</p></div>
      <div class="bm-card"><div class="icon">🔎</div><h3>2. Vérification</h3><p>Optionnel : pack vérification par nos juristes partenaires.</p></div>
      <div class="bm-card"><div class="icon">💬</div><h3>3. Négociation</h3><p>L'acheteur contacte le vendeur, échange direct via la plateforme.</p></div>
      <div class="bm-card"><div class="icon">⚖️</div><h3>4. Conclusion</h3><p>Actes signés entre les parties avec leurs conseils. Paiement bancaire ou stablecoin.</p></div>
    </div>
  </section>`;
}

const JURISDICTIONS = [
  { flag: "🇦🇪", pays: "Émirats Arabes Unis", ville: "Dubaï", type: "Free Zone / Mainland", prix: "à partir de 4 000 $", delai: "5-10 jours", taxe: "0 % (9 % si taxable)", note: "Idéal pour commerce international, famille, prestige" },
  { flag: "🇺🇸", pays: "États-Unis", ville: "Delaware / Wyoming", type: "LLC / C-Corp", prix: "à partir de 700 $", delai: "3-7 jours", taxe: "0 % si non-résident (état)", note: "Crédibilité mondiale, compte Stripe/Wise/PayPal" },
  { flag: "🇬🇧", pays: "Royaume-Uni", ville: "Londres", type: "Ltd", prix: "à partir de 250 £", delai: "24-48h", taxe: "19-25 %", note: "Rapide, reconnue, compte bancaire en ligne possible" },
  { flag: "🇭🇰", pays: "Hong Kong", ville: "Hong Kong", type: "Ltd", prix: "à partir de 1 500 $", delai: "5-7 jours", taxe: "8,25-16,5 %", note: "Passerelle idéale vers l'Asie et la Chine" },
  { flag: "🇸🇬", pays: "Singapour", ville: "Singapour", type: "Pte Ltd", prix: "à partir de 2 500 $", delai: "7-10 jours", taxe: "0-17 %", note: "Le pays le plus fiable pour les affaires en Asie" },
  { flag: "🇨🇭", pays: "Suisse", ville: "Zoug / Genève", type: "Sàrl / SA", prix: "à partir de 5 000 $", delai: "2-4 semaines", taxe: "8-14 %", note: "Prestige bancaire, stabilité maximale" },
  { flag: "🇻🇬", pays: "Îles Vierges Britanniques", ville: "Road Town", type: "BVI IBC", prix: "à partir de 1 800 $", delai: "3-5 jours", taxe: "0 %", note: "Le grand classique offshore : holding, confidentialité, reconnue mondialement" },
  { flag: "🇰🇾", pays: "Îles Caïmans", ville: "George Town", type: "Exempted Company", prix: "à partir de 2 000 $", delai: "3-5 jours", taxe: "0 %", note: "Offshore, confidentialité maximale, standard des fonds" },
  { flag: "🇮🇪", pays: "Irlande", ville: "Dublin", type: "Ltd", prix: "à partir de 1 200 $", delai: "5-7 jours", taxe: "12,5 %", note: "Porte d'entrée européenne" },
  { flag: "🇲🇺", pays: "Maurice", ville: "Port Louis", type: "GBC / Offshore", prix: "à partir de 1 800 $", delai: "7-10 jours", taxe: "0-15 %", note: "Pont vers l'Afrique" },
  { flag: "🇧🇸", pays: "Bahamas", ville: "Nassau", type: "IBC", prix: "à partir de 1 500 $", delai: "5-7 jours", taxe: "0 %", note: "Offshore sans impôt, pas de reporting annuel public" },
  { flag: "🇱🇨", pays: "Sainte-Lucie", ville: "Castries", type: "IBC", prix: "à partir de 1 200 $", delai: "4-6 jours", taxe: "0 %", note: "Parmi les moins chers, confidentiel, bien accepté" },
  { flag: "🇧🇿", pays: "Belize", ville: "Belize City", type: "IBC", prix: "à partir de 1 000 $", delai: "3-5 jours", taxe: "0 %", note: "Économique, simple, entièrement exonéré" },
  { flag: "🇸🇨", pays: "Seychelles", ville: "Victoria", type: "IBC", prix: "à partir de 1 100 $", delai: "3-5 jours", taxe: "0 %", note: "Rapide et discret, très utilisé pour le trading" },
  { flag: "🇹🇷", pays: "Turquie", ville: "Istanbul", type: "A.Ş. / Ltd", prix: "à partir de 900 $", delai: "7-14 jours", taxe: "12-23 %", note: "Marché régional puissant, pas de capital minimum" }
];

function renderSociete() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head"><div><h2>Création de sociétés internationales</h2><p class="sub">Ouvrez votre entreprise dans le monde entier — on s'occupe de tout</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">📝</div><h3>Constitution de la société</h3><p>Formalités, statuts, enregistrement gouvernemental, agréments.</p></div>
      <div class="bm-card"><div class="icon">🏦</div><h3>Compte bancaire</h3><p>Ouverture de compte bancaire local ou en ligne, ouverture d'un compte crypto-friendly.</p></div>
      <div class="bm-card"><div class="icon">💼</div><h3>Siège social & services</h3><p>Adresse de siège, agent local, secrétariat, conformité annuelle (CRS/FATCA).</p></div>
      <div class="bm-card"><div class="icon">📄</div><h3>Licences & visas</h3><p>Licence commerciale, visa investisseur / résidence (ex : Dubai golden visa).</p></div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Juridictions disponibles</h2><p class="sub">15 destinations, 1 équipe — choisissez votre base</p></div></div>
    <div class="pool-row" style="grid-template-columns:1.4fr 1fr 1fr 1fr;align-items:start" id="jHeader">
      <div class="name">Juridiction</div><div class="name">Prix</div><div class="name">Délai</div><div class="name">Fiscalité</div>
    </div>
    ${JURISDICTIONS.map((j) => `
      <div class="pool-row" style="grid-template-columns:1.4fr 1fr 1fr 1fr;align-items:start">
        <div>
          <div class="name">${j.flag} ${j.pays} — ${j.ville}</div>
          <div class="tag">${j.type}</div>
          <div class="tag">${j.note}</div>
        </div>
        <div class="tag" style="color:var(--accent);font-weight:700">${j.prix}</div>
        <div class="tag">${j.delai}</div>
        <div class="tag">${j.taxe}</div>
      </div>`).join("")}

    <div class="section-head" style="margin-top:40px"><div><h2>Guide de choix — quelle société pour quel besoin ?</h2><p class="sub">Documentation pratique pour choisir votre juridiction</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🌍</div><h3>Commerce international / Trading</h3><p>BVI, Seychelles, Belize, Dubaï Free Zone. Impôt 0 %, règlements en USD, contrat simple.</p></div>
      <div class="bm-card"><div class="icon">💻</div><h3>E-commerce & freelances</h3><p>USA LLC (Wyoming/Delaware) — 700 $, ouverture de Stripe/Wise/PayPal possible, 0 % d'impôt US hors résidence.</p></div>
      <div class="bm-card"><div class="icon">🏦</div><h3>Famille / Transmission de patrimoine</h3><p>Suisse (Sàrl), Dubaï Mainland, Singapour. Banques solides, stabilité, possibilité de résidence.</p></div>
      <div class="bm-card"><div class="icon">📈</div><h3>Holdings & investissements</h3><p>BVI, Caïmans, Maurice (GBC). Structure mère pour détenir des filiales, des biens ou des fonds.</p></div>
      <div class="bm-card"><div class="icon">🌐</div><h3>Marché africain</h3><p>Maurice (pont vers l'Afrique), Dubaï, Turquie. Accès aux marchés locaux avec une structure fiable.</p></div>
      <div class="bm-card"><div class="icon">🇪🇺</div><h3>Accès européen</h3><p>Irlande (12,5 %), Royaume-Uni (rapide). Marques de série pour livrer en Europe.</p></div>
    </div>

    <div class="legal-box" style="margin-top:34px">
      <h3>Documentation & précisions</h3>
      <ul class="small">
        <li><b>Quels documents faut-il fournir ?</b> Passeport (ou CNI), justificatif d'adresse de moins de 3 mois, preuve de l'activité. KYC standard.</li>
        <li><b>Combien de temps ?</b> De 24h (UK) à 4 semaines (Suisse). Comptes bancaires : 1 à 4 semaines selon la banque.</li>
        <li><b>Puis-je être discret ?</b> Oui — les IBC (BVI, Seychelles, Belize, Bahamas, Caïmans) n'ont pas de registre public des actionnaires.</li>
        <li><b>Est-ce légal ?</b> Créer une société à l'étranger est parfaitement légal. L'impôt dû dans VOTRE pays de résidence doit être déclaré. La fraude fiscale, elle, ne l'est pas.</li>
        <li><b>Exigences annuelles :</b> la plupart des juridictions exigent un renouvellement annuel (gouvernement + agent local) : 300 à 1 500 $/an selon la juridiction.</li>
        <li><b>CRS / FATCA :</b> depuis 2018, les comptes sont automatiquement échangés entre pays signataires. La confidentialité a ses limites : déclarez honnêtement.</li>
        <li><b>Compte bancaire :</b> nous ouvrons via nos partenaires (banques locales, néobanques, banques crypto-friendly). La décision finale appartient toujours à la banque.</li>
      </ul>
      <div class="notice" style="margin-top:14px">Ce guide est informatif. Pour toute structuration fiscale personnelle, consultez un avocat / expert-comptable de votre pays. La plateforme ne donne pas de conseil fiscal.</div>
    </div>

    <div class="form-card" style="margin-top:40px">
      <h2 style="color:var(--accent)">Demander l'ouverture d'une société</h2>
      <p class="muted small">${currentUser ? "Nous étudierons votre demande et vous enverrons le devis exact." : "Connectez-vous pour envoyer la demande (ou utilisez le bouton Contacter)."}</p>
      <div class="form-grid">
        <div><label>Votre nom</label><input id="sName" value="${currentUser ? currentUser.name : ""}" placeholder="Nom complet"></div>
        <div><label>Email / WhatsApp</label><input id="sContact" placeholder="email ou numéro"></div>
        <div><label>Pays de création souhaité</label>
          <select id="sPays">
            ${JURISDICTIONS.map((j) => `<option>${j.pays} (${j.ville})</option>`).join("")}
            <option>Je ne sais pas — conseillez-moi</option>
          </select>
        </div>
        <div><label>Activité de la société</label>
          <select id="sActivite">
            <option>Trading / Import-Export</option>
            <option>E-commerce</option>
            <option>Immobilier</option>
            <option>Fintech / Crypto</option>
            <option>Consulting</option>
            <option>Holdings / Investissements</option>
            <option>Autre</option>
          </select>
        </div>
      </div>
      <label>Message (besoins particuliers : visa, compte bancaire, associés...)</label>
      <textarea id="sMsg" rows="3" placeholder="Décrivez votre projet..."></textarea>
      <button class="btn btn-primary full" onclick="submitSociete()">Envoyer la demande de création</button>
      <p id="sOk" class="ok small" style="display:none;margin-top:12px">✓ Demande envoyée. Notre équipe vous contacte sous 24h avec le devis.</p>
      <p id="sErr" class="small" style="display:none;margin-top:12px;color:var(--red)"></p>
    </div>
  </section>`;
}

async function submitSociete() {
  const err = document.getElementById("sErr");
  err.style.display = "none";
  const r = await api("contact", "POST", {
    name: document.getElementById("sName").value,
    contact: document.getElementById("sContact").value,
    subject: "Création de société — " + document.getElementById("sPays").value,
    message: "Activité : " + document.getElementById("sActivite").value + ". " + document.getElementById("sMsg").value
  });
  if (r.ok) {
    document.getElementById("sOk").style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    err.style.display = "block";
    err.textContent = r.error || "Erreur : renseignez nom et contact.";
  }
}

function renderBusiness() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head"><div><h2>Modèle économique</h2><p class="sub">Comment la plateforme gagne de l'argent, sans toucher aux fonds des clients</p></div></div>

    <div class="bm-grid">
      <div class="bm-card"><div class="icon">📈</div><h3>Courtage actions</h3><p>Commissions sur ordres exécutés pour banques, fonds et institutionnels.</p><div class="fee">0,25 – 1 % par ordre</div></div>
      <div class="bm-card"><div class="icon">📜</div><h3>Courtage obligations</h3><p>Commission sur placement et exécution d'obligations souveraines et corporate.</p><div class="fee">0,1 – 0,75 % du nominal</div></div>
      <div class="bm-card"><div class="icon">🛢️</div><h3>Matières premières</h3><p>Commission sur intermédiation de contrats énergie, céréales et métaux.</p><div class="fee">0,25 – 1,5 % du contrat</div></div>
      <div class="bm-card"><div class="icon">🤝</div><h3>Commission de mise en relation</h3><p>Prélevée quand une transaction est conclue entre un acheteur et un vendeur.</p><div class="fee">1 – 3 %</div></div>
      <div class="bm-card"><div class="icon">📌</div><h3>Abonnement vendeurs</h3><p>Publication d'offres, visibilité premium et badge « documents vérifiés ».</p><div class="fee">50 – 200 € / mois</div></div>
      <div class="bm-card"><div class="icon">📑</div><h3>Packs de vérification</h3><p>Audit préalable des documents par un partenaire notaire / juriste.</p><div class="fee">300 – 1 500 € / dossier</div></div>
      <div class="bm-card"><div class="icon">🏦</div><h3>Fonds immobiliers</h3><p>Frais de gestion sur les actifs collectés et commission de performance.</p><div class="fee">1 – 1,5 % + carry 10 %</div></div>
      <div class="bm-card"><div class="icon">⚡</div><h3>Crypto & stablecoins</h3><p>Frais sur les entrées / sorties en stablecoin et sur les tokens de fonds.</p><div class="fee">0,5 % par opération</div></div>
      <div class="bm-card"><div class="icon">📊</div><h3>Services premium</h3><p>Rapports, analyse de crédit sur mesure, assistance juridique internationale.</p><div class="fee">Sur devis</div></div>
      <div class="bm-card"><div class="icon">🏭</div><h3>Immobilier, Usines, Marques</h3><p>Commission sur cession de biens et marques premium (mandats vérifiés).</p><div class="fee">1 – 3 %</div></div>
      <div class="bm-card"><div class="icon">🔄</div><h3>Mandats M&A</h3><p>Fusions-acquisitions et recherche d'acquéreurs pour entreprises.</p><div class="fee">1 – 5 %</div></div>
      <div class="bm-card"><div class="icon">🔗</div><h3>API Crypto ↔ Financier</h3><p>Abonnement des fintechs et fonds qui accèdent à vos actifs par API.</p><div class="fee">500 – 5 000 €/mois</div></div>
      <div class="bm-card"><div class="icon">🏢</div><h3>Création de sociétés</h3><p>Ouverture d'entreprises dans le monde entier, compte bancaire inclus.</p><div class="fee">700 – 4 000 € / société</div></div>
    </div>
    <div class="section-head" style="margin-top:30px"><div><h2>Unité économique</h2><p class="sub">Scénario réaliste à 12 mois</p></div></div>
    <table class="econ">
      <thead><tr><th>Source de revenus</th><th>Volume</th><th>Estimation mensuelle</th></tr></thead>
      <tbody>
        <tr><td>Abonnements vendeurs</td><td>100 vendeurs × 100 €</td><td>10 000 €</td></tr>
        <tr><td>Commission transactions</td><td>10 transactions × 5 000 € × 2 %</td><td>1 000 €</td></tr>
        <tr><td>Courtage actions & obligations</td><td>15 ordres × 1 000 € × 0,5 %</td><td>75 €</td></tr>
        <tr><td>Matières premières (énergie, céréales)</td><td>2 contrats × 150 000 € × 0,5 %</td><td>1 500 €</td></tr>
        <tr><td>Packs vérification</td><td>20 dossiers × 500 €</td><td>10 000 €</td></tr>
        <tr><td>Crypto (stablecoins + tokens)</td><td>200 opérations × 250 € × 0,5 %</td><td>250 €</td></tr>
        <tr><td>Fonds immobiliers</td><td>3 fonds en gestion</td><td>2 500 €</td></tr>
        <tr><td>Études & rapports</td><td>15 rapports × 150 €</td><td>2 250 €</td></tr>
        <tr><td>Mandats M&A / cessions</td><td>1 opération / trimestre</td><td>2 000 €</td></tr>
        <tr><td>API & partenariats</td><td>2 partenaires × 500 €</td><td>1 000 €</td></tr>
        <tr><td class="tot">Total récurrent estimé</td><td></td><td class="tot">≈ 30 575 € / mois</td></tr>
      </tbody>
    </table>

    <div class="bm-card" style="margin-top:10px">
      <h3>Phases de lancement</h3>
      <p><b>Phase 1 · 2-4 semaines :</b> MVP vitrine + catalogue + mise en relation. Coût : faible, aucun risque réglementaire.</p>
      <p style="margin-top:8px"><b>Phase 2 · Mois 2-4 :</b> abonnements vendeurs + packs de vérification documentaire (partenaires notaires).</p>
      <p style="margin-top:8px"><b>Phase 3 · Mois 4-8 :</b> escrow sécurisé + paiements stablecoins réels (licence VASP selon juridiction).</p>
      <p style="margin-top:8px"><b>Phase 4 · Mois 8+ :</b> lancement des fonds immobiliers SPV puis tokenisation encadrée des actifs.</p>
    </div>
  </section>`;
}

function renderPublish() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Catalogue", onclick: "navigate('catalogue')" },
      { label: "Publier une offre" }
    ])}
    <div class="section-head">
      <div><h2 style="color:var(--accent)">Publier une offre</h2><p class="sub">Soumettez votre actif pour validation — publication sous 24h après vérification</p></div>
    </div>
    <div class="form-card">
      <p class="muted small">${currentUser ? "Votre offre sera soumise à validation par notre équipe avant publication." : "Connectez-vous pour soumettre une offre. La validation des documents (KYC/KYB) est requise avant publication."}</p>
      
      <div class="form-grid">
        <div><label>Type d'actif</label>
          <select id="pType" onchange="togglePublishFields()">
            <option value="obligation">Obligation</option>
            <option value="credit">Crédit / Créances</option>
            <option value="hedgefund">Fonds immobilier</option>
            <option value="immobilier">Immobilier</option>
            <option value="usine">Usine</option>
            <option value="marque">Marque</option>
            <option value="ma">Entreprise (M&A)</option>
            <option value="commodity">Matière première</option>
            <option value="financement_dette">🏦 Financement / Refinancement Dette</option>
          </select>
        </div>
        <div><label>Devise</label>
          <select id="pDevise"><option>USD</option><option>EUR</option><option>USDC</option><option>USDT</option><option>AED</option></select>
        </div>
      </div>
      
      <!-- Champs communs -->
      <label>Titre de l'actif</label>
      <input id="pTitle" placeholder="Ex : Obligation souveraine pays X 2030">
      
      <div class="form-grid">
        <div><label>Pays</label><input id="pPays" placeholder="Pays de l'actif"></div>
        <div><label>Rendement / Taux cible (%)</label><input id="pYield" type="number" step="0.1" placeholder="8.5"></div>
        <div><label>Montant (devise)</label><input id="pAmount" type="number" placeholder="250000"></div>
        <div><label>Échéance / Durée</label><input id="pMaturity" placeholder="2032 ou 24 mois"></div>
      </div>
      
      <!-- Champs spécifiques Financement Dette (masqués par défaut) -->
      <div id="fdFields" style="display:none;border-top:1px solid var(--line);padding-top:var(--space-lg);margin-top:var(--space-lg)">
        <h4 style="color:var(--navy);margin-bottom:var(--space-md)">🏦 Détails financement / refinancement</h4>
        <div class="form-grid">
          <div><label>Type de dette recherchée</label>
            <select id="pDebtType">
              <option value="senior_immo">Dette Senior Immobilier (LTV 70%)</option>
              <option value="construction">Construction / Promotion (tranches avancement)</option>
              <option value="refinancing">Refinancing / Recap / Equity Release</option>
              <option value="senior_corp">Dette Senior Entreprise / Unitranche (EBITDA > 2M€)</option>
              <option value="mezzanine">Mezzanine / Dette Subordonnée (warrant/PIK)</option>
              <option value="bridge">Bridge / Capex Express (3-12 mois)</option>
            </select>
          </div>
          <div><label>LTV / Multiple EBITDA visé</label>
            <select id="pLtv">
              <option value="50">50% LTV / 2.0x EBITDA</option>
              <option value="60" selected>60% LTV / 2.5x EBITDA</option>
              <option value="70">70% LTV / 3.0x EBITDA</option>
              <option value="75">75% LTV / 3.5x EBITDA (mezzanine)</option>
            </select>
          </div>
          <div><label>Durée souhaitée</label>
            <select id="pDuration">
              <option value="3">3 ans (bridge)</option>
              <option value="5">5 ans</option>
              <option value="7" selected>7 ans</option>
              <option value="10">10 ans</option>
            </select>
          </div>
          <div><label>Garanties proposées</label>
            <input id="pGuarantees" placeholder="Hypothèque 1er rang, nantissement parts, caution personnelle, GFA...">
          </div>
        </div>
        <label>Description du projet / Besoin de financement</label>
        <textarea id="pProjectDesc" rows="4" placeholder="Contexte, utilisation des fonds, business plan, sortie envisagée..."></textarea>
      </div>
      
      <!-- Description standard (pour autres types) -->
      <div id="stdDesc">
        <label>Description</label>
        <textarea id="pDesc" rows="4" placeholder="Structure, garanties, historique, documents disponibles..."></textarea>
      </div>
      
      <button class="btn btn-primary full" onclick="submitOffer()">Soumettre mon offre</button>
      <p id="pOk" class="ok small" style="display:none;margin-top:12px">✓ Offre envoyée. Notre équipe la vérifiera puis la publiera.</p>
      <p id="pErr" class="small" style="display:none;margin-top:12px;color:var(--red)"></p>
    </div>
  </section>`;
  
  // Initialize field visibility
  togglePublishFields();
}

function togglePublishFields() {
  const type = document.getElementById("pType")?.value;
  const fdFields = document.getElementById("fdFields");
  const stdDesc = document.getElementById("stdDesc");
  if (fdFields && stdDesc) {
    const show = type === "financement_dette";
    fdFields.style.display = show ? "block" : "none";
    stdDesc.style.display = show ? "none" : "block";
  }
}

let _payConfig = null;
async function renderSubscription() {
  const box = document.getElementById("app");
  const plans = await api("plans");
  _payConfig = plans.config || null;
  const list = (plans.plans || []).map((p) => `
    <div class="sub-plan ${currentSub && currentSub.plan === p.key && currentSub.statut === "actif" ? "sub-active" : ""}">
      <h3>${p.name}</h3>
      <div class="sub-price">${p.price} <span>€${p.interval}</span></div>
      <div class="sub-tag">${p.tagline}</div>
      <ul>${p.features.map((f) => `<li>${f}</li>`).join("")}</ul>
      ${currentSub && currentSub.plan === p.key && currentSub.statut === "actif"
        ? `<button class="btn btn-primary full" disabled>Abonnement actif</button>`
        : `
          <button class="btn btn-primary full" onclick="subscribePayPal('${p.key}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="margin-right:6px">
              <path d="M12 2.25C6.03 2.25 1.2 7.08 1.2 13.05c0 4.42 2.87 8.17 6.75 9.45.36.12.68-.2.68-.49v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.58 9.58 0 0112 6.84c.85.004 1.7.115 2.5.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.69.92.69 1.85V21c0 .27.27.59.75.48C19.14 21.22 24 17.47 24 13.05 24 7.08 19.17 2.25 13.2 2.25h-.03z"/>
            </svg>
            Payer avec PayPal (activation immédiate)
          </button>
          <button class="btn btn-ghost full" style="margin-top:8px" onclick="subscribe('${p.key}')">Autres moyens (virement, crypto...)</button>
        `}
    </div>`).join("");
  box.innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Abonnement" }
    ])}
    <div class="section-head">
      <div><h2>Abonnement</h2><p class="sub">Accès aux vendeurs, aux documents et aux alertes — ${currentUser ? "votre statut : <b>" + subStatus() + "</b>" : "connectez-vous pour souscrire"}</p></div>
      ${!currentUser ? `<button class="btn btn-primary" onclick="openAuth()">Se connecter</button>` : ""}
    </div>
    <div class="sub-grid">${list}</div>
    <div id="subInvoice"></div>
    <div class="notice" style="margin-top:24px">Paiement par virement, PayPal, mobile money ou stablecoins. L'accès est activé manuellement par notre équipe après réception du paiement (généralement sous 24 h). Abonnement sans engagement, résiliable à tout moment — voir CGV.</div>
  </section>`;
  renderInvoice();
}

function renderInvoice() {
  const box = document.getElementById("subInvoice");
  if (!box) return;
  if (!currentSub || currentSub.statut === "actif") { box.innerHTML = ""; return; }
  box.innerHTML = `
  <div class="form-card" style="margin-top:26px">
    <h3 style="color:var(--accent)">Facture — ${currentSub.reference}</h3>
    <p class="muted small">Plan : ${currentSub.plan} · Montant : ${currentSub.montant} ${currentSub.devise} · Statut : <b>${currentSub.statut === "en_attente" ? "en attente de paiement" : currentSub.statut}</b></p>
    <h4 style="margin-top:14px">Comment payer</h4>
    <ol class="pay-steps">
      <li>Effectuez le paiement par le moyen de votre choix ci-dessous.</li>
      <li>Indiquez la référence <b>${currentSub.reference}</b> dans le libellé du paiement.</li>
      <li>Cliquez sur « J'ai effectué le paiement » pour prévenir notre équipe.</li>
      <li>Notre équipe vérifie et active votre accès sous 24 h.</li>
    </ol>
    <div class="pay-rows" id="payRows"></div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="confirmPaid()">J'ai effectué le paiement</button>
    <p id="payOk" class="ok small" style="display:none;margin-top:10px">✓ Bien reçu. Notre équipe vérifie votre paiement et active votre accès sous 24 h.</p>
  </div>`;
  renderPayRows();
}

function renderPayRows() {
  const box = document.getElementById("payRows");
  if (!box) return;
  const m = (_payConfig && _payConfig.moyens) || {};
  const rows = Object.values(m).map((x) => `<div class="pay-row"><b>${x.label}</b><span>${x.details}</span></div>`);
  box.innerHTML = rows.join("") || `<div class="pay-row"><span>Aucun moyen de paiement configuré.</span></div>`;
}

async function subscribe(plan) {
  if (!currentUser) { openAuth(); return; }
  const r = await api("subscribe", "POST", { plan });
  if (r.ok && r.invoice) {
    const s = await api("my-subscription");
    currentSub = s.subscription || null;
    renderSubscription();
  } else {
    alert((r && r.error) || "Erreur. Réessayez.");
  }
}

async function subscribePayPal(plan) {
  if (!currentUser) { openAuth(); return; }
  try {
    const r = await api("paypal/create-order", "POST", { plan });
    if (!r.ok) { alert(r.error || "Erreur création commande PayPal"); return; }
    window.location.href = `https://www.${PAYPAL_CONFIG.mode === "live" ? "" : "sandbox."}paypal.com/checkoutnow?token=${r.orderID}`;
  } catch (e) {
    console.error("PayPal error:", e);
    alert("Erreur lors de la redirection PayPal");
  }
}

async function confirmPaid() {
  const r = await api("subscribe/confirm", "POST", {});
  if (r.ok) {
    document.getElementById("payOk").style.display = "block";
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } else {
    alert((r && r.error) || "Erreur. Réessayez.");
  }
}

function renderKyc() {
  const box = document.getElementById("app");
  const s = currentUser ? currentUser.kyc_statut : "aucun";
  const statusHtml = s === "valide"
    ? `<div class="notice" style="border-color:var(--accent);color:var(--accent)">✓ Votre identité est vérifiée. Badge Vérifié actif.</div>`
    : s === "en_attente"
    ? `<div class="notice">⏳ Votre demande est en cours de vérification par notre équipe (sous 24 h).</div>`
    : s === "rejete"
    ? `<div class="notice" style="border-color:var(--red);color:var(--red)">Demande rejetée. Corrigez les informations et renvoyez.</div>`
    : "";
  box.innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Vérification d'identité (KYC)" }
    ])}
    <div class="form-card">
      <h2 style="color:var(--accent)">Vérification d'identité (KYC)</h2>
      <p class="muted small">Obtenez le badge <span class="badge verified">Vérifié</span> : gage de crédibilité auprès des vendeurs. Votre demande est traitée manuellement par notre équipe.</p>
      ${statusHtml}
      ${currentUser ? `
      <div class="form-grid">
        <div><label>Nom légal complet</label><input id="kNom" placeholder="Comme sur la pièce d'identité"></div>
        <div><label>Pays de résidence</label><input id="kPays" placeholder="Ex : France, Émirats, Algérie..."></div>
      </div>
      <label>Type de document</label>
      <select id="kDoc">
        <option>Passeport</option>
        <option>Carte nationale d'identité</option>
        <option>Permis de conduire</option>
        <option>Passeport ou ID société (vendeur)</option>
      </select>
      <label>Référence ou n° du document (facultatif)</label>
      <input id="kRef" placeholder="Numéro du document, sans photo pour l'instant">
      <button class="btn btn-primary full" style="margin-top:14px" onclick="submitKyc()">Envoyer ma demande</button>
      <p id="kOk" class="ok small" style="display:none;margin-top:12px">✓ Demande envoyée. Notre équipe vous notifie dès validation.</p>` : `
      <button class="btn btn-primary full" onclick="openAuth()">Se connecter pour se vérifier</button>`}
    </div>
  </section>`;
}
async function submitKyc() {
  const r = await api("kyc", "POST", {
    nom: document.getElementById("kNom").value,
    pays: document.getElementById("kPays").value,
    document: document.getElementById("kDoc").value + (document.getElementById("kRef").value ? " — " + document.getElementById("kRef").value : "")
  });
  const ok = document.getElementById("kOk");
  if (r.ok) {
    currentUser.kyc_statut = "en_attente";
    ok.style.display = "block";
  } else {
    ok.style.display = "block";
    ok.textContent = "⚠ " + (r.error || "Erreur");
    ok.style.color = "var(--red)";
  }
}

function renderCompare() {
  const ids = getCompare();
  const list = assets.filter((a) => ids.includes(String(a.id)));
  const fields = [
    ["Type", (a) => a.typeLabel],
    ["Émetteur", (a) => a.emetteur],
    ["Pays", (a) => a.pays],
    ["Devise", (a) => a.devise],
    ["Montant", (a) => money(a.montant)],
    ["Rendement", (a) => (a.rendement ? pct(a.rendement) : "-")],
    ["Échéance", (a) => a.maturite],
    ["Risque", (a) => a.risque],
    ["Vendeur", (a) => a.vendeur]
  ];
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Catalogue", onclick: "navigate('catalogue')" },
      { label: "Comparateur" }
    ])}
    <div class="section-head">
      <div><h2>Comparateur</h2><p class="sub">${list.length} offre(s) sélectionnée(s) — comparez-les côte à côte</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="clearCompare()">Vider</button>
        <button class="btn btn-ghost" onclick="navigate('catalogue')">← Catalogue</button>
      </div>
    </div>
    ${list.length >= 2 ? `
    <div class="cmp-table-wrap">
      <table class="cmp-table">
        <thead><tr><th>Critère</th>${list.map((a) => `<th><span class="token">${a.token}</span><br>${a.title}</th>`).join("")}</tr></thead>
        <tbody>
          ${fields.map(([label, fn]) => `<tr><td><b>${label}</b></td>${list.map((a) => `<td>${fn(a)}</td>`).join("")}</tr>`).join("")}
          <tr><td></td>${list.map((a) => `<td><button class="btn btn-primary btn-sm" onclick="openAsset('${a.id}')">Voir la fiche</button></td>`).join("")}</tr>
        </tbody>
      </table>
    </div>` : `<p class="muted">Sélectionnez au moins 2 offres avec le bouton <b>+</b> sur les cartes.</p>`}
    ${compareBarHtml()}
  </section>`;
  refreshCompareBar();
}

async function submitOffer() {
  const t = document.getElementById("pTitle").value.trim();
  if (!t) { document.getElementById("pErr").style.display = "block"; document.getElementById("pErr").textContent = "Veuillez renseigner le titre de l'actif."; return; }
  if (!currentUser) { document.getElementById("pErr").style.display = "block"; document.getElementById("pErr").textContent = "Connectez-vous d'abord pour soumettre une offre."; return; }
  
  const type = document.getElementById("pType").value;
  const isFinancementDette = type === "financement_dette";
  
  const payload = {
    type: type,
    title: t,
    pays: document.getElementById("pPays").value,
    devise: document.getElementById("pDevise").value,
    montant: parseFloat(document.getElementById("pAmount").value) || null,
    rendement: parseFloat(document.getElementById("pYield").value) || null,
    maturite: document.getElementById("pMaturity").value,
    description: isFinancementDette ? document.getElementById("pProjectDesc")?.value : document.getElementById("pDesc").value
  };
  
  if (isFinancementDette) {
    payload.debt_type = document.getElementById("pDebtType")?.value;
    payload.ltv_target = document.getElementById("pLtv")?.value;
    payload.duration_target = document.getElementById("pDuration")?.value;
    payload.guarantees = document.getElementById("pGuarantees")?.value;
  }
  
  const r = await api("submit", "POST", payload);
  if (r.ok) {
    document.getElementById("pOk").style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    document.getElementById("pErr").style.display = "block";
    document.getElementById("pErr").textContent = r.error || "Erreur.";
  }
}

function renderFavorites() {
  const favs = getFavs();
  const list = assets.filter((a) => favs.includes(String(a.id)));
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>Mes favoris</h2><p class="sub">Votre watchlist — ${list.length} actif(s) suivi(s)</p></div>
      <button class="btn btn-ghost" onclick="navigate('catalogue')">← Retour au catalogue</button>
    </div>
    <div class="grid">${list.map(assetCard).join("") || `<p class="muted">Aucun favori pour le moment. Cliquez sur ☆ pour suivre une offre.</p>`}</div>
  </section>`;
}

function renderAlerts() {
  const alerts = getAlerts();
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>Mes alertes</h2><p class="sub">Soyez notifié quand une offre correspond à vos critères</p></div>
      <button class="btn btn-ghost" onclick="navigate('catalogue')">← Retour au catalogue</button>
    </div>
    <div class="form-card">
      <h3 style="color:var(--accent)">Créer une alerte</h3>
      <div class="form-grid">
        <div><label>Nom de l'alerte</label><input id="alName" placeholder="Ex : Obligations souveraines Afrique"></div>
        <div><label>Type d'actif</label>
          <select id="alType">
            <option value="all">Tous</option>
            <option value="obligation">Obligations</option>
            <option value="credit">Crédits</option>
            <option value="hedgefund">Fonds immobiliers</option>
            <option value="immobilier">Immobilier</option>
            <option value="usine">Usines</option>
            <option value="marque">Marques</option>
            <option value="ma">M&A</option>
            <option value="commodity">Matières premières</option>
          </select>
        </div>
        <div><label>Rendement min. (%)</label><input id="alYield" type="number" step="0.1" placeholder="Ex : 8"></div>
        <div><label>Montant max.</label><input id="alAmount" type="number" placeholder="Ex : 1000000"></div>
      </div>
      <button class="btn btn-primary full" onclick="addAlert()">Enregistrer l'alerte</button>
    </div>
    <h3 style="margin-top:34px;color:var(--accent)">Alertes enregistrées</h3>
    <div id="alertsList"></div>
  </section>`;
  renderAlertsList();
}

function renderAlertsList() {
  const box = document.getElementById("alertsList");
  if (!box) return;
  const alerts = getAlerts();
  box.innerHTML = alerts.map((al) => {
    const matches = matchAlert(al);
    return `
    <div class="pool-row" style="align-items:start">
      <div>
        <div class="name">${al.name}</div>
        <div class="tag">${al.type === "all" ? "Tous types" : al.type} · Rendement ≥ ${al.yield}% · Montant ≤ ${al.amount ? money(al.amount) : "∞"}</div>
      </div>
      <div class="apy">${matches.length} <span style="color:var(--muted);font-size:.8rem">correspondance(s)</span></div>
      <div class="invest"><button class="btn btn-ghost" onclick="removeAlert(${al.id})">Supprimer</button></div>
    </div>`;
  }).join("") || `<p class="muted">Aucune alerte. Créez-en une ci-dessus.</p>`;
}

function matchAlert(al) {
  return assets.filter((a) => {
    if (al.type !== "all" && a.type !== al.type) return false;
    if (al.yield && (a.rendement || 0) < al.yield) return false;
    if (al.amount && (a.montant || 0) > al.amount) return false;
    return true;
  });
}

function addAlert() {
  const name = document.getElementById("alName").value.trim() || "Alerte " + (getAlerts().length + 1);
  getAlerts().push({
    id: Date.now(),
    name,
    type: document.getElementById("alType").value,
    yield: parseFloat(document.getElementById("alYield").value) || 0,
    amount: parseFloat(document.getElementById("alAmount").value) || null
  });
  saveState();
  renderAlertsList();
  refreshNavBadges();
}

function removeAlert(id) {
  state.alerts = getAlerts().filter((a) => a.id !== id);
  saveState();
  renderAlertsList();
  refreshNavBadges();
}

function renderDeals() {
  const deals = getDeals();
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>Mes dossiers</h2><p class="sub">Suivi des transactions en cours — la plateforme ne détient jamais les fonds</p></div>
      <button class="btn btn-ghost" onclick="navigate('catalogue')">← Retour au catalogue</button>
    </div>
    <div id="dealsList"></div>
  </section>`;
  renderDealsList();
}

function renderDealsList() {
  const box = document.getElementById("dealsList");
  if (!box) return;
  const deals = getDeals();
  box.innerHTML = deals.map((d) => {
    const a = assets.find((x) => String(x.id) === String(d.assetId));
    const idx = DEAL_STAGES.findIndex((s) => s.k === d.status);
    const cur = idx === -1 ? 0 : idx;
    return `
    <div class="deal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div class="name">${a ? tData(a.title) : "Offre supprimée"}</div>
          <div class="tag">${d.ref} · <span>Ouvert le</span> ${new Date(d.date).toLocaleDateString(currentLang() === "fr" ? "fr-FR" : "en-GB")}</div>
        </div>
        <div class="tag" style="color:var(--accent);font-weight:700"><span>Étape</span> ${cur + 1}/${DEAL_STAGES.length} — ${tData(DEAL_STAGES[cur].label)}</div>
      </div>
      <div class="pipeline">
        ${DEAL_STAGES.map((s, i) => `<div class="pstep ${i < cur ? "done" : ""} ${i === cur ? "cur" : ""}"><span class="n">${i + 1}</span>${s.label}</div>`).join("")}
      </div>
      <div class="progress"><div class="progress-bar" style="width:${Math.round(((cur + 1) / DEAL_STAGES.length) * 100)}%"></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${DEAL_STAGES.map((s) => `<button class="btn btn-ghost ${d.status === s.k ? "btn-primary" : ""}" onclick="setDealStatus(${d.id},'${s.k}')">${s.label}</button>`).join("")}
        <button class="btn btn-ghost" onclick="removeDeal(${d.id})">Supprimer</button>
      </div>
      <p class="small muted" style="margin-top:12px">${d.notes || ""}</p>
    </div>`;
  }).join("") || `<p class="muted">Aucun dossier ouvert. Depuis une fiche d'actif, cliquez sur « Suivre ce dossier ».</p>`;
}

function startDeal(assetId) {
  const a = assets.find((x) => String(x.id) === String(assetId));
  if (!a) return;
  const deals = getDeals();
  if (deals.find((d) => d.assetId === String(assetId))) { alert("Ce dossier est déjà suivi."); return; }
  deals.push({ id: Date.now(), assetId: String(assetId), ref: "AUR-" + a.token + "-" + String(Date.now()).slice(-4), status: "contact", date: Date.now(), notes: "Demande d'information envoyée — attente de la réponse du vendeur." });
  saveState();
  renderDeals();
}

function setDealStatus(id, status) {
  const d = getDeals().find((x) => x.id === id);
  if (!d) return;
  d.status = status;
  if (status === "closing") d.notes = "Dossier conclu entre les parties. Règlement direct hors plateforme.";
  if (status === "nda") d.notes = "NDA signé avec " + (assets.find((x) => String(x.id) === d.assetId)?.vendeur || "le vendeur") + " — accès aux documents confidentiels.";
  if (status === "loi") d.notes = "Lettre d'intention échangée — périmètre et prix indicatif.";
  if (status === "dd") d.notes = "Due diligence en cours : documents, bilans, vérifications.";
  if (status === "spa") d.notes = "Négociation du contrat de cession (SPA) avec les conseils.";
  saveState();
  renderDealsList();
}

function removeDeal(id) {
  state.deals = getDeals().filter((d) => d.id !== id);
  saveState();
  renderDealsList();
}

function genLOI(id) {
  const a = assets.find((x) => String(x.id) === String(id));
  if (!a) return;
  const deal = getDeals().find((d) => d.assetId === String(id));
  const ref = deal ? deal.ref : "AUR-" + a.token + "-" + String(Date.now()).slice(-4);
  const d = new Date();
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:40px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <a class="back" href="#" onclick="navigate('detail','${a.id}');return false;">← Retour à la fiche</a>
      <button class="btn btn-primary" onclick="window.print()">Imprimer / PDF</button>
    </div>
    <div class="loi-doc">
      <div class="loi-head">
        <img src="logo.svg" alt="Aureus">
        <h1>LETTRE D'INTENTION</h1>
        <p class="muted"><span>Référence :</span> ${ref} · <span>Date :</span> ${d.toLocaleDateString(currentLang() === "fr" ? "fr-FR" : "en-GB")}</p>
      </div>
      <div class="loi-body">
        <p><b>Vendeur / cédant :</b> ${a.vendeur} (${tData(a.pays)})</p>
        <p><b>Émetteur de l'actif :</b> ${tData(a.emetteur)}</p>
        <p><b>Actif visé :</b> ${tData(a.title)} — <span>Réf.</span> ${a.token} — <span>Catégorie</span> ${tData(a.typeLabel)}</p>
        <p><b>Caractéristiques :</b> <span>Montant nominal</span> ${money(a.montant)} · <span>Échéance</span> ${tData(a.maturite)}${a.rendement ? ` · <span>Rendement</span> ${pct(a.rendement)}` : ""} · <span>Risque</span> ${a.risque}</p>
        <h3>Intentions des parties</h3>
        <p>Les soussignés expriment leur intention de conclure une transaction portant sur l'actif décrit ci-dessus, sous réserve de la finalisation des documents contractuels, de la vérification documentaire et des conditions préalables convenues entre les parties.</p>
        <h3>Engagements</h3>
        <p>Cette lettre d'intention est non contraignante et ne constitue ni une offre, ni une acceptation, ni un engagement de conclure. Seul l'accord définitif signé par les parties aura valeur contraignante. Les parties s'engagent à la confidentialité et à la bonne foi pendant la négociation.</p>
        <h3>Parties</h3>
        <div class="loi-sign">
          <div><div class="lbl">Acheteur / investisseur</div><div class="line"></div><div class="small muted">Nom, signature, date</div></div>
          <div><div class="lbl">Vendeur / cédant</div><div class="line"></div><div class="small muted">Nom, signature, date</div></div>
        </div>
        <div class="notice" style="margin-top:18px">Document généré à titre informatif par la plateforme Aureus Capital Markets, qui agit uniquement comme intermédiaire de mise en relation et ne détient aucun fonds. Ce modèle ne constitue pas un conseil juridique.</div>
      </div>
    </div>
  </section>`;
}

const LEGAL_DOCS = {
  cgu: { title: "Conditions Générales d'Utilisation", sections: [
    ["1. Objet", "La plateforme Aureus Capital Markets met en relation des acheteurs et des vendeurs d'actifs (obligations, crédits, immobilier, usines, marques, M&A, matières premières). Elle agit uniquement comme intermédiaire de mise en relation et de courtage d'annonces."],
    ["2. Comptes et accès", "L'accès aux fonctions de mise en relation (contact des vendeurs, documents, alertes) est réservé aux membres disposant d'un abonnement actif. Chaque compte est personnel : l'utilisateur s'engage à fournir des informations exactes et à ne pas partager ses identifiants."],
    ["3. Abonnements payants", "Deux formules payantes : « Investisseur Vérifié » (99 €/mois) et « Premium » (299 €/mois). Le paiement est effectué par virement, PayPal, mobile money ou stablecoins, selon les modalités indiquées sur la facture. L'accès est activé manuellement après vérification du paiement (généralement sous 24 h). Abonnement sans engagement, résiliable à tout moment ; l'accès reste actif jusqu'à la fin de la période payée."],
    ["4. Contenu des offres", "Les offres, montants, rendements et documents sont fournis par les vendeurs. La plateforme ne garantit ni l'exactitude de ces informations ni le résultat des transactions. Chaque acheteur est invité à faire vérifier les documents par ses propres conseils avant toute décision."],
    ["5. Transactions", "Les transactions conclues le sont directement entre les parties, assistées de leurs conseils (avocats, notaires, experts). La plateforme ne détient jamais les fonds des utilisateurs et n'est pas partie aux transactions."],
    ["6. Obligations de l'utilisateur", "L'utilisateur s'interdit toute utilisation frauduleuse, toute contrefaçon, tout harcèlement et toute tentative de contourner les mécanismes d'abonnement ou de sécurité. Tout manquement peut entraîner la suspension du compte."],
    ["7. Données personnelles", "Les données collectées (nom, email, messages) servent uniquement au fonctionnement de la plateforme (compte, abonnements, mise en relation, notifications). Elles ne sont jamais revendues. Détails dans la politique de confidentialité."],
    ["8. Limitation de responsabilité", "La plateforme ne fournit ni conseil en investissement, ni garantie de rendement, ni assurance contre les pertes. En aucun cas elle ne peut être tenue responsable des pertes liées aux transactions conclues via ses services."],
    ["9. Résiliation", "Tout utilisateur peut supprimer son compte à tout moment. La plateforme se réserve le droit de suspendre un compte en cas de manquement aux présentes conditions."],
    ["10. Droit applicable", "Les présentes conditions sont régies par la loi applicable au siège de l'éditeur. En cas de litige, les parties s'efforceront de trouver une solution amiable avant toute procédure."]
  ]},
  cgv: { title: "Conditions Générales de Vente (abonnements)", sections: [
    ["1. Produits concernés", "Les présentes CGV régissent la vente des abonnements « Investisseur Vérifié » (99 €/mois) et « Premium » (299 €/mois) proposés par Aureus Capital Markets."],
    ["2. Prix", "Les prix sont exprimés en euros, TVA non applicable (prestations de services hors Union européenne, ou régime applicable à l'éditeur). Le montant est confirmé sur la facture avant tout paiement."],
    ["3. Moyens de paiement acceptés", "Virement SEPA/international, PayPal, mobile money (Wave, Orange Money, MTN MoMo) et stablecoins (USDT/USDC). Les coordonnées de paiement figurent sur la facture."],
    ["4. Facturation", "Chaque commande génère une facture portant une référence unique (ex. AUR-2026-0001). L'utilisateur doit indiquer cette référence dans le libellé de son paiement."],
    ["5. Activation", "L'accès est activé après vérification de la réception du paiement par l'équipe, généralement sous 24 h. Un email et une notification confirment l'activation."],
    ["6. Durée et renouvellement", "L'abonnement est mensuel, sans engagement. Il ne se renouvelle pas automatiquement : le client choisit librement de re-souscrire chaque mois."],
    ["7. Remboursement", "Conformément à la réglementation, le consommateur dispose d'un droit de rétractation de 14 jours pour tout paiement de plus de 120 €, sauf si le service a été pleinement exécuté. Pour tout litige de paiement, contacter support@aureuscapitalmarkets.com."],
    ["8. Frais de mise en relation", "En complément des abonnements, des honoraires forfaitaires de mise en relation peuvent être facturés à la conclusion d'une mise en relation effective. Le montant est toujours communiqué et accepté par écrit avant facturation."]
  ]},
  mentions: { title: "Mentions légales", sections: [
    ["Éditeur", "Aureus Capital Markets — (coordonnées à compléter : société, siège social, SIREN/registre, TVA intracommunautaire, représentant légal)."],
    ["Contact", "Email : contact@aureuscapitalmarkets.com · WhatsApp / Telegram — Dubaï · Alger · Paris"],
    ["Hébergement", "Le site est hébergé par l'infrastructure de l'éditeur (à compléter : nom et adresse de l'hébergeur)."],
    ["Activité", "La plateforme exerce une activité de courtage d'annonces et de mise en relation. Elle n'est ni une banque, ni un prestataire de services de paiement, ni un conseiller en investissement, et ne détient aucun fonds pour le compte de tiers."],
    ["Propriété intellectuelle", "Les contenus (textes, logo, design) sont la propriété d'Aureus Capital Markets. Toute reproduction sans autorisation est interdite."],
    ["Données personnelles", "Conformément au RGPD, les utilisateurs disposent d'un droit d'accès, de rectification et de suppression de leurs données : contacter contact@aureuscapitalmarkets.com."]
  ]},
  privacy: { title: "Politique de confidentialité", sections: [
    ["1. Données collectées", "Lors de l'inscription : nom, email, mot de passe haché. Lors de l'utilisation : favoris, alertes, dossiers, messages, conversations et données d'abonnement."],
    ["2. Finalités", "Création et gestion du compte, fourniture des services (mise en relation, abonnements, notifications), prévention de la fraude et support."],
    ["3. Base légale", "Le traitement repose sur l'exécution du contrat (CGU/CGV) et sur le consentement pour les communications éventuelles."],
    ["4. Conservation", "Les données sont conservées tant que le compte est actif, puis supprimées ou anonymisées après suppression du compte ou au plus tard 3 ans après la dernière connexion."],
    ["5. Partage", "Les données ne sont jamais vendues. Elles ne sont partagées qu'avec les prestataires techniques strictement nécessaires (hébergement) et sur demande légale des autorités compétentes."],
    ["6. Droits", "Accès, rectification, suppression, portabilité et opposition : contacter contact@aureuscapitalmarkets.com. Droit de saisir la CNIL ou l'autorité locale de protection des données."],
    ["7. Sécurité", "Les mots de passe sont hachés, les sessions protégées et les accès administrateur restreints."],
    ["8. Cookies", "Le site utilise le stockage local du navigateur pour les préférences (langue, favoris). Aucun traceur publicitaire n'est utilisé."]
  ]}
};

function renderLegal(doc) {
  const d = LEGAL_DOCS[doc] || LEGAL_DOCS.cgu;
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="legal-tabs">
      ${Object.entries(LEGAL_DOCS).map(([k, v]) => `<button class="btn ${k === (doc || "cgu") ? "btn-primary" : "btn-ghost"}" onclick="navigate('legal','${k}')">${v.title.split(" (")[0].split(" — ")[0]}</button>`).join("")}
    </div>
    <div class="legal-box">
      <h2 style="color:var(--accent)">${d.title}</h2>
      ${d.sections.map(([h, p]) => `<h3>${h}</h3><p>${p}</p>`).join("")}
      <div class="notice" style="margin-top:22px">Document généré à titre informatif. Faites valider ces conditions par un avocat avant le lancement commercial. © 2026 Aureus Capital Markets — Démo concept. Aucune offre d'investissement.</div>
    </div>
  </section>`;
}

async function renderCryptoLoans() {
  const cfgR = await api("crypto-loans/config");
  const cfg = cfgR.supported ? cfgR : { supported: [], currencies: ["EUR","USD"], ltv_tiers: [], durations: [3,6,12,24] };
  const myLoans = currentUser ? (await api("crypto-loans")).loans || [] : [];
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>Prêts contre Crypto</h2><p class="sub">Déposez vos crypto-actifs en collatéral et obtenez un prêt en EUR, USD ou stablecoins — sans vendre vos cryptos</p></div>
    </div>

    <div class="crypto-hero">
      <div class="crypto-hero-left">
        <h3>Comment ça marche ?</h3>
        <div class="bm-grid" style="margin-top:16px">
          <div class="bm-card"><div class="icon">🪙</div><h3>1. Déposez votre crypto</h3><p>BTC, ETH, USDT, USDC, SOL, BNB ou XRP — envoyez-les sur notre wallet sécurisé en multisig.</p></div>
          <div class="bm-card"><div class="icon">📊</div><h3>2. Obtenez votre prêt</h3><p>Jusqu'à 80 % de la valeur de votre collatéral en EUR, USD ou stablecoins. Taux à partir de 6,5 %.</p></div>
          <div class="bm-card"><div class="icon">💰</div><h3>3. Remboursez et récupérez</h3><p>Remboursez le prêt + intérêts, récupérez 100 % de vos crypto-actifs. Possibilité de remboursement anticipé.</p></div>
        </div>
      </div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Cryptos acceptées</h2><p class="sub">Collatéral supporté et ratios LTV</p></div></div>
    <table class="econ">
      <thead><tr><th>Crypto</th><th>Symbol</th><th>LTV disponible</th><th>Taux indicatif</th></tr></thead>
      <tbody>
        ${cfg.supported.map((c) => `<tr><td><b>${c.symbol}</b></td><td>${c.name}</td><td>${c.ltv_range}</td><td>${c.rate_range}</td></tr>`).join("")}
      </tbody>
    </table>

    <div class="section-head" style="margin-top:34px"><div><h2>Grille des taux</h2><p class="sub">Taux annuel selon le LTV choisi</p></div></div>
    <div class="bm-grid">
      ${(cfg.ltv_tiers || []).map((t) => `<div class="bm-card"><div class="icon">📈</div><h3>LTV ${t.ltv} %</h3><p>Taux annuel : <b style="color:var(--accent)">${t.rate} %</b></p><p class="small muted">Vous empruntez ${t.ltv} % de la valeur de votre collatéral. Plus le LTV est bas, plus le taux est avantageux.</p></div>`).join("")}
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Vos durées de prêt</h2></div></div>
    <div class="bm-grid">
      ${(cfg.durations || [3,6,12,24]).map((d) => `<div class="bm-card"><div class="icon">⏱️</div><h3>${d} mois</h3><p>Durée standard${d <= 6 ? " — idéal pour un besoin de trésorerie court terme" : d <= 12 ? "" : " — investissement de moyen terme"}.</p></div>`).join("")}
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Avantages</h2></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🚀</div><h3>Pas de vérification de crédit</h3><p>Votre crypto est le garant : pas de KYC long, pas de fiche de paie, accès rapide.</p></div>
      <div class="bm-card"><div class="icon">🔒</div><h3>Sécurité multisig</h3><p>Les cryptos sont déposées dans un wallet multisig 2-of-3 : vous, Aureus, et un dépositaire tiers.</p></div>
      <div class="bm-card"><div class="icon">⚡</div><h3>Déblocage sous 24h</h3><p>Dès réception du collatéral, le prêt est viré sur votre compte en 24 à 48h ouvrées.</p></div>
      <div class="bm-card"><div class="icon">🔄</div><h3>Remboursement flexible</h3><p>Remboursement par échéances ou en une fois. Remboursement anticipé sans pénalité.</p></div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Simulateur</h2><p class="sub">Estimez votre prêt en quelques clics</p></div></div>
    <div class="form-card">
      <div class="form-grid">
        <div><label>Crypto en collatéral</label>
          <select id="clCrypto" onchange="updateLoanSim()">
            ${cfg.supported.map((c) => `<option value="${c.symbol}">${c.symbol} — ${c.name}</option>`).join("")}
          </select>
        </div>
        <div><label>Montant du collatéral</label><input id="clAmount" type="number" step="0.001" placeholder="Ex : 1.5" oninput="updateLoanSim()"></div>
        <div><label>LTV (%)</label>
          <select id="clLtv" onchange="updateLoanSim()">
            ${(cfg.ltv_tiers || []).map((t) => `<option value="${t.ltv}">${t.ltv} % — ${t.rate} %/an</option>`).join("")}
          </select>
        </div>
        <div><label>Devise du prêt</label>
          <select id="clCurrency" onchange="updateLoanSim()">
            ${(cfg.currencies || ["EUR","USD"]).map((d) => `<option>${d}</option>`).join("")}
          </select>
        </div>
        <div><label>Durée</label>
          <select id="clDuration">
            ${(cfg.durations || [3,6,12,24]).map((d) => `<option value="${d}">${d} mois</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="loanSim" style="margin-top:18px;padding:16px;background:var(--bg2);border-radius:12px;display:none">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px">
          <div><div class="k">Montant du prêt</div><div class="v" id="simLoan" style="font-size:1.3rem;color:var(--accent)">—</div></div>
          <div><div class="k">Taux annuel</div><div class="v" id="simRate">—</div></div>
          <div><div class="k">Intérêts totaux</div><div class="v" id="simInterest" style="color:var(--red)">—</div></div>
          <div><div class="k">Mensualité</div><div class="v" id="simMonthly">—</div></div>
        </div>
      </div>
    </div>

    <div class="section-head" style="margin-top:34px"><div><h2>Demander un prêt</h2><p class="sub">${currentUser ? "Remplissez le formulaire ci-dessous — notre équipe vous recontacte sous 24h" : "Connectez-vous pour soumettre une demande"}</p></div></div>
    ${currentUser ? `
    <div class="form-card">
      <div class="form-grid">
        <div><label>Crypto en collatéral</label>
          <select id="clReqCrypto">
            ${cfg.supported.map((c) => `<option value="${c.symbol}">${c.symbol} — ${c.name}</option>`).join("")}
          </select>
        </div>
        <div><label>Montant du collatéral</label><input id="clReqAmount" type="number" step="0.001" placeholder="Ex : 2.5"></div>
        <div><label>LTV souhaité (%)</label>
          <select id="clReqLtv">
            ${(cfg.ltv_tiers || []).map((t) => `<option value="${t.ltv}">${t.ltv} % — ${t.rate} %/an</option>`).join("")}
          </select>
        </div>
        <div><label>Devise du prêt</label>
          <select id="clReqCurrency">
            ${(cfg.currencies || ["EUR","USD"]).map((d) => `<option>${d}</option>`).join("")}
          </select>
        </div>
        <div><label>Durée (mois)</label>
          <select id="clReqDuration">
            ${(cfg.durations || [3,6,12,24]).map((d) => `<option value="${d}">${d} mois</option>`).join("")}
          </select>
        </div>
        <div><label>Adresse wallet (pour remise du collatéral)</label><input id="clReqWallet" placeholder="0x... ou bc1..."></div>
      </div>
      <label>Objet du prêt</label>
      <input id="clReqPurpose" placeholder="Ex : Trésorerie entreprise, achat immobilier...">
      <button class="btn btn-primary full" style="margin-top:14px" onclick="submitCryptoLoan()">Envoyer la demande</button>
      <p id="clOk" class="ok small" style="display:none;margin-top:12px">✓ Demande envoyée. Notre équipe vous recontacte sous 24h avec les conditions définitives.</p>
      <p id="clErr" class="small" style="display:none;margin-top:12px;color:var(--red)"></p>
    </div>` : `
    <div class="notice" style="margin-top:16px">Connectez-vous pour faire une demande de prêt crypto. <a href="#" style="color:var(--accent)" onclick="openAuth();return false;">Se connecter</a></div>`}

    ${myLoans.length ? `
    <div class="section-head" style="margin-top:34px"><div><h2>Mes demandes</h2></div></div>
    <table class="econ">
      <thead><tr><th>Réf.</th><th>Collatéral</th><th>Prêt demandé</th><th>LTV</th><th>Durée</th><th>Taux</th><th>Statut</th><th>Date</th></tr></thead>
      <tbody>
        ${myLoans.map((l) => `<tr>
          <td><b>${l.reference}</b></td>
          <td>${l.collateral_amount} ${l.collateral_crypto}</td>
          <td>${l.loan_amount.toLocaleString("fr-FR")} ${l.loan_currency}</td>
          <td>${l.ltv} %</td>
          <td>${l.duration_months} mois</td>
          <td>${l.taux_annuel} %</td>
          <td>${l.statut === "en_attente" ? '<span style="color:var(--accent)">En attente</span>' : l.statut === "approuve" ? '<span style="color:var(--green)">Approuvé</span>' : '<span style="color:var(--red)">Rejeté</span>'}</td>
          <td class="small">${l.created_at}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : ""}

    <div class="legal-box" style="margin-top:34px">
      <h3>Conditions importantes</h3>
      <ul class="small">
        <li><b>Sécurité du collatéral :</b> Les crypto-actifs sont déposés dans un wallet multisig 2-of-3 et conservés pendant toute la durée du prêt.</li>
        <li><b>Appel de marge (Margin Call) :</b> Si la valeur du collatéral chute de plus de 30 % par rapport au montant initialement estimé, vous serez notifié pour compléter le dépôt sous 48h.</li>
        <li><b>Liquidation :</b> En cas de non-réponse à l'appel de marge et si la chute dépasse 50 %, le collatéral peut être partiellement liquidé pour couvrir le prêt.</li>
        <li><b>Remboursement anticipé :</b> Possible à tout moment sans pénalité. Les intérêts sont calculés au prorata temporis.</li>
        <li><b>Frais de dossier :</b> 1 % du montant du prêt, prélevé sur le montant versé.</li>
        <li><b>Pas de conseil financier :</b> Cette plateforme agit uniquement comme intermédiaire de mise en relation. Elle ne détient jamais les fonds et ne fournit pas de conseil en investissement.</li>
      </ul>
    </div>
  </section>`;
  updateLoanSim();
}

function renderCryptoLoansLanding() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Prêts Crypto" }
    ])}
    <div class="hero" style="text-align:center;padding:var(--space-2xl) 0">
      <span class="eyebrow">Prêts contre Crypto • Sans vendre vos actifs</span>
      <h1>Libérez la valeur de vos crypto-actifs<br><span class="gold">sans les vendre</span></h1>
      <p class="lead">Empruntez jusqu'à <b>80 %</b> de la valeur de votre BTC, ETH, USDT, USDC, SOL, BNB ou XRP. Taux dès <b>6,5 %/an</b>. Déblocage sous 24h.</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-lg" onclick="navigate('prets-crypto')">Simuler mon prêt</button>
        <button class="btn btn-outline btn-lg" onclick="navigate('abonnement')">Devenir membre</button>
      </div>
      <div class="stats" style="margin-top:var(--space-xl)">
        <div class="stat"><div class="num">7</div><div class="lbl">Cryptos acceptées</div></div>
        <div class="stat"><div class="num">80 %</div><div class="lbl">LTV max</div></div>
        <div class="stat"><div class="num">6,5 %</div><div class="lbl">Taux plancher</div></div>
        <div class="stat"><div class="num">24h</div><div class="lbl">Déblocage</div></div>
      </div>
    </div>

    <div class="section-head"><div><h2>Comment ça marche</h2><p class="sub">3 étapes simples, 100 % en ligne</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🪙</div><h3>1. Choisissez votre collatéral</h3><p>BTC, ETH, USDT, USDC, SOL, BNB, XRP. Indiquez le montant et le LTV souhaité (30-80 %).</p></div>
      <div class="bm-card"><div class="icon">📊</div><h3>2. Recevez l'offre</h3><p>Notre équipe valide en <b>24h ouvrées</b>. Vous signez numériquement, pas de paperasse.</p></div>
      <div class="bm-card"><div class="icon">💰</div><h3>3. Recevez les fonds</h3><p>Virement EUR/USD ou stablecoins. Vos cryptos restent en multisig 2-of-3 sécurisé.</p></div>
    </div>

    <div class="section-head" style="margin-top:var(--space-xl)"><div><h2>Simulateur express</h2><p class="sub">Estimez votre prêt en 30 secondes</p></div></div>
    <div class="form-card" style="max-width:520px;margin:0 auto">
      <div class="form-grid">
        <div><label>Crypto</label><select id="lpCrypto"><option value="BTC">BTC — Bitcoin</option><option value="ETH">ETH — Ethereum</option><option value="USDT">USDT — Tether</option><option value="USDC">USDC — USD Coin</option><option value="SOL">SOL — Solana</option><option value="BNB">BNB — BNB Chain</option><option value="XRP">XRP — Ripple</option></select></div>
        <div><label>Montant crypto</label><input id="lpAmount" type="number" step="0.001" placeholder="Ex: 2.5" oninput="updateLandingSim()"></div>
        <div><label>LTV</label><select id="lpLtv" onchange="updateLandingSim()"><option value="50">50 % — 6,5 %/an</option><option value="60" selected>60 % — 8,5 %/an</option><option value="70">70 % — 11 %/an</option><option value="80">80 % — 14 %/an</option></select></div>
        <div><label>Durée</label><select id="lpDuration" onchange="updateLandingSim()"><option value="6">6 mois</option><option value="12" selected>12 mois</option><option value="24">24 mois</option></select></div>
      </div>
      <div id="lpSim" style="margin-top:var(--space-lg);padding:var(--space-md);background:var(--accent-light);border-radius:var(--radius);display:none">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-md);text-align:center">
          <div><div class="k">Prêt estimé</div><div class="v" id="lpLoan" style="font-size:1.5rem;color:var(--accent)">—</div></div>
          <div><div class="k">Intérêts totaux</div><div class="v" id="lpInterest" style="font-size:1.5rem;color:var(--red)">—</div></div>
          <div><div class="k">Mensualité</div><div class="v" id="lpMonthly" style="font-size:1.5rem;color:var(--navy)">—</div></div>
          <div><div class="k">Taux annuel</div><div class="v" id="lpRate" style="font-size:1.5rem;color:var(--green)">—</div></div>
        </div>
      </div>
      <button class="btn btn-primary full btn-lg" style="margin-top:var(--space-lg)" onclick="navigate('prets-crypto')">Continuer vers la demande complète</button>
    </div>

    <div class="section-head" style="margin-top:var(--space-xl)"><div><h2>Pourquoi Aureus ?</h2></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🔒</div><h3>Multisig 2-of-3</h3><p>Vous, Aureus, dépositaire tiers. Aucun risque de perte unilatérale.</p></div>
      <div class="bm-card"><div class="icon">⚡</div><h3>Pas de credit check</h3><p>Votre crypto est la garantie. Pas de fiche de paie, pas de scoring bancaire.</p></div>
      <div class="bm-card"><div class="icon">🔄</div><h3>Remboursement libre</h3><p>Anticipé sans pénalité. Échéances mensuelles ou in fine selon votre choix.</p></div>
      <div class="bm-card"><div class="icon">🌍</div><h3>International</h3><p>Virement SEPA, SWIFT, USDC/USDT. Dubaï, Paris, Singapour, Alger — même service.</p></div>
    </div>

    <div class="legal-box" style="margin-top:var(--space-xl);text-align:center">
      <h3>Prêt à commencer ?</h3>
      <p class="muted">Créez votre compte, simulez, soumettez. Notre équipe vous recontacte sous 24h.</p>
      <button class="btn btn-primary btn-lg" style="margin-top:var(--space-md)" onclick="openAuth()">Créer mon compte gratuit</button>
    </div>
  </section>`;
  updateLandingSim();
}

function updateLandingSim() {
  const crypto = document.getElementById("lpCrypto")?.value;
  const amount = parseFloat(document.getElementById("lpAmount")?.value) || 0;
  const ltv = parseInt(document.getElementById("lpLtv")?.value) || 60;
  const duration = parseInt(document.getElementById("lpDuration")?.value) || 12;
  const sim = document.getElementById("lpSim");
  if (!sim || !amount) { if (sim) sim.style.display = "none"; return; }
  const prices = { BTC: 65000, ETH: 3500, USDT: 1, USDC: 1, SOL: 150, BNB: 600, XRP: 0.55 };
  const rates = { 50: 6.5, 60: 8.5, 70: 11.0, 80: 14.0 };
  const collateralValue = amount * (prices[crypto] || 1);
  const loanAmount = collateralValue * ltv / 100;
  const rate = rates[ltv] || 8.5;
  const totalInterest = loanAmount * (rate / 100) * (duration / 12);
  const monthly = (loanAmount + totalInterest) / duration;
  document.getElementById("lpLoan").textContent = loanAmount.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " EUR";
  document.getElementById("lpRate").textContent = rate + " %";
  document.getElementById("lpInterest").textContent = "+" + totalInterest.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " EUR";
  document.getElementById("lpMonthly").textContent = monthly.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " EUR/mois";
  sim.style.display = "block";
}

function renderMnaLanding() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Entreprises & M&A", onclick: "navigate('entreprises')" },
      { label: "Fusions & Acquisitions" }
    ])}
    <div class="hero" style="text-align:center;padding:var(--space-2xl) 0">
      <span class="eyebrow">Fusions & Acquisitions • Mandats vérifiés</span>
      <h1>Vendez ou achetez une entreprise<br><span class="gold">en toute confidentialité</span></h1>
      <p class="lead">25+ mandats M&A actifs. Secteurs : industrie, tech, santé, énergie, distribution. Accompagnement de la valorisation au closing.</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-lg" onclick="navigate('entreprises')">Voir les opportunités</button>
        <button class="btn btn-outline btn-lg" onclick="navigate('publier')">Proposer un mandat</button>
      </div>
      <div class="stats" style="margin-top:var(--space-xl)">
        <div class="stat"><div class="num">25+</div><div class="lbl">Mandats actifs</div></div>
        <div class="stat"><div class="num">15+</div><div class="lbl">Pays couverts</div></div>
        <div class="stat"><div class="num">50 M€+</div><div class="lbl">Volume 2025</div></div>
        <div class="stat"><div class="num">90 j</div><div class="lbl">Délai moyen closing</div></div>
      </div>
    </div>

    <div class="section-head"><div><h2>Nos services M&A</h2><p class="sub">De la stratégie à l'exécution</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🎯</div><h3>Cession d'entreprise</h3><p>Valorisation, memorandum, recherche acquéreurs qualifiés, négociation, due diligence, closing.</p></div>
      <div class="bm-card"><div class="icon">🔍</div><h3>Acquisition ciblée</h3><p>Cahier des charges, screening, approche confidentielle, structuration, financement.</p></div>
      <div class="bm-card"><div class="icon">🤝</div><h3>Joint Ventures & Partenariats</h3><p>Structure juridique, gouvernance, accords d'actionnaires, sortie.</p></div>
      <div class="bm-card"><div class="icon">💰</div><h3>Levée de fonds growth</h3><p>Series A/B, dette mezzanine, private placement. Réseau 200+ family offices & fonds.</p></div>
    </div>

    <div class="legal-box" style="margin-top:var(--space-xl);max-width:520px;margin-left:auto;margin-right:auto;text-align:center">
      <h3>Discutons de votre projet</h3>
      <p class="muted">Confidentialité totale. Première échange sans engagement.</p>
      <button class="btn btn-primary btn-lg" style="margin-top:var(--space-md)" onclick="openContact()">Contacter l'équipe M&A</button>
    </div>
  </section>`;
}

function renderImmoInternationalLanding() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Immobilier", onclick: "navigate('immobilier')" },
      { label: "International" }
    ])}
    <div class="hero" style="text-align:center;padding:var(--space-2xl) 0">
      <span class="eyebrow">Immobilier International • 14 pays</span>
      <h1>Investissez dans l'immobilier<br><span class="gold">sans frontières</span></h1>
      <p class="lead">Villas, appartements, bureaux, immeubles de rapport. Dubaï, Doha, Lisbonne, Marrakech, Singapour, Oman, Mauritius. Mandats vérifiés, titres clairs.</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-lg" onclick="navigate('immobilier')">Explorer les biens</button>
        <button class="btn btn-outline btn-lg" onclick="navigate('publier')">Déposer un bien</button>
      </div>
      <div class="stats" style="margin-top:var(--space-xl)">
        <div class="stat"><div class="num">14</div><div class="lbl">Pays</div></div>
        <div class="stat"><div class="num">50+</div><div class="lbl">Biens en ligne</div></div>
        <div class="stat"><div class="num">8 %</div><div class="lbl">Rendement net moyen</div></div>
        <div class="stat"><div class="num">100 %</div><div class="lbl">Titres vérifiés</div></div>
      </div>
    </div>

    <div class="section-head"><div><h2>Destinations phares</h2></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🇦🇪</div><h3>Dubaï</h3><p>Rendement 6-10 %, visa investisseur, 0 % impôt foncier. Dubai Marina, Downtown, Palm Jumeirah.</p></div>
      <div class="bm-card"><div class="icon">🇵🇹</div><h3>Portugal</h3><p>Golden Visa, NHR fiscalité, forte demande locative. Lisbonne, Porto, Algarve.</p></div>
      <div class="bm-card"><div class="icon">🇶🇦</div><h3>Qatar</h3><p>Croissance PIB +4 %, 월드컵 legacy, Lusail, The Pearl. Freehold zones étendues.</p></div>
      <div class="bm-card"><div class="icon">🇲🇦</div><h3>Maroc</h3><p>Marrakech, Casablanca, Tanger. Rendement 7-12 %, marché touristique fort, prix attractifs.</p></div>
    </div>

    <div class="legal-box" style="margin-top:var(--space-xl);max-width:520px;margin-left:auto;margin-right:auto;text-align:center">
      <h3>Trouvez votre bien idéal</h3>
      <p class="muted">Filtres par région, budget, type, rendement. Alertes automatiques.</p>
      <button class="btn btn-primary btn-lg" style="margin-top:var(--space-md)" onclick="navigate('immobilier')">Voir tous les biens</button>
    </div>
  </section>`;
}

function renderFinancementDetteLanding() {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Besoins & Financement", onclick: "navigate('besoins')" },
      { label: "Financement & Refinancement Dette" }
    ])}
    <div class="hero" style="text-align:center;padding:var(--space-2xl) 0">
      <span class="eyebrow">Financement & Refinancement de Dette • Immobilier & Entreprises</span>
      <h1>Structurez, refinancez, développez<br><span class="gold">vos actifs réels</span></h1>
      <p class="lead">Dette senior, mezzanine, bridge, capex. Immobilier (LTV 70 %) et entreprises (EBITDA multiple). Taux 6-12 %. Closing 4-8 semaines. Réseau 150+ prêteurs institutionnels & family offices.</p>
      <div class="hero-actions">
        <button class="btn btn-primary btn-lg" onclick="openContact()">Mon projet de financement</button>
        <button class="btn btn-outline btn-lg" onclick="navigate('besoins')">Voir les demandes actives</button>
      </div>
      <div class="stats" style="margin-top:var(--space-xl)">
        <div class="stat"><div class="num">70 %</div><div class="lbl">LTV max immo</div></div>
        <div class="stat"><div class="num">4-8 sem</div><div class="lbl">Closing moyen</div></div>
        <div class="stat"><div class="num">6-12 %</div><div class="lbl">Taux indicatifs</div></div>
        <div class="stat"><div class="num">150+</div><div class="lbl">Prêteurs partenaires</div></div>
      </div>
    </div>

    <div class="section-head"><div><h2>Nos solutions de dette</h2><p class="sub">Produits sur mesure pour chaque situation</p></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🏢</div><h3>Immobilier — Dette Senior</h3><p>Prêt hypothécaire 1er rang. LTV jusqu'à 70 %. Durée 3-10 ans. Amortissement ou in fine. Bureaux, logistique, résidentiel, hôtels, retail.</p></div>
      <div class="bm-card"><div class="icon">🏗️</div><h3>Immobilier — Construction / Développement</h3><p>Financement de promotion, VEFA, rénovation lourde. Avancement par tranches. Garanties GFA / hypothèque. Taux 7-10 %.</p></div>
      <div class="bm-card"><div class="icon">🔄</div><h3>Refinancement / Recap</h3><p>Rachat dette existante, sortie de bridge, libération de cash (equity release). Allongement maturité, baisse coût, fonds pour capex/acquisition.</p></div>
      <div class="bm-card"><div class="icon">🏭</div><h3>Entreprises — Dette Senior & Unitranche</h3><p>EBITDA > 2 M€. Multiple 2.5-3.5x. Covenant-light possible. Refinancement LBO, croissance, transmission.</p></div>
      <div class="bm-card"><div class="icon">📊</div><h3>Mezzanine & Dette Subordonnée</h3><p>Complément senior. Ticket 2-15 M€. Taux 10-14 % + warrant/PIK. Flexibilité covenants. Idéal growth/acquisition sans dilution.</p></div>
      <div class="bm-card"><div class="icon">⚡</div><h3>Bridge & Capex Express</h3><p>Besoin urgent 4-12 mois. Closing 3-4 semaines. Garantie actifs (immo, stock, créances). Taux 9-13 %. Relais avant financement long.</p></div>
    </div>

    <div class="section-head" style="margin-top:var(--space-xl)"><div><h2>Simulateur indicatif</h2><p class="sub">Estimez votre capacité d'emprunt en 1 minute</p></div></div>
    <div class="form-card" style="max-width:560px;margin:0 auto">
      <div class="form-grid">
        <div><label>Type d'actif</label><select id="fdType"><option value="immo">Immobilier (bureaux, logistique, résidentiel, hôtel)</option><option value="entreprise">Entreprise (PME/ETI, EBITDA > 2M€)</option><option value="promotion">Promotion / Construction</option><option value="bridge">Bridge / Refinancement urgent</option></select></div>
        <div><label>Valeur actif / EBITDA</label><input id="fdValue" type="number" step="100000" placeholder="Ex: 10000000 (valeur bien) ou 3000000 (EBITDA)"></div>
        <div><label>LTV / Multiple visé</label><select id="fdLtv"><option value="50">50 % LTV / 2.0x EBITDA</option><option value="60" selected>60 % LTV / 2.5x EBITDA</option><option value="70">70 % LTV / 3.0x EBITDA</option><option value="75">75 % LTV / 3.5x EBITDA (mezzanine)</option></select></div>
        <div><label>Durée</label><select id="fdDuration"><option value="3">3 ans (bridge)</option><option value="5">5 ans</option><option value="7" selected>7 ans</option><option value="10">10 ans</option></select></div>
      </div>
      <div id="fdSim" style="margin-top:var(--space-lg);padding:var(--space-md);background:var(--accent-light);border-radius:var(--radius);display:none">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-md);text-align:center">
          <div><div class="k">Montant empruntable</div><div class="v" id="fdLoan" style="font-size:1.5rem;color:var(--accent)">—</div></div>
          <div><div class="k">Taux indicatif</div><div class="v" id="fdRate" style="font-size:1.5rem;color:var(--green)">—</div></div>
          <div><div class="k">Mensualité (amortissable)</div><div class="v" id="fdMonthly" style="font-size:1.5rem;color:var(--navy)">—</div></div>
          <div><div class="k">Coût total intérêts</div><div class="v" id="fdTotalInt" style="font-size:1.5rem;color:var(--red)">—</div></div>
        </div>
      </div>
      <button class="btn btn-primary full btn-lg" style="margin-top:var(--space-lg)" onclick="openContact()">Obtenir une terme sheet indicatif</button>
    </div>

    <div class="section-head" style="margin-top:var(--space-xl)"><div><h2>Pourquoi passer par Aureus ?</h2></div></div>
    <div class="bm-grid">
      <div class="bm-card"><div class="icon">🎯</div><h3>Matching intelligent</h3><p>Nous qualifions votre dossier et le présentons aux 3-5 prêteurs les plus pertinents. Gain de temps, meilleurs termes.</p></div>
      <div class="bm-card"><div class="icon">📄</div><h3>Dossier complet prêt banque</h3><p>Memorandum, business plan, valorisation, due diligence pack. Nous préparons ce que les prêteurs attendent.</p></div>
      <div class="bm-card"><div class="icon">🤝</div><h3>Négociation termes clés</h3><p>Spread, covenants, amortissement, garanties, frais. Nous défendons vos intérêts face aux prêteurs.</p></div>
      <div class="bm-card"><div class="icon">🌍</div><h3>Cross-border natif</h3><p>Dette en EUR/USD/CHF/GBP. Juridictions : France, Benelux, DACH, UK, UAE, Maroc, Afrique francophone.</p></div>
    </div>

    <div class="legal-box" style="margin-top:var(--space-xl);max-width:520px;margin-left:auto;margin-right:auto;text-align:center">
      <h3>Prêt à structurer votre financement ?</h3>
      <p class="muted">Remplissez le formulaire → Term sheet indicatif sous 48h → Closing 4-8 semaines.</p>
      <button class="btn btn-primary btn-lg" style="margin-top:var(--space-md)" onclick="openContact()">Lancer mon dossier</button>
    </div>
  </section>`;
  updateFinancementDetteSim();
}

function updateFinancementDetteSim() {
  const type = document.getElementById("fdType")?.value;
  const value = parseFloat(document.getElementById("fdValue")?.value) || 0;
  const ltv = parseInt(document.getElementById("fdLtv")?.value) || 60;
  const duration = parseInt(document.getElementById("fdDuration")?.value) || 7;
  const sim = document.getElementById("fdSim");
  if (!sim || !value) { if (sim) sim.style.display = "none"; return; }
  // Taux indicatifs selon type et LTV
  const baseRates = { immo: 5.5, entreprise: 7.0, promotion: 7.5, bridge: 9.0 };
  const ltvPremium = { 50: 0, 60: 0.5, 70: 1.0, 75: 2.0 };
  const rate = (baseRates[type] || 6.5) + (ltvPremium[ltv] || 0.5);
  const loanAmount = value * ltv / 100;
  const monthlyRate = rate / 100 / 12;
  const months = duration * 12;
  const monthly = monthlyRate > 0 ? loanAmount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)) : loanAmount / months;
  const totalInterest = monthly * months - loanAmount;
  document.getElementById("fdLoan").textContent = loanAmount.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " EUR";
  document.getElementById("fdRate").textContent = rate.toFixed(1) + " %";
  document.getElementById("fdMonthly").textContent = monthly.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " EUR/mois";
  document.getElementById("fdTotalInt").textContent = totalInterest.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " EUR";
  sim.style.display = "block";
}

function updateLoanSim() {
  const crypto = document.getElementById("clCrypto")?.value;
  const amount = parseFloat(document.getElementById("clAmount")?.value) || 0;
  const ltv = parseInt(document.getElementById("clLtv")?.value) || 60;
  const currency = document.getElementById("clCurrency")?.value || "EUR";
  const duration = parseInt(document.getElementById("clDuration")?.value) || 12;
  const sim = document.getElementById("loanSim");
  if (!sim || !amount) { if (sim) sim.style.display = "none"; return; }
  const prices = { BTC: 65000, ETH: 3500, USDT: 1, USDC: 1, SOL: 150, BNB: 600, XRP: 0.55 };
  const rates = { 50: 6.5, 60: 8.5, 70: 11.0, 80: 14.0 };
  const collateralValue = amount * (prices[crypto] || 1);
  const loanAmount = collateralValue * ltv / 100;
  const rate = rates[ltv] || 8.5;
  const totalInterest = loanAmount * (rate / 100) * (duration / 12);
  const monthly = (loanAmount + totalInterest) / duration;
  document.getElementById("simLoan").textContent = loanAmount.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " " + currency;
  document.getElementById("simRate").textContent = rate + " %";
  document.getElementById("simInterest").textContent = "+" + totalInterest.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " " + currency;
  document.getElementById("simMonthly").textContent = monthly.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " " + currency + " /mois";
  sim.style.display = "block";
}

async function submitCryptoLoan() {
  const err = document.getElementById("clErr");
  const ok = document.getElementById("clOk");
  err.style.display = "none"; ok.style.display = "none";
  const amount = parseFloat(document.getElementById("clReqAmount").value);
  if (!amount || amount <= 0) { err.style.display = "block"; err.textContent = "Montant du collatéral requis."; return; }
  const r = await api("crypto-loans", "POST", {
    collateral_crypto: document.getElementById("clReqCrypto").value,
    collateral_amount: amount,
    ltv: parseInt(document.getElementById("clReqLtv").value),
    loan_currency: document.getElementById("clReqCurrency").value,
    loan_amount: 0,
    duration_months: parseInt(document.getElementById("clReqDuration").value),
    purpose: document.getElementById("clReqPurpose").value,
    wallet_address: document.getElementById("clReqWallet").value
  });
  if (r.ok) {
    ok.style.display = "block";
  } else {
    err.style.display = "block";
    err.textContent = r.error || "Erreur.";
  }
}

function renderDetail(id) {
  const a = assets.find((x) => String(x.id) === String(id));
  if (!a) return navigate("catalogue");
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:40px">
    <a class="back" href="#" onclick="navigate('catalogue');return false;">← Retour au catalogue</a>
    <div class="detail-grid">
      <div class="detail-card">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap">${badge(a.type)} <span class="token">${a.token}</span>${a.verifie ? `<span class="badge verified">Vérifié</span>` : ""}</div>
        <h2>${tData(a.title)}</h2>
        <p class="muted">${tData(a.emetteur)} — ${tData(a.pays)} · <span>Devise :</span> ${a.devise}</p>
        <p style="margin-top:16px">${tData(a.description)}</p>
        <h3 style="margin-top:22px;color:var(--accent)">Documents disponibles</h3>
        <div class="docs">
          ${a.documents_locked
            ? `<div class="doc-locked"><span>🔒</span> Les documents de cette offre sont réservés aux membres Premium.<button class="btn btn-primary" style="margin-top:10px" onclick="navigate('abonnement')">Débloquer avec Premium</button></div>`
            : a.documents.map((d) => `<div class="doc-item"><span class="ic">—</span> ${tData(d)}</div>`).join("") || `<p class="muted small">Aucun document fourni pour cette offre.</p>`}
        </div>
        <ul class="detail-list">
          <li><span>Type :</span> ${tData(a.typeLabel)}${assetSector(a) ? ` (${tData(assetSector(a))})` : ""}</li>
          <li><span>Émetteur :</span> ${tData(a.emetteur)}</li>
          <li><span>Pays :</span> ${tData(a.pays)}</li>
          <li><span>Échéance :</span> ${tData(a.maturite)}</li>
          <li><span>Risque :</span> ${a.risque}</li>
          ${a.minimum ? `<li><span>Souscription minimum :</span> ${money(a.minimum)}</li>` : ""}
        </ul>
      </div>
      <div class="side-card">
        <div class="tag muted">Valeur nominale</div>
        <div class="side-price">${money(a.montant)}</div>
        ${a.rendement ? `<div class="metric" style="margin:12px 0"><div class="k">Rendement annuel</div><div class="v green" style="font-size:1.4rem">${pct(a.rendement)}</div></div>` : `<div class="metric" style="margin:12px 0"><div class="k">Catégorie</div><div class="v" style="font-size:1.4rem">${tData(a.typeLabel)}</div></div>`}
        <div class="metric"><div class="k">Vendeur</div><div class="v" style="font-size:1rem">${a.vendeur}</div></div>
        ${hasAccess()
          ? `<button class="btn btn-primary full" style="margin-top:18px" onclick="openConversationForAsset('${a.id}', '${a.token} — demande d\'information')">Discuter de cette offre</button>
        <button class="btn btn-ghost full" style="margin-top:10px" onclick="openConversationForAsset('${a.id}', '${a.token} — accès documents', 'Bonjour, je souhaite accéder aux documents de l\'offre ${a.token}. Merci de me faire parvenir le dossier.')">Demander l'accès aux documents</button>`
          : `<button class="btn btn-primary full" style="margin-top:18px" onclick="navigate('abonnement')">🔒 Débloquer l'accès vendeurs</button>
        <p class="small muted" style="margin-top:8px">Contacter les vendeurs et recevoir les documents nécessite un abonnement Vérifié ou Premium.</p>`}
        <button class="btn btn-outline full" style="margin-top:10px" onclick="contactSeller('${a.vendeur.replace(/'/g, "")}')">Contacter par email / WhatsApp</button>
        <button class="btn btn-outline full" style="margin-top:10px" onclick="startDeal('${a.id}')">Suivre ce dossier</button>
        <button class="btn btn-outline full" style="margin-top:10px" onclick="genLOI('${a.id}')">Générer une lettre d'intention</button>
        <button class="btn btn-ghost full" style="margin-top:10px" onclick="toggleFav('${a.id}')">${getFavs().includes(String(a.id)) ? "★ Retirer des favoris" : "☆ Ajouter aux favoris"}</button>
        <button class="btn btn-outline full" style="margin-top:10px" onclick="window.print()">🖨️ Imprimer / Télécharger PDF</button>
        <p class="small muted" style="margin-top:14px">Paiement accepté : virement bancaire, USDC, USDT. La plateforme ne détient jamais les fonds.</p>
      </div>
    </div>
  </section>`;
}

function contactSeller(seller) {
  document.getElementById("cName").value = "";
  document.getElementById("cContact").value = "";
  document.getElementById("cMsg").value = `Bonjour, je suis intéressé(e) par l'offre de ${seller}. Merci de me transmettre les documents.`;
  document.getElementById("cOk").style.display = "none";
  document.getElementById("contactModal").classList.add("show");
}

function openContact() {
  document.getElementById("cName").value = "";
  document.getElementById("cContact").value = "";
  document.getElementById("cMsg").value = "";
  document.getElementById("cOk").style.display = "none";
  document.getElementById("contactModal").classList.add("show");
}
function closeContact() { document.getElementById("contactModal").classList.remove("show"); }
async function submitContact() {
  const ok = document.getElementById("cOk");
  const r = await api("contact", "POST", {
    name: document.getElementById("cName").value,
    contact: document.getElementById("cContact").value,
    subject: document.getElementById("cSubject").value,
    message: document.getElementById("cMsg").value
  });
  if (r.ok) {
    ok.style.display = "block";
    setTimeout(closeContact, 1600);
  } else {
    ok.style.display = "block";
    ok.textContent = "⚠ " + (r.error || "Erreur");
    ok.style.color = "var(--red)";
  }
}

function navigate(page, id) {
  curPage = page;
  curId = id || null;
  const target = page === "detail" ? "#/detail/" + id : "#/" + page;
  if (window.location.hash !== target) window.location.hash = target;
  renderPage(page, id);
  const menu = document.querySelector(".nav-links");
  if (menu) menu.classList.remove("open");
}
function toggleMenu() {
  document.querySelector(".nav-links")?.classList.toggle("open");
}
function renderPage(page, id) {
  const route = page + (id ? "/" + id : "");
  if (lastRoute === route) return;
  lastRoute = route;
  curPage = page;
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (page === "home") renderHome();
  else if (page === "catalogue") renderCatalogue();
  else if (page === "immobilier") renderImmo();
  else if (page === "entreprises") renderEntreprises();
  else if (page === "besoins") renderNeeds();
  else if (page === "abonnement") renderSubscription();
  else if (page === "kyc") renderKyc();
  else if (page === "comparateur") renderCompare();
  else if (page === "marches") renderMarkets();
  else if (page === "hedgefunds") renderHedgeFunds();
  else if (page === "services") renderServices();
  else if (page === "creer-societe") renderSociete();
  else if (page === "crypto") renderCrypto();
  else if (page === "prets-crypto") renderCryptoLoans();
  else if (page === "prets-crypto-landing") renderCryptoLoansLanding();
  else if (page === "mna-landing") renderMnaLanding();
  else if (page === "immobilier-international") renderImmoInternationalLanding();
  else if (page === "financement-dette") renderFinancementDetteLanding();
  else if (page === "tableau-de-bord" || page === "dashboard") renderDashboard();
  else if (page === "business") renderBusiness();
  else if (page === "publier") renderPublish();
  else if (page === "legal") renderLegal(id);
  else if (page === "favoris") renderFavorites();
  else if (page === "alertes") renderAlerts();
  else if (page === "dossiers") renderDeals();
  else if (page === "messages") renderMessages();
  else if (page === "detail") renderDetail(id);
}
window.addEventListener("hashchange", () => {
  const h = (window.location.hash || "#/home").replace("#/", "");
  const parts = h.split("/");
  renderPage(parts[0] || "home", parts[1]);
});
function openAsset(id) { navigate("detail", id); }

async function renderMessages() {
  if (!currentUser) { openAuth(); return; }
  const r = await api("conversations");
  const convs = r.conversations || [];
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>Messages</h2><p class="sub">Vos échanges avec l'équipe de la plateforme, par offre</p></div>
      <button class="btn btn-ghost" onclick="navigate('catalogue')">← Parcourir les offres</button>
    </div>
    <div class="msg-list">
      ${convs.map((c) => `
        <div class="msg-item" onclick="openThread(${c.id})">
          <h3>${c.subject || "Discussion"}</h3>
          <div class="sub">${c.asset_title ? "Offre : " + c.asset_title : "Sujet général"}</div>
          <div class="meta">Ouvert le ${new Date(c.created_at).toLocaleDateString("fr-FR")}${c.replies ? ` · <span class="msg-reply">${c.replies} réponse(s) de l'équipe</span>` : ""}</div>
        </div>`).join("") || `<p class="muted">Aucune conversation. Depuis une fiche d'offre, cliquez sur « Discuter de cette offre ».</p>`}
    </div>
  </section>`;
}

async function openThread(id) {
  const r = await api("conversation?id=" + id);
  if (!r.conversation) { alert(r.error || "Conversation introuvable."); return; }
  renderThread(r.conversation, r.messages || []);
}

function renderThread(conv, messages) {
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    <div class="section-head">
      <div><h2>${conv.subject || "Discussion"}</h2><p class="sub">Échanges avec l'équipe AUREUS — réponse sous 24h ouvrées</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="renderMessages()">← Toutes les conversations</button>
        <button class="btn btn-outline" onclick="payFee(${conv.id})">Payer les frais de mise en relation (350 €)</button>
      </div>
    </div>
    <div class="thread-box">
      <div class="thread" id="threadBox">
        ${(messages || []).map((m) => `
          <div class="bubble ${m.sender}">
            ${m.body}
            <div class="meta">${m.sender === "equipe" ? "Équipe AUREUS" : "Vous"} · ${new Date(m.created_at).toLocaleString("fr-FR")}</div>
          </div>`).join("") || `<p class="muted">Démarrez la conversation.</p>`}
      </div>
      <div class="thread-form">
        <textarea id="msgInput" rows="2" placeholder="Votre message..."></textarea>
        <button class="btn btn-primary" onclick="sendMessage(${conv.id})">Envoyer</button>
      </div>
    </div>
    <div id="feeBox"></div>
  </section>`;
  const box = document.getElementById("threadBox");
  if (box) box.scrollTop = box.scrollHeight;
  renderFeeBox();
}

async function renderFeeBox() {
  const box = document.getElementById("feeBox");
  if (!box) return;
  const r = await api("my-fees");
  const pending = (r.fees || []).find((f) => f.statut === "en_attente");
  if (!pending) { box.innerHTML = ""; return; }
  const m = (_payConfig && _payConfig.moyens) || {};
  box.innerHTML = `
  <div class="form-card" style="margin-top:22px">
    <h3 style="color:var(--accent)">Facture frais de mise en relation — ${pending.reference}</h3>
    <p class="muted small">Montant : ${pending.montant} ${pending.devise} · Statut : en attente de paiement</p>
    <ol class="pay-steps">
      <li>Effectuez le paiement par virement / PayPal / Wave / stablecoin.</li>
      <li>Indiquez la référence <b>${pending.reference}</b> dans le libellé.</li>
      <li>Cliquez sur « J'ai payé » — l'équipe confirme et vous notifie.</li>
    </ol>
    <div class="pay-rows">${Object.values(m).map((x) => `<div class="pay-row"><b>${x.label}</b><span>${x.details}</span></div>`).join("")}</div>
    <button class="btn btn-primary" style="margin-top:14px" onclick="confirmFeePaid()">J'ai effectué le paiement</button>
    <p id="feeOk" class="ok small" style="display:none;margin-top:10px">✓ Bien reçu. Notre équipe confirme sous 24 h.</p>
  </div>`;
}

async function payFee(convId) {
  const r = await api("fee", "POST", { conversation_id: convId });
  if (r.ok && r.fee) {
    renderFeeBox();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } else {
    alert((r && r.error) || "Erreur.");
  }
}
async function confirmFeePaid() {
  const r = await api("fee/confirm", "POST", {});
  const ok = document.getElementById("feeOk");
  if (r.ok) {
    ok.style.display = "block";
  } else {
    ok.style.display = "block";
    ok.textContent = "⚠ " + (r.error || "Erreur");
    ok.style.color = "var(--red)";
  }
}

async function sendMessage(convId) {
  const input = document.getElementById("msgInput");
  const body = input ? input.value.trim() : "";
  if (!body) return;
  const r = await api("messages", "POST", { conversation_id: convId, body });
  if (r.ok) openThread(convId);
  else alert(r.error || "Erreur d'envoi.");
}

async function openConversationForAsset(assetId, subject, message) {
  if (!currentUser) { openAuth(); return; }
  const r = await api("conversations", "POST", { asset_id: assetId, subject });
  if (r.ok && r.conversation) {
    if (message) await api("messages", "POST", { conversation_id: r.conversation.id, body: message });
    openThread(r.conversation.id);
  } else if (r.code === "SUB_REQUIRED") {
    alert("Abonnement requis pour contacter les vendeurs.");
    navigate("abonnement");
  } else {
    alert((r && r.error) || "Erreur. Réessayez.");
  }
}

async function refreshNotifBadge() {
  if (!currentUser) return;
  try {
    const r = await api("notifications");
    const badge = document.getElementById("notifBadge");
    if (badge) { badge.textContent = r.unread; badge.style.display = r.unread > 0 ? "inline-flex" : "none"; }
  } catch (e) {}
}
async function openNotifs() {
  if (!currentUser) { openAuth(); return; }
  const r = await api("notifications");
  const list = document.getElementById("notifList");
  list.innerHTML = (r.notifications || []).map((n) => `
    <div class="notif-item ${n.read ? "read" : "unread"}">
      <span class="dot"></span>
      <div>
        <b>${tData(n.title)}</b>
        ${n.body ? `<p>${tData(n.body)}</p>` : ""}
        <div class="t">${new Date(n.created_at).toLocaleString(currentLang() === "fr" ? "fr-FR" : "en-GB")}</div>
      </div>
    </div>`).join("") || `<p class="muted" style="padding:16px;text-align:center">Aucune notification pour le moment.</p>`;
  document.getElementById("notifModal").classList.add("show");
}
function closeNotifs() { document.getElementById("notifModal").classList.remove("show"); }
async function markNotifsRead() {
  await api("notifications/read", "POST");
  refreshNotifBadge();
  document.querySelectorAll("#notifList .notif-item").forEach((el) => { el.classList.remove("unread"); el.classList.add("read"); });
}

document.getElementById("contactModal").addEventListener("click", (e) => {
  if (e.target.id === "contactModal") closeContact();
});
document.getElementById("authModal").addEventListener("click", (e) => {
  if (e.target.id === "authModal") closeAuth();
});
document.getElementById("notifModal").addEventListener("click", (e) => {
  if (e.target.id === "notifModal") closeNotifs();
});

let authMode = "login";
function openAuth() {
  authMode = "login";
  document.getElementById("authTitle").textContent = "Connexion";
  document.getElementById("authSub").textContent = "Accédez à votre espace membre";
  document.getElementById("aName").style.display = "none";
  document.getElementById("aRoleLbl").style.display = "none";
  document.getElementById("aRole").style.display = "none";
  document.getElementById("authBtn").textContent = "Se connecter";
  document.getElementById("authToggle").textContent = "Pas de compte ? S'inscrire";
  document.getElementById("aOk").style.display = "none";
  document.getElementById("aErr").style.display = "none";
  document.getElementById("authModal").classList.add("show");
}
function closeAuth() { document.getElementById("authModal").classList.remove("show"); }
function toggleAuth() {
  authMode = authMode === "login" ? "register" : "login";
  if (authMode === "register") {
    document.getElementById("authTitle").textContent = "Inscription";
    document.getElementById("authSub").textContent = "Créez votre compte gratuitement";
    document.getElementById("aName").style.display = "block";
    document.getElementById("aRoleLbl").style.display = "block";
    document.getElementById("aRole").style.display = "block";
    document.getElementById("aCguLbl").style.display = "flex";
    document.getElementById("authBtn").textContent = "S'inscrire";
    document.getElementById("authToggle").textContent = "Déjà un compte ? Se connecter";
  } else {
    document.getElementById("authTitle").textContent = "Connexion";
    document.getElementById("authSub").textContent = "Accédez à votre espace membre";
    document.getElementById("aName").style.display = "none";
    document.getElementById("aRoleLbl").style.display = "none";
    document.getElementById("aRole").style.display = "none";
    document.getElementById("aCguLbl").style.display = "none";
    document.getElementById("authBtn").textContent = "Se connecter";
    document.getElementById("authToggle").textContent = "Pas de compte ? S'inscrire";
  }
  document.getElementById("aErr").style.display = "none";
}
async function submitAuth() {
  const err = document.getElementById("aErr");
  err.style.display = "none";
  let r;
  if (authMode === "register") {
    if (!document.getElementById("aCgu").checked) {
      err.style.display = "block";
      err.textContent = "Veuillez accepter les CGU / CGV et la politique de confidentialité pour continuer.";
      return;
    }
    r = await api("register", "POST", {
      name: document.getElementById("aName").value,
      email: document.getElementById("aEmail").value,
      password: document.getElementById("aPass").value,
      role: document.getElementById("aRole").value
    });
    if (r.ok) {
      r = await api("login", "POST", { email: document.getElementById("aEmail").value, password: document.getElementById("aPass").value });
    }
  } else {
    r = await api("login", "POST", { email: document.getElementById("aEmail").value, password: document.getElementById("aPass").value });
  }
  if (r.ok && r.user) {
    const me2 = await api("me");
    currentUser = me2.user || r.user;
    const s = await api("my-subscription");
    currentSub = s.subscription || null;
    updateAuthUI();
    document.getElementById("aOk").style.display = "block";
    setTimeout(closeAuth, 800);
  } else {
    err.style.display = "block";
    err.textContent = (r.error || "Erreur.") + (r.user ? "" : "");
  }
}
async function logoutUser() {
  await api("logout", "POST");
  currentUser = null;
  currentSub = null;
  updateAuthUI();
}
function updateAuthUI() {
  const btn = document.getElementById("navAuthBtn");
  const userMenu = document.getElementById("navUserMenu");
  document.querySelectorAll(".member-only").forEach((el) => el.classList.toggle("show", !!currentUser));
  if (currentUser) {
    if (btn) {
      btn.textContent = t("connexion");
      btn.onclick = (e) => { e.preventDefault(); openAuth(); };
    }
    if (userMenu) userMenu.classList.add("show");
    const userNameEl = document.getElementById("navUserName");
    if (userNameEl) userNameEl.textContent = currentUser.name.split(" ")[0];
    refreshNotifBadge();
  } else {
    if (btn) {
      btn.textContent = t("connexion");
      btn.onclick = (e) => { e.preventDefault(); openAuth(); };
    }
    if (userMenu) userMenu.classList.remove("show");
    const badge = document.getElementById("notifBadge");
    if (badge) badge.style.display = "none";
  }
  refreshNavBadges();
}

function refreshNavBadges() {
  const favCount = document.getElementById("navFavCount");
  if (favCount && currentUser) favCount.textContent = " (" + getFavs().length + ")";
  const dealCount = document.getElementById("navDealCount");
  if (dealCount && currentUser) dealCount.textContent = " (" + getDeals().length + ")";
  const alertMatches = getAlerts().reduce((acc, al2) => acc + matchAlert(al2).length, 0);
  const alertCount = document.getElementById("navAlertCount");
  if (alertCount && currentUser) alertCount.textContent = alertMatches ? " (" + alertMatches + ")" : "";
}

// DASHBOARD FUNCTIONS
function renderDashboard() {
  if (!currentUser) { openAuth(); return; }
  const sub = currentSub || { plan: null, statut: "inactif" };
  const isPremium = sub.plan === "premium" && sub.statut === "actif";
  const isVerifie = sub.plan === "verifie" && sub.statut === "actif";
  const favs = getFavs().length;
  const alerts = getAlerts().length;
  const deals = getDeals().length;
  const kycStatus = currentUser.kyc_statut || "aucun";
  
  document.getElementById("app").innerHTML = `
  <section class="section container" style="padding-top:50px">
    ${breadcrumbs([
      { label: "Accueil", onclick: "navigate('home')" },
      { label: "Tableau de bord" }
    ])}
    
    <!-- Header utilisateur -->
    <div class="card" style="margin-bottom:var(--space-lg);background:linear-gradient(135deg,var(--navy) 0%,var(--navy2) 100%);color:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-md);padding:var(--space-lg)">
        <div>
          <h2 style="margin:0;font-size:1.5rem">${currentUser.name.split(" ")[0]}, bienvenue</h2>
          <p class="muted" style="margin:var(--space-xs) 0 0;color:rgba(255,255,255,.8)">Aureus Capital Markets — Votre espace investisseur</p>
        </div>
        <div style="display:flex;gap:var(--space-sm);flex-wrap:wrap">
          <span class="badge ${isPremium ? 'verified' : (isVerifie ? '' : '')}" style="background:${isPremium ? 'var(--gold)' : (isVerifie ? 'var(--green)' : 'var(--red)')};color:${isPremium ? '#000' : '#fff'};border:none;padding:6px 12px;font-size:.75rem">
            ${isPremium ? 'PREMIUM' : (isVerifie ? 'VÉRIFIÉ' : 'GRATUIT')}
          </span>
          <span class="badge" style="background:rgba(255,255,255,.15);border:none;padding:6px 12px;font-size:.75rem">
            KYC: ${kycStatus === "valide" ? "✓ Validé" : kycStatus === "en_attente" ? "⏳ En attente" : "Non fait"}
          </span>
        </div>
      </div>
    </div>
    
    <!-- Stats rapides -->
    <div class="stats" style="margin-bottom:var(--space-xl)">
      <div class="stat"><div class="num">${favs}</div><div class="lbl">Favoris</div></div>
      <div class="stat"><div class="num">${alerts}</div><div class="lbl">Alertes actives</div></div>
      <div class="stat"><div class="num">${deals}</div><div class="lbl">Dossiers suivis</div></div>
      <div class="stat"><div class="num">${currentUser.kyc_statut === "valide" ? "✓" : "—"}</div><div class="lbl">KYC</div></div>
    </div>
    
    <!-- Onglets -->
    <div class="card">
      <div class="ent-tabs" style="border-bottom:1px solid var(--line);padding:0 var(--space-md);margin-bottom:0" id="dashTabs">
        <button class="btn btn-ghost dash-tab active" onclick="showDashTab('vue-ensemble')" style="border-radius:0;border-bottom:3px solid var(--accent)">Vue d'ensemble</button>
        <button class="btn btn-ghost dash-tab" onclick="showDashTab('favoris')" style="border-radius:0">Favoris (${favs})</button>
        <button class="btn btn-ghost dash-tab" onclick="showDashTab('alertes')" style="border-radius:0">Alertes (${alerts})</button>
        <button class="btn btn-ghost dash-tab" onclick="showDashTab('dossiers')" style="border-radius:0">Dossiers (${deals})</button>
        <button class="btn btn-ghost dash-tab" onclick="showDashTab('abonnement')" style="border-radius:0">Abonnement</button>
        <button class="btn btn-ghost dash-tab" onclick="showDashTab('kyc')" style="border-radius:0">KYC</button>
        <button class="btn btn-ghost dash-tab" onclick="showDashTab('simulateurs')" style="border-radius:0">Simulateurs</button>
      </div>
      
      <div id="dashContent" style="padding:var(--space-lg)">
        <!-- Vue d'ensemble -->
        <div id="tab-vue-ensemble" class="dash-tab-pane">
          <div class="bm-grid" style="margin-bottom:var(--space-xl)">
            <div class="bm-card"><div class="icon">📊</div><h3>Accès aux offres</h3><p>${isPremium || isVerifie ? "✓ Débloqué — Vous pouvez contacter les vendeurs et voir les documents" : "🔒 Bloqué — Abonnement Vérifié (99€/mois) requis"}</p><button class="btn ${isPremium || isVerifie ? "btn-ghost" : "btn-primary"}" style="margin-top:var(--space-sm)" onclick="${isPremium || isVerifie ? 'navigate(\"catalogue\")' : 'navigate(\"abonnement\")'}">${isPremium || isVerifie ? "Explorer le catalogue" : "S'abonner"}</button></div>
            <div class="bm-card"><div class="icon">📄</div><h3>Documents & Data Room</h3><p>${isPremium ? "✓ Accès complet aux documents, data room, exports PDF" : "🔒 Réservé Premium (299€/mois)"}</p><button class="btn ${isPremium ? "btn-ghost" : "btn-primary"}" style="margin-top:var(--space-sm)" onclick="${isPremium ? 'navigate(\"catalogue\")' : 'navigate(\"abonnement\")'}">${isPremium ? "Voir documents" : "Passer Premium"}</button></div>
            <div class="bm-card"><div class="icon">🔔</div><h3>Alertes personnalisées</h3><p>${alerts > 0 ? "✓ " + alerts + " alerte(s) active(s) — Vous êtes notifié(e) dès qu'une offre match" : "Aucune alerte — Créez-en pour ne rater aucune opportunité"}</p><button class="btn btn-primary" style="margin-top:var(--space-sm)" onclick="navigate('alertes')">${alerts > 0 ? "Gérer mes alertes" : "Créer une alerte"}</button></div>
            <div class="bm-card"><div class="icon">📁</div><h3>Mes dossiers</h3><p>${deals > 0 ? "✓ " + deals + " dossier(s) en cours — Pipeline : contact → NDA → LOI → DD → Closing" : "Aucun dossier — Commencez par contacter un vendeur depuis une fiche offre"}</p><button class="btn btn-primary" style="margin-top:var(--space-sm)" onclick="navigate('catalogue')">${deals > 0 ? "Voir mes dossiers" : "Explorer les offres"}</button></div>
          </div>
          
          <div class="section-head"><div><h2>Actions rapides</h2></div></div>
          <div class="bm-grid">
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('catalogue')"><div class="icon" style="margin:0 auto var(--space-sm)">🔍</div><h3>Explorer le catalogue</h3><p class="muted">143 offres vérifiées — obligations, crédits, immo, M&A...</p></div>
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('prets-crypto-landing')"><div class="icon" style="margin:0 auto var(--space-sm)">🪙</div><h3>Prêt contre crypto</h3><p class="muted">Jusqu'à 80% LTV, taux dès 6.5%, déblocage 24h</p></div>
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('financement-dette')"><div class="icon" style="margin:0 auto var(--space-sm)">🏦</div><h3>Financement dette</h3><p class="muted">Senior, mezzanine, bridge — immo & entreprises</p></div>
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('entreprises')"><div class="icon" style="margin:0 auto var(--space-sm)">🏭</div><h3>M&A / Entreprises</h3><p class="muted">Cessions, fusions, levées de fonds, partenariats</p></div>
          </div>
        </div>
        
        <!-- Favoris -->
        <div id="tab-favoris" class="dash-tab-pane" style="display:none">
          <div class="section-head"><div><h2>Mes favoris</h2></div></div>
          <div class="grid" id="dashFavsGrid"></div>
        </div>
        
        <!-- Alertes -->
        <div id="tab-alertes" class="dash-tab-pane" style="display:none">
          <div class="section-head"><div><h2>Mes alertes</h2></div><button class="btn btn-primary" onclick="openAlertModal()">+ Nouvelle alerte</button></div>
          <div class="needs-list" id="dashAlertsList"></div>
        </div>
        
        <!-- Dossiers -->
        <div id="tab-dossiers" class="dash-tab-pane" style="display:none">
          <div class="section-head"><div><h2>Mes dossiers</h2></div></div>
          <div class="pipeline" id="dashPipeline">
            <div class="pstep done"><div class="n">1</div>Contact</div>
            <div class="pstep"><div class="n">2</div>NDA</div>
            <div class="pstep"><div class="n">3</div>LOI</div>
            <div class="pstep"><div class="n">4</div>Due Diligence</div>
            <div class="pstep"><div class="n">5</div>SPA</div>
            <div class="pstep"><div class="n">6</div>Closing</div>
          </div>
          <div class="grid" id="dashDealsGrid"></div>
        </div>
        
        <!-- Abonnement -->
        <div id="tab-abonnement" class="dash-tab-pane" style="display:none">
          <div class="section-head"><div><h2>Mon abonnement</h2></div></div>
          <div id="dashSubContent"></div>
        </div>
        
        <!-- KYC -->
        <div id="tab-kyc" class="dash-tab-pane" style="display:none">
          <div class="section-head"><div><h2>Vérification d'identité (KYC)</h2></div></div>
          <div id="dashKycContent"></div>
        </div>
        
        <!-- Simulateurs -->
        <div id="tab-simulateurs" class="dash-tab-pane" style="display:none">
          <div class="section-head"><div><h2>Mes simulateurs</h2></div></div>
          <div class="bm-grid">
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('prets-crypto-landing')"><div class="icon" style="margin:0 auto var(--space-sm)">🪙</div><h3>Prêt crypto</h3><p class="muted">Collatéral BTC/ETH/USDT → Prêt EUR/USDT</p><button class="btn btn-primary" style="margin-top:var(--space-sm)">Ouvrir</button></div>
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('financement-dette')"><div class="icon" style="margin:0 auto var(--space-sm)">🏦</div><h3>Financement dette</h3><p class="muted">LTV / EBITDA multiple → Montant, taux, mensualité</p><button class="btn btn-primary" style="margin-top:var(--space-sm)">Ouvrir</button></div>
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('catalogue')"><div class="icon" style="margin:0 auto var(--space-sm)">📈</div><h3>Rendement obligation</h3><p class="muted">Prix, coupon, échéance → YTM, duration</p><button class="btn btn-ghost" style="margin-top:var(--space-sm)">Bientôt</button></div>
            <div class="bm-card" style="text-align:center;cursor:pointer" onclick="navigate('catalogue')"><div class="icon" style="margin:0 auto var(--space-sm)">🏠</div><h3>Cash-flow immo</h3><p class="muted">Prix, loyer, charges, emprunt → TRI, cash-on-cash</p><button class="btn btn-ghost" style="margin-top:var(--space-sm)">Bientôt</button></div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
  
  // Render sub-panes
  renderDashFavs();
  renderDashAlerts();
  renderDashDeals();
  renderDashSubscription();
  renderDashKYC();
  
  // Tab switching
  window.showDashTab = (tab) => {
    document.querySelectorAll(".dash-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".dash-tab-pane").forEach(p => p.style.display = "none");
    document.getElementById("tab-" + tab).style.display = "block";
    const activeBtn = document.querySelector(`.dash-tab[onclick*="${tab}"]`);
    if (activeBtn) activeBtn.classList.add("active");
  };
}

function renderDashFavs() {
  const favs = getFavs();
  const list = assets.filter((a) => favs.includes(String(a.id)));
  const grid = document.getElementById("dashFavsGrid");
  if (grid) grid.innerHTML = list.length ? list.map(assetCard).join("") : `<p class="muted">Aucun favori. Cliquez sur ☆ sur une offre pour l'ajouter.</p>`;
}

function renderDashAlerts() {
  const alerts = getAlerts();
  const box = document.getElementById("dashAlertsList");
  if (!box) return;
  if (!alerts.length) { box.innerHTML = `<p class="muted">Aucune alerte. <button class="btn btn-primary" style="margin-left:var(--space-sm)" onclick="openAlertModal()">Créer ma première alerte</button></p>`; return; }
  box.innerHTML = alerts.map((al, i) => `
    <div class="need-card" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-md);flex-wrap:wrap">
      <div>
        <h3 style="margin:0">${al.name || "Alerte " + (i+1)}</h3>
        <div class="small muted">${al.type !== "all" ? al.type : "Tous types"} · ${al.region !== "all" ? al.region : "Toutes régions"} · ${al.min || 0} - ${al.max || "∞"} ${al.currency || "EUR"}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="deleteAlert(${i})">Supprimer</button>
    </div>`).join("");
}

function renderDashDeals() {
  const deals = getDeals();
  const grid = document.getElementById("dashDealsGrid");
  if (!grid) return;
  if (!deals.length) { grid.innerHTML = `<p class="muted">Aucun dossier. Depuis une fiche offre, cliquez "Suivre ce dossier".</p>`; return; }
  grid.innerHTML = deals.map((d) => {
    const a = assets.find((x) => String(x.id) === String(d.assetId));
    return `<div class="deal-card">
      <h3>${a ? a.title : "Offre #" + d.assetId}</h3>
      <div class="small muted"><span>Étape:</span> ${d.stage || "contact"} · <span>Créé:</span> ${new Date(d.created_at).toLocaleDateString(currentLang() === "fr" ? "fr-FR" : "en-GB")}</div>
      <div class="ent-foot" style="margin-top:var(--space-md)">
        <button class="btn btn-primary" onclick="openAsset('${d.assetId}')">Ouvrir</button>
        <button class="btn btn-ghost" onclick="removeDeal('${d.assetId}')">Retirer</button>
      </div>
    </div>`;
  }).join("");
}

function renderDashSubscription() {
  const box = document.getElementById("dashSubContent");
  if (!box) return;
  const sub = currentSub || { plan: null, statut: "inactif" };
  box.innerHTML = `
    <div class="form-card" style="max-width:500px">
      <h3 style="color:var(--accent);margin-bottom:var(--space-md)">Statut actuel</h3>
      <div class="stat" style="text-align:left;background:var(--bg2);border-radius:var(--radius);padding:var(--space-md);margin-bottom:var(--space-lg)">
        <div style="font-size:1.2rem;font-weight:700;color:var(--navy)">${sub.plan === "premium" ? "Premium (299€/mois)" : sub.plan === "verifie" ? "Vérifié (99€/mois)" : "Gratuit"}</div>
        <div class="small muted">Statut: ${sub.statut === "actif" ? "✓ Actif" : sub.statut === "en_attente" ? "⏳ En attente de paiement" : "Inactif"}</div>
      </div>
      ${sub.statut === "actif" && sub.plan === "verifie" ? `
        <button class="btn btn-primary full" onclick="subscribe('premium')">Passer Premium (299€/mois)</button>
      ` : sub.statut === "actif" && sub.plan === "premium" ? `
        <button class="btn btn-ghost full" style="color:var(--red)" onclick="cancelSub()">Annuler l'abonnement</button>
      ` : `
        <button class="btn btn-primary full" onclick="navigate('abonnement')">Choisir un plan</button>
      `}
    </div>`;
}

function renderDashKYC() {
  const box = document.getElementById("dashKycContent");
  if (!box) return;
  const s = currentUser.kyc_statut || "aucun";
  const statusHtml = s === "valide"
    ? `<div class="notice" style="border-color:var(--green);color:var(--green)">✓ Votre identité est vérifiée. Badge Vérifié actif.</div>`
    : s === "en_attente"
    ? `<div class="notice">⏳ Votre demande est en cours de vérification par notre équipe (sous 24 h).</div>`
    : s === "rejete"
    ? `<div class="notice" style="border-color:var(--red);color:var(--red)">Demande rejetée. Corrigez les informations et renvoyez.</div>`
    : "";
  box.innerHTML = `
    <div class="form-card">
      <h3 style="color:var(--accent);margin-bottom:var(--space-md)">Vérification d'identité</h3>
      <p class="muted small">Obtenez le badge <span class="badge verified">Vérifié</span> : gage de crédibilité auprès des vendeurs.</p>
      ${statusHtml}
      ${currentUser ? `
      <div class="form-grid">
        <div><label>Nom légal complet</label><input id="kNom" placeholder="Comme sur la pièce d'identité"></div>
        <div><label>Pays de résidence</label><input id="kPays" placeholder="Ex : France, Émirats, Algérie..."></div>
      </div>
      <label>Type de document</label>
      <select id="kDoc">
        <option>Passeport</option>
        <option>Carte nationale d'identité</option>
        <option>Permis de conduire</option>
        <option>Passeport ou ID société (vendeur)</option>
      </select>
      <label>Référence ou n° du document (facultatif)</label>
      <input id="kRef" placeholder="Numéro du document, sans photo pour l'instant">
      <button class="btn btn-primary full" style="margin-top:var(--space-md)" onclick="submitKyc()">Envoyer ma demande</button>
      <p id="kOk" class="ok small" style="display:none;margin-top:var(--space-sm)">✓ Demande envoyée.</p>` : `
      <button class="btn btn-primary full" onclick="openAuth()">Se connecter pour se vérifier</button>`}
    </div>`;
}

function openAlertModal() {
  document.getElementById("app").innerHTML += `
    <div class="modal show" id="alertModal" style="z-index:200">
      <div class="modal-card" style="max-width:500px">
        <button class="modal-close" onclick="closeAlertModal()">&times;</button>
        <h3>Créer une alerte</h3>
        <div class="form-grid">
          <div><label>Nom de l'alerte</label><input id="alName" placeholder="Ex : Obligations Afrique"></div>
          <div><label>Type</label><select id="alType"><option value="all">Tous</option><option value="obligation">Obligations</option><option value="credit">Crédits</option><option value="hedgefund">Fonds Immo</option><option value="immobilier">Immobilier</option><option value="usine">Usines</option><option value="marque">Marques</option><option value="ma">M&A</option><option value="commodity">Matières Premières</option></select></div>
          <div><label>Région</label><select id="alRegion"><option value="all">Toutes</option>${REGIONS.filter(r=>r.key!=="all").map(r=>`<option value="${r.key}">${r.label}</option>`).join("")}</select></div>
          <div><label>Devise</label><select id="alCurrency"><option value="EUR">EUR</option><option value="USD">USD</option><option value="USDC">USDC</option><option value="USDT">USDT</option></select></div>
          <div><label>Montant min</label><input id="alMin" type="number" placeholder="0"></div>
          <div><label>Montant max</label><input id="alMax" type="number" placeholder="Illimité"></div>
        </div>
        <button class="btn btn-primary full" style="margin-top:var(--space-md)" onclick="saveAlert()">Créer</button>
      </div>
    </div>`;
}

function closeAlertModal() {
  const m = document.getElementById("alertModal");
  if (m) m.remove();
}

function saveAlert() {
  const name = document.getElementById("alName").value.trim() || "Alerte " + (getAlerts().length + 1);
  const alerts = getAlerts();
  alerts.push({
    name, type: document.getElementById("alType").value,
    region: document.getElementById("alRegion").value,
    currency: document.getElementById("alCurrency").value,
    min: parseFloat(document.getElementById("alMin").value) || 0,
    max: parseFloat(document.getElementById("alMax").value) || 0
  });
  saveState();
  closeAlertModal();
  renderDashAlerts();
  refreshNavBadges();
  alert("Alerte créée !");
}

function deleteAlert(i) {
  if (!confirm("Supprimer cette alerte ?")) return;
  const alerts = getAlerts();
  alerts.splice(i, 1);
  saveState();
  renderDashAlerts();
  refreshNavBadges();
}

function removeDeal(assetId) {
  if (!confirm("Retirer ce dossier ?")) return;
  const deals = getDeals();
  const idx = deals.findIndex(d => String(d.assetId) === String(assetId));
  if (idx >= 0) { deals.splice(idx, 1); saveState(); renderDashDeals(); refreshNavBadges(); }
}

function cancelSub() {
  if (!confirm("Annuler l'abonnement Premium ? Vous perdrez l'accès aux documents et data room.")) return;
  const r = api("subscribe/cancel", "POST", {}).then(() => { currentSub = null; renderDashboard(); });
}

/* ========================================
   SAAS LAYOUT HANDLING
   ======================================== */

function showMarketingLayout() {
  document.getElementById("marketingLayout")?.classList.remove("hidden");
  document.getElementById("appLayout")?.classList.add("hidden");
  document.body.classList.remove("app-mode");
}

function showAppLayout() {
  document.getElementById("marketingLayout")?.classList.add("hidden");
  document.getElementById("appLayout")?.classList.remove("hidden");
  document.body.classList.add("app-mode");
  initSidebar();
  initTopbar();
  initCommandPalette();
  initKeyboardShortcuts();
}

function switchLayout() {
  if (currentUser) {
    showAppLayout();
  } else {
    showMarketingLayout();
  }
}

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const menuBtn = document.getElementById("menuBtn");
  const sidebarOverlay = document.querySelector(".sidebar-overlay");
  
  if (!sidebar) return;

  // Create overlay if not exists
  if (!sidebarOverlay) {
    const overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    document.body.appendChild(overlay);
  }

  // Toggle collapsed state (desktop)
  if (sidebarToggle) {
    sidebarToggle.onclick = () => {
      sidebar.classList.toggle("collapsed");
      localStorage.setItem("sidebarCollapsed", sidebar.classList.contains("collapsed"));
    };
  }

  // Mobile menu toggle
  if (menuBtn) {
    menuBtn.onclick = () => {
      sidebar.classList.toggle("open");
      document.querySelector(".sidebar-overlay")?.classList.toggle("visible");
    };
  }

  // Close on overlay click
  document.querySelector(".sidebar-overlay")?.addEventListener("click", () => {
    sidebar.classList.remove("open");
    document.querySelector(".sidebar-overlay")?.classList.remove("visible");
  });

  // Restore collapsed state
  if (localStorage.getItem("sidebarCollapsed") === "true") {
    sidebar.classList.add("collapsed");
  }

  // Sidebar navigation
  document.querySelectorAll(".sidebar-link[data-page]").forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      const page = link.dataset.page;
      navigate(page);
      // Update active state
      document.querySelectorAll(".sidebar-link").forEach(l => l.classList.remove("active"));
      link.classList.add("active");
      // Close mobile sidebar
      sidebar.classList.remove("open");
      document.querySelector(".sidebar-overlay")?.classList.remove("visible");
    };
  });

  // Set active link based on current page
  const setActiveLink = (page) => {
    document.querySelectorAll(".sidebar-link[data-page]").forEach(l => {
      l.classList.toggle("active", l.dataset.page === page);
    });
  };

  // Expose for navigate()
  window.setSidebarActive = setActiveLink;
}

function initTopbar() {
  // Global search
  const searchInput = document.getElementById("globalSearchInput");
  const searchContainer = document.getElementById("globalSearch");
  
  if (searchInput) {
    let searchTimeout;
    searchInput.oninput = () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        const query = searchInput.value.trim().toLowerCase();
        if (query.length >= 2) {
          performGlobalSearch(query);
        } else {
          hideGlobalSearchResults();
        }
      }, 150);
    };
    
    searchInput.onfocus = () => {
      if (searchInput.value.trim().length >= 2) {
        performGlobalSearch(searchInput.value.trim().toLowerCase());
      }
    };
    
    document.addEventListener("click", (e) => {
      if (!searchContainer?.contains(e.target)) {
        hideGlobalSearchResults();
      }
    });
  }

  // Notifications button
  const notifBtn = document.getElementById("notifBtn");
  const notifModal = document.getElementById("notifModal");
  if (notifBtn && notifModal) {
    notifBtn.onclick = () => {
      notifModal.classList.add("show");
      renderNotifications();
    };
  }

  // User menu dropdown
  const userBtn = document.getElementById("userBtn");
  const userMenu = document.getElementById("userMenu");
  if (userBtn && userMenu) {
    userBtn.onclick = (e) => {
      e.stopPropagation();
      userMenu.classList.toggle("open");
    };
    document.addEventListener("click", () => userMenu.classList.remove("open"));
  }

  // User dropdown navigation
  document.querySelectorAll(".user-dropdown-item[data-page]").forEach(item => {
    item.onclick = (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigate(page);
      userMenu.classList.remove("open");
    };
  });

  // Publish button
  const publishBtn = document.getElementById("topbarPublishBtn");
  if (publishBtn) {
    publishBtn.onclick = (e) => {
      e.preventDefault();
      navigate("publish");
    };
  }

  // Update user name in topbar
  const topbarUserName = document.getElementById("topbarUserName");
  const dropdownUserName = document.getElementById("dropdownUserName");
  const dropdownUserEmail = document.getElementById("dropdownUserEmail");
  if (currentUser) {
    const name = currentUser.name.split(" ")[0];
    if (topbarUserName) topbarUserName.textContent = name;
    if (dropdownUserName) dropdownUserName.textContent = currentUser.name;
    if (dropdownUserEmail) dropdownUserEmail.textContent = currentUser.email;
  }

  // Notification badge
  updateTopbarNotifBadge();
}

function performGlobalSearch(query) {
  // Search across assets, companies, needs, etc.
  const results = [];
  const q = query.toLowerCase();
  
  assets.forEach(a => {
    const haystack = `${a.title} ${a.emetteur} ${a.pays} ${a.typeLabel}`.toLowerCase();
    if (haystack.includes(q)) {
      results.push({ type: "asset", title: tData(a.title), subtitle: `${tData(a.typeLabel)} · ${tData(a.pays)}`, page: "marketplace", id: a.id });
    }
  });
  
  // Add quick actions
  if (query.includes("publier") || query.includes("publish")) {
    results.unshift({ type: "action", title: "Publier une offre", subtitle: "Créer une nouvelle annonce", page: "publish" });
  }
  if (query.includes("tableau") || query.includes("dashboard")) {
    results.unshift({ type: "action", title: "Tableau de bord", subtitle: "Vue d'ensemble de votre espace", page: "dashboard" });
  }
  if (query.includes("abonn") || query.includes("sub")) {
    results.unshift({ type: "action", title: "Mon abonnement", subtitle: "Gérer votre plan", page: "subscription" });
  }
  
  renderGlobalSearchResults(results.slice(0, 8));
}

function renderGlobalSearchResults(results) {
  let container = document.getElementById("globalSearchResults");
  if (!container) {
    container = document.createElement("div");
    container.id = "globalSearchResults";
    container.className = "global-search-results";
    document.getElementById("globalSearch")?.appendChild(container);
  }
  
  if (!results.length) {
    container.innerHTML = `<div class="search-result-empty">Aucun résultat pour "${document.getElementById("globalSearchInput")?.value}"</div>`;
    container.classList.add("show");
    return;
  }
  
  container.innerHTML = results.map(r => `
    <a href="#" class="search-result-item" onclick="navigate('${r.page}'${r.id ? `, '${r.id}'` : ''}); hideGlobalSearchResults(); return false;">
      <span class="search-result-title">${r.title}</span>
      <span class="search-result-subtitle">${r.subtitle}</span>
      ${r.type === "action" ? '<span class="search-result-type">Action</span>' : ''}
    </a>
  `).join("");
  container.classList.add("show");
}

function hideGlobalSearchResults() {
  const container = document.getElementById("globalSearchResults");
  if (container) container.classList.remove("show");
}

function initCommandPalette() {
  const palette = document.getElementById("commandPalette");
  const input = document.getElementById("commandInput");
  const list = document.getElementById("commandList");
  
  if (!palette || !input) return;

  const commands = [
    { id: "dashboard", label: "Tableau de bord", shortcut: "⌘1", action: () => navigate("dashboard") },
    { id: "marketplace", label: "Marché", shortcut: "⌘2", action: () => navigate("marketplace") },
    { id: "financing", label: "Financement", shortcut: "⌘3", action: () => navigate("financing") },
    { id: "companies", label: "Entreprises & M&A", shortcut: "⌘4", action: () => navigate("companies") },
    { id: "realestate", label: "Immobilier", shortcut: "⌘5", action: () => navigate("realestate") },
    { id: "crypto-loans", label: "Prêts Crypto", shortcut: "⌘6", action: () => navigate("crypto-loans") },
    { id: "markets", label: "Marchés", shortcut: "⌘7", action: () => navigate("markets") },
    { id: "needs", label: "Besoins & Financement", shortcut: "⌘8", action: () => navigate("needs") },
    { id: "alerts", label: "Mes alertes", shortcut: "⌘9", action: () => navigate("alerts") },
    { id: "deals", label: "Mes dossiers", shortcut: "⌘0", action: () => navigate("deals") },
    { id: "publish", label: "Publier une offre", shortcut: "⌘P", action: () => navigate("publish") },
    { id: "subscription", label: "Mon abonnement", shortcut: "⌘S", action: () => navigate("subscription") },
    { id: "settings", label: "Paramètres", shortcut: "⌘,", action: () => navigate("settings") },
    { id: "logout", label: "Déconnexion", shortcut: "", action: () => logoutUser() },
  ];

  function renderCommandList(filter = "") {
    const filtered = filter 
      ? commands.filter(c => c.label.toLowerCase().includes(filter.toLowerCase()) || c.shortcut.toLowerCase().includes(filter.toLowerCase()))
      : commands;
    
    list.innerHTML = filtered.map((c, i) => `
      <div class="command-item" data-index="${i}" data-id="${c.id}" tabindex="0">
        <span class="command-label">${c.label}</span>
        ${c.shortcut ? `<kbd class="command-shortcut">${c.shortcut}</kbd>` : ""}
      </div>
    `).join("");
    
    // Add click handlers
    list.querySelectorAll(".command-item").forEach(item => {
      item.onclick = () => {
        const cmd = commands.find(c => c.id === item.dataset.id);
        if (cmd) { cmd.action(); closeCommandPalette(); }
      };
    });
  }

  function openCommandPalette() {
    palette.classList.remove("hidden");
    input.value = "";
    renderCommandList();
    input.focus();
    list.querySelector(".command-item")?.classList.add("selected");
  }

  function closeCommandPalette() {
    palette.classList.add("hidden");
    input.value = "";
  }

  function selectCommand(direction) {
    const items = list.querySelectorAll(".command-item");
    if (!items.length) return;
    let current = list.querySelector(".command-item.selected");
    let index = current ? parseInt(current.dataset.index) : -1;
    index = (index + direction + items.length) % items.length;
    items.forEach(i => i.classList.remove("selected"));
    items[index].classList.add("selected");
    items[index].scrollIntoView({ block: "nearest" });
  }

  input.oninput = (e) => renderCommandList(e.target.value);
  
  input.onkeydown = (e) => {
    if (e.key === "Escape") { closeCommandPalette(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); selectCommand(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selectCommand(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const selected = list.querySelector(".command-item.selected");
      if (selected) {
        const cmd = commands.find(c => c.id === selected.dataset.id);
        if (cmd) { cmd.action(); closeCommandPalette(); }
      }
    }
  };

  // Cmd+K / Ctrl+K to open
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      if (palette.classList.contains("hidden")) {
        openCommandPalette();
      } else {
        closeCommandPalette();
      }
    }
  });

  // Close on backdrop click
  palette.querySelector(".command-palette-backdrop")?.addEventListener("click", closeCommandPalette);
}

function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    
    if (e.metaKey || e.ctrlKey) return; // Let Cmd+K be handled by command palette
    
    switch (e.key.toLowerCase()) {
      case "g": case "d": e.preventDefault(); navigate("dashboard"); break;
      case "m": e.preventDefault(); navigate("marketplace"); break;
      case "f": e.preventDefault(); navigate("financing"); break;
      case "c": e.preventDefault(); navigate("companies"); break;
      case "r": e.preventDefault(); navigate("realestate"); break;
      case "l": e.preventDefault(); navigate("crypto-loans"); break;
      case "k": e.preventDefault(); navigate("markets"); break;
      case "n": e.preventDefault(); navigate("needs"); break;
      case "a": e.preventDefault(); navigate("alerts"); break;
      case "o": e.preventDefault(); navigate("deals"); break;
      case "p": e.preventDefault(); navigate("publish"); break;
      case "s": e.preventDefault(); navigate("subscription"); break;
      case "?": e.preventDefault(); showKeyboardShortcutsHelp(); break;
    }
  });
}

function showKeyboardShortcutsHelp() {
  showToast("Raccourcis: G=Dashboard, M=Marché, F=Financement, C=Entreprises, R=Immobilier, L=Crypto, K=Marchés, N=Besoins, A=Alertes, O=Dossiers, P=Publier, S=Abonnement, ?=Aide", "info", 5000);
}

/* Toast Notification System */
function showToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  
  const icons = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L21.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };
  
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    ${icons[type] || icons.info}
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;
  
  if (container) {
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }
}

/* Notification badge updates */
function updateTopbarNotifBadge() {
  const badge = document.getElementById("topbarNotifBadge");
  const bellBadge = document.getElementById("notifBadge");
  const sidebarBadge = document.querySelector(".sidebar-badge"); // first one
  
  // We'll update this when notifications are loaded
  // For now, just hide if no unread
  // Actual count comes from notifications API
}

function updateNotifBadges(count) {
  const badges = [document.getElementById("topbarNotifBadge"), document.getElementById("notifBadge"), document.getElementById("sidebarAlertCount")].filter(Boolean);
  badges.forEach(b => {
    if (count > 0) {
      b.textContent = count > 99 ? "99+" : count;
      b.style.display = "flex";
    } else {
      b.style.display = "none";
    }
  });
}

/* Global search results styles injected */
const searchResultsStyle = document.createElement("style");
searchResultsStyle.textContent = `
  .global-search-results {
    position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px;
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow-lg); max-height: 400px; overflow-y: auto;
    opacity: 0; visibility: hidden; transform: translateY(-8px); transition: all .15s ease;
    z-index: 50;
  }
  .global-search-results.show { opacity: 1; visibility: visible; transform: translateY(0); }
  .search-result-item { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-sm) var(--space-md); color: var(--text); text-decoration: none; }
  .search-result-item:hover { background: var(--accent-light); color: var(--accent); }
  .search-result-title { font-weight: 500; }
  .search-result-subtitle { font-size: .8rem; color: var(--muted); flex: 1; }
  .search-result-type { font-size: .65rem; padding: 2px 6px; background: var(--accent-light); color: var(--accent); border-radius: 4px; }
  .search-result-empty { padding: var(--space-md); color: var(--muted); text-align: center; }
`;
document.head.appendChild(searchResultsStyle);

/* Toast container */
const toastContainerStyle = document.createElement("style");
toastContainerStyle.textContent = `
  .toast-container { position: fixed; bottom: var(--space-xl); right: var(--space-xl); z-index: 110; display: flex; flex-direction: column; gap: var(--space-sm); }
  .toast { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-md) var(--space-lg); background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-lg); min-width: 280px; max-width: 420px; animation: slideInRight .2s ease; }
  @keyframes slideInRight { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
  .toast.success { border-left: 4px solid var(--green); }
  .toast.error { border-left: 4px solid var(--red); }
  .toast.warning { border-left: 4px solid var(--gold); }
  .toast.info { border-left: 4px solid var(--accent); }
  .toast-icon { width: 20px; height: 20px; flex-shrink: 0; color: var(--accent); }
  .toast.success .toast-icon { color: var(--green); }
  .toast.error .toast-icon { color: var(--red); }
  .toast.warning .toast-icon { color: var(--gold); }
  .toast-message { flex: 1; font-size: .88rem; color: var(--text); }
  .toast-close { background: none; border: none; color: var(--faint); cursor: pointer; padding: var(--space-xs); }
  .toast-close:hover { color: var(--red); }
`;
document.head.appendChild(toastContainerStyle);

/* ========================================
   APP INITIALIZATION
   ======================================== */

async function initApp() {
  const me = await api("me");
  if (me.user) currentUser = me.user;
  updateAuthUI();
  if (currentUser) {
    const s = await api("my-subscription");
    currentSub = s.subscription || null;
  }
  const data = await api("assets");
  assets = data && data.length ? data : [];
  initMarkets();
  const h = (window.location.hash || "#/home").replace("#/", "");
  const parts = h.split("/");
  renderPage(parts[0] || "home", parts[1]);
  refreshNavBadges();
  refreshNotifBadge();
  applyLang();
  setInterval(refreshNotifBadge, 15000);
  setInterval(tickAll, 4000);
}

initApp();
