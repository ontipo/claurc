CLAURC — Pack d'authentification (100% HTML/CSS/JS, sans backend)
===================================================================

CONTENU
- index.html        -> la page de compte Claurc : inscription, connexion,
                        mot de passe oublié. C'est la page que les autres
                        sites ouvrent en popup pour la connexion Claurc.
- claurc-auth.js     -> le SDK à importer sur les sites partenaires
                        (bouton "Se connecter avec Claurc").
- exemple-site.html  -> démo d'un site tiers qui utilise le SDK.
- logo.svg           -> le logo Claurc, utilisé dans la page et sur la carte PDF.

COMMENT HÉBERGER
1. Mets index.html, claurc-auth.js et logo.svg sur le MÊME domaine
   (ex: id.claurc.com), servi en HTTPS. N'importe quel hébergement
   statique fonctionne (Netlify, Vercel, GitHub Pages, Cloudflare
   Pages, un simple `npx serve .`, etc.) — aucun serveur Node ni
   base de données n'est requis.
2. Sur chaque site partenaire, importe claurc-auth.js depuis ce
   domaine et configure authOrigin avec l'URL réelle
   (voir exemple-site.html).

IMPORTANT : ça ne marche pas en ouvrant simplement le fichier avec
file:// dans le navigateur (popup + postMessage exigent une vraie
origine http/https). Utilise un serveur statique local pour tester,
par exemple :
    npx serve .
puis ouvre http://localhost:3000

COMMENT ÇA MARCHE
- Inscription : demande prénom, nom, nom d'utilisateur, date de
  naissance, email, mot de passe. À la création du compte :
    * un CODE MEMBRE unique à 7 chiffres (0-9) est généré
    * un NIP secret à 9 caractères (0-9 et A-Z) est généré
    * une carte de membre PDF est générée et téléchargée
      automatiquement (logo, infos, code-barres en haut,
      code membre bien visible en bas, NIP discret à côté)
- Connexion : avec l'email OU le code membre à 7 chiffres, + mot de passe.
- Mot de passe oublié :
    1. l'utilisateur importe le PDF de sa carte + tape son NIP
    2. le code membre est extrait du PDF et le NIP est vérifié
    3. si valide, l'utilisateur choisit un nouveau mot de passe
    4. l'ancien NIP devient invalide (son hash est remplacé),
       une nouvelle carte est générée avec un nouveau NIP valide,
       et elle est téléchargée automatiquement.

LIMITES DE CETTE VERSION (à savoir)
- Il n'y a pas de vrai serveur : les comptes sont stockés dans le
  localStorage du NAVIGATEUR sur le domaine id.claurc.com. Ça veut
  dire qu'un compte créé sur un appareil/navigateur n'est pas
  automatiquement visible sur un autre appareil, puisqu'il n'y a
  pas de base de données centrale. Pour du vrai multi-appareil, il
  faut un backend (Node/Postgres, Neon, etc.) — je peux te la
  fournir si tu veux, il faudra juste que je puisse écrire un
  fichier .zip pour toi (déjà possible maintenant).
- Les mots de passe et NIP sont hachés avec bcrypt côté client
  avant d'être stockés — mais comme il n'y a pas de serveur,
  n'importe qui avec accès au navigateur peut lire le localStorage.
  Pour un vrai produit en production, héberge la logique sensible
  côté serveur.

PERSONNALISATION
- Couleurs / typographie : variables CSS en haut de index.html
  (--bg, --arc-gold, --arc-violet, etc.)
- Format de la carte PDF : fonction buildMemberCardPdf() dans
  index.html.
