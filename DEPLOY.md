# VYORA — Mise en ligne et passage au « vrai »

## 1. Lancer en local
```
node --version        # 22.5 ou plus
npm test              # 28 tests de l'API
WELCOME_COINS=1000 npm start     # http://localhost:3000 (pièces de test)
```

## 2. Déployer (accessible dans le monde entier)
Aucune dépendance npm : un conteneur ou un hébergeur Node suffit.
1. Choisir un hébergeur avec **disque persistant** (Fly.io, Railway, Render, VPS + Docker…).
2. Variables d'environnement : copier `.env.example` ; **APP_SECRET est obligatoire**.
3. Monter un volume sur `/data` (la base SQLite y est stockée). Sauvegarder ce volume chaque jour.
4. Mettre un nom de domaine + HTTPS (automatique chez la plupart des hébergeurs ; sinon Caddy ou Cloudflare).
5. S'inscrire avec l'e-mail `ADMIN_EMAIL` : ce compte devient administrateur.
6. Vérifier `https://votre-domaine/healthz`.
`docker build -t vyora . && docker run -p 3000:3000 -v vyora-data:/data -e APP_SECRET=... -e ADMIN_EMAIL=... vyora`

**Limite à connaître :** SQLite convient pour un lancement et quelques milliers d'utilisateurs sur une seule instance. Pour une forte croissance (plusieurs serveurs), migrer vers PostgreSQL (le schéma est dans `server.js`).

## 3. Ce qui est fait et testé
Inscription 18+ avec acceptation des CGU, mots de passe hachés (scrypt), sessions signées, limitation de débit, en-têtes de sécurité, Matchs, messagerie (rafraîchie toutes les 3 s), Moments (texte) avec likes/commentaires, cadeaux avec journal comptable atomique (60 % en diamants pour le créateur), blocage, signalement, tableau d'administration (stats, signalements, bannissement), suppression de compte (RGPD), pages légales modèles.

## 4. Ce qu'il reste à brancher (impossible sans vos comptes/clés)
### Paiements (V-Coins)
Point d'entrée : `POST /api/wallet/checkout` dans `server.js` (renvoie 501 tant que rien n'est branché).
- Créer un compte Stripe (cartes) et/ou Flutterwave / CinetPay / Orange Money / M-Pesa (Afrique), selon vos pays.
- Créer une session de paiement, puis **créditer les coins uniquement dans un webhook signé** (jamais depuis le navigateur) en insérant une ligne `ledger` + `UPDATE users SET coins=coins+?`.
- Retraits des diamants : vérification d'identité (KYC), seuil minimum, validation manuelle au début.
- Consulter un comptable : TVA, fiscalité des revenus des créateurs, licence éventuelle de monnaie électronique.
### Chat vocal / vidéo / Live
Point d'entrée : `GET /api/live/token`. Créer un compte LiveKit Cloud (ou Agora), renseigner les clés, générer le jeton signé côté serveur, puis ajouter le SDK client dans `public/app.js` (page « Live & Chat »).
### Photos et vidéos
Les Moments sont en texte. Ajouter un stockage objet (S3, Cloudflare R2) avec envoi par URL signée, limitation de taille/type, et **analyse automatique des contenus illicites**.
### Vérification e-mail / réinitialisation du mot de passe
Brancher un service d'e-mail (Resend, Postmark, SES) : lien de confirmation et « mot de passe oublié ».
### Notifications push, application iOS/Android
Le site est installable (PWA). Pour les stores : encapsuler avec Capacitor, ou créer des apps natives. Apple et Google exigent politique de confidentialité, suppression de compte dans l'app (déjà fait) et, pour les achats de coins, leur système de paiement intégré (commission 15–30 %).
### Langues
L'interface est en français. Pour l'international : extraire les textes de `app.js` dans des fichiers de traduction (en, es, pt, ar…).
### Modération à grande échelle
Équipe ou prestataire de modération, filtres de mots, outil de signalement des mineurs, procédure de réponse aux autorités, conservation des journaux.

## 5. Avant d'ouvrir au public
- Faire relire `public/legal/*.html` par un avocat (modèles, champs [À COMPLÉTER]).
- Déclarer le traitement des données selon votre pays (RGPD UE, loi locale ailleurs).
- Test de charge et audit de sécurité externe avant une campagne de lancement.
