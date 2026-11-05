/* ============================================================
   AUREUS — Moteur de traduction de l'interface (FR ⇄ EN ⇄ 中文)
   Traduit tout le DOM rendu (pages, cartes, tableaux, modales,
   placeholders, titres, options) après chaque rendu.
   Source de vérité = français. Chaque nœud garde son texte FR
   d'origine pour pouvoir rebasculer proprement.
   ============================================================ */
(function () {
  "use strict";

  window.I18N_TRIPLES = window.I18N_TRIPLES || [];
  window.I18N_PATTERNS = window.I18N_PATTERNS || [];

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };
  var ATTRS = ["placeholder", "title", "aria-label", "alt"];

  var MAP = { en: Object.create(null), zh: Object.create(null) };
  var builtCount = -1;
  var internal = false;

  function build() {
    if (builtCount === window.I18N_TRIPLES.length) return;
    MAP.en = Object.create(null);
    MAP.zh = Object.create(null);
    for (var i = 0; i < window.I18N_TRIPLES.length; i++) {
      var t = window.I18N_TRIPLES[i];
      if (!t || !t[0]) continue;
      MAP.en[t[0]] = t[1] === undefined ? t[0] : t[1];
      MAP.zh[t[0]] = t[2] === undefined ? (t[1] === undefined ? t[0] : t[1]) : t[2];
    }
    builtCount = window.I18N_TRIPLES.length;
  }
  window.rebuildI18nMap = build;

  function currentLang() {
    return window.AUREUS_LANG || "fr";
  }
  window.currentLang = currentLang;

  function clean(s) {
    return String(s).replace(/\s+/g, " ").trim();
  }

  function lookup(core, l) {
    var hit = MAP[l] && MAP[l][core];
    if (hit) return hit;
    var pats = window.I18N_PATTERNS;
    for (var i = 0; i < pats.length; i++) {
      var p = pats[i];
      var m = core.match(p[0]);
      if (m) {
        var out = l === "zh" ? p[2] : p[1];
        if (!out) continue;
        return out.replace(/\$(\d)/g, function (_, n) {
          return m[Number(n)] || "";
        });
      }
    }
    return null;
  }

  function trString(raw, l) {
    var core = clean(raw);
    if (!core) return null;
    var hit = lookup(core, l);
    if (hit === null || hit === undefined || hit === core) return null;
    var lead = raw.match(/^\s*/)[0];
    var trail = raw.match(/\s*$/)[0];
    return lead + hit + trail;
  }

  function srcNode(node) {
    if (node.__i18nFr === undefined) node.__i18nFr = node.nodeValue;
    return node.__i18nFr;
  }

  function srcAttr(el, a) {
    if (!el.__i18nFrAttr) el.__i18nFrAttr = {};
    if (el.__i18nFrAttr[a] === undefined) el.__i18nFrAttr[a] = el.getAttribute(a);
    return el.__i18nFrAttr[a];
  }

  function translateTree(root, l) {
    if (!root || (l !== "en" && l !== "zh")) return 0;
    build();
    var n = 0;

    // Texte
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          if (SKIP[node.tagName] || node.hasAttribute("data-no-i18n")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var node, guard = 0;
    while ((node = walker.nextNode()) && guard++ < 40000) {
      var fr = srcNode(node);
      if (!fr || !/\S/.test(fr)) continue;
      var out = trString(fr, l);
      if (out === null || out === node.nodeValue) continue;
      node.nodeValue = out;
      n++;
    }

    // Attributs
    var els = root.querySelectorAll("[placeholder],[title],[aria-label],[alt]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.hasAttribute && el.hasAttribute("data-no-i18n")) continue;
      for (var j = 0; j < ATTRS.length; j++) {
        var a = ATTRS[j];
        if (!el.hasAttribute(a)) continue;
        var src = srcAttr(el, a);
        if (!src || !/\S/.test(src)) continue;
        var val = trString(src, l);
        if (val === null) continue;
        if (el.getAttribute(a) !== val) {
          el.setAttribute(a, val);
          n++;
        }
      }
    }
    return n;
  }

  /* Traduction ponctuelle d'une valeur de données (titre, pays, description…).
     Utilisée au rendu pour les chaînes composites construites par concaténation. */
  window.T = function (value) {
    if (value === null || value === undefined) return value;
    var l = currentLang();
    if (l !== "en" && l !== "zh") return value;
    build();
    var out = trString(String(value), l);
    return out === null ? String(value) : out;
  };

  window.applyUiTranslation = function (root) {
    var l = currentLang();
    if (l !== "en" && l !== "zh") return 0;
    if (!window.AUREUS_UI_READY) return 0;
    internal = true;
    var n = 0;
    try {
      n = translateTree(root || document.body, l);
    } catch (e) {
      /* no-op */
    }
    internal = false;
    return n;
  };

  window.addEventListener("DOMContentLoaded", function () {
    window.AUREUS_UI_READY = true;
    var obs = new MutationObserver(function () {
      if (internal) return;
      var l = currentLang();
      if (l !== "en" && l !== "zh") return;
      if (window.__i18nPending) return;
      window.__i18nPending = true;
      setTimeout(function () {
        window.__i18nPending = false;
        window.applyUiTranslation();
      }, 0);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.applyUiTranslation();
  });
})();
