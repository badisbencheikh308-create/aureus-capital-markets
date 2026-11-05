# Aureus RWA — Plateforme serveur

MarketPlace internationale : obligations, crédits, immobilier, usines,
marques, M&A, fonds immobiliers. Paiement banque ou crypto (stablecoins).

## Lancement

1. Ouvre un terminal PowerShell
2. Va dans ce dossier :
   ```
   cd "C:\Users\badis\OneDrive\Desktop\Nouveau dossier\aureus-server"
   ```
3. Démarre le serveur :
   ```
   node server.js
   ```

Le serveur tourne tant que la fenêtre est ouverte. Pour l'arrêter : Ctrl+C.

## Adresses

| Quoi | Adresse |
|---|---|
| Site public | http://localhost:3000 |
| Panneau admin | http://localhost:3000/admin |

## Compte administrateur (à changer absolument)

- Email : `admin@aureusrwa.com`
- Mot de passe : `admin2026`

⚠️ **IMPORTANT** : change ce mot de passe dès la mise en ligne. Modifie la
ligne `const pass = "admin2026";` dans `server.js`, puis supprime le fichier
`data.db` et redémarre pour recréer le compte avec le nouveau mot de passe.

## Ce que fait la plateforme

- **Site public** : catalogue d'offres chargé depuis la base de données,
  comptes membres (inscription/connexion), soumission d'offres par les
  vendeurs, formulaire de contact.
- **Panneau admin** : tableau de bord, gestion complète des offres
  (ajout/modification/suppression), validation des soumissions vendeurs,
  consultation des demandes de contact, liste des membres.

## Structure du projet

```
aureus-server/
├── server.js          # Serveur Node.js (API + fichiers + base)
├── data.db            # Base SQLite (créée automatiquement)
├── public/            # Site public (HTML/CSS/JS)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── data/assets.js (données démo, remplacées par l'API)
│   └── docs/          # Documents de prospection
└── admin/
    └── index.html     # Panneau d'administration
```

## Base de données (SQLite)

Fichier `data.db` créé automatiquement au premier démarrage. Tables :
`users`, `sessions`, `assets`, `contacts`, `submissions`.

Pour repartir de zéro : supprime `data.db` et redémarre le serveur.
Les 14 offres de démonstration sont réinsérées automatiquement.

## API (résumé)

- `POST /api/register` — inscription membre
- `POST /api/login` / `/api/logout` / `GET /api/me` — session
- `GET /api/assets` — offres publiées
- `POST /api/contact` — demande de contact (arrive dans l'admin)
- `POST /api/submit` — soumission d'offre par un vendeur connecté
- `GET /api/mystatus` — suivi des soumissions du membre
- Admin : `/admin/api/...` (login, overview, assets, submissions,
  contacts, users) — protégé par session admin

## Pour la mise en ligne (phase suivante)

1. Changer le mot de passe admin (voir plus haut)
2. Mettre le serveur sur un hébergement (ex : Railway, Render, un VPS)
3. Remplacer la base locale par un hébergement mutualisé si besoin
4. Ajouter le paiement (Stripe + stablecoins) et HTTPS (via l'hébergeur)
5. Consulter un avocat avant de proposer la crypto réelle
