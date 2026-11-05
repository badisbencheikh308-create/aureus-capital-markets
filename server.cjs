const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_DIR = path.join(__dirname, "admin");
const DB_PATH = path.join(__dirname, "data.db");
const SESSION_SECRET = crypto.randomBytes(32).toString("hex");
const COOKIE_NAME = "aureus_session";

const PAYMENT_CONFIG = {
  brand: "Aureus Capital Markets",
  currency: "EUR",
  plans: {
    verifie: { key: "verifie", name: "Investisseur Vérifié", price: 99, interval: "/mois", tagline: "Contacter les vendeurs et suivre les offres", features: ["Contacter les vendeurs", "Alertes illimitées", "Badge Vérifié", "Favoris illimités"] },
    premium: { key: "premium", name: "Premium", price: 299, interval: "/mois", tagline: "Accès complet : documents, data room, priorité", features: ["Tout Vérifié", "Accès aux documents", "Data room", "Export PDF des fiches", "Priorité équipe"] }
  },
  relation_fee: { key: "relation_fee", name: "Frais de mise en relation", price: 350, tagline: "Honoraires forfaitaires à la mise en relation effective" },
  moyens: {
    virement: { label: "Virement SEPA / International", details: "IBAN: FR76 3000 4000 0312 3456 7890 143 — BIC: BNPAFRPP — Aureus Capital Markets SAS" },
    paypal: { label: "PayPal", details: "paiement@aureuscapitalmarkets.com" },
    wave: { label: "Wave / Orange Money / MTN MoMo", details: "+33 7 00 00 00 00 (Aureus Capital Markets)" },
    crypto: { label: "Crypto stablecoins (USDT / USDC sur Ethereum/Polygon)", details: "0x742d35Cc6634C0532925a3b8D4C0532925a3b8D4 (à remplacer par votre wallet)" }
  }
};
const EMAIL_CONFIG = {
  enabled: true,
  from: "Aureus Capital Markets <contact@aureuscapitalmarkets.com>",
  resendApiKey: process.env.RESEND_API_KEY || "re_xxxxxxxxxxxxxxxxxxxxxxxx"  // Mettre votre clé Resend ici ou dans .env
};

// PAYPAL CONFIG
const PAYPAL_CONFIG = {
  clientId: process.env.PAYPAL_CLIENT_ID || "TON_CLIENT_ID_SANDBOX",
  secret: process.env.PAYPAL_SECRET || "TON_SECRET_SANDBOX",
  mode: process.env.PAYPAL_MODE || "sandbox", // "sandbox" ou "live"
  baseUrl: process.env.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com"
};

async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CONFIG.clientId}:${PAYPAL_CONFIG.secret}`).toString("base64");
  const res = await fetch(`${PAYPAL_CONFIG.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const data = await res.json();
  return data.access_token;
}

async function createPayPalOrder(plan, userId, email) {
  const prices = { verifie: "99.00", premium: "299.00" };
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_CONFIG.baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        amount: { currency_code: "EUR", value: prices[plan] },
        custom_id: `${plan}_${userId}_${Date.now()}`,
        description: `Abonnement ${plan === "verifie" ? "Investisseur Vérifié" : "Premium"} - Aureus Capital Markets`
      }],
      application_context: { 
        return_url: `${process.env.BASE_URL || "http://localhost:3000"}#/abonnement?success=1`, 
        cancel_url: `${process.env.BASE_URL || "http://localhost:3000"}#/abonnement?canceled=1`,
        brand_name: "Aureus Capital Markets",
        user_action: "PAY_NOW"
      }
    })
  });
  return res.json();
}

async function capturePayPalOrder(orderID) {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_CONFIG.baseUrl}/v2/checkout/orders/${orderID}/capture`, {
    method: "POST", 
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
  });
  return res.json();
}

async function sendEmail({ to, subject, html, text }) {
  if (!EMAIL_CONFIG.enabled || !EMAIL_CONFIG.resendApiKey || EMAIL_CONFIG.resendApiKey.startsWith("re_xxxx")) {
    return queueEmail(to, subject, text || html);
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${EMAIL_CONFIG.resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: EMAIL_CONFIG.from,
        to: [to],
        subject: subject,
        html: html,
        text: text
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return queueEmail(to, subject, text || html);
    }
    return { ok: true };
  } catch (e) {
    console.error("Email send failed:", e);
    return queueEmail(to, subject, text || html);
  }
}
function queueEmail(to, subject, body) {
  try {
    db.prepare("INSERT INTO outbox (to_addr, subject, body) VALUES (?,?,?)").run(to, subject, body);
  } catch (e) {}
}
const hasActiveSub = (userId) => {
  const s = db.prepare("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId);
  return s && s.statut === "actif" ? s : null;
};
const subPlan = (s) => (s && s.plan ? s.plan : null);

const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'acheteur',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  emetteur TEXT,
  pays TEXT,
  devise TEXT,
  montant REAL,
  rendement REAL,
  maturite TEXT,
  risque TEXT,
  token TEXT,
  description TEXT,
  documents TEXT,
  vendeur TEXT,
  minimum REAL,
  statut TEXT DEFAULT 'publie',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  message TEXT,
  subject TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  pays TEXT,
  devise TEXT,
  montant REAL,
  rendement REAL,
  maturite TEXT,
  description TEXT,
  debt_type TEXT,
  ltv_target TEXT,
  duration_target TEXT,
  guarantees TEXT,
  statut TEXT DEFAULT 'en_attente',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER,
  user_id INTEGER NOT NULL,
  subject TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender TEXT NOT NULL DEFAULT 'membre',
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS needs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  category TEXT NOT NULL DEFAULT 'credit',
  title TEXT NOT NULL,
  amount REAL,
  currency TEXT DEFAULT 'EUR',
  purpose TEXT,
  description TEXT,
  region TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bank_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank TEXT NOT NULL,
  product TEXT NOT NULL,
  range_min REAL,
  range_max REAL,
  currency TEXT DEFAULT 'EUR',
  rate REAL,
  purpose TEXT,
  region TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  plan TEXT NOT NULL,
  reference TEXT UNIQUE NOT NULL,
  statut TEXT DEFAULT 'en_attente',
  montant REAL,
  devise TEXT DEFAULT 'EUR',
  moyen TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  actived_at TEXT
);
CREATE TABLE IF NOT EXISTS relation_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  conversation_id INTEGER,
  reference TEXT UNIQUE NOT NULL,
  statut TEXT DEFAULT 'en_attente',
  montant REAL DEFAULT 350,
  devise TEXT DEFAULT 'EUR',
  moyen TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  actived_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crypto_loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  collateral_crypto TEXT NOT NULL,
  collateral_amount REAL NOT NULL,
  loan_currency TEXT DEFAULT 'EUR',
  loan_amount REAL NOT NULL,
  ltv INTEGER DEFAULT 60,
  duration_months INTEGER DEFAULT 12,
  purpose TEXT,
  wallet_address TEXT,
  statut TEXT DEFAULT 'en_attente',
  reference TEXT,
  taux_annuel REAL DEFAULT 8.5,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);
`);

const assetCols = db.prepare("PRAGMA table_info(assets)").all().map((c) => c.name);
if (!assetCols.includes("verifie")) {
  db.exec("ALTER TABLE assets ADD COLUMN verifie INTEGER DEFAULT 0");
  db.exec(`UPDATE assets SET verifie = 1 WHERE token IN ('SN-2032','DLG-2029','AU-100KG','PPA-EUR-01','WHEAT-1','BRENT-Q3','LNG-JKM-01','DRA-PART-01','PJ-VILLA-01')`);
  console.log("[DB] Migration : colonne verifie ajoutée.");
}
if (!assetCols.includes("secteur")) {
  db.exec("ALTER TABLE assets ADD COLUMN secteur TEXT");
  console.log("[DB] Migration : colonne secteur ajoutée.");
}
if (!assetCols.includes("mode")) {
  db.exec("ALTER TABLE assets ADD COLUMN mode TEXT");
  db.exec(`UPDATE assets SET mode = CASE
    WHEN type IN ('usine','marque','ma') AND (title LIKE '%Partenariat%' OR title LIKE '%partenariat%' OR title LIKE '%Levée%' OR title LIKE '%levée%' OR title LIKE '%financement%' OR title LIKE '%Financement%') THEN 'partenariat'
    WHEN type IN ('usine','marque','ma') AND (title LIKE '%Fusion%' OR title LIKE '%fusion%') THEN 'fusion'
    WHEN type IN ('usine','marque','ma') THEN 'vente'
    ELSE NULL END`);
  console.log("[DB] Migration : colonne mode ajoutée.");
}
if (!assetCols.includes("a_la_une")) {
  db.exec("ALTER TABLE assets ADD COLUMN a_la_une INTEGER DEFAULT 0");
  db.exec(`UPDATE assets SET a_la_une = 1 WHERE token IN ('SN-2032','CI-2033','QATAR-LNG-01','AU-100KG','MA-MRK-01','WA-LOG-01')`);
  console.log("[DB] Migration : colonne a_la_une ajoutée.");
}
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("kyc_statut")) {
  db.exec("ALTER TABLE users ADD COLUMN kyc_statut TEXT DEFAULT 'aucun'");
  db.exec("ALTER TABLE users ADD COLUMN kyc_nom TEXT");
  db.exec("ALTER TABLE users ADD COLUMN kyc_pays TEXT");
  db.exec("ALTER TABLE users ADD COLUMN kyc_document TEXT");
  console.log("[DB] Migration : colonnes KYC ajoutées.");
}

const seedAssets = [
  { type: "obligation", title: "Obligation Souveraine Sénégal 2032", emetteur: "État du Sénégal", pays: "Sénégal", devise: "USD", montant: 250000, rendement: 8.6, maturite: "2032", risque: "B", token: "SN-2032", description: "Obligation souveraine libellée en USD, échéance 2032. Coupon semestriel. Documents vérifiés par la plateforme.", documents: JSON.stringify(["Prospectus d'émission", "Certificat de détention", "Analyse pays"]), vendeur: "Fonds Afrique Capital" },
  { type: "obligation", title: "Obligation Corporate Dubaï Logistics 2029", emetteur: "Dubaï Logistics Group", pays: "EAU", devise: "USD", montant: 500000, rendement: 7.2, maturite: "2029", risque: "BBB", token: "DLG-2029", description: "Obligation corporate émise par un groupe logistique de Dubaï. Coupon annuel indexé.", documents: JSON.stringify(["Term Sheet", "Rapport annuel 2025", "Évaluation des garanties"]), vendeur: "Gulf Private Wealth" },
  { type: "obligation", title: "Obligation Énergie Kenya 2028", emetteur: "Kenya Green Energy SA", pays: "Kenya", devise: "EUR", montant: 180000, rendement: 10.1, maturite: "2028", risque: "B+", token: "KGE-2028", description: "Projet solaire certifié. Coupon trimestriel.", documents: JSON.stringify(["Plan d'affaires", "PPA signé", "Certificat vert"]), vendeur: "Impact Energy Fund" },
  { type: "credit", title: "Crédit Commercial Alimentaire Europe", emetteur: "Pool de 34 créances", pays: "France / Italie", devise: "EUR", montant: 300000, rendement: 12.4, maturite: "18 mois", risque: "BB", token: "TR-EC-01", description: "Portefeuille de créances fournisseurs du secteur agroalimentaire.", documents: JSON.stringify(["Liste des débiteurs anonymisée", "Statistiques de recouvrement", "Contrat de cession"]), vendeur: "Euro Trade Credit" },
  { type: "credit", title: "Crédit Immobilier Commercial Istanbul", emetteur: "Fonds de créances RE-Turquie", pays: "Turquie", devise: "USD", montant: 650000, rendement: 15.8, maturite: "24 mois", risque: "B", token: "TR-REC-01", description: "Créances hypothécaires de premier rang sur immobilier commercial.", documents: JSON.stringify(["Hypothèques constituées", "Évaluations immobilières", "Structure du pool"]), vendeur: "Mediterranean Credit Partners" },
  { type: "hedgefund", title: "Fonds Résidentiel Premium Dubaï", emetteur: "Dubaï Real Asset Fund SPV", pays: "EAU", devise: "USD", montant: 2000000, rendement: 14.2, maturite: "5 ans", risque: "BB", token: "DRA-PART-01", description: "Fonds investissant dans des appartements premium à Dubaï.", documents: JSON.stringify(["Offre de souscription", "États financiers audités", "Politique ESG"]), vendeur: "Dubai Real Asset Fund", minimum: 25000 },
  { type: "hedgefund", title: "Fonds Logistique Afrique de l'Ouest", emetteur: "West Africa Logistics Fund", pays: "Côte d'Ivoire / Sénégal", devise: "EUR", montant: 3000000, rendement: 11.8, maturite: "7 ans", risque: "BB+", token: "WAL-PART-01", description: "Entrepôts et plateformes logistiques loués à des multinationales.", documents: JSON.stringify(["Livre blanc du fonds", "Contrats de location", "Analyse du marché"]), vendeur: "West Africa Logistics", minimum: 10000 },
  { type: "hedgefund", title: "Fonds Résidences Étudiantes Malaisie", emetteur: "KL Student Living Fund", pays: "Malaisie", devise: "USD", montant: 1500000, rendement: 9.6, maturite: "4 ans", risque: "BBB", token: "KLS-PART-01", description: "Parc de résidences étudiantes à Kuala Lumpur et Penang.", documents: JSON.stringify(["Rapport de gestion", "Taux d'occupation", "Cashflow projections"]), vendeur: "KL Student Living", minimum: 15000 },
  { type: "immobilier", title: "Villa Prestige Palm Jumeirah", emetteur: "Particulier / holding", pays: "EAU", devise: "USD", montant: 4800000, rendement: null, maturite: "Vente directe", risque: "A", token: "PJ-VILLA-01", description: "Villa avec vue mer, 6 chambres, plage privée.", documents: JSON.stringify(["Titre de propriété", "Évaluation notariale", "Certificat d'exonération"]), vendeur: "Mandataire Palm Properties" },
  { type: "immobilier", title: "Immeuble de bureaux — La Défense", emetteur: "Fonds famille", pays: "France", devise: "EUR", montant: 12500000, rendement: 6.2, maturite: "Vente directe", risque: "BBB", token: "DF-BUR-01", description: "Immeuble de 3 400 m² loué à 100% à un groupe bancaire.", documents: JSON.stringify(["Baux en cours", "Diagnostics techniques", "Évaluation expert"]), vendeur: "Family Office Paris" },
  { type: "usine", title: "Usine Agroalimentaire — Maroc", emetteur: "Groupe industriel", pays: "Maroc", devise: "EUR", montant: 6800000, rendement: null, maturite: "Vente directe", risque: "BB", token: "MOR-USINE-01", description: "Unité de transformation agroalimentaire de 8 000 m².", documents: JSON.stringify(["Fiche technique usine", "Bilans 3 ans", "Certification ISO"]), vendeur: "Mandat Industrie Maghreb" },
  { type: "marque", title: "Marque de Mode Premium — Vente", emetteur: "Fondateur", pays: "France", devise: "EUR", montant: 2500000, rendement: null, maturite: "Cession de marque", risque: "BB+", token: "MOD-PR-01", description: "Marque de prêt-à-porter premium avec 14 boutiques.", documents: JSON.stringify(["Valorisation de marque", "Contrats de distribution", "Données de vente"]), vendeur: "Mandat Marques & Co" },
  { type: "ma", title: "Entreprise Logistique — Recherche acquéreur", emetteur: "Famille fondatrice", pays: "Sénégal / Côte d'Ivoire", devise: "EUR", montant: 9000000, rendement: null, maturite: "Mandat M&A", risque: "BB", token: "WA-LOG-01", description: "Plateforme logistique ouest-africaine, 250 employés.", documents: JSON.stringify(["Mémorandum confidentiel", "États financiers audités", "Rapport de due diligence"]), vendeur: "Mandat M&A West Africa" },
  { type: "ma", title: "Clinique Vétérinaire — Recherche acquéreur", emetteur: "Groupe fondateur", pays: "Espagne", devise: "EUR", montant: 1200000, rendement: null, maturite: "Mandat M&A", risque: "BBB", token: "ES-VET-01", description: "Réseau de 3 cliniques vétérinaires à Madrid.", documents: JSON.stringify(["Mémorandum confidentiel", "Bilans audités", "Contrats de location"]), vendeur: "Mandat M&A Iberia" },
  { type: "commodity", title: "Contrat Pétrole Brut Brent — Livraison", emetteur: "Trader international / négoce", pays: "International (Brent)", devise: "USD", montant: 1500000, rendement: null, maturite: "Livraison 30 jours", risque: "BBB", token: "BRENT-Q3", description: "Contrat d'achat de brut Brent, chargement fiable, qualités standard. Inco terms, titrage, inspection SGS possible.", documents: JSON.stringify(["Certificat d'analyse", "Contrat cadre", "Fiche produit"]), vendeur: "Négoce Méditerranée" },
  { type: "commodity", title: "Contrat Gaz Naturel LNG — Asie", emetteur: "Fournisseur LNG", pays: "Asie (JKM)", devise: "USD", montant: 2800000, rendement: null, maturite: "Fenêtre de livraison", risque: "BBB", token: "LNG-JKM-01", description: "Cargaison LNG livrée en Asie, indexée JKM. Origine flexible (Australie, Qatar, USA). Délais courts.", documents: JSON.stringify(["Term sheet", "Lettre de commodité", "Cadre logistique"]), vendeur: "LNG Trade Partners" },
  { type: "commodity", title: "Contrat Blé Dur — 10 000 tonnes", emetteur: "Négociant céréalier", pays: "France / Mer Noire", devise: "EUR", montant: 3200000, rendement: null, maturite: "Récolte 2026", risque: "BBB+", token: "WHEAT-1", description: "Blé dur qualité meunière, livraison FOB ou CFR. Certificat d'origine, analyse au déchargement, inspection tierce possible.", documents: JSON.stringify(["Analyse qualité", "Contrat type GAFTA", "Lettre de crédit"]), vendeur: "Céréales Partners Europe" },
  { type: "commodity", title: "Contrat Maïs — Afrique de l'Ouest", emetteur: "Coopérative export", pays: "Sénégal / Côte d'Ivoire", devise: "USD", montant: 1400000, rendement: null, maturite: "2-4 semaines", risque: "BB", token: "MAIS-WA", description: "Maïs jaune qualité fourragère, volume 6 000 t, cargaison partagée possible. Livraison port d'Abidjan ou Dakar.", documents: JSON.stringify(["Fiche produit", "Certificat sanitaire", "Inspection"]) , vendeur: "AgroTrade Ouest-Afrique" },
  { type: "commodity", title: "Contrat Or & Lingots — 100 kg", emetteur: "Affineur agréé LBMA", pays: "Suisse", devise: "USD", montant: 7200000, rendement: null, maturite: "Livraison 7 jours", risque: "A", token: "AU-100KG", description: "Lingots 1 kg certifiés LBMA, stockés à Zurich. Transaction sécurisée avec dépôt fiduciaire et contrôle.", documents: JSON.stringify(["Certificat LBMA", "Valuation", "Accord de dépôt"]), vendeur: "Metal Wealth SA" },
  { type: "commodity", title: "Contrat Électricité — PPA Industriel", emetteur: "Producteur indépendant", pays: "Europe (France / Espagne)", devise: "EUR", montant: 950000, rendement: null, maturite: "Contrat 12-24 mois", risque: "BBB+", token: "PPA-EUR-01", description: "Power Purchase Agreement : achat d'électricité verte à prix fixe ou indexé, volume 50 MW/an. Idéal pour industriels et traders.", documents: JSON.stringify(["Term sheet PPA", "Garanties d'origine", "Cadre de livraison"]), vendeur: "Green Power Trading" },
  { type: "commodity", title: "Contrat Gazole 0,1 % — Ouest Afrique", emetteur: "Négociant pétrolier", pays: "Sénégal / Côte d'Ivoire", devise: "USD", montant: 2100000, rendement: null, maturite: "Cargaison 15 jours", risque: "BB+", token: "GOL-WA-01", description: "Gazole 0,1 % soufre, volume 10 000 t, livraison CIF Dakar ou Abidjan. Certificats d'analyse au chargement et déchargement.", documents: JSON.stringify(["Certificat d'analyse", "Contrat type", "Inspection"]), vendeur: "Atlantic Fuels Trading" },
  { type: "commodity", title: "Contrat Café Arabica — Afrique de l'Est", emetteur: "Exportateur / coopérative", pays: "Éthiopie / Kenya", devise: "USD", montant: 620000, rendement: null, maturite: "Récolte en cours", risque: "BB", token: "COFF-AA-01", description: "Arabica grade AA, 300 tonnes, livraison FOB Djibouti. Traçabilité, classement qualité, inspection tierce disponible.", documents: JSON.stringify(["Rapport de dégustation", "Certificat d'origine", "Fiche lot"]), vendeur: "East Africa Coffee Export" },
  { type: "commodity", title: "Contrat Cacao — Côte d'Ivoire", emetteur: "Coopérative de planteurs", pays: "Côte d'Ivoire", devise: "USD", montant: 1750000, rendement: null, maturite: "Campagne en cours", risque: "BB", token: "COCO-CI-01", description: "Cacao marchand, 800 tonnes, livraison port d'Abidjan. Qualité export standard, contrôle qualité au déchargement.", documents: JSON.stringify(["Certificat qualité", "Contrat type", "Inspection"]), vendeur: "Ivorian Cocoa House" },
  { type: "commodity", title: "Contrat Cuivre Concentré — Afrique Centrale", emetteur: "Mineur / trader", pays: "RDC / Zambie", devise: "USD", montant: 3400000, rendement: null, maturite: "Livraison 30-45 jours", risque: "BB", token: "CU-CON-01", description: "Concentré de cuivre 25-30 %, 1 000 t métal, livraison FOB ou CIF. Assay certificate, freight forwarder inclus.", documents: JSON.stringify(["Assay certificate", "Lettre de crédit", "Contrat de vente"]), vendeur: "Copper & Base Metals Trade" },
  { type: "commodity", title: "Contrat Riz Parfumé — 5 000 t", emetteur: "Négociant asiatique", pays: "Thaïlande / Vietnam", devise: "USD", montant: 2300000, rendement: null, maturite: "Cargaison 3-4 semaines", risque: "BBB", token: "RICE-1", description: "Riz parfumé 5 %, 5 000 tonnes, livraison CIF Dakar ou Lomé. Certificat qualité, packaging 25-50 kg, inspection SGS.", documents: JSON.stringify(["Certificat qualité", "Lettre de crédit", "Fiche produit"]), vendeur: "Mekong Rice Trading" },
  { type: "commodity", title: "Contrat Sucre Brut — Brésil", emetteur: "Moulin sucrier / export", pays: "Brésil", devise: "USD", montant: 1900000, rendement: null, maturite: "Cargaison 3 semaines", risque: "BBB", token: "SUGAR-BR", description: "Sucre brut ICUMSA 600-1200, 12 000 t, livraison FOB Santos. Bulks in bulk vessel, analyse de qualité incluse.", documents: JSON.stringify(["Analyse ICUMSA", "Contrat type", "Inspection"]) , vendeur: "Brazil Sugar House" },
  { type: "commodity", title: "Contrat Engrais Urée 46 % — Afrique", emetteur: "Importateur / distributeur", pays: "Dubaï / Afrique de l'Ouest", devise: "USD", montant: 2600000, rendement: null, maturite: "Livraison 4-6 semaines", risque: "BB+", token: "UREA-46", description: "Urée granulaire 46 % azote, 10 000 t, livraison port ouest-africain. Sacs 50 kg, certificats d'analyse, financement possible.", documents: JSON.stringify(["Certificat d'analyse", "Lettre de crédit", "Fiche produit"]), vendeur: "Agro Inputs Trading" },
  { type: "obligation", title: "Obligation Souveraine Qatar 2031", emetteur: "État du Qatar", pays: "Qatar", devise: "USD", montant: 3000000, rendement: 4.4, maturite: "2031", risque: "AA", token: "QA-SOV-31", description: "Eurobond souverain qatari libellé en USD, échéance 2031. Coupon annuel. L'un des émetteurs les mieux notés du Golfe, garantie souveraine.", documents: JSON.stringify(["Prospectus d'émission", "Notation S&P / Moody's", "Certificat de détention"]), vendeur: "Gulf Sovereign Desk" },
  { type: "obligation", title: "Obligation Souveraine Singapour 2030", emetteur: "République de Singapour", pays: "Singapour", devise: "USD", montant: 2500000, rendement: 2.6, maturite: "2030", risque: "AAA", token: "SG-SOV-30", description: "Obligation souveraine singapourienne notée AAA. Une des signatures les plus sûres au monde, idéale pour la gestion de trésorerie institutionnelle.", documents: JSON.stringify(["Prospectus", "Notation AAA", "Analyse pays"]), vendeur: "Asia Sovereign Capital" },
  { type: "obligation", title: "Obligation Souveraine Oman 2029", emetteur: "Sultanat d'Oman", pays: "Oman", devise: "USD", montant: 1800000, rendement: 5.2, maturite: "2029", risque: "BB+", token: "OM-SOV-29", description: "Eurobond souverain omanais, échéance 2029. Coupon annuel. Prime de risque attractive sur un émetteur en amélioration budgétaire.", documents: JSON.stringify(["Prospectus", "Rapport FMI pays", "Certificat de détention"]), vendeur: "Gulf Sovereign Desk" },
  { type: "obligation", title: "Trésor Américain US Treasury 10 ans", emetteur: "Gouvernement des États-Unis", pays: "États-Unis", devise: "USD", montant: 5000000, rendement: 4.2, maturite: "2036", risque: "AAA", token: "UST-10Y", description: "US Treasury à 10 ans, la référence mondiale du sans-risque dollar. Liquidité maximale, idéal pour sécuriser une poche en USD.", documents: JSON.stringify(["CUSIP du titre", "Attestation de compte", "Fact sheet Treasury"]), vendeur: "US Fixed Income Desk" },
  { type: "obligation", title: "Obligation Corporate Dubaï — Énergie 2028", emetteur: "Conglomérat énergétique de Dubaï", pays: "EAU (Dubaï)", devise: "USD", montant: 3500000, rendement: 5.6, maturite: "2028", risque: "BBB+", token: "DBX-EN-28", description: "Obligation corporate émise par un acteur majeur de l'énergie et des utilities de Dubaï. Coupon annuel, forte liquidité régionale.", documents: JSON.stringify(["Term sheet", "États financiers 2025", "Rapport de notation"]), vendeur: "Gulf Wealth Partners" },
  { type: "obligation", title: "Obligation Souveraine Côte d'Ivoire 2033", emetteur: "République de Côte d'Ivoire", pays: "Côte d'Ivoire", devise: "USD", montant: 2200000, rendement: 7.8, maturite: "2033", risque: "B+", token: "CI-2033", description: "Eurobond ivoirien échéance 2033. Pays en forte croissance en Afrique de l'Ouest, coupon semestriel, prime de risque élevée.", documents: JSON.stringify(["Prospectus", "Analyse pays", "Programme d'émission"]), vendeur: "Africa Fixed Income" },
  { type: "obligation", title: "Obligation Souveraine Kenya 2033", emetteur: "République du Kenya", pays: "Kenya", devise: "USD", montant: 1600000, rendement: 9.2, maturite: "2033", risque: "B-", token: "KE-2033", description: "Eurobond kenyan échéance 2033. Rendement attractif sur une économie est-africaine en réforme. Coupon semestriel.", documents: JSON.stringify(["Prospectus", "Programme FMI", "Analyse pays"]), vendeur: "Africa Fixed Income" },
  { type: "obligation", title: "Obligation Souveraine France (OAT) 2034", emetteur: "République française", pays: "France", devise: "EUR", montant: 4000000, rendement: 2.8, maturite: "2034", risque: "AA", token: "FR-OAT-34", description: "Obligation assimilable du Trésor français à 10 ans. Référence de la zone euro, liquidité excellente, adossée à l'État français.", documents: JSON.stringify(["Prospectus Agence France Trésor", "ISIN", "Attestation de compte"]), vendeur: "Euro Fixed Income Desk" },
  { type: "credit", title: "Crédit Commercial Chine — Pool Export", emetteur: "Pool de créances export", pays: "Chine", devise: "USD", montant: 5000000, rendement: 6.8, maturite: "12 mois", risque: "BBB", token: "CN-EXP-01", description: "Portefeuille de créances d'exportation chinoises adossé à des lettres de crédit confirmées. Recouvrement via maisons de négoce.", documents: JSON.stringify(["Liste des débiteurs anonymisée", "Lettres de crédit", "Historique de recouvrement"]), vendeur: "Sino Trade Finance" },
  { type: "credit", title: "Crédit Maritime Singapour — Pool", emetteur: "Fonds de créances maritimes", pays: "Singapour", devise: "USD", montant: 4200000, rendement: 7.4, maturite: "18 mois", risque: "BBB", token: "SG-SHIP-01", description: "Créances de fret et affrètement de la place maritime de Singapour. Sécurisées par connaissements et primes d'assurance.", documents: JSON.stringify(["Structure du pool", "Connaissements", "Analyse du risque"]), vendeur: "Maritime Credit Partners" },
  { type: "credit", title: "Crédit Commercial Afrique de l'Est", emetteur: "Pool de créances agro", pays: "Tanzanie / Ouganda / Rwanda", devise: "USD", montant: 1500000, rendement: 12.5, maturite: "12 mois", risque: "B", token: "EA-AGRO-01", description: "Créances du commerce agricole est-africain (café, thé, coton). Rendement élevé, recouvrement structuré par des spécialistes locaux.", documents: JSON.stringify(["Liste des débiteurs anonymisée", "Statistiques de recouvrement", "Contrats de cession"]), vendeur: "East Africa Trade Credit" },
  { type: "hedgefund", title: "Fonds Logistique Chine — Distribution", emetteur: "China Logistics Fund", pays: "Chine (Shanghai / Chengdu)", devise: "USD", montant: 6000000, rendement: 8.2, maturite: "5 ans", risque: "BB+", token: "CN-LOG-01", description: "Plateformes logistiques e-commerce louées à des opérateurs majeurs. Demande portée par la distribution en ligne.", documents: JSON.stringify(["Livre blanc du fonds", "Contrats de location", "États financiers"]), vendeur: "China Logistics Fund", minimum: 25000 },
  { type: "hedgefund", title: "Fonds REIT Singapour — Bureaux", emetteur: "SG Office REIT", pays: "Singapour", devise: "SGD", montant: 4500000, rendement: 5.4, maturite: "Fonds ouvert", risque: "BBB+", token: "SG-REIT-01", description: "Portefeuille de bureaux de grade A à Singapour et dans les pôles d'affaires asiatiques. Distribution trimestrielle.", documents: JSON.stringify(["Rapport de gestion", "Taux d'occupation", "Évaluation du portefeuille"]), vendeur: "SG REIT Advisors", minimum: 20000 },
  { type: "hedgefund", title: "Fonds Énergie Verte Qatar", emetteur: "Qatar Green Energy Fund", pays: "Qatar", devise: "USD", montant: 5500000, rendement: 6.5, maturite: "6 ans", risque: "BBB", token: "QA-GREEN-01", description: "Projets solaires et efficacité énergétique au Qatar et dans le Golfe, adossés à des contrats de long terme.", documents: JSON.stringify(["Livre blanc", "PPA / contrats", "États financiers"]), vendeur: "Qatar Green Energy", minimum: 30000 },
  { type: "hedgefund", title: "Fonds Immobilier Dubaï — Marina", emetteur: "DME Real Estate Fund", pays: "EAU (Dubaï)", devise: "USD", montant: 8000000, rendement: 9.0, maturite: "5 ans", risque: "BB", token: "DME-MAR-01", description: "Appartements et penthouse de la Marina de Dubaï en location courte durée. Rendement élevé porté par le tourisme.", documents: JSON.stringify(["Offre de souscription", "Évaluations immobilières", "Cashflow projections"]), vendeur: "DME Real Estate", minimum: 15000 },
  { type: "immobilier", title: "Villa de Luxe — Katara Doha", emetteur: "Holding privée", pays: "Qatar", devise: "USD", montant: 4200000, rendement: null, maturite: "Vente directe", risque: "A", token: "QA-KAT-01", description: "Villa moderne face à la mer dans le quartier résidentiel de Katara à Doha. Titre de propriété en pleine propriété.", documents: JSON.stringify(["Titre de propriété", "Évaluation notariale", "Certificat municipal"]), vendeur: "Doha Real Estate Mandate" },
  { type: "immobilier", title: "Appartement Marina Dubaï — Vente", emetteur: "Particulier", pays: "EAU (Dubaï)", devise: "USD", montant: 950000, rendement: null, maturite: "Vente directe", risque: "A", token: "DBX-MAR-01", description: "Appartement 2 chambres vue port à Dubai Marina, livré et meublé. Rente locative potentielle et plus-value confirmée.", documents: JSON.stringify(["Titre de propriété", "Évaluation DLD", "Historique locatif"]), vendeur: "Palm Properties Mandate" },
  { type: "immobilier", title: "Résidence Mascate — Vente", emetteur: "Famille omanaise", pays: "Oman", devise: "USD", montant: 650000, rendement: null, maturite: "Vente directe", risque: "BB+", token: "OM-MUS-01", description: "Villa de standing dans le quartier résidentiel d'Al Mouj, Mascate. Jardin, piscine, accès golf et marina.", documents: JSON.stringify(["Titre de propriété", "Évaluation", "Certificat de propriété"]), vendeur: "Muscat Property Mandate" },
  { type: "immobilier", title: "Penthouse Riviera Singapour", emetteur: "Famille investisseuse", pays: "Singapour", devise: "SGD", montant: 5500000, rendement: null, maturite: "Vente directe", risque: "A", token: "SG-PH-01", description: "Penthouse de 3 chambres en bord de rivière à Singapour. Rare mise en vente, potentiel locatif premium.", documents: JSON.stringify(["Titre de propriété", "Évaluation bancaire", "Relevé de charges"]), vendeur: "Singapore Homes Mandate" },
  { type: "usine", title: "Usine Électronique — Chine (Shenzhen)", emetteur: "Groupe industriel chinois", pays: "Chine", devise: "USD", montant: 8500000, rendement: null, maturite: "Vente / partenariat", risque: "BB", token: "CN-SZ-01", description: "Unité d'assemblage électronique de 12 000 m² à Shenzhen. Main-d'œuvre qualifiée, chaîne d'approvisionnement intégrée.", documents: JSON.stringify(["Fiche technique", "Bilans 3 ans", "Certifications"]), vendeur: "Asia Industrial Mandate" },
  { type: "usine", title: "Usine Agroalimentaire — Dubaï JAFZA", emetteur: "Groupe agroalimentaire", pays: "EAU (Dubaï)", devise: "USD", montant: 5200000, rendement: null, maturite: "Vente directe", risque: "BB+", token: "DBX-FOOD-01", description: "Usine de transformation alimentaire en zone franche JAFZA, prête à l'emploi, avec licences et marché GCC acquis.", documents: JSON.stringify(["Fiche technique usine", "Licence JAFZA", "Bilans 3 ans"]), vendeur: "Gulf Industry Mandate" },
  { type: "marque", title: "Marque Mode Africaine — Cession", emetteur: "Fondateur", pays: "Sénégal / Côte d'Ivoire", devise: "EUR", montant: 1800000, rendement: null, maturite: "Cession de marque", risque: "BB", token: "MOD-AF-01", description: "Marque de prêt-à-porter premium ouest-africaine, 8 boutiques et distribution internationale en ligne.", documents: JSON.stringify(["Valorisation de marque", "Données de vente", "Contrats de distribution"]), vendeur: "Africa Brands Mandate" },
  { type: "ma", title: "Entreprise Logistique Chine-Europe — Cession", emetteur: "Famille fondatrice", pays: "Chine / Allemagne", devise: "EUR", montant: 12000000, rendement: null, maturite: "Mandat M&A", risque: "BB", token: "CN-EU-LOG", description: "Opérateur de fret ferroviaire Chine-Europe (route de la soie), 300 employés, chiffre d'affaires établi sur les corridors.", documents: JSON.stringify(["Mémorandum confidentiel", "États financiers audités", "Rapport de due diligence"]), vendeur: "Mandat M&A Eurasia" },
  { type: "ma", title: "Holding Technologique Singapour — Partenariat", emetteur: "Fondateurs", pays: "Singapour", devise: "USD", montant: 9000000, rendement: null, maturite: "Levée / partenariat", risque: "BB+", token: "SG-TECH-01", description: "Plateforme SaaS fintech asiatique rentable, recherche partenaire stratégique pour accélérer au Moyen-Orient et en Afrique.", documents: JSON.stringify(["Mémorandum", "États financiers audités", "Business plan"]), vendeur: "Mandat M&A Singapour" },
  { type: "ma", title: "Clinique Médicale — Qatar (partenariat)", emetteur: "Groupe médical du Golfe", pays: "Qatar", devise: "USD", montant: 6000000, rendement: null, maturite: "Mandat M&A", risque: "BB+", token: "QA-MED-01", description: "Réseau de polycliniques à Doha, recherche investisseur partenaire pour extension dans le Golfe. Réglementation locale maîtrisée.", documents: JSON.stringify(["Mémorandum confidentiel", "Bilans audités", "Licences médicales"]), vendeur: "Mandat M&A Gulf" },
  { type: "commodity", title: "Contrat Gaz Naturel Qatar — 5 ans", emetteur: "Producteur gazier qatari", pays: "Qatar", devise: "USD", montant: 9500000, rendement: null, maturite: "Contrat 5 ans", risque: "A", token: "QATAR-LNG-01", description: "Contrat d'approvisionnement LNG qatari à long terme (5 ans), indexé sur les indices régionaux. Livraison Asie ou Moyen-Orient.", documents: JSON.stringify(["Term sheet", "Lettre de commodité", "Cadre contractuel"]), vendeur: "Qatar Gas Desk" },
  { type: "commodity", title: "Contrat Riz — Thaïlande 15 000 t", emetteur: "Négociant thaïlandais", pays: "Thaïlande", devise: "USD", montant: 6900000, rendement: null, maturite: "Cargaison 3 semaines", risque: "BBB", token: "RICE-TH-15K", description: "Riz blanc thaï 5 %, 15 000 tonnes, livraison CIF. Certificat qualité, inspection SGS, financement documentaire possible.", documents: JSON.stringify(["Certificat qualité", "Lettre de crédit", "Fiche produit"]), vendeur: "Bangkok Rice Trading" },
  { type: "commodity", title: "Contrat Huile de Palme — Malaisie", emetteur: "Exportateur malaisien", pays: "Malaisie", devise: "USD", montant: 2200000, rendement: null, maturite: "Cargaison 3-4 semaines", risque: "BBB-", token: "CPO-MY-01", description: "Huile de palme brute (CPO), 5 000 tonnes, livraison CIF. Certificat MPOB, inspection au chargement et déchargement.", documents: JSON.stringify(["Certificat MPOB", "Analyse qualité", "Contrat type"]), vendeur: "Kuala Lumpur Commodities" },
  { type: "commodity", title: "Contrat Poulet congelé — Brésil", emetteur: "Abattoir exportateur", pays: "Brésil", devise: "USD", montant: 1800000, rendement: null, maturite: "Cargaison 4 semaines", risque: "BBB", token: "POUL-BR-01", description: "Poulet congelé Halal, 2 500 tonnes, livraison CIF Afrique ou Golfe. Certificats Halal et sanitaires inclus, inspection tierce.", documents: JSON.stringify(["Certificat Halal", "Certificat sanitaire", "Fiche produit"]), vendeur: "Brazil Poultry Export" },
  { type: "commodity", title: "Contrat Minerai de Fer — Australie", emetteur: "Mineur australien", pays: "Australie", devise: "USD", montant: 8800000, rendement: null, maturite: "Cargaison 30-40 jours", risque: "BBB+", token: "FE-AU-01", description: "Minerai de fer 62 % Fe, 60 000 tonnes, livraison CIF port asiatique ou moyen-oriental. Assay certificate et inspection SGS.", documents: JSON.stringify(["Assay certificate", "Lettre de crédit", "Contrat de vente"]), vendeur: "Perth Bulk Trading" },
  { type: "usine", title: "Usine Agroalimentaire — Algérie (Oran)", emetteur: "Groupe familial algérien", pays: "Algérie", devise: "EUR", montant: 4200000, rendement: null, maturite: "Vente / partenariat", risque: "BB", token: "DZ-ORN-01", description: "Unité de transformation de produits laitiers et jus, 6 500 m² à Oran. Marché national établi, certificats sanitaires à jour, foncier propriété.", documents: JSON.stringify(["Fiche technique usine", "Bilans 3 ans", "Titres fonciers"]), vendeur: "Mandat Industrie Maghreb" },
  { type: "usine", title: "Usine Textile — Tunisie (Monastir)", emetteur: "Groupe textile exportateur", pays: "Tunisie", devise: "EUR", montant: 3500000, rendement: null, maturite: "Vente directe", risque: "BB", token: "TN-MON-01", description: "Atelier de confection de 5 000 m², capacité 40 000 pièces/mois, contrats d'exportation vers l'Europe, main-d'œuvre qualifiée.", documents: JSON.stringify(["Fiche technique", "Contrats de production", "Bilans audités"]), vendeur: "Mandat Industrie Maghreb" },
  { type: "usine", title: "Unité de Production Boissons — Côte d'Ivoire", emetteur: "PME industrielle", pays: "Côte d'Ivoire", devise: "EUR", montant: 2900000, rendement: null, maturite: "Vente / partenariat", risque: "B+", token: "CI-BEV-01", description: "Ligne d'embouteillage d'eau minérale et boissons gazeuses à Abidjan, distribution dans 8 pays d'Afrique de l'Ouest, contrat de marque.", documents: JSON.stringify(["Fiche technique ligne", "Réseau de distribution", "Bilans 3 ans"]), vendeur: "West Africa Business Mandate" },
  { type: "usine", title: "Usine Métallurgique — Turquie (Istanbul)", emetteur: "Groupe sidérurgique", pays: "Turquie", devise: "USD", montant: 9800000, rendement: null, maturite: "Vente directe", risque: "BB+", token: "TR-MET-01", description: "Unité de découpe et soudure métallique de 9 000 m² en zone industrielle d'Istanbul, certifications ISO et clients européens.", documents: JSON.stringify(["Fiche technique", "Certifications ISO", "États financiers"]), vendeur: "Eurasia Industry Mandate" },
  { type: "marque", title: "Marque Cosmétique Bio — Cession", emetteur: "Fondatrice", pays: "France / Afrique", devise: "EUR", montant: 1100000, rendement: null, maturite: "Cession de marque", risque: "BB", token: "MOD-COS-01", description: "Marque de cosmétiques naturels vendue en pharmacies et e-commerce, notoriété confirmée, recette protégée et packaging déposés.", documents: JSON.stringify(["Valorisation de marque", "Données de vente", "Marques déposées"]), vendeur: "Mandat Marques & Co" },
  { type: "marque", title: "Chaîne de Restaurants — Cession (8 points de vente)", emetteur: "Fondateur", pays: "Sénégal", devise: "EUR", montant: 1600000, rendement: null, maturite: "Cession de marque", risque: "BB", token: "MOD-REST-01", description: "Chaîne de restauration rapide locale, 8 restaurants à Dakar et Saly, fournisseurs intégrés, concept éprouvé à développer en Afrique.", documents: JSON.stringify(["Valorisation", "Comptes des 3 ans", "Baux commerciaux"]), vendeur: "Africa Brands Mandate" },
  { type: "marque", title: "Marque Sportswear — Internationale", emetteur: "Entrepreneurs", pays: "USA / Europe", devise: "USD", montant: 3800000, rendement: null, maturite: "Cession / licence", risque: "BB+", token: "MOD-SPT-01", description: "Marque de vêtements de sport avec distribution e-commerce mondiale et présence en retail, 120 000 clients fidèles.", documents: JSON.stringify(["Valorisation de marque", "Données e-commerce", "Contrats de licence"]), vendeur: "Global Brands Mandate" },
  { type: "ma", title: "Restaurant Gastronomique — Recherche acquéreur", emetteur: "Chef fondateur", pays: "France (Paris)", devise: "EUR", montant: 1400000, rendement: null, maturite: "Mandat M&A", risque: "BBB", token: "FR-GASTRO-01", description: "Table gastronomique étoilée dans le 8e arrondissement, CA en croissance, fonds de commerce et notoriété. Acquisition ou prise de participation.", documents: JSON.stringify(["Mémorandum confidentiel", "Comptes audités", "Bail commercial"]), vendeur: "Mandat M&A Europe" },
  { type: "ma", title: "Hôtel Boutique — Recherche partenariat", emetteur: "Groupe hôtelier", pays: "Maroc (Marrakech)", devise: "EUR", montant: 6500000, rendement: null, maturite: "Mandat M&A", risque: "BB", token: "MA-HOT-01", description: "Riad-hôtel 18 suites à Marrakech, taux d'occupation 85 %, recherche partenaire pour extension. RSE et classement 5 étoiles.", documents: JSON.stringify(["Mémorandum confidentiel", "États financiers", "Évaluation immobilière"]), vendeur: "Mandat M&A Maghreb" },
  { type: "ma", title: "Entreprise de Transport Routier — Afrique de l'Ouest", emetteur: "Famille fondatrice", pays: "Sénégal / Mali", devise: "EUR", montant: 3800000, rendement: null, maturite: "Mandat M&A", risque: "B+", token: "WA-TRANS-01", description: "Flotte de 45 camions, contrats miniers et FMCG, ateliers de maintenance. Recherche partenaire pour renouveler la flotte et se développer.", documents: JSON.stringify(["Mémorandum confidentiel", "États financiers audités", "Contrats clients"]), vendeur: "Mandat M&A West Africa" },
  { type: "ma", title: "Startup Fintech — Levée de fonds", emetteur: "Fondateurs", pays: "France", devise: "EUR", montant: 2500000, rendement: null, maturite: "Levée / partenaire", risque: "BB+", token: "FR-FINTECH-01", description: "Plateforme B2B de financement de factures, 300 clients PME, MRR établi, recherche investisseur pour phase de croissance régionale.", documents: JSON.stringify(["Mémorandum", "Métriques financières", "Business plan"]), vendeur: "Mandat M&A Europe" },
  { type: "ma", title: "PME Agroexport — Recherche acquéreur", emetteur: "Fondateur", pays: "Égypte", devise: "USD", montant: 2200000, rendement: null, maturite: "Mandat M&A", risque: "BB", token: "EG-AGRO-01", description: "Exportateur d'agrumes et de fruits frais vers le Golfe et l'Europe, stations de conditionnement certifiées, contrats long terme.", documents: JSON.stringify(["Mémorandum confidentiel", "Bilans audités", "Contrats export"]), vendeur: "Mandat M&A Middle East" },
  { type: "usine", title: "Boulangerie Industrielle — Dubaï", emetteur: "Groupe alimentaire", pays: "EAU (Dubaï)", devise: "USD", montant: 4800000, rendement: null, maturite: "Vente / partenariat", risque: "BB+", token: "DBX-BK-01", description: "Production de pain et viennoiseries, 3 200 m², fournisseur des grands distributeurs du Golfe, capacité extensible.", documents: JSON.stringify(["Fiche technique", "Contrats de distribution", "Certifications HACCP"]), vendeur: "Gulf Industry Mandate" },
  { type: "marque", title: "Marque de Café — Chaîne internationale", emetteur: "Fondateurs", pays: "Italie / UAE", devise: "EUR", montant: 2400000, rendement: null, maturite: "Cession de marque", risque: "BB", token: "MOD-CAFE-01", description: "Marque de café et torréfaction avec 5 coffee shops et distribution en ligne, source de grains certifiés, potentiel franchise au Moyen-Orient.", documents: JSON.stringify(["Valorisation de marque", "Comptes", "Contrats fournisseurs"]), vendeur: "Mediterranean Brands" },
  { type: "ma", title: "Startup Fintech Paiements — Levée de fonds", emetteur: "Fondateurs", pays: "Sénégal", devise: "EUR", montant: 1800000, rendement: null, maturite: "Levée de fonds", risque: "BB", token: "SN-FINTECH-01", description: "Plateforme de paiement mobile ouest-africaine, 40 000 utilisateurs, agrément en cours. Recherche un investisseur stratégique pour la phase d'expansion régionale.", documents: JSON.stringify(["Mémorandum", "Métriques d'usage", "Business plan"]), vendeur: "Mandat M&A West Africa" },
  { type: "ma", title: "EdTech Francophone — Levée de fonds", emetteur: "Fondateurs", pays: "France", devise: "EUR", montant: 2200000, rendement: null, maturite: "Levée de fonds", risque: "BB+", token: "FR-EDTECH-01", description: "Plateforme de formation en ligne pour les entreprises francophones, 200 comptes B2B, ARR en croissance de 40 %/an. Levée de 2,2 M€ en série A.", documents: JSON.stringify(["Mémorandum", "Métriques ARR", "Business plan"]), vendeur: "Mandat M&A Europe" },
  { type: "ma", title: "Agence Digitale — Recherche acquéreur", emetteur: "Fondateurs", pays: "Maroc", devise: "EUR", montant: 900000, rendement: null, maturite: "Vente", risque: "BB", token: "MA-DIGITAL-01", description: "Agence web et marketing digital, 25 employés, portefeuille de 60 clients récurrents (tourisme, retail, banque). CA 1,2 M€.", documents: JSON.stringify(["Mémorandum confidentiel", "Comptes audités", "Portefeuille clients"]), vendeur: "Mandat M&A Maghreb" },
  { type: "ma", title: "Startup Santé Télémédecine — Partenariat", emetteur: "Fondateurs", pays: "Côte d'Ivoire", devise: "EUR", montant: 1500000, rendement: null, maturite: "Partenariat / levée", risque: "BB", token: "CI-HEALTH-01", description: "Application de télémédecine en Afrique de l'Ouest, 15 000 consultations réalisées. Recherche partenaire hospitalier ou assureur pour le déploiement.", documents: JSON.stringify(["Mémorandum", "Métriques santé", "Conventions partenaires"]), vendeur: "Mandat M&A West Africa" },
  { type: "ma", title: "E-commerce Mode — Recherche acquéreur", emetteur: "Fondatrice", pays: "Égypte", devise: "USD", montant: 1100000, rendement: null, maturite: "Vente", risque: "BB", token: "EG-ECOMM-01", description: "Boutique e-commerce de mode féminine au Caire, 90 000 clients, logistique externalisée, EBITDA positif. Vente complète avec marque et base clients.", documents: JSON.stringify(["Mémorandum", "Données e-commerce", "Comptes"]), vendeur: "Mandat M&A Middle East" },
  { type: "ma", title: "FoodTech — Recherche partenaire industriel", emetteur: "Fondateurs", pays: "Turquie", devise: "USD", montant: 3200000, rendement: null, maturite: "Partenariat industriel", risque: "BB", token: "TR-FOOD-01", description: "Producteur de snacks sains, 3 lignes de production, distribution dans 12 pays. Recherche un partenaire industriel pour l'internationalisation.", documents: JSON.stringify(["Mémorandum", "États financiers", "Contrats distributeurs"]), vendeur: "Mandat M&A Eurasia" },
  { type: "ma", title: "LogTech — Fusion avec acteur logistique", emetteur: "Fondateurs", pays: "Singapour", devise: "USD", montant: 5000000, rendement: null, maturite: "Fusion / rapprochement", risque: "BB+", token: "SG-LOGTECH-01", description: "Startup de gestion de flottes par IA, 300 flottes sous contrat en Asie du Sud-Est. Recherche un rapprochement avec un acteur logistique international.", documents: JSON.stringify(["Mémorandum", "Métriques produit", "Contrats clients"]), vendeur: "Mandat M&A Singapour" },
  { type: "obligation", title: "Obligation Souveraine Rwanda 2034", emetteur: "République du Rwanda", pays: "Rwanda", devise: "USD", montant: 1400000, rendement: 8.0, maturite: "2034", risque: "B+", token: "RW-2034", description: "Eurobond rwandais échéance 2034. Économie en forte croissance, prime de risque élevée, coupon semestriel.", documents: JSON.stringify(["Prospectus", "Analyse pays", "Programme d'émission"]), vendeur: "Africa Fixed Income" },
  { type: "obligation", title: "Obligation Souveraine Ghana 2034", emetteur: "République du Ghana", pays: "Ghana", devise: "USD", montant: 1200000, rendement: 10.8, maturite: "2034", risque: "B-", token: "GH-2034", description: "Eurobond ghanéen échéance 2034. Restructuration achevée, rendement très élevé, coupon semestriel.", documents: JSON.stringify(["Prospectus", "Accord de restructuration", "Analyse pays"]), vendeur: "Africa Fixed Income" },
  { type: "obligation", title: "Obligation Souveraine Nigeria 2033", emetteur: "République fédérale du Nigeria", pays: "Nigeria", devise: "USD", montant: 2300000, rendement: 9.5, maturite: "2033", risque: "B-", token: "NG-2033", description: "Eurobond nigérian échéance 2033. Plus grande économie d'Afrique, coupon semestriel, prime de risque élevée.", documents: JSON.stringify(["Prospectus", "Analyse pays", "Programme FMI"]), vendeur: "Africa Fixed Income" },
  { type: "obligation", title: "Obligation Souveraine Bénin 2032", emetteur: "République du Bénin", pays: "Bénin", devise: "EUR", montant: 1700000, rendement: 7.1, maturite: "2032", risque: "B+", token: "BJ-2032", description: "Eurobond béninois échéance 2032. Pays en réforme avec une discipline budgétaire reconnue, coupon annuel.", documents: JSON.stringify(["Prospectus", "Analyse pays", "Programme d'émission"]), vendeur: "Africa Fixed Income" },
  { type: "obligation", title: "Obligation Souveraine Égypte 2034", emetteur: "République arabe d'Égypte", pays: "Égypte", devise: "USD", montant: 2600000, rendement: 8.9, maturite: "2034", risque: "B", token: "EG-2034", description: "Eurobond égyptien échéance 2034. Coupon semestriel, soutien FMI, rendement attractif sur un grand marché émergent.", documents: JSON.stringify(["Prospectus", "Programme FMI", "Analyse pays"]), vendeur: "MENA Fixed Income Desk" },
  { type: "obligation", title: "Obligation Souveraine Turquie 2034", emetteur: "République de Turquie", pays: "Turquie", devise: "USD", montant: 3000000, rendement: 6.4, maturite: "2034", risque: "BB-", token: "TR-SOV-34", description: "Eurobond turc échéance 2034. Coupon semestriel, accès aux marchés rétabli après la normalisation monétaire.", documents: JSON.stringify(["Prospectus", "Analyse pays", "Notation"]), vendeur: "EM Sovereign Desk" },
  { type: "obligation", title: "Obligation Corporate Telecom Maroc 2029", emetteur: "Opérateur télécoms marocain", pays: "Maroc", devise: "EUR", montant: 1500000, rendement: 5.1, maturite: "2029", risque: "BBB-", token: "MA-TEL-29", description: "Obligation corporate émise par un opérateur télécoms intégré du Maroc. Coupon annuel, notation investment grade régionale.", documents: JSON.stringify(["Term sheet", "États financiers 2025", "Rapport de notation"]), vendeur: "North Africa Desk" },
  { type: "obligation", title: "Obligation Corporate BHP 2031", emetteur: "BHP Group", pays: "Australie", devise: "USD", montant: 3500000, rendement: 4.6, maturite: "2031", risque: "A", token: "AU-BHP-31", description: "Obligation du géant minier BHP, notée A. Coupon annuel, l'une des signatures industrielles les plus solides au monde.", documents: JSON.stringify(["Prospectus", "États financiers", "Rapport de notation"]), vendeur: "Global Corporate Desk" },
  { type: "obligation", title: "Obligation Corporate Aramco 2030", emetteur: "Saudi Aramco", pays: "Arabie saoudite", devise: "USD", montant: 4000000, rendement: 4.3, maturite: "2030", risque: "A", token: "SA-ARAMCO-30", description: "Obligation du géant pétrolier Saudi Aramco, notée A. Coupon annuel, cash-flows très stables, liquidité élevée.", documents: JSON.stringify(["Prospectus", "États financiers", "Rapport de notation"]), vendeur: "Gulf Sovereign Desk" },
  { type: "obligation", title: "Obligation Supranationale AfDB 2030", emetteur: "Banque africaine de développement", pays: "Supranational (Afrique)", devise: "USD", montant: 2800000, rendement: 5.0, maturite: "2030", risque: "AAA", token: "AFDB-2030", description: "Obligation de la Banque africaine de développement, notée AAA. Signature supranationale de premier ordre, impact développement.", documents: JSON.stringify(["Prospectus", "Notation AAA", "Politique ESG"]), vendeur: "Supranational Desk" },
  { type: "obligation", title: "Obligation Corporate Emirates NBD 2028", emetteur: "Emirates NBD Bank", pays: "EAU (Dubaï)", devise: "USD", montant: 2500000, rendement: 4.9, maturite: "2028", risque: "A-", token: "EAU-ENBD-28", description: "Obligation subordonnée de la banque Emirates NBD, plus grande banque des EAU. Coupon annuel, solide assise régionale.", documents: JSON.stringify(["Term sheet", "États financiers", "Rapport de notation"]), vendeur: "Gulf Wealth Partners" },
  { type: "obligation", title: "Obligation Souveraine Afrique du Sud 2032", emetteur: "République d'Afrique du Sud", pays: "Afrique du Sud", devise: "USD", montant: 2100000, rendement: 6.2, maturite: "2032", risque: "BB-", token: "ZA-2032", description: "Eurobond sud-africain échéance 2032. Coupon semestriel, économie la plus industrialisée du continent.", documents: JSON.stringify(["Prospectus", "Analyse pays", "Programme d'émission"]), vendeur: "Africa Fixed Income" },
  { type: "credit", title: "Crédit Commercial Café & Cacao — Cameroun", emetteur: "Pool de créances agro", pays: "Cameroun / Côte d'Ivoire", devise: "EUR", montant: 1100000, rendement: 13.5, maturite: "12 mois", risque: "B", token: "CM-AGRO-01", description: "Créances du négoce café-cacao en Afrique centrale et de l'Ouest. Rendement élevé, recouvrement structuré par spécialistes locaux.", documents: JSON.stringify(["Liste des débiteurs anonymisée", "Statistiques de recouvrement", "Contrats de cession"]), vendeur: "Africa Trade Credit" },
  { type: "credit", title: "Crédit Factoring PME — Dubaï", emetteur: "Fonds de factoring", pays: "EAU (Dubaï)", devise: "USD", montant: 3200000, rendement: 9.0, maturite: "9 mois", risque: "BB+", token: "DBX-FACT-01", description: "Portefeuille de factures PME de la place de Dubaï, cession quotidienne, délégués au recouvrement des grosses places.", documents: JSON.stringify(["Liste des débiteurs anonymisée", "Historique de recouvrement", "Contrat de cession"]), vendeur: "Gulf Receivables Fund" },
  { type: "credit", title: "Crédit Commercial Textile — Asie", emetteur: "Pool de créances export", pays: "Bangladesh / Vietnam", devise: "USD", montant: 3800000, rendement: 8.2, maturite: "12 mois", risque: "BB", token: "BD-TXT-01", description: "Créances d'exportation textile adossées à des lettres de crédit confirmées. Secteur mature, recouvrement bancarisé.", documents: JSON.stringify(["Lettres de crédit", "Liste des débiteurs", "Historique de recouvrement"]), vendeur: "Asia Trade Finance" },
  { type: "credit", title: "Crédit Import Automobile — Afrique de l'Ouest", emetteur: "Pool de créances import", pays: "Sénégal / Côte d'Ivoire / Bénin", devise: "EUR", montant: 2400000, rendement: 11.0, maturite: "18 mois", risque: "BB", token: "WA-AUTO-01", description: "Financement d'importation de véhicules pour distributeurs ouest-africains. Créances adossées aux ventes, recouvrement dédié.", documents: JSON.stringify(["Contrats de financement", "Liste des débiteurs", "Statistiques de recouvrement"]), vendeur: "West Africa Trade Credit" },
  { type: "credit", title: "Crédit Construction — RDC (Kinshasa)", emetteur: "Fonds de créances BTP", pays: "RDC", devise: "USD", montant: 1900000, rendement: 14.0, maturite: "24 mois", risque: "B", token: "CD-CONS-01", description: "Créances du secteur de la construction à Kinshasa, hypothèques et sûretés réelles constituées, marché en expansion.", documents: JSON.stringify(["Hypothèques constituées", "Évaluations immobilières", "Structure du pool"]), vendeur: "Central Africa Credit" },
  { type: "credit", title: "Crédit Commercial Pêche — Mauritanie", emetteur: "Pool de créances halieutiques", pays: "Mauritanie", devise: "EUR", montant: 950000, rendement: 12.0, maturite: "12 mois", risque: "B+", token: "MR-FISH-01", description: "Créances des exportateurs de produits de la mer de Nouadhibou, adossées aux contrats d'exportation vers l'Europe.", documents: JSON.stringify(["Contrats de vente", "Liste des débiteurs", "Statistiques de recouvrement"]), vendeur: "Mauritania Trade Finance" },
  { type: "credit", title: "Crédit DPP Pétrolier — Congo", emetteur: "Fonds de créances énergie", pays: "Congo-Brazzaville", devise: "USD", montant: 4200000, rendement: 11.5, maturite: "6 mois", risque: "B", token: "CG-OIL-01", description: "Créances adossées à des documents pétroliers (DPP) de cargo brut, cycle court, garanties documentaires.", documents: JSON.stringify(["Lettre de crédit", "Contrats de vente", "Structure du pool"]), vendeur: "Energy Trade Credit" },
  { type: "credit", title: "Crédit Microfinance — Ouganda", emetteur: "Fonds de microfinance", pays: "Ouganda", devise: "USD", montant: 800000, rendement: 13.0, maturite: "24 mois", risque: "B", token: "UG-MICRO-01", description: "Pool de micro-crédits accordés par un réseau d'IMF ougandaises. Diversification élevée, rendement social et financier.", documents: JSON.stringify(["Rapport de l'IMF", "Statistiques de remboursement", "Analyse du pool"]), vendeur: "Impact Credit Partners" },
  { type: "hedgefund", title: "Fonds Bureaux Green — Francfort", emetteur: "Frankfurt Green Office Fund", pays: "Allemagne", devise: "EUR", montant: 5500000, rendement: 6.8, maturite: "6 ans", risque: "BBB+", token: "DE-OFF-01", description: "Immeubles de bureaux certifiés green à Francfort, locataires bancaires de long terme, rénovation énergétique en cours.", documents: JSON.stringify(["Livre blanc du fonds", "Contrats de location", "États financiers"]), vendeur: "Frankfurt Green Office", minimum: 25000 },
  { type: "hedgefund", title: "Fonds Data Centers — Amsterdam", emetteur: "Euro Datacenter Fund", pays: "Pays-Bas", devise: "EUR", montant: 7000000, rendement: 8.5, maturite: "7 ans", risque: "BB+", token: "NL-DC-01", description: "Infrastructures data center en périphérie d'Amsterdam, contrats d'hébergement cloud de long terme, demande en forte hausse.", documents: JSON.stringify(["Livre blanc", "Contrats clients", "États financiers"]), vendeur: "Euro Datacenter Fund", minimum: 30000 },
  { type: "hedgefund", title: "Fonds Logistique GCC — Distribution", emetteur: "GCC Logistics Real Fund", pays: "EAU / Arabie saoudite", devise: "USD", montant: 6500000, rendement: 9.2, maturite: "6 ans", risque: "BB", token: "GCC-LOG-01", description: "Entrepôts logistiques dans les hubs du Golfe, locataires e-commerce et FMCG, taux d'occupation supérieur à 92 %.", documents: JSON.stringify(["Livre blanc du fonds", "Contrats de location", "Cashflow projections"]), vendeur: "GCC Logistics Real", minimum: 20000 },
  { type: "hedgefund", title: "Fonds Résidentiel — Riyad", emetteur: "Riyadh Living Fund", pays: "Arabie saoudite", devise: "USD", montant: 5000000, rendement: 8.0, maturite: "5 ans", risque: "BB+", token: "SA-RES-01", description: "Résidences de standing à Riyad portées par la croissance démographique et la Vision 2030. Distribution semestrielle.", documents: JSON.stringify(["Rapport de gestion", "Évaluations immobilières", "États financiers"]), vendeur: "Riyadh Living", minimum: 15000 },
  { type: "hedgefund", title: "Fonds Retail — Lagos", emetteur: "Lagos Retail Fund", pays: "Nigeria", devise: "USD", montant: 4500000, rendement: 11.5, maturite: "7 ans", risque: "B+", token: "NG-RET-01", description: "Centres commerciaux et surfaces retail à Lagos, locataires internationaux, rendement attractif sur le plus grand marché africain.", documents: JSON.stringify(["Livre blanc", "Contrats de location", "États financiers"]), vendeur: "Lagos Retail Fund", minimum: 10000 },
  { type: "hedgefund", title: "Fonds Hôtelier — Bali", emetteur: "Bali Hospitality Fund", pays: "Indonésie", devise: "USD", montant: 4800000, rendement: 10.0, maturite: "6 ans", risque: "BB", token: "ID-HOT-01", description: "Villas et hôtels-boutique à Bali et Lombok, gestion opérateur, revenus touristiques en croissance.", documents: JSON.stringify(["Offre de souscription", "Contrats de gestion", "Cashflow projections"]), vendeur: "Bali Hospitality", minimum: 20000 },
  { type: "immobilier", title: "Villa avec Piscine — Marrakech", emetteur: "Particulier", pays: "Maroc", devise: "EUR", montant: 1200000, rendement: null, maturite: "Vente directe", risque: "BB+", token: "MA-MRK-01", description: "Villa de 4 chambres avec jardin et piscine dans le quartier de l'Aguedal, titres de propriété en règle, notaire conseil inclus.", documents: JSON.stringify(["Titre de propriété", "Évaluation notariale", "Certificat de propriété"]), vendeur: "Marrakech Property Mandate" },
  { type: "immobilier", title: "Appartement Vue Mer — Nice", emetteur: "Famille investisseuse", pays: "France", devise: "EUR", montant: 1800000, rendement: null, maturite: "Vente directe", risque: "A", token: "FR-NICE-01", description: "Appartement de 5 pièces en front de mer sur la Promenade, immeuble de standing, cave et parking.", documents: JSON.stringify(["Titre de propriété", "Diagnostics", "Évaluation expert"]), vendeur: "Côte d'Azur Properties" },
  { type: "immobilier", title: "Duplex — Abidjan Riviera", emetteur: "Particulier", pays: "Côte d'Ivoire", devise: "EUR", montant: 850000, rendement: null, maturite: "Vente directe", risque: "BB", token: "CI-ABJ-01", description: "Duplex de 4 chambres dans la Riviera Golf, résidence sécurisée avec piscine, documents fonciers en règle.", documents: JSON.stringify(["Titre de propriété", "Évaluation", "Certificat foncier"]), vendeur: "Abidjan Homes" },
  { type: "immobilier", title: "Ferme Viticole — Toscane", emetteur: "Famille toscane", pays: "Italie", devise: "EUR", montant: 3200000, rendement: null, maturite: "Vente directe", risque: "BBB", token: "IT-TOS-01", description: "Domaine viticole de 12 ha avec maison de maître et chais, production DOC, réputation établie, gérance possible.", documents: JSON.stringify(["Acte de propriété", "Évaluation agronomique", "Baux et contrats"]), vendeur: "Tuscan Estate Mandate" },
  { type: "immobilier", title: "Tour de Bureaux — Casablanca", emetteur: "Fonds immobilier", pays: "Maroc", devise: "EUR", montant: 4500000, rendement: 7.5, maturite: "Vente directe", risque: "BB+", token: "MA-CAS-01", description: "Immeuble de bureaux de 6 étages au cœur de Casablanca, loué à 100 % à des sociétés internationales, rendement 7,5 %.", documents: JSON.stringify(["Baux en cours", "Diagnostics techniques", "Évaluation expert"]), vendeur: "Casablanca Corporate Real Estate" },
  { type: "immobilier", title: "Maison de Plage — Dakar Almadies", emetteur: "Particulier", pays: "Sénégal", devise: "EUR", montant: 950000, rendement: null, maturite: "Vente directe", risque: "BB", token: "SN-DAK-01", description: "Maison de 3 chambres face à l'océan aux Almadies, Dakar. Titre foncier en règle, potentiel de location saisonnière.", documents: JSON.stringify(["Titre foncier", "Évaluation", "Certificat de propriété"]), vendeur: "Dakar Properties" },
  { type: "immobilier", title: "Appartement Investissement — Lisbonne", emetteur: "Fonds famille", pays: "Portugal", devise: "EUR", montant: 480000, rendement: 5.8, maturite: "Vente directe", risque: "BBB", token: "PT-LIS-01", description: "Appartement rénové de 2 chambres dans le quartier de Baixa, loué à long terme, rendement net 5,8 %.", documents: JSON.stringify(["Titre de propriété", "Bail en cours", "Évaluation expert"]), vendeur: "Lisbon Investment Homes" },
  { type: "immobilier", title: "Complexe Résidentiel — Kigali", emetteur: "Promoteur", pays: "Rwanda", devise: "USD", montant: 2800000, rendement: 9.0, maturite: "Vente / clés en main", risque: "BB", token: "RW-KIG-01", description: "Résidence de 24 appartements en cours de finition à Kigali, pré-louée à 70 %, rendement locatif projeté 9 %.", documents: JSON.stringify(["Plans du projet", "Pré-ventes / baux", "Étude de marché"]), vendeur: "Kigali Urban Development" },
  { type: "usine", title: "Usine Textile — Bangladesh (Dacca)", emetteur: "Groupe textile exportateur", pays: "Bangladesh", devise: "USD", montant: 4800000, rendement: null, maturite: "Vente directe", risque: "BB", token: "BD-TXT-US-01", description: "Usine de confection de 10 000 m² à Dacca, capacité 150 000 pièces/mois, certification BSCI, contrats export Europe et USA.", documents: JSON.stringify(["Fiche technique", "Contrats de production", "Certifications"]), vendeur: "Asia Industrial Mandate" },
  { type: "usine", title: "Usine Plasturgie — Vietnam", emetteur: "Groupe industriel", pays: "Vietnam", devise: "USD", montant: 5200000, rendement: null, maturite: "Vente directe", risque: "BB+", token: "VN-PLAST-01", description: "Unité d'injection plastique de 7 000 m² près d'Hô Chi Minh-Ville, 40 presses, clients électronique et automobile.", documents: JSON.stringify(["Fiche technique", "Bilans 3 ans", "Liste des machines"]), vendeur: "Asia Industrial Mandate" },
  { type: "usine", title: "Unité Agro — Éthiopie (Addis)", emetteur: "PME industrielle", pays: "Éthiopie", devise: "USD", montant: 3400000, rendement: null, maturite: "Vente / partenariat", risque: "B+", token: "ET-AGRO-01", description: "Unité de transformation de céréales et légumineuses à Addis-Abeba, chaîne de 2 000 m², marché local en expansion.", documents: JSON.stringify(["Fiche technique", "Bilans 3 ans", "Certificats sanitaires"]), vendeur: "East Africa Business Mandate" },
  { type: "usine", title: "Usine Pharmaceutique — Jordanie", emetteur: "Groupe pharmaceutique", pays: "Jordanie", devise: "USD", montant: 7500000, rendement: null, maturite: "Vente directe", risque: "BB+", token: "JO-PHARMA-01", description: "Site de production pharmaceutique certifié GMP de 8 500 m², portefeuille de 60 références, marchés MENA et Afrique.", documents: JSON.stringify(["Fiche technique", "Certifications GMP", "États financiers"]), vendeur: "MENA Industry Mandate" },
  { type: "usine", title: "Usine Emballage — Johannesburg", emetteur: "Groupe emballage", pays: "Afrique du Sud", devise: "USD", montant: 6100000, rendement: null, maturite: "Vente directe", risque: "BB+", token: "ZA-PACK-01", description: "Unité de production d'emballages carton de 9 000 m², clients miniers et FMCG, double ligne automatisée.", documents: JSON.stringify(["Fiche technique", "Contrats clients", "Bilans audités"]), vendeur: "Southern Africa Mandate" },
  { type: "marque", title: "Marque K-Beauty — Cosmétiques", emetteur: "Fondateurs", pays: "Corée du Sud", devise: "USD", montant: 4200000, rendement: null, maturite: "Cession de marque", risque: "BB+", token: "MOD-KB-01", description: "Marque de cosmétiques coréenne avec e-commerce international et distributeurs en Asie et Europe, R&D intégrée.", documents: JSON.stringify(["Valorisation de marque", "Données e-commerce", "Contrats de distribution"]), vendeur: "Asia Brands Mandate" },
  { type: "marque", title: "Marque Hôtellerie Boutique — Bali", emetteur: "Fondateurs", pays: "Indonésie", devise: "USD", montant: 2900000, rendement: null, maturite: "Cession / management", risque: "BB", token: "MOD-HOT-01", description: "Marque d'hôtels-boutique avec 3 établissements gérés et une pipeline de développement dans le Sud-Est asiatique.", documents: JSON.stringify(["Valorisation", "Contrats de gestion", "États financiers"]), vendeur: "Asia Brands Mandate" },
  { type: "marque", title: "Marque Snacks — Afrique de l'Ouest", emetteur: "Fondatrice", pays: "Nigeria / Ghana", devise: "USD", montant: 1300000, rendement: null, maturite: "Cession de marque", risque: "BB", token: "MOD-SNK-01", description: "Marque de snacks naturels distribuée en grande distribution et e-commerce en Afrique de l'Ouest, croissance à 2 chiffres.", documents: JSON.stringify(["Valorisation de marque", "Données de vente", "Contrats distributeurs"]), vendeur: "Africa Brands Mandate" },
  { type: "marque", title: "Marque Parfums — Golfe", emetteur: "Fondateur", pays: "EAU (Dubaï)", devise: "USD", montant: 3600000, rendement: null, maturite: "Cession de marque", risque: "BB+", token: "MOD-PRF-01", description: "Maison de parfums de niche du Golfe, présence retail dans 6 pays et e-commerce, fragrances exclusives sous contrat.", documents: JSON.stringify(["Valorisation de marque", "Données de vente", "Contrats de distribution"]), vendeur: "Gulf Brands Mandate" },
  { type: "ma", title: "SaaS RH — Recherche acquéreur", emetteur: "Fondateurs", pays: "France", devise: "EUR", montant: 3500000, rendement: null, maturite: "Vente", risque: "BB+", token: "FR-SASRH-01", description: "Logiciel RH pour PME, 180 clients, MRR 90 k€, churn faible. Vente majoritaire avec plan d'intéressement pour l'équipe.", documents: JSON.stringify(["Mémorandum", "Métriques SaaS", "Business plan"]), vendeur: "Mandat M&A Europe" },
  { type: "ma", title: "Startup AgriTech — Levée de fonds", emetteur: "Fondateurs", pays: "Nigeria", devise: "USD", montant: 2000000, rendement: null, maturite: "Levée de fonds", risque: "BB", token: "NG-AGRITECH-01", description: "Plateforme de financement des petits agriculteurs via mobile money, 25 000 exploitations financées, agréments en cours.", documents: JSON.stringify(["Mémorandum", "Métriques d'usage", "Business plan"]), vendeur: "Mandat M&A West Africa" },
  { type: "ma", title: "Compagnie de Bus — Rapprochement", emetteur: "Groupe fondateur", pays: "Kenya", devise: "USD", montant: 4200000, rendement: null, maturite: "Fusion / rapprochement", risque: "BB", token: "KE-BUS-01", description: "Opérateur de transport interurbain au Kenya, 80 véhicules, lignes rentables. Recherche un rapprochement avec un acteur régional.", documents: JSON.stringify(["Mémorandum confidentiel", "États financiers", "Licences d'exploitation"]), vendeur: "Mandat M&A East Africa" },
  { type: "ma", title: "Réseau de Cliniques Dentaires — Recherche acquéreur", emetteur: "Groupe médical", pays: "EAU (Dubaï)", devise: "USD", montant: 5000000, rendement: null, maturite: "Vente", risque: "BB+", token: "EAU-DENT-01", description: "Réseau de 5 cliniques dentaires à Dubaï et Abu Dhabi, patientèle premium, équipement dernière génération.", documents: JSON.stringify(["Mémorandum confidentiel", "Bilans audités", "Licences médicales"]), vendeur: "Mandat M&A Gulf" },
  { type: "ma", title: "Startup CleanTech — Levée de fonds", emetteur: "Fondateurs", pays: "Singapour", devise: "USD", montant: 3000000, rendement: null, maturite: "Levée de fonds", risque: "BB+", token: "SG-CLEAN-01", description: "Technologie de recyclage des eaux industrielles, 12 installations déployées en Asie du Sud-Est, série A en préparation.", documents: JSON.stringify(["Mémorandum", "Métriques produit", "Business plan"]), vendeur: "Mandat M&A Singapour" },
  { type: "ma", title: "Distributeur Pharmaceutique — Partenariat", emetteur: "Groupe familial", pays: "Côte d'Ivoire", devise: "EUR", montant: 6800000, rendement: null, maturite: "Partenariat", risque: "BB", token: "CI-PHARMA-01", description: "Distribution pharmaceutique en Afrique de l'Ouest, 3 entrepôts certifiés, 400 pharmacies clients. Recherche partenaire industriel.", documents: JSON.stringify(["Mémorandum confidentiel", "États financiers", "Contrats fournisseurs"]), vendeur: "Mandat M&A West Africa" },
  { type: "ma", title: "Plateforme E-learning — Fusion", emetteur: "Fondateurs", pays: "Inde", devise: "USD", montant: 7500000, rendement: null, maturite: "Fusion / rapprochement", risque: "BB+", token: "IN-EDTECH-01", description: "Plateforme de formation en ligne indienne, 2 millions d'apprenants, recherche fusion avec un éditeur international.", documents: JSON.stringify(["Mémorandum", "Métriques d'usage", "États financiers"]), vendeur: "Mandat M&A Asia" },
  { type: "ma", title: "Chocolaterie Artisanale — Vente", emetteur: "Maître artisan", pays: "Belgique", devise: "EUR", montant: 2400000, rendement: null, maturite: "Vente", risque: "BBB", token: "BE-CHOC-01", description: "Chocolaterie artisanale de renom à Bruxelles, atelier et 3 boutiques, export vers l'Asie, notoriété internationale.", documents: JSON.stringify(["Mémorandum confidentiel", "Comptes audités", "Contrats export"]), vendeur: "Mandat M&A Europe" },
  { type: "commodity", title: "Contrat Coton — Afrique de l'Ouest", emetteur: "Exportateur / coopérative", pays: "Burkina Faso / Mali", devise: "USD", montant: 1100000, rendement: null, maturite: "Campagne en cours", risque: "BB", token: "COTTON-WA-01", description: "Coton fibre standard, 2 000 tonnes, livraison FOB. Certificat qualité, inspection, financement documentaire possible.", documents: JSON.stringify(["Certificat qualité", "Contrat type", "Inspection"]), vendeur: "West Africa Cotton Trade" },
  { type: "commodity", title: "Contrat Huile d'Olive — Tunisie", emetteur: "Coopérative / exportateur", pays: "Tunisie", devise: "EUR", montant: 1600000, rendement: null, maturite: "Campagne en cours", risque: "BBB", token: "OLIVE-TN-01", description: "Huile d'olive vierge extra, 300 tonnes, livraison FOB Sfax ou CIF Europe. Certificats d'analyse et d'origine inclus.", documents: JSON.stringify(["Analyse qualité", "Certificat d'origine", "Fiche produit"]), vendeur: "Tunisian Olive House" },
  { type: "commodity", title: "Contrat Acier — Turquie", emetteur: "Producteur / exportateur", pays: "Turquie", devise: "USD", montant: 2900000, rendement: null, maturite: "Cargaison 3 semaines", risque: "BB+", token: "STEEL-TR-01", description: "Bobines laminées à chaud, 8 000 tonnes, livraison FOB Iskenderun. Certificats d'analyse mill, inspection tierce.", documents: JSON.stringify(["Mill certificate", "Contrat type", "Inspection"]), vendeur: "Iskenderun Steel Trading" },
  { type: "commodity", title: "Contrat Bananes — Équateur", emetteur: "Exportateur équatorien", pays: "Équateur", devise: "USD", montant: 1800000, rendement: null, maturite: "Cargaison 2-3 semaines", risque: "BB+", token: "BAN-EC-01", description: "Bananes qualité export, 4 000 boîtes équivalent, livraison CIF. Certificats sanitaires et GlobalGAP inclus.", documents: JSON.stringify(["Certificat GlobalGAP", "Certificat sanitaire", "Fiche produit"]), vendeur: "Guayaquil Fruit Export" },
  { type: "commodity", title: "Contrat Thé — Kenya", emetteur: "Coopérative de planteurs", pays: "Kenya", devise: "USD", montant: 950000, rendement: null, maturite: "Vente aux enchères / récolte", risque: "BB", token: "TEA-KE-01", description: "Thé noir CTC des hauts plateaux kenyans, 400 tonnes, vente via Mombasa Auction. Traçabilité et grade certifiés.", documents: JSON.stringify(["Grade certificate", "Certificat d'origine", "Fiche lot"]), vendeur: "East Africa Tea Export" },
  { type: "commodity", title: "Contrat Noix de Cajou — Côte d'Ivoire", emetteur: "Coopérative / exportateur", pays: "Côte d'Ivoire", devise: "USD", montant: 1400000, rendement: null, maturite: "Campagne en cours", risque: "BB", token: "CAJOU-CI-01", description: "Noix de cajou brutes (RCN), 1 000 tonnes, livraison FOB Abidjan. Grade export, analyse d'humidité incluse.", documents: JSON.stringify(["Analyse qualité", "Certificat d'origine", "Fiche produit"]), vendeur: "Ivorian Cashew Trade" },
  { type: "commodity", title: "Contrat Aluminium — Canada", emetteur: "Fonderie exportatrice", pays: "Canada", devise: "USD", montant: 4100000, rendement: null, maturite: "Cargaison 3-4 semaines", risque: "A-", token: "AL-CA-01", description: "Aluminium primaire haute pureté, 2 000 tonnes, livraison CIF port européen. Certificats de qualité et inspection SGS.", documents: JSON.stringify(["Certificat de qualité", "Lettre de crédit", "Contrat de vente"]), vendeur: "Quebec Metals Trading" },
  { type: "commodity", title: "Contrat Urée — Algérie", emetteur: "Producteur / distributeur", pays: "Algérie", devise: "USD", montant: 2300000, rendement: null, maturite: "Livraison 4-6 semaines", risque: "BB+", token: "UREA-DZ-01", description: "Urée granulaire 46 %, 9 000 tonnes, livraison FOB Arzew ou CIF Afrique. Certificats d'analyse inclus.", documents: JSON.stringify(["Certificat d'analyse", "Lettre de crédit", "Fiche produit"]), vendeur: "Mediterranean Fertilizer Trade" },
  { type: "commodity", title: "Contrat GNL — Algérie", emetteur: "Producteur gazier", pays: "Algérie", devise: "USD", montant: 3200000, rendement: null, maturite: "Fenêtre de livraison", risque: "BBB", token: "LNG-DZ-01", description: "Cargaison GNL algérien, livraison Méditerranée ou Asie. Origine stable, indexation marché, inspection tierce.", documents: JSON.stringify(["Term sheet", "Lettre de commodité", "Cadre logistique"]), vendeur: "Mediterranean LNG Desk" },
  { type: "commodity", title: "Contrat Sésame — Soudan", emetteur: "Exportateur", pays: "Soudan", devise: "USD", montant: 1200000, rendement: null, maturite: "Campagne en cours", risque: "B+", token: "SES-SD-01", description: "Sésame standard ou humera, 800 tonnes, livraison FOB Port-Soudan. Analyse qualité et certificat d'origine inclus.", documents: JSON.stringify(["Analyse qualité", "Certificat d'origine", "Fiche produit"]), vendeur: "Khartoum Seeds Export" },
  { type: "commodity", title: "Contrat Café Robusta — Vietnam", emetteur: "Exportateur vietnamien", pays: "Vietnam", devise: "USD", montant: 1500000, rendement: null, maturite: "Récolte en cours", risque: "BB+", token: "COFF-VN-01", description: "Robusta grade 2, 600 tonnes, livraison FOB Saigon. Traçabilité, classement qualité, inspection tierce disponible.", documents: JSON.stringify(["Rapport de dégustation", "Certificat d'origine", "Fiche lot"]), vendeur: "Saigon Coffee Export" },
  { type: "commodity", title: "Contrat Or — Dubaï (lingots)", emetteur: "Affineur / courtier", pays: "EAU (Dubaï)", devise: "USD", montant: 5500000, rendement: null, maturite: "Livraison 7 jours", risque: "A", token: "AU-DBX-01", description: "Lingots d'or certifiés LBMA stockés à Dubaï, 80 kg. Transaction sécurisée avec dépôt fiduciaire et contrôle.", documents: JSON.stringify(["Certificat LBMA", "Valuation", "Accord de dépôt"]), vendeur: "Dubai Metal Desk" },
  { type: "commodity", title: "Contrat Diamants — Angola", emetteur: "Mineur / courtier", pays: "Angola", devise: "USD", montant: 2700000, rendement: null, maturite: "Livraison 15-30 jours", risque: "B+", token: "DIA-AO-01", description: "Diamants bruts certifiés Kimberley, livraison Lucapa ou Luanda. Processus de contrôle et traçabilité complet.", documents: JSON.stringify(["Certificat Kimberley", "Valuation", "Contrat de vente"]), vendeur: "Luanda Gem Trade" },
  { type: "commodity", title: "Contrat Charbon Thermique — Indonésie", emetteur: "Mineur / trader", pays: "Indonésie", devise: "USD", montant: 3800000, rendement: null, maturite: "Cargaison 3-4 semaines", risque: "BB", token: "COAL-ID-01", description: "Charbon thermique 5 500 kcal, 50 000 tonnes, livraison CIF. Certificats d'analyse, inspection au chargement.", documents: JSON.stringify(["Analyse calorifique", "Lettre de crédit", "Contrat de vente"]), vendeur: "Jakarta Coal Trading" }
];

const rowCount = db.prepare("SELECT COUNT(*) AS c FROM assets").get().c;
const VERIFIED_TOKENS = new Set(["SN-2032","DLG-2029","AU-100KG","PPA-EUR-01","WHEAT-1","BRENT-Q3","LNG-JKM-01","DRA-PART-01","PJ-VILLA-01","QA-SOV-31","SG-SOV-30","UST-10Y","FR-OAT-34","CI-2033","DBX-EN-28","QA-KAT-01","CN-LOG-01","SG-REIT-01","OM-SOV-29","AFDB-2030","SA-ARAMCO-30","AU-BHP-31","DE-OFF-01","NL-DC-01","MA-MRK-01","FR-NICE-01","IT-TOS-01","MOD-KB-01","CI-PHARMA-01","OLIVE-TN-01","COTTON-WA-01","AL-CA-01"]);

if (rowCount === 0) {
  const ins = db.prepare(`INSERT INTO assets (type,title,emetteur,pays,devise,montant,rendement,maturite,risque,token,description,documents,vendeur,minimum,verifie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const a of seedAssets) {
    ins.run(a.type, a.title, a.emetteur, a.pays, a.devise, a.montant, a.rendement, a.maturite, a.risque, a.token, a.description, a.documents, a.vendeur, a.minimum ?? null, VERIFIED_TOKENS.has(a.token) ? 1 : 0);
  }
  console.log("[DB] Actifs de démonstration insérés.");
}

const insAsset = db.prepare(`INSERT INTO assets (type,title,emetteur,pays,devise,montant,rendement,maturite,risque,token,description,documents,vendeur,minimum,verifie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
let inserted = 0;
for (const a of seedAssets) {
  const exists = db.prepare("SELECT id FROM assets WHERE token = ?").get(a.token);
  if (!exists) {
    insAsset.run(a.type, a.title, a.emetteur, a.pays, a.devise, a.montant, a.rendement, a.maturite, a.risque, a.token, a.description, a.documents, a.vendeur, a.minimum ?? null, VERIFIED_TOKENS.has(a.token) ? 1 : 0);
    inserted++;
  }
}
if (inserted > 0) console.log(`[DB] ${inserted} nouvelle(s) offre(s) ajoutée(s).`);

const MODE_BY_TOKEN = {
  "MOR-USINE-01": "vente", "MOD-PR-01": "vente", "WA-LOG-01": "vente", "ES-VET-01": "vente",
  "CN-SZ-01": "vente", "DBX-FOOD-01": "vente", "MOD-AF-01": "vente", "CN-EU-LOG": "fusion",
  "SG-TECH-01": "partenariat", "QA-MED-01": "partenariat",
  "DZ-ORN-01": "vente", "TN-MON-01": "vente", "CI-BEV-01": "partenariat", "TR-MET-01": "vente",
  "MOD-COS-01": "vente", "MOD-REST-01": "vente", "MOD-SPT-01": "vente", "FR-GASTRO-01": "vente",
  "MA-HOT-01": "partenariat", "WA-TRANS-01": "partenariat", "FR-FINTECH-01": "financement",
  "EG-AGRO-01": "vente", "DBX-BK-01": "partenariat", "MOD-CAFE-01": "vente",
  "SN-FINTECH-01": "financement", "FR-EDTECH-01": "financement", "MA-DIGITAL-01": "vente",
  "CI-HEALTH-01": "partenariat", "EG-ECOMM-01": "vente", "TR-FOOD-01": "partenariat", "SG-LOGTECH-01": "fusion",
  "BD-TXT-US-01": "vente", "VN-PLAST-01": "vente", "ET-AGRO-01": "partenariat", "JO-PHARMA-01": "vente",
  "ZA-PACK-01": "vente", "MOD-KB-01": "vente", "MOD-HOT-01": "vente", "MOD-SNK-01": "vente",
  "MOD-PRF-01": "vente", "FR-SASRH-01": "vente", "NG-AGRITECH-01": "financement", "KE-BUS-01": "fusion",
  "EAU-DENT-01": "vente", "SG-CLEAN-01": "financement", "CI-PHARMA-01": "partenariat",
  "IN-EDTECH-01": "fusion", "BE-CHOC-01": "vente"
};
let modeUpdated = 0;
const updMode = db.prepare("UPDATE assets SET mode = ? WHERE token = ?");
for (const [token, mode] of Object.entries(MODE_BY_TOKEN)) {
  const r = updMode.run(mode, token);
  if (r.changes > 0) modeUpdated++;
}
if (modeUpdated > 0) console.log(`[DB] ${modeUpdated} offre(s) classée(s) (vente / fusion / partenariat / financement).`);

const seedNeeds = [
  { category: "credit", title: "Crédit d'équipement — Menuiserie industrielle", amount: 180000, currency: "EUR", purpose: "Achat de machines CNC et agrandissement de l'atelier", description: "Entreprise artisanale à Lyon cherche un financement de 180 000 € sur 5 ans pour moderniser son outil de production et doubler sa capacité.", region: "Europe", status: "active" },
  { category: "financement", title: "Financement pré-export — Cacao Côte d'Ivoire", amount: 750000, currency: "USD", purpose: "Campagne d'achat auprès des coopératives", description: "Exportateur ivoirien cherche un préfinancement de campagne (750 000 USD) adossé à des contrats de vente signés avec des négociants européens.", region: "Afrique", status: "active" },
  { category: "credit", title: "Crédit immobilier — Acquisition entrepôt logistique", amount: 1250000, currency: "EUR", purpose: "Achat d'un entrepôt de 4 000 m² près de Rotterdam", description: "PME logistique cherche un crédit immobilier à hauteur de 1 250 000 € sur 12 ans. Baux de location confirmés avec deux clients majeurs.", region: "Europe", status: "active" },
  { category: "financement", title: "Levée de fonds — Clinique vétérinaire réseau", amount: 600000, currency: "EUR", purpose: "Ouverture de 3 nouvelles agences en Afrique de l'Ouest", description: "Réseau de cliniques vétérinaires (2 sites à Dakar) recherche 600 000 € pour s'étendre à Abidjan, Bamako et Conakry. Bilan rentable depuis 3 ans.", region: "Afrique", status: "active" },
  { category: "credit", title: "Crédit de trésorerie — Import distributeur", amount: 300000, currency: "USD", purpose: "Financement d'un stock d'importation de produits électroniques", description: "Distributeur à Dubaï cherche une ligne de financement court terme de 300 000 USD, garantie par les contrats clients et la marchandise.", region: "Golfe", status: "active" }
];
const seedBankOffers = [
  { bank: "Bank of Africa", product: "Prêt d'équipement PME", range_min: 50000, range_max: 1000000, currency: "EUR", rate: 7.5, purpose: "Machines, véhicules, immobilier d'exploitation — jusqu'à 7 ans, garantie BPI possible", region: "Afrique" },
  { bank: "UBA — United Bank for Africa", product: "Préfinancement export", range_min: 250000, range_max: 5000000, currency: "USD", rate: 8.2, purpose: "Préfinancement des campagnes agricoles et contrats export (cacao, coton, café)", region: "Afrique" },
  { bank: "Attijariwafa Bank", product: "Crédit d'investissement", range_min: 100000, range_max: 3000000, currency: "EUR", rate: 6.1, purpose: "Acquisition d'actifs industriels, immobilier professionnel, développement international", region: "Afrique" },
  { bank: "Qatar National Bank", product: "Financement du commerce — LCB", range_min: 500000, range_max: 15000000, currency: "USD", rate: 5.4, purpose: "Lettres de crédit, financement d'import/export vers l'Asie et l'Afrique", region: "Golfe" },
  { bank: "OCBC Bank", product: "Prêt immobilier professionnel", range_min: 300000, range_max: 8000000, currency: "USD", rate: 4.6, purpose: "Achat d'entrepôts, bureaux et actifs logistiques en Asie — jusqu'à 70 % du projet", region: "Asie" },
  { bank: "DBS Bank", product: "Financement PME technologique", range_min: 100000, range_max: 5000000, currency: "USD", rate: 5.1, purpose: "Croissance SaaS / fintech, dette de croissance, apport possible avec fonds d'investissement", region: "Asie" }
];

const needCount = db.prepare("SELECT COUNT(*) AS c FROM needs").get().c;
if (needCount === 0) {
  const ins = db.prepare("INSERT INTO needs (category,title,amount,currency,purpose,description,region,status) VALUES (?,?,?,?,?,?,?,?)");
  for (const n of seedNeeds) ins.run(n.category, n.title, n.amount, n.currency, n.purpose, n.description, n.region, n.status);
  console.log("[DB] Besoins de démonstration insérés.");
}
const offerCount = db.prepare("SELECT COUNT(*) AS c FROM bank_offers").get().c;
if (offerCount === 0) {
  const ins = db.prepare("INSERT INTO bank_offers (bank,product,range_min,range_max,currency,rate,purpose,region) VALUES (?,?,?,?,?,?,?,?)");
  for (const o of seedBankOffers) ins.run(o.bank, o.product, o.range_min, o.range_max, o.currency, o.rate, o.purpose, o.region);
  console.log("[DB] Opportunités bancaires de démonstration insérées.");
}

const adminEmail = "admin@aureusrwa.com";
const existingAdmin = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
if (!existingAdmin) {
  const pass = "admin2026";
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pass, salt, 64).toString("hex");
  db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)").run(adminEmail, "Administrateur", `${salt}:${hash}`, "admin");
  console.log(`[DB] Compte admin créé : ${adminEmail} / ${pass}`);
}

function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pass, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(pass, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(pass, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)").run(token, userId);
  return token;
}
function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token);
  return row || null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) { reject(new Error("Trop grand")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); } });
    req.on("error", reject);
  });
}

function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const rateBuckets = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; rateBuckets.set(key, b); }
  b.count++;
  return b.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
}, 60000).unref();

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket.remoteAddress || "unknown";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf",
  ".rtf": "application/rtf", ".eml": "text/plain"
};

function serveStatic(dir) {
  return (url, res) => {
    let rel = decodeURIComponent(url.split("?")[0]);
    if (rel === "/" ) rel = "/index.html";
    let file = path.join(dir, rel);
    if (!file.startsWith(dir)) { res.writeHead(403); res.end("Forbidden"); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("Not found"); return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  };
}

function getAssets(statut) {
  const rows = db.prepare("SELECT * FROM assets WHERE statut = ? ORDER BY id DESC").all(statut || "publie");
  return rows.map((r) => ({ ...r, documents: r.documents ? JSON.parse(r.documents) : [] }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const cookies = (req.headers.cookie || "").split(";").map((c) => c.trim()).filter(Boolean);
  const getCookie = (n) => { const c = cookies.find((x) => x.startsWith(n + "=")); return c ? c.slice(n.length + 1) : null; };
  const token = getCookie(COOKIE_NAME);
  const user = getSessionUser(token);
  const isAdmin = user && user.role === "admin";

  if (p === "/admin" || p.startsWith("/admin/")) {
    if (p === "/admin/api/check") return sendJSON(res, 200, { ok: !!user, isAdmin: !!isAdmin, user: user ? { name: user.name, email: user.email, role: user.role } : null });
    if (p.startsWith("/admin/api/")) {
      if (p === "/admin/api/login") {
        if (rateLimited(clientIp(req) + "|adminlogin", 10, 10 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: "Trop de tentatives. Réessayez plus tard." });
        const b = await readBody(req);
        const u = db.prepare("SELECT * FROM users WHERE email = ?").get((b.email || "").toLowerCase());
        if (u && u.role === "admin" && verifyPassword(b.password || "", u.password_hash)) {
          res.setHeader("Set-Cookie", `${COOKIE_NAME}=${createSession(u.id)}; HttpOnly; Path=/; Max-Age=2592000`);
          return sendJSON(res, 200, { ok: true });
        }
        return sendJSON(res, 401, { ok: false, error: "Identifiants invalides." });
      }
      if (!isAdmin) return sendJSON(res, 401, { ok: false, error: "Non autorisé." });
      if (p === "/admin/api/logout") {
        db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
        res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
        return sendJSON(res, 200, { ok: true });
      }
      if (p === "/admin/api/overview") {
        const assets = db.prepare("SELECT COUNT(*) c FROM assets").get().c;
        const contacts = db.prepare("SELECT COUNT(*) c FROM contacts").get().c;
        const submissions = db.prepare("SELECT COUNT(*) c FROM submissions").get().c;
        const users = db.prepare("SELECT COUNT(*) c FROM users WHERE role != 'admin'").get().c;
        const crypto_loans = db.prepare("SELECT COUNT(*) c FROM crypto_loans").get().c;
        return sendJSON(res, 200, { assets, contacts, submissions, users, crypto_loans });
      }
      if (p === "/admin/api/assets") {
        const rows = db.prepare("SELECT * FROM assets ORDER BY id DESC").all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/contacts") {
        const rows = db.prepare("SELECT * FROM contacts ORDER BY id DESC").all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/submissions") {
        const rows = db.prepare("SELECT * FROM submissions ORDER BY id DESC").all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/users") {
        const rows = db.prepare("SELECT id,email,name,role,created_at FROM users WHERE role != 'admin' ORDER BY id DESC").all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/asset") {
        const b = await readBody(req);
        if (b.action === "une") {
          db.prepare("UPDATE assets SET a_la_une = ? WHERE id = ?").run(b.value ? 1 : 0, b.id);
          return sendJSON(res, 200, { ok: true });
        }
        if (req.method === "POST") {
          db.prepare(`INSERT INTO assets (type,title,emetteur,pays,devise,montant,rendement,maturite,risque,token,description,documents,vendeur,minimum,statut,verifie) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(b.type, b.title, b.emetteur || "", b.pays || "", b.devise || "USD", b.montant || null, b.rendement ?? null, b.maturite || "", b.risque || "", b.token || "", b.description || "", JSON.stringify(b.documents || []), b.vendeur || "", b.minimum ?? null, b.statut || "publie", b.verifie ? 1 : 0);
          return sendJSON(res, 200, { ok: true });
        }
        if (req.method === "PUT") {
          const b = await readBody(req);
          db.prepare(`UPDATE assets SET type=?,title=?,emetteur=?,pays=?,devise=?,montant=?,rendement=?,maturite=?,risque=?,token=?,description=?,documents=?,vendeur=?,minimum=?,statut=?,verifie=? WHERE id=?`)
            .run(b.type, b.title, b.emetteur || "", b.pays || "", b.devise || "USD", b.montant || null, b.rendement ?? null, b.maturite || "", b.risque || "", b.token || "", b.description || "", JSON.stringify(b.documents || []), b.vendeur || "", b.minimum ?? null, b.statut || "publie", b.verifie ? 1 : 0, b.id);
          return sendJSON(res, 200, { ok: true });
        }
        if (req.method === "DELETE") {
          const b = await readBody(req);
          db.prepare("DELETE FROM assets WHERE id = ?").run(b.id);
          return sendJSON(res, 200, { ok: true });
        }
      }
      if (p === "/admin/api/submission") {
        const b = await readBody(req);
        if (b.action === "approve") {
          const s = db.prepare("SELECT * FROM submissions WHERE id = ?").get(b.id);
          if (s) {
            db.prepare(`INSERT INTO assets (type,title,emetteur,pays,devise,montant,rendement,maturite,risque,description,vendeur,statut) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
              .run(s.type, s.title, "", s.pays || "", s.devise || "USD", s.montant || null, s.rendement ?? null, s.maturite || "", "B", s.description || "", "Mandat confidentiel", "publie");
            db.prepare("UPDATE submissions SET statut='approuvee' WHERE id=?").run(b.id);
          }
          return sendJSON(res, 200, { ok: true });
        }
        if (b.action === "reject") {
          db.prepare("UPDATE submissions SET statut='rejetee' WHERE id=?").run(b.id);
          return sendJSON(res, 200, { ok: true });
        }
      }
      if (p === "/admin/api/contact") {
        const b = await readBody(req);
        db.prepare("DELETE FROM contacts WHERE id = ?").run(b.id);
        return sendJSON(res, 200, { ok: true });
      }
      if (p === "/admin/api/conversations") {
        const rows = db.prepare(`SELECT c.id, c.subject, c.created_at, u.name AS user_name, u.email AS user_email, a.title AS asset_title,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS nb,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender='membre') AS pending
          FROM conversations c JOIN users u ON u.id = c.user_id LEFT JOIN assets a ON a.id = c.asset_id ORDER BY pending DESC, c.id DESC`).all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/subscriptions") {
        if (req.method === "POST") {
          const b = await readBody(req);
          if (b.action === "activer") {
            db.prepare("UPDATE subscriptions SET statut='actif', actived_at=datetime('now') WHERE id=?").run(b.id);
            const s = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(b.id);
            if (s) {
              const u = db.prepare("SELECT * FROM users WHERE id = ?").get(s.user_id);
              db.prepare("INSERT INTO notifications (user_id,title,body) VALUES (?,?,?)").run(s.user_id, "Abonnement activé", "Votre abonnement " + s.plan + " est actif. Accès débloqué.");
              if (u) queueEmail(u.email, "Votre abonnement Aureus est actif", "Bonjour " + (u.name || "") + ",\n\nVotre abonnement " + s.plan + " (réf. " + s.reference + ") est actif. Accès aux vendeurs débloqué.\n\nL'équipe Aureus Capital Markets");
            }
          }
          if (b.action === "desactiver") {
            db.prepare("UPDATE subscriptions SET statut='expire' WHERE id=?").run(b.id);
          }
          return sendJSON(res, 200, { ok: true });
        }
        const rows = db.prepare(`SELECT s.id, s.plan, s.reference, s.statut, s.montant, s.devise, s.moyen, s.created_at, s.actived_at, u.name AS user_name, u.email AS user_email
          FROM subscriptions s JOIN users u ON u.id = s.user_id ORDER BY s.id DESC`).all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/fees") {
        if (req.method === "POST") {
          const b = await readBody(req);
          if (b.action === "activer") {
            db.prepare("UPDATE relation_fees SET statut='actif', actived_at=datetime('now') WHERE id=?").run(b.id);
            const f = db.prepare("SELECT * FROM relation_fees WHERE id = ?").get(b.id);
            if (f) {
              const u = db.prepare("SELECT * FROM users WHERE id = ?").get(f.user_id);
              db.prepare("INSERT INTO notifications (user_id,title,body) VALUES (?,?,?)").run(f.user_id, "Frais de mise en relation confirmés", "Référence " + f.reference + " confirmée. Merci.");
              if (u) queueEmail(u.email, "Confirmation frais de mise en relation", "Bonjour,\n\nVotre frais de mise en relation (réf. " + f.reference + ") est confirmé.\n\nL'équipe Aureus Capital Markets");
            }
          }
          return sendJSON(res, 200, { ok: true });
        }
        const rows = db.prepare(`SELECT f.id, f.reference, f.statut, f.montant, f.devise, f.moyen, f.created_at, u.name AS user_name, u.email AS user_email
          FROM relation_fees f JOIN users u ON u.id = f.user_id ORDER BY f.id DESC`).all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/kyc") {
        if (req.method === "POST") {
          const b = await readBody(req);
          if (b.action === "valider") {
            db.prepare("UPDATE users SET kyc_statut='valide' WHERE id=?").run(b.id);
            const u = db.prepare("SELECT * FROM users WHERE id = ?").get(b.id);
            if (u) {
              db.prepare("INSERT INTO notifications (user_id,title,body) VALUES (?,?,?)").run(b.id, "KYC validé", "Votre identité a été vérifiée. Badge Vérifié activé.");
              queueEmail(u.email, "Votre profil est vérifié", "Bonjour,\n\nVotre identité a été vérifiée. Vous affichez le badge Vérifié.\n\nL'équipe Aureus Capital Markets");
            }
          }
          if (b.action === "rejeter") {
            db.prepare("UPDATE users SET kyc_statut='rejete' WHERE id=?").run(b.id);
          }
          return sendJSON(res, 200, { ok: true });
        }
        const rows = db.prepare(`SELECT u.id, u.name, u.email, u.kyc_statut, u.kyc_nom, u.kyc_pays, u.kyc_document, u.created_at
          FROM users u WHERE u.kyc_statut != 'aucun' ORDER BY u.id DESC`).all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/conversation") {
        const id = Number(url.searchParams.get("id"));
        const msgs = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC").all(id);
        return sendJSON(res, 200, msgs);
      }
      if (p === "/admin/api/crypto-loans") {
        if (req.method === "POST") {
          const b = await readBody(req);
          if (b.action === "approuver") {
            db.prepare("UPDATE crypto_loans SET statut='approuve', updated_at=datetime('now') WHERE id=?").run(b.id);
            const loan = db.prepare("SELECT * FROM crypto_loans WHERE id = ?").get(b.id);
            if (loan) {
              db.prepare("INSERT INTO notifications (user_id,title,body) VALUES (?,?,?)").run(loan.user_id, "Prêt crypto approuvé", "Votre demande " + loan.reference + " a été approuvée. Contactez-nous pour finaliser.");
              const u = db.prepare("SELECT * FROM users WHERE id = ?").get(loan.user_id);
              if (u) queueEmail(u.email, "Votre prêt crypto est approuvé", "Bonjour " + (u.name || "") + ",\n\nVotre demande de prêt crypto " + loan.reference + " (" + loan.collateral_amount + " " + loan.collateral_crypto + " → " + loan.loan_amount + " " + loan.loan_currency + ") a été approuvée.\n\nL'équipe Aureus Capital Markets");
            }
          }
          if (b.action === "rejeter") {
            db.prepare("UPDATE crypto_loans SET statut='rejete', updated_at=datetime('now') WHERE id=?").run(b.id);
          }
          return sendJSON(res, 200, { ok: true });
        }
        const rows = db.prepare(`SELECT cl.*, u.name AS user_name, u.email AS user_email
          FROM crypto_loans cl LEFT JOIN users u ON u.id = cl.user_id ORDER BY cl.id DESC`).all();
        return sendJSON(res, 200, rows);
      }
      if (p === "/admin/api/messages" && req.method === "POST") {
        const b = await readBody(req);
        const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(Number(b.conversation_id));
        if (!conv) return sendJSON(res, 404, { ok: false, error: "Introuvable." });
        if (!b.body || !b.body.trim()) return sendJSON(res, 400, { ok: false, error: "Message vide." });
        db.prepare("INSERT INTO messages (conversation_id, sender, body) VALUES (?,?,?)").run(conv.id, "equipe", b.body.trim().slice(0, 2000));
        db.prepare("INSERT INTO notifications (user_id, title, body) VALUES (?,?,?)").run(conv.user_id, "Réponse de l'équipe AUREUS", `Vous avez reçu une réponse sur « ${conv.subject || "votre discussion"} »`);
        return sendJSON(res, 200, { ok: true });
      }
    }
    if (p === "/admin" || p === "/admin/") return serveStatic(ADMIN_DIR)("/index.html", res);
    return serveStatic(ADMIN_DIR)(p.replace("/admin", "") || "/index.html", res);
  }

  if (p.startsWith("/api/")) {
    if (p === "/api/register") {
      if (rateLimited(clientIp(req) + "|register", 20, 10 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: "Trop de tentatives. Réessayez plus tard." });
      const b = await readBody(req);
      const email = (b.email || "").toLowerCase().trim();
      const name = (b.name || "").trim();
      const pass = b.password || "";
      if (!email || !name || pass.length < 6) return sendJSON(res, 400, { ok: false, error: "Email, nom et mot de passe (min 6 caractères) requis." });
      const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (exists) return sendJSON(res, 409, { ok: false, error: "Cet email est déjà inscrit." });
      db.prepare("INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)").run(email, name, hashPassword(pass), b.role === "vendeur" ? "vendeur" : "acheteur");
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/api/login") {
      if (rateLimited(clientIp(req) + "|login", 20, 10 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: "Trop de tentatives. Réessayez plus tard." });
      const b = await readBody(req);
      const u = db.prepare("SELECT * FROM users WHERE email = ?").get((b.email || "").toLowerCase());
      if (u && verifyPassword(b.password || "", u.password_hash)) {
        res.setHeader("Set-Cookie", `${COOKIE_NAME}=${createSession(u.id)}; HttpOnly; Path=/; Max-Age=2592000`);
        return sendJSON(res, 200, { ok: true, user: { name: u.name, email: u.email, role: u.role } });
      }
      return sendJSON(res, 401, { ok: false, error: "Email ou mot de passe incorrect." });
    }
    if (p === "/api/logout") {
      if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
      res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/api/me") {
      return sendJSON(res, 200, { user: user ? { name: user.name, email: user.email, role: user.role, kyc_statut: user.kyc_statut } : null });
    }
    if (p === "/api/assets") {
      const rows = db.prepare("SELECT * FROM assets WHERE statut = 'publie' ORDER BY a_la_une DESC, id DESC").all();
      const sub = user ? hasActiveSub(user.id) : null;
      const premium = user && sub && sub.plan === "premium";
      return sendJSON(res, 200, rows.map((r) => {
        const locked = !(premium || user?.role === "admin");
        return { ...r, documents: locked ? [] : (r.documents ? JSON.parse(r.documents) : []), documents_locked: locked };
      }));
    }
    if (p === "/api/kyc") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!b.nom || !b.pays) return sendJSON(res, 400, { ok: false, error: "Nom légal et pays requis." });
        db.prepare("UPDATE users SET kyc_statut='en_attente', kyc_nom=?, kyc_pays=?, kyc_document=? WHERE id=?").run(b.nom.slice(0, 200), b.pays.slice(0, 100), (b.document || "").slice(0, 200), user.id);
        return sendJSON(res, 200, { ok: true });
      }
      return sendJSON(res, 200, { kyc_statut: user.kyc_statut });
    }
    if (p === "/api/fee") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const b = await readBody(req);
      const fee = PAYMENT_CONFIG.relation_fee;
      const existing = db.prepare("SELECT * FROM relation_fees WHERE user_id = ? AND statut IN ('en_attente','actif') ORDER BY id DESC LIMIT 1").get(user.id);
      if (existing) return sendJSON(res, 200, { ok: true, fee: existing, existing: true });
      const count = db.prepare("SELECT COUNT(*) AS c FROM relation_fees").get().c + 1;
      const reference = "FEE-" + new Date().getFullYear() + "-" + String(count).padStart(4, "0");
      const r = db.prepare("INSERT INTO relation_fees (user_id, conversation_id, reference, statut, montant, devise) VALUES (?,?,?,?,?,?)")
        .run(user.id, Number(b.conversation_id) || null, reference, "en_attente", fee.price, PAYMENT_CONFIG.currency);
      const f = db.prepare("SELECT * FROM relation_fees WHERE id = ?").get(Number(r.lastInsertRowid));
      return sendJSON(res, 200, { ok: true, fee: f });
    }
    if (p === "/api/my-fees") {
      if (!user) return sendJSON(res, 200, { fees: [] });
      const rows = db.prepare("SELECT * FROM relation_fees WHERE user_id = ? ORDER BY id DESC").all(user.id);
      return sendJSON(res, 200, { fees: rows });
    }
    if (p === "/api/plans") {
      return sendJSON(res, 200, { config: PAYMENT_CONFIG, plans: Object.values(PAYMENT_CONFIG.plans), locked: user ? !hasActiveSub(user.id) : true });
    }
    if (p === "/api/my-subscription") {
      if (!user) return sendJSON(res, 200, { subscription: null });
      const s = db.prepare("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(user.id);
      return sendJSON(res, 200, { subscription: s || null });
    }
    if (p === "/api/subscribe") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous pour souscrire." });
      const b = await readBody(req);
      const plan = PAYMENT_CONFIG.plans[b.plan];
      if (!plan) return sendJSON(res, 400, { ok: false, error: "Plan inconnu." });
      const last = db.prepare("SELECT id FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(user.id);
      if (last) {
        const cur = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(last.id);
        if (cur && (cur.statut === "en_attente" || cur.statut === "actif")) {
          return sendJSON(res, 200, { ok: true, invoice: cur, existing: true });
        }
      }
      const year = new Date().getFullYear();
      const count = db.prepare("SELECT COUNT(*) AS c FROM subscriptions").get().c + 1;
      const reference = `AUR-${year}-${String(count).padStart(4, "0")}`;
      const r = db.prepare("INSERT INTO subscriptions (user_id, plan, reference, statut, montant, devise) VALUES (?,?,?,?,?,?)")
        .run(user.id, plan.key, reference, "en_attente", plan.price, PAYMENT_CONFIG.currency);
      const invoice = db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(Number(r.lastInsertRowid));
      return sendJSON(res, 200, { ok: true, invoice });
    }
    if (p === "/api/subscribe/confirm") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const b = await readBody(req);
      const s = db.prepare("SELECT * FROM subscriptions WHERE user_id = ? AND statut = 'en_attente' ORDER BY id DESC LIMIT 1").get(user.id);
      if (!s) return sendJSON(res, 404, { ok: false, error: "Aucune facture en attente." });
      db.prepare("UPDATE subscriptions SET moyen = ? WHERE id = ?").run((b.moyen || "").slice(0, 120), s.id);
      return sendJSON(res, 200, { ok: true, invoice: db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(s.id) });
    }
    if (p === "/api/fee/confirm") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const b = await readBody(req);
      const f = db.prepare("SELECT * FROM relation_fees WHERE user_id = ? AND statut = 'en_attente' ORDER BY id DESC LIMIT 1").get(user.id);
      if (!f) return sendJSON(res, 404, { ok: false, error: "Aucun frais en attente." });
      db.prepare("UPDATE relation_fees SET moyen = ? WHERE id = ?").run((b.moyen || "").slice(0, 120), f.id);
      return sendJSON(res, 200, { ok: true, fee: db.prepare("SELECT * FROM relation_fees WHERE id = ?").get(f.id) });
    }
    if (p === "/api/contact") {
      if (rateLimited(clientIp(req) + "|contact", 15, 10 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: "Trop de demandes. Réessayez plus tard." });
      const b = await readBody(req);
      if (!b.name || !b.contact || !b.message) return sendJSON(res, 400, { ok: false, error: "Tous les champs sont requis." });
      db.prepare("INSERT INTO contacts (name,contact,message,subject) VALUES (?,?,?,?)").run(b.name, b.contact, b.message, b.subject || "");
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/api/submit") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous pour soumettre une offre." });
      const b = await readBody(req);
      if (!b.title || !b.type) return sendJSON(res, 400, { ok: false, error: "Titre et type requis." });
      db.prepare("INSERT INTO submissions (user_id,type,title,pays,devise,montant,rendement,maturite,description) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(user.id, b.type, b.title, b.pays || "", b.devise || "USD", b.montant || null, b.rendement ?? null, b.maturite || "", b.description || "");
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/api/mystatus") {
      if (!user) return sendJSON(res, 200, { submissions: [] });
      const rows = db.prepare("SELECT id,title,type,statut,created_at FROM submissions WHERE user_id = ? ORDER BY id DESC").all(user.id);
      return sendJSON(res, 200, { submissions: rows });
    }
    if (p === "/api/conversations") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      if (req.method === "POST") {
        if (user.role !== "admin" && !hasActiveSub(user.id)) {
          return sendJSON(res, 402, { ok: false, code: "SUB_REQUIRED", error: "Abonnement requis pour contacter les vendeurs." });
        }
        const b = await readBody(req);
        const assetId = Number(b.asset_id) || null;
        const subject = (b.subject || "").trim().slice(0, 200);
        let conv = assetId ? db.prepare("SELECT * FROM conversations WHERE user_id = ? AND asset_id = ?").get(user.id, assetId) : null;
        if (!conv) {
          const r = db.prepare("INSERT INTO conversations (asset_id, user_id, subject) VALUES (?,?,?)").run(assetId, user.id, subject || "Discussion");
          conv = { id: Number(r.lastInsertRowid), asset_id: assetId, user_id: user.id, subject: subject || "Discussion" };
        }
        return sendJSON(res, 200, { ok: true, conversation: { id: conv.id, asset_id: conv.asset_id, subject: conv.subject } });
      }
      const rows = db.prepare(`SELECT c.id, c.asset_id, c.subject, c.created_at, a.title AS asset_title,
        (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender='equipe') AS replies
        FROM conversations c LEFT JOIN assets a ON a.id = c.asset_id WHERE c.user_id = ? ORDER BY c.id DESC`).all(user.id);
      return sendJSON(res, 200, { conversations: rows });
    }
    if (p === "/api/conversation") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const id = Number(url.searchParams.get("id"));
      const conv = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(id, user.id);
      if (!conv) return sendJSON(res, 404, { ok: false, error: "Conversation introuvable." });
      const msgs = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC").all(id);
      return sendJSON(res, 200, { conversation: conv, messages: msgs });
    }
    if (p === "/api/messages" && req.method === "POST") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      if (user.role !== "admin" && !hasActiveSub(user.id)) {
        return sendJSON(res, 402, { ok: false, code: "SUB_REQUIRED", error: "Abonnement requis pour envoyer des messages." });
      }
      const b = await readBody(req);
      const conv = db.prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?").get(Number(b.conversation_id), user.id);
      if (!conv) return sendJSON(res, 404, { ok: false, error: "Conversation introuvable." });
      if (!b.body || !b.body.trim()) return sendJSON(res, 400, { ok: false, error: "Message vide." });
      db.prepare("INSERT INTO messages (conversation_id, sender, body) VALUES (?,?,?)").run(conv.id, "membre", b.body.trim().slice(0, 2000));
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/api/notifications") {
      if (!user) return sendJSON(res, 200, { notifications: [], unread: 0 });
      const unread = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0").get(user.id).c;
      const notifications = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(user.id);
      return sendJSON(res, 200, { notifications, unread });
    }
    if (p === "/api/notifications/read" && req.method === "POST") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").run(user.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/api/profile/password" && req.method === "POST") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const b = await readBody(req);
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      if (!verifyPassword(b.current || "", u.password_hash)) return sendJSON(res, 400, { ok: false, error: "Mot de passe actuel incorrect." });
      if ((b.password || "").length < 6) return sendJSON(res, 400, { ok: false, error: "Nouveau mot de passe : 6 caractères minimum." });
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(b.password), user.id);
      return sendJSON(res, 200, { ok: true });
    }
    if (p === "/api/needs") {
      if (req.method === "POST") {
        if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous pour publier un besoin." });
        if (rateLimited(clientIp(req) + "|need", 10, 60 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: "Limite de publication atteinte. Réessayez plus tard." });
        const b = await readBody(req);
        const title = (b.title || "").trim();
        if (!title) return sendJSON(res, 400, { ok: false, error: "Titre requis." });
        db.prepare("INSERT INTO needs (user_id,category,title,amount,currency,purpose,description,region) VALUES (?,?,?,?,?,?,?,?)")
          .run(user.id, b.category === "financement" ? "financement" : "credit", title, b.amount || null, b.currency || "EUR", (b.purpose || "").slice(0, 500), (b.description || "").slice(0, 2000), (b.region || "").slice(0, 100));
        return sendJSON(res, 200, { ok: true });
      }
      const rows = db.prepare("SELECT * FROM needs WHERE status = 'active' ORDER BY id DESC").all();
      return sendJSON(res, 200, rows);
    }
    if (p === "/api/bank-offers") {
      if (req.method === "POST") {
        if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous pour publier une opportunité." });
        if (rateLimited(clientIp(req) + "|offer", 10, 60 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: "Limite de publication atteinte. Réessayez plus tard." });
        const b = await readBody(req);
        const bank = (b.bank || "").trim();
        const product = (b.product || "").trim();
        if (!bank || !product) return sendJSON(res, 400, { ok: false, error: "Nom de la banque et produit requis." });
        db.prepare("INSERT INTO bank_offers (bank,product,range_min,range_max,currency,rate,purpose,region) VALUES (?,?,?,?,?,?,?,?)")
          .run(bank, product, b.range_min || null, b.range_max || null, b.currency || "EUR", b.rate ?? null, (b.purpose || "").slice(0, 500), (b.region || "").slice(0, 100));
        return sendJSON(res, 200, { ok: true });
      }
      const rows = db.prepare("SELECT * FROM bank_offers ORDER BY id DESC").all();
      return sendJSON(res, 200, rows);
    }
    if (p === "/api/crypto-loans") {
      if (req.method === "POST") {
        if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous pour faire une demande." });
        if (rateLimited(clientIp(req) + "|cryptoloan", 10, 60 * 60 * 1000)) return sendJSON(res, 429, { ok: false, error: "Limite atteinte. Réessayez plus tard." });
        const b = await readBody(req);
        const cryptos = ["BTC","ETH","USDT","USDC","SOL","BNB","XRP"];
        if (!cryptos.includes(b.collateral_crypto)) return sendJSON(res, 400, { ok: false, error: "Crypto non supportée." });
        if (!b.collateral_amount || b.collateral_amount <= 0) return sendJSON(res, 400, { ok: false, error: "Montant du collatéral requis." });
        if (!b.loan_amount || b.loan_amount <= 0) return sendJSON(res, 400, { ok: false, error: "Montant du prêt requis." });
        const ltv = Math.min(Math.max(Number(b.ltv) || 60, 30), 80);
        const duration = Math.min(Math.max(Number(b.duration_months) || 12, 1), 36);
        const taux = ltv <= 50 ? 6.5 : ltv <= 60 ? 8.5 : ltv <= 70 ? 11.0 : 14.0;
        const count = db.prepare("SELECT COUNT(*) AS c FROM crypto_loans").get().c + 1;
        const reference = "CLOAN-" + new Date().getFullYear() + "-" + String(count).padStart(4, "0");
        db.prepare(`INSERT INTO crypto_loans (user_id,collateral_crypto,collateral_amount,loan_currency,loan_amount,ltv,duration_months,purpose,wallet_address,statut,reference,taux_annuel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(user.id, b.collateral_crypto, Number(b.collateral_amount), b.loan_currency || "EUR", Number(b.loan_amount), ltv, duration, (b.purpose || "").slice(0, 500), (b.wallet_address || "").slice(0, 120), "en_attente", reference, taux);
        const loan = db.prepare("SELECT * FROM crypto_loans WHERE reference = ?").get(reference);
        db.prepare("INSERT INTO notifications (user_id,title,body) VALUES (?,?,?)").run(user.id, "Demande de prêt crypto reçue", "Votre demande " + reference + " est en cours d'analyse. Notre équipe vous recontacte sous 24h.");
        return sendJSON(res, 200, { ok: true, loan });
      }
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const rows = db.prepare("SELECT * FROM crypto_loans WHERE user_id = ? ORDER BY id DESC").all(user.id);
      return sendJSON(res, 200, { loans: rows });
    }
    if (p === "/api/crypto-loans/config") {
      return sendJSON(res, 200, {
        supported: [
          { symbol: "BTC", name: "Bitcoin", ltv_range: "30-70%", rate_range: "6.5-11 %" },
          { symbol: "ETH", name: "Ethereum", ltv_range: "30-70%", rate_range: "6.5-11 %" },
          { symbol: "USDT", name: "Tether", ltv_range: "50-80%", rate_range: "8.5-14 %" },
          { symbol: "USDC", name: "USD Coin", ltv_range: "50-80%", rate_range: "8.5-14 %" },
          { symbol: "SOL", name: "Solana", ltv_range: "30-60%", rate_range: "8.5-11 %" },
          { symbol: "BNB", name: "BNB Chain", ltv_range: "30-60%", rate_range: "8.5-11 %" },
          { symbol: "XRP", name: "Ripple", ltv_range: "30-60%", rate_range: "8.5-11 %" }
        ],
        currencies: ["EUR","USD","USDT","USDC"],
        ltv_tiers: [
          { ltv: 50, rate: 6.5 },
          { ltv: 60, rate: 8.5 },
          { ltv: 70, rate: 11.0 },
          { ltv: 80, rate: 14.0 }
        ],
        durations: [3, 6, 12, 18, 24, 36]
      });
    }
    // PAYPAL ROUTES
    if (p === "/api/paypal/create-order") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const b = await readBody(req);
      const plan = b.plan;
      if (!plan || !PAYMENT_CONFIG.plans[plan]) return sendJSON(res, 400, { ok: false, error: "Plan invalide." });
      try {
        const order = await createPayPalOrder(plan, user.id, user.email);
        if (order.id) return sendJSON(res, 200, { ok: true, orderID: order.id });
        return sendJSON(res, 400, { ok: false, error: "Erreur création commande PayPal" });
      } catch (e) {
        console.error("PayPal create order error:", e);
        return sendJSON(res, 500, { ok: false, error: "Erreur serveur" });
      }
    }
    if (p === "/api/paypal/capture-order") {
      if (!user) return sendJSON(res, 401, { ok: false, error: "Connectez-vous." });
      const b = await readBody(req);
      const orderID = b.orderID;
      if (!orderID) return sendJSON(res, 400, { ok: false, error: "orderID requis." });
      try {
        const capture = await capturePayPalOrder(orderID);
        if (capture.status === "COMPLETED") {
          const customId = capture.purchase_units?.[0]?.custom_id || "";
          const parts = customId.split("_");
          const plan = parts[0];
          const userId = parseInt(parts[1]) || user.id;
          if (PAYMENT_CONFIG.plans[plan]) {
            const year = new Date().getFullYear();
            const count = db.prepare("SELECT COUNT(*) AS c FROM subscriptions").get().c + 1;
            const reference = `AUR-${year}-${String(count).padStart(4, "0")}`;
            db.prepare("INSERT INTO subscriptions (user_id, plan, reference, statut, montant, devise, moyen) VALUES (?,?,?,?,?,?,?)")
              .run(userId, plan, reference, "actif", PAYMENT_CONFIG.plans[plan].price, PAYMENT_CONFIG.currency, "PayPal");
            // Email confirmation
            const u = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
            if (u) {
              await sendEmail({
                to: u.email,
                subject: "Abonnement activé - Aureus Capital Markets",
                html: `<p>Bonjour ${u.name || ""},</p><p>Votre abonnement <b>${PAYMENT_CONFIG.plans[plan].name}</b> a été activé (réf: ${reference}).</p><p>Vous avez maintenant accès à toutes les fonctionnalités.</p><p>L'équipe Aureus Capital Markets</p>`
              });
            }
            return sendJSON(res, 200, { ok: true, plan, reference });
          }
        }
        return sendJSON(res, 400, { ok: false, error: "Paiement non complété" });
      } catch (e) {
        console.error("PayPal capture error:", e);
        return sendJSON(res, 500, { ok: false, error: "Erreur serveur" });
      }
    }
    return sendJSON(res, 404, { ok: false, error: "API inconnue" });
  }

  if (p === "/") return serveStatic(PUBLIC_DIR)("/index.html", res);
  return serveStatic(PUBLIC_DIR)(p, res);
});

server.listen(PORT, () => {
  console.log("");
  console.log("==============================================");
  console.log("  CAPITAL MARKETS — Plateforme en ligne");
  console.log(`  Site public  : http://localhost:${PORT}`);
  console.log(`  Panneau admin: http://localhost:${PORT}/admin`);
  console.log(`  Admin login  : admin@aureusrwa.com / admin2026`);
  console.log("==============================================");
});
