/* Dictionnaire UI — lot 6 : derniers textes (services, besoins, création de société,
   hedge funds, prêts crypto, marchés) + correction de la note de marché. */
window.I18N_TRIPLES.push(
  /* ---- Services ---- */
  ["Permis douane & entrepôts", "Customs permits & warehouses", "海关许可与仓储"],
  ["Business plan & étude de marché", "Business plan & market study", "商业计划与市场研究"],
  ["Sur devis", "On quotation", "按报价"],
  ["Services premium", "Premium services", "高级服务"],
  ["Rapports, analyse de crédit sur mesure, assistance juridique internationale.", "Reports, bespoke credit analysis, international legal assistance.", "报告、定制信贷分析、国际法律协助。"],

  /* ---- Besoins & financement ---- */
  ["Particuliers, entreprises et banques publient ici leurs besoins et opportunités de crédit et de financement, partout dans le monde.", "Individuals, companies and banks publish their credit and financing needs and opportunities here, worldwide.", "个人、企业与银行在此发布全球范围内的信贷与融资需求及机会。"],
  ["Besoins de financement publiés", "Published funding needs", "已发布的融资需求"],
  ["Crédit d'équipement, pré-export, trésorerie, immobilier…", "Equipment loans, pre-export, working capital, real estate…", "设备贷款、出口前融资、营运资金、房地产…"],
  ["Opportunités des banques", "Bank opportunities", "银行机会"],
  ["Banques et institutions financières proposent leurs produits de financement.", "Banks and financial institutions offer their financing products.", "银行与金融机构提供其融资产品。"],
  ["Connectez-vous pour publier un besoin de financement ou une opportunité bancaire.", "Sign in to publish a funding need or a bank opportunity.", "请登录后发布融资需求或银行机会。"],
  ["Proposer une solution", "Propose a solution", "提供方案"],
  ["Discuter avec la banque", "Discuss with the bank", "与银行洽谈"],

  /* ---- Création de société : juridictions ---- */
  ["🇦🇪 Émirats Arabes Unis — Dubaï", "🇦🇪 United Arab Emirates — Dubai", "🇦🇪 阿联酋 — 迪拜"],
  ["🇺🇸 États-Unis — Delaware / Wyoming", "🇺🇸 United States — Delaware / Wyoming", "🇺🇸 美国 — 特拉华 / 怀俄明"],
  ["🇨🇭 Suisse — Zoug / Genève", "🇨🇭 Switzerland — Zug / Geneva", "🇨🇭 瑞士 — 楚格 / 日内瓦"],
  ["🇻🇬 Îles Vierges Britanniques — Road Town", "🇻🇬 British Virgin Islands — Road Town", "🇻🇬 英属维尔京群岛 — 罗德城"],
  ["🇰🇾 Îles Caïmans — George Town", "🇰🇾 Cayman Islands — George Town", "🇰🇾 开曼群岛 — 乔治城"],
  ["Émirats Arabes Unis (Dubaï)", "United Arab Emirates (Dubai)", "阿联酋（迪拜）"],
  ["États-Unis (Delaware / Wyoming)", "United States (Delaware / Wyoming)", "美国（特拉华 / 怀俄明）"],
  ["Suisse (Zoug / Genève)", "Switzerland (Zug / Geneva)", "瑞士（楚格 / 日内瓦）"],
  ["Îles Vierges Britanniques (Road Town)", "British Virgin Islands (Road Town)", "英属维尔京群岛（罗德城）"],
  ["Îles Caïmans (George Town)", "Cayman Islands (George Town)", "开曼群岛（乔治城）"],
  ["USA LLC (Wyoming/Delaware) — 700 $, ouverture de Stripe/Wise/PayPal possible, 0 % d'impôt US hors résidence.", "US LLC (Wyoming/Delaware) — $700, Stripe/Wise/PayPal account possible, 0% US tax if non-resident.", "美国 LLC（怀俄明/特拉华）— 700 美元，可开 Stripe/Wise/PayPal 账户，非居民 0% 美国税。"],
  ["la plupart des juridictions exigent un renouvellement annuel (gouvernement + agent local) : 300 à 1 500 $/an selon la juridiction.", "most jurisdictions require annual renewal (government + local agent): $300 to $1,500/year depending on the jurisdiction.", "多数司法辖区要求年度续期（政府 + 本地代理）：视辖区而定，每年 300 至 1 500 美元。"],
  ["0 % (9 % si taxable)", "0% (9% if taxable)", "0%（应税则 9%）"],

  /* ---- Hedge funds ---- */
  ["Souscription min 20 000 $ par part. Documents d'offre à examiner avec un conseil local. La plateforme ne détient jamais les fonds.", "Minimum subscription $20,000 per unit. Offer documents to be reviewed with a local adviser. The platform never holds funds.", "每份最低认购 2 万美元。发行文件请与本地顾问审阅。平台从不持有资金。"],

  /* ---- Divers ---- */
  ["Rendement annuel", "Annual yield", "年化收益率"],
  ["Type d'exécution", "Execution type", "执行类型"],
  ["Matières premières (énergie, céréales, métaux)", "Commodities (energy, grains, metals)", "大宗商品（能源、粮食、金属）"]
);

/* Compléments pour les chaînes composites (valeurs de données concaténées) */
window.I18N_TRIPLES.push(
  ["rendement", "yield", "收益率"],
  ["Devise :", "Currency:", "币种："],
  ["Offre supprimée", "Offer removed", "资产已删除"],
  ["Montant à définir", "Amount to be defined", "金额待定"],
  ["Fourchette sur demande", "Range on request", "区间按需"],
  ["Montant nominal", "Nominal amount", "名义金额"],
  ["Réf.", "Ref.", "编号"],
  ["Référence :", "Reference:", "参考："],
  ["Date :", "Date:", "日期："],
  ["Ouvert le", "Opened on", "开启于"],
  ["Étape", "Stage", "阶段"],
  ["Créé:", "Created:", "创建于："],
  ["Financement :", "Financing:", "融资："],
  ["Offre #", "Offer #", "资产 #"]
);

/* Correction de la phrase exacte du disclaimer marchés */
(function () {
  var right = "Cotes à titre indicatif et de démonstration. Les transactions se concluent entre les parties auprès de contreparties agréées ; la plateforme n'exécute pas d'ordres et ne détient jamais les fonds.";
  window.I18N_TRIPLES.push([
    right,
    "Quotes are indicative and for demonstration only. Transactions are concluded between the parties with approved counterparties; the platform does not execute orders and never holds funds.",
    "报价仅供参考与演示。交易由双方在认可的交易对手之间达成；平台不执行订单，也不持有资金。"
  ]);
})();

window.I18N_PATTERNS.push(
  [/^Vous empruntez (\d+)\s*% de la valeur de votre collatéral\. Plus le LTV est bas, plus le taux est avantageux\.$/, "You borrow $1% of your collateral value. The lower the LTV, the better the rate.", "您可借入抵押物价值的 $1%。LTV 越低，利率越优惠。"],
  [/^Souscription min (.+) par part\. Documents d'offre à examiner avec un conseil local\. La plateforme est une simple vitrine de mise en relation\.$/, "Minimum subscription $1 per unit. Offer documents to be reviewed with a local adviser. The platform is a simple matchmaking showcase.", "每份最低认购 $1。发行文件请与本地顾问审阅。平台仅为撮合展示。"],
  [/^(\d[\d\s.,–-]*)\s*jours?$/i, "$1 days", "$1 天"],
  [/^(\d[\d\s.,–-]*)\s*semaines?$/i, "$1 weeks", "$1 周"],
  [/^(\d[\d\s.,–-]*)\s*mois$/i, "$1 months", "$1 个月"],
  [/^(\d[\d\s.,–-]*)\s*ans?$/i, "$1 years", "$1 年"],
  [/^(\d[\d\s.,–-]*)\s*heures?$/i, "$1 hours", "$1 小时"],
  [/^(.+) — mise en relation$/, "$1 — introduction", "$1 — 撮合"],
  [/^(.+) — demande d'information$/, "$1 — information request", "$1 — 信息咨询"],
  [/^(.+) — accès documents$/, "$1 — document access", "$1 — 文件访问"],
  [/^(\d[\d\s.,–-]*)\s*€\s*\/\s*dossier$/i, "€$1 / file", "€$1 / 份"],
  [/^(\d[\d\s.,–-]*)\s*\$\s*par ordre$/i, "$$1 per order", "每笔 $1 美元"]
);

/* Derniers libellés + corrections de traductions de données */
window.I18N_TRIPLES.push(
  ["Obligation", "Bond", "债券"],
  ["Crédit", "Loan", "信贷"],
  ["Fonds Immobilier", "Real estate fund", "不动产基金"],
  ["Fonds immobilier", "Real estate fund", "不动产基金"],
  ["Fusion-Acquisition", "Merger / M&A", "并购"],
  ["Matières Premières", "Commodities", "大宗商品"],
  ["Prix", "Price", "价格"],
  ["Pont vers l'Afrique", "Gateway to Africa", "通往非洲的门户"],
  ["Pools de rendement & tokens d'actifs", "Yield pools & asset tokens", "收益池与资产通证"],
  ["Pool Rendement Obligations Afrique", "Africa Bond Yield Pool", "非洲债券收益池"],
  ["Obligations souveraines", "Sovereign bonds", "主权债券"],
  ["Créances fournisseurs", "Supplier receivables", "供应商应收款"],
  ["Token Fonds Immobilier Dubaï", "Dubai Real Estate Fund Token", "迪拜不动产基金通证"],
  ["Parts de fonds immobiliers", "Real estate fund units", "不动产基金份额"],
  ["Connecter un wallet", "Connect a wallet", "连接钱包"],
  ["Valeur investie", "Invested value", "已投资金额"],
  ["Taux indicatif", "Indicative rate", "参考利率"],
  ["Taux annuel", "Annual rate", "年化利率"],
  ["Entreprise (PME/ETI, EBITDA > 2M€)", "Corporate (SME/mid-cap, EBITDA > €2M)", "企业（中小企业/中型企业，EBITDA > 200 万欧元）"],
  ["Montant max.", "Max amount", "最高金额"],
  ["Dette Senior Entreprise / Unitranche (EBITDA > 2M€)", "Corporate senior debt / unitranche (EBITDA > €2M)", "企业优先级债务 / 单一批次贷款（EBITDA > 200 万欧元）"],
  ["Fonds Immobiliers internationaux", "International real estate funds", "国际不动产基金"],
  ["Commission 0,25 – 1 % par ordre", "0.25 – 1% commission per order", "每笔佣金 0.25 – 1%"],
  ["Services Banques & Institutionnels", "Bank & institutional services", "银行与机构服务"],
  ["Contrat de prestation annuel", "Annual service contract", "年度服务合约"],
  ["10 000 $ par ordre", "$10,000 per order", "每笔 10,000 美元"],
  ["Crédit Commercial Café & Cacao — Cameroun", "Commercial Loan — Coffee & Cocoa — Cameroon", "商业贷款——咖啡与可可——喀麦隆"],
  ["Crédit Commercial Pêche — Mauritanie", "Commercial Loan — Fishing — Mauritania", "商业贷款——渔业——毛里塔尼亚"],
  ["Crédit Maritime Singapour — Pool", "Maritime Loan Singapore — Pool", "新加坡海事贷款——联营"],
  ["Financement pré-export — Cacao Côte d'Ivoire", "Pre-export financing — Cocoa, Ivory Coast", "出口前融资——科特迪瓦可可"],
  ["Mis à jour", "Updated", "更新于"]
);
