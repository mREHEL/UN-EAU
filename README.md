# UN'EAU

Jeu de cartes inspiré du UNO, jouable entre 2 et 10 personnes directement dans le navigateur. L’hôte détient l’état autoritaire, mais chaque joueur reçoit une copie de secours chiffrée par WebRTC afin qu’une partie puisse continuer après son départ.

## Démarrage

Prérequis : Node.js 20.19+ ou 22.12+.

```bash
npm install
npm run dev
```

Puis ouvrez l’adresse affichée par Vite. Pour simuler plusieurs joueurs, utilisez plusieurs navigateurs ou profils de navigateur : un même profil réutilise volontairement la même identité de reconnexion.

Commandes utiles :

```bash
npm test          # tests unitaires déterministes
npm run test:e2e # tests Playwright (navigateurs à installer avec npx playwright install)
npm run typecheck
npm run build
npm run preview
```

Le scénario P2P réel à trois navigateurs est volontairement optionnel afin que la CI ne dépende pas d’un service public. Pour le lancer sans faire sortir les données de la machine :

```bash
# terminal 1
npm run signal:test

# terminal 2
P2P_LIVE=1 VITE_PEER_HOST=127.0.0.1 VITE_PEER_PORT=9000 VITE_PEER_PATH=/uneau \
  npx playwright test tests/e2e/live-p2p.spec.ts --project=chromium
```

## Règles retenues

- Paquet standard de 108 cartes et 7 cartes distribuées par joueur.
- Une carte est jouable si sa couleur ou son symbole correspond, ou si c’est un joker.
- Une carte piochée termine le tour.
- À deux joueurs, l’inversion agit comme un passe-tour.
- Le joueur choisit la nouvelle couleur après un joker.
- Par défaut, un `+4` n’est autorisé que si le joueur ne possède aucune carte de la couleur active.
- Le cumul des `+2` et des `+4` est désactivé par défaut et configurable séparément. Les deux types ne se mélangent jamais.
- Le bouton UNO doit être activé avant de poser l’avant-dernière carte. Sinon, deux cartes sont piochées immédiatement.
- La manche s’arrête dès qu’une main est vide. Les cartes numériques valent leur nombre, les actions 20 points et les jokers 50 points.

## Architecture P2P et migration

Le serveur public PeerJS sert uniquement à mettre les navigateurs en relation. Les données de partie circulent ensuite sur des DataChannels WebRTC fiables.

- L’hôte valide toutes les intentions et diffuse des snapshots complets munis d’une version, d’un terme d’élection et d’une empreinte SHA-256.
- Les messages ont une version de protocole, un identifiant unique, une séquence, un terme et sont validés à l’exécution avec Zod.
- Les doublons et séquences obsolètes sont ignorés. Les messages applicatifs sont acquittés.
- Les pairs connus forment un maillage de secours. Un heartbeat surveille l’hôte ; une période de grâce évite une élection sur une latence brève.
- Le candidat possédant la version cohérente la plus récente gagne ; l’identifiant joueur départage les égalités.
- La reprise exige la majorité absolue des participants. Sans quorum, la partie est suspendue pour éviter deux états divergents.
- Un terme supérieur invalide les actions de l’ancien hôte s’il revient après la migration.

### Limites honnêtes

Le P2P sans service de salle permanent ne peut pas garantir une disponibilité absolue :

- Si les navigateurs restants ne peuvent pas communiquer entre eux ou si aucun quorum ne subsiste, la partie reste suspendue.
- Le code initial correspond à l’identifiant PeerJS de l’hôte initial. Après une migration, les joueurs déjà présents connaissent le nouveau pair et se reconnectent entre eux, mais un tout nouveau navigateur ne peut pas retrouver le salon avec l’ancien code sans annuaire externe.
- Les snapshots de secours contiennent les mains, la pioche et leur ordre. L’interface cache les cartes adverses, mais un joueur techniquement avancé peut inspecter la mémoire de son navigateur. Cette architecture ne protège donc pas contre un participant qui triche.
- L’identité de reconnexion associe un UUID et un secret aléatoire de 256 bits conservés dans `localStorage`. Seule son empreinte SHA-256 est répliquée dans l’état de secours. Effacer le stockage du navigateur supprime cette preuve d’identité.
- PeerJS Cloud et les STUN publics n’offrent pas de garantie de service. Certains réseaux d’entreprise exigent un TURN. Les secrets TURN doivent être injectés avec des variables d’environnement et ne jamais être publiés dans le dépôt.

## Tests

Les tests unitaires couvrent le paquet, la distribution, les coups, les tours, les actions spéciales, la pénalité UNO, la victoire, les snapshots et leur intégrité, la déduplication, les états obsolètes, les élections à 3/4/6 joueurs, le double candidat, le retour de l’ancien hôte, le délai de grâce, l’absence de quorum, les pertes, retards et partitions simulés.

Playwright vérifie le flux d’accueil, les préférences, la persistance du pseudonyme et les mises en page desktop/mobile. Un test optionnel vérifie réellement la création d’un salon dans trois contextes isolés, le lancement puis la migration après fermeture de l’hôte avec un PeerServer local. Les contraintes NAT réelles restent à tester sur plusieurs réseaux physiques.

## Déploiement GitHub Pages

1. Créez un dépôt GitHub et poussez ce dossier sur la branche `main`.
2. Dans **Settings → Pages → Build and deployment**, choisissez **GitHub Actions**.
3. Le workflow `.github/workflows/deploy.yml` teste, compile puis publie `dist/`.

La configuration Vite déduit automatiquement le nom du dépôt dans GitHub Actions, ce qui rend les ressources compatibles avec le sous-chemin Pages. Les invitations utilisent une query string (`?room=ABC123`) et ne nécessitent donc aucune réécriture côté serveur.

## Configuration réseau

Copiez `.env.example` vers `.env.local` pour utiliser votre propre PeerServer ou un TURN. Ne placez jamais de secrets dans une variable `VITE_*` sur un dépôt public : ces valeurs sont intégrées au JavaScript client. Pour un TURN de production, utilisez de préférence des identifiants éphémères délivrés par un service séparé.
