CLAURC — Version avec base de données Neon (Postgres)
=======================================================

CONTENU
- schema.sql          -> structure de la table users (déjà créée
                          automatiquement au démarrage du serveur, mais
                          tu peux aussi l'exécuter toi-même).
- server/              -> le serveur Node.js/Express qui parle à Neon.
    .env                  -> DATABASE_URL déjà rempli avec la clé que tu
                             m'as donnée, + un secret JWT généré.
    server.js, db.js, cardGenerator.js, package.json
- public/              -> les fichiers servis par le serveur :
    index.html            -> page de compte (inscription/connexion/reset)
    claurc-auth.js         -> le SDK (même fichier que dans /sdk)
    logo.svg
- sdk/claurc-auth.js   -> copie de référence du SDK à importer ailleurs.
- exemple-site.html    -> démo d'un site tiers utilisant le SDK.

⚠️ IMPORTANT : Neon n'héberge QUE la base de données Postgres. Il ne peut
pas exécuter le serveur Node.js ni servir de fichiers JS/HTML tout seul.
Il te faut donc héberger le dossier server/ (qui contient index.html,
claurc-auth.js, etc. via express.static) sur une plateforme qui fait
tourner du Node.js, par exemple :
  - Render.com (gratuit pour commencer)
  - Railway.app
  - Fly.io
  - Un VPS avec `node server.js` + pm2

INSTALLATION
1. cd server
2. npm install
3. Vérifie server/.env (DATABASE_URL déjà rempli avec ta clé Neon)
4. node server.js
   -> Au démarrage, le serveur crée automatiquement la table "users"
      dans ta base Neon si elle n'existe pas encore (via ensureSchema()).
5. Ouvre http://localhost:4000 -> c'est ta page de compte Claurc.
6. claurc-auth.js est automatiquement servi sur
   http://localhost:4000/claurc-auth.js -> c'est ce fichier que les
   sites partenaires importent.

RESTER CONNECTÉ
- Le jeton de session dure 30 jours et est stocké dans le localStorage
  (pas sessionStorage) du navigateur, donc il survit à la fermeture du
  navigateur/onglet.
- À chaque page Claurc chargée (index.html) ou à chaque appel
  Claurc.restoreSession() sur un site partenaire, le jeton est revérifié
  auprès du serveur ET renouvelé ("jeton glissant") — tant que
  l'utilisateur revient dans les 30 jours, il reste connecté partout.
- Sur un site tiers, appelle Claurc.restoreSession() au chargement de la
  page (voir exemple-site.html) pour reconnecter l'utilisateur
  automatiquement, sans repasser par le popup.

FLUX CARTE / NIP / RESET (inchangé, maintenant persistant en base)
- Inscription : prénom, nom, username, date de naissance, email, mot de
  passe -> génère un code membre (7 chiffres) + un NIP secret (9
  caractères 0-9/A-Z) -> carte PDF téléchargée avec logo, infos,
  code-barres du code membre, et le NIP en petit.
- Connexion : email OU code membre à 7 chiffres, + mot de passe.
- Mot de passe oublié : upload du PDF de la carte + saisie du NIP ->
  vérification -> nouveau mot de passe -> nouveau NIP généré (l'ancien
  devient inutilisable, son hash étant remplacé en base) -> nouvelle
  carte téléchargée.

SÉCURITÉ — À FAIRE AVANT DE METTRE EN LIGNE
- Le mot de passe Neon que tu m'as donné est maintenant dans ce fichier
  .env et a transité dans cette conversation : régénère-le dans la
  console Neon (Settings > Reset password) avant un vrai lancement en
  production, puis remets la nouvelle valeur dans server/.env.
- Ne commit jamais server/.env sur un dépôt public (ajoute-le à
  .gitignore).
- Restreins cors() aux domaines de tes sites partenaires (au lieu de
  tout accepter) une fois que tu connais la liste.
- Ajoute une limite anti-brute-force sur /api/auth/login et
  /api/auth/forgot-password/verify si tu veux, je peux l'ajouter.
