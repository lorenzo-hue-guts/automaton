# Lot 6M-B — Phase 2 : backend Web sécurisé

## Résultat et portée

Le client/adaptateur de runner dédié, le contrat authentifié et son raccordement au
Builder sont implémentés. Le protocole est testé avec doubles explicitement
SIMULATED. Aucun service de runner autorisé, adresse opérationnelle, CA privée ou
clé de production n'a été fourni. **Acceptation distante réelle : BLOCKED.**
Ce lot ne prétend pas avoir déployé le service HTTPS, créé sa VM ou prouvé son
isolation. Le récepteur et son superviseur d'isolation restent à installer et à
valider sur une infrastructure expressément autorisée.

Documents lus intégralement : `product-factory-lot-6mb-audit.md`,
`product-factory-lot-6m.md`, `product-factory-lot-6m-integration-map.md` ; interfaces
Builder/SurfaceAcceptance/CompanyStore/capabilities et admission existantes.

## Inventaire et intégration

Point de raccordement : `ModelBuilder` → opération `factory_model_browser` admise
par PolicyEngine → `SurfaceAcceptance.browser` → `BrowserAcceptanceProvider`.
Le provider dédié est injecté explicitement dans les services Builder. Il reçoit
le plan figé, les snapshots exacts des artefacts compilés et le contexte de la
tâche/lease. Son environnement navigateur distinct n'altère pas l'environnement
de compilation Docker. Le runtime distant doit démarrer la même application
dans sa propre frontière privée ; il ne se connecte pas à un port de l'hôte.

Le Task Graph, HarnessRegistry, LocalWorkerPool, ResourceManager, les approvals,
CompanyStore, quality gates et la dérivation de capacités restent les systèmes
existants. Aucun ordonnanceur, heartbeat, worker pool ou mécanisme de promotion
supplémentaire. La consultation STATUS est une attente bornée à l'intérieur de
l'opération de worker déjà louée, pas un service de polling autonome.

Fichiers ajoutés dans cette phase :

- `src/product-factory/web-runner.ts`
- `src/__tests__/product-factory/web-runner.test.ts`
- `docs/product-factory-lot-6mb-web.md`

Fichiers modifiés dans cette phase :

- `src/product-factory/model-build-types.ts`
- `src/product-factory/model-builder.ts`
- `src/product-factory/surface-builder-types.ts`
- `src/product-factory/surface-acceptance.ts`
- `src/product-factory/surface-browser.ts`
- `src/product-factory/index.ts`

Schéma : **V16 inchangé**, aucune migration. Les ajouts optionnels aux records
versionnés existants préservent les anciens plans/receipts/providers.

## Contrat du runner v1 et sécurité

`WebRunnerPolicy` est une configuration publique épinglée : propriétaire,
identité du runner, adresse IPv4 RFC1918 HTTPS, clé publique Ed25519, CA TLS fournie
séparément, environnement/toolchain, digest d'image, hash du profil de sécurité,
capacités et bornes. Une configuration incomplète ou dangereuse est refusée.
Les hôtes publics, DNS arbitraire, credentials dans l'URL, HTTP et redirects sont
refusés. Le transport direct Node HTTPS conserve la validation TLS, limite les
réponses et n'utilise pas de proxy ni de DNS pour joindre un autre hôte.

La politique exige : isolation PER_JOB, non-root, sandbox Chromium actif, aucun
mode privilégié, aucun port public, montage sensible ou secret de l'orchestrateur,
egress DENY. Les limites maximales acceptées par le contrat sont 120 secondes,
200 000 octets d'artefacts, 100 000 octets de réponse ; les bornes du plan et de la
lease peuvent être plus strictes. Ces plafonds ne prétendent pas mesurer CPU/RAM.
Le profil de sécurité de déploiement doit également imposer leurs limites.

Une approbation **existante** `resource_reservation`, décidée par le propriétaire
du produit et liée exactement à `runnerApprovalAction(policy)`, est requise avant
dispatch. Ce contrôle n'accorde pas lui-même une approbation. Le PolicyEngine
existant admet toujours l'opération Builder ; tâche, lease, Company guards,
Brief approuvé et budgets sont revérifiés pendant les échanges.

Les messages Ed25519 utilisent un domaine de signature versionné. La clé privée
du client est un KeyObject détenu par le runtime autorisé, jamais un fichier du
produit, paramètre d'acceptation, receipt ou log. Le runner doit épingler la clé
publique du client associé au propriétaire autorisé. Les signatures publiques
conservées comme preuves ne sont pas des credentials réutilisables.

Opérations : IDENTITY, SUBMIT, STATUS, CANCEL. Chaque réponse doit correspondre
au nonce courant, runner, job, hash du job, environnement, image et profil de
sécurité. Les requêtes ont une fenêtre de fraîcheur de 30 secondes. Le futur
récepteur doit en plus conserver un registre de nonces/idempotence et rejeter les
replays : `validateRunnerRequest` valide signatures/fraîcheur/bindings mais ne
constitue pas à elle seule un service durable anti-replay.

Le job lie propriétaire, produit, tâche, lease, Contract et surface ref/hash,
Brief ID/hash, architecture révision/hash, plan ref/hash et manifest des artefacts.
Les bytes sont vérifiés par SHA-256, tailles, chemins relatifs sûrs, unicité et
manifest exact. Première portée : artefacts texte compilés du chemin Node HTTP
existant, commande runtime exacte `node <artefact.js>`. Aucun shell ou commande de
runtime arbitraire n'est envoyé. Les dépendances nécessaires doivent déjà être
présentes dans l'image autorisée ; aucun téléchargement automatique.

`prepareRunnerBrowser` prépare le programme **de confiance existant** du Lot 6M
et le plan comme données JSON. Il ne lance aucun navigateur ni ne crée une
isolation. Le récepteur ne doit l'exécuter qu'après établir sa frontière isolée.
Le programme impose `chromiumSandbox: true`, contexte éphémère par viewport,
interactions structurées, origine loopback unique, pas de downloads, diagnostics
runtime et assertions. Aucune option `--no-sandbox` ou fallback vers l'hôte.

## Receipts, réparation et reprise

Le job est persisté dans `surfaceRun` avant soumission. Une connexion perdue ou
une réponse de sécurité invalide laisse l'exécution INTERRUPTED. La même tâche,
le même artefact, probe, policy et environnement retrouvent le plan figé et
consultent STATUS ; ils ne resoumettent pas le job. Un autre artefact/tâche du
même produit est bloqué tant que ce job est non réconcilié. Les autres produits
restent indépendants. Un crash entre persistance et SUBMIT est donc conservateur :
un job inconnu du runner ne devient pas implicitement une nouvelle soumission.

Le délai ne dépasse pas la lease. Abort/délai déclenchent une tentative CANCEL
signée bornée à deux secondes ; aucune réponse tardive ne devient PASS. Une
annulation ou perte de connexion ne démontre pas la destruction du runtime :
l'état interrompu reste durable et requiert réconciliation. La réconciliation
administrative après expiration complète de la lease n'est pas automatisée ici.
Le futur superviseur doit arrêter les jobs à leur deadline, même si le client
disparaît, et permettre STATUS/CANCEL authentifiés sans relancer l'application.

Un PASS distant exige une preuve signée COMPLETED/REAL, sandbox actif, non-root,
cleanup attesté et résultats structurés exacts. Le quality gate revérifie la
signature avec la clé épinglée dans le plan et compare observations, findings,
screenshots et moteur au résultat signé. Une réponse HTTP seule, screenshot seul,
résultat altéré ou résultat d'un autre produit/plan est insuffisant. Les contrôles
existants imposent les dimensions d'interaction obligatoires et les hashes des
captures. Les anciennes preuves ne certifient jamais un nouvel artefact.

Le transport fixture ou le runner déclaré SIMULATED produisent un résultat
BLOCKED sans preuve de promotion, même s'ils annoncent une réussite. Les erreurs
d'application authentifiées suivent la réparation bornée existante : FAIL
historique immuable, nouvel artefact, nouveau plan/run/receipt. Les interruptions
du runner mettent le Builder BLOCKED, sans lancer une réparation spéculative.

Une signature protège l'identité et l'intégrité ; elle ne démontre pas à elle
seule que le noyau ou Chromium applique effectivement le sandbox. L'acceptation
de l'infrastructure, sa configuration et l'identité du superviseur restent des
prérequis de l'approbation du propriétaire.

## Preuve réelle locale et frontière actuelle

Nouvelle tentative reproductible avec l'image navigateur existante :
`node /tmp/lot-6mb-web/browser-probe.mjs`, via `DockerProductSandbox`, mêmes
restrictions réseau/filesystem/utilisateur, aucun changement de permissions du
sandbox. Chromium 151.0.7922.173 / Playwright Core 1.57.0.

Le sous-processus Chromium est tenté puis avorte avant ouverture utilisable :
`FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166`, helper SUID mal
configuré ; SIGABRT. La tentative retourne BLOCKED. Le diagnostic de Phase 1
sur namespaces/NNP/seccomp reste applicable. Aucune navigation, interaction,
capture ou persistance réelle de navigateur n'est prouvée par cette tentative.

Preuves locales : `/tmp/lot-6mb-web/browser-private.json`, `browser.log` et
`browser-probe.mjs`. Le succès du processus enveloppe de diagnostic (exit 0)
n'est pas un succès navigateur. Aucun endpoint de runner autorisé n'a été utilisé.

| Élément | Statut réel |
| --- | --- |
| Client dédié, contrats, validators, préparation du programme | IMPLÉMENTÉ / INTERFACE-READY |
| Signatures et vérifications Ed25519 | Exécutées localement sur clés de test |
| Protocole runner, identité, réponses et reprises | FIXTURE-ONLY / SIMULATED |
| Transport TLS vers un runner autorisé | Non exécuté |
| Service HTTPS, superviseur et isolation distante | NOT_IMPLEMENTED / infrastructure requise |
| Chromium utilisable dans le sandbox actuel | BLOCKED |
| Parcours navigateur d'une application générée | BLOCKED |
| Réparation réellement détectée par navigateur distant | BLOCKED |
| Généralisation du modèle réel | NON DÉMONTRÉE |

## Provisionnement proposé — à autoriser, non exécuté

1. Le propriétaire désigne une infrastructure privée dédiée, par exemple une VM
   Linux non privilégiée pour les jobs, avec user namespaces réellement disponibles.
   Point de départ à mesurer : 2 vCPU, 2–4 Gio RAM, disque borné ; coût monétaire
   UNKNOWN, dépendant de l'infrastructure choisie. Aucun achat/provisionnement ici.
2. Épingler image/toolchains et profil revu. Garder Chromium non-root avec sandbox
   actif. Ne pas reprendre les restrictions incompatibles du conteneur actuel en
   espérant un résultat différent ; établir une frontière indépendante approuvée.
   Pas de conteneur privilégié, host mounts sensibles ou CDP public. Chromium doit
   utiliser un pipe interne et des contexts propres par job.
3. Implémenter le récepteur HTTPS privé `/v1/acceptance` et son superviseur borné.
   TLS CA et certificat avec SAN IP ; firewall autorisant uniquement le client
   orchestrateur pour ce contrôle. Egress des produits/jobs DENY, sans accès à
   l'orchestrateur, au service de signature ou aux autres produits.
4. Associer une clé client Ed25519 au propriétaire autorisé, une clé de résultat au
   superviseur, et épingler sa clé publique côté orchestrateur. Les secrets restent
   hors du produit et des logs. Le superviseur doit signer uniquement ses propres
   résultats mesurés, jamais un PASS fourni par l'application.
5. Vérifier `validateRunnerRequest`, conserver durablement nonces et jobs par
   propriétaire/ID/hash ; même ID et même hash = même job, hash différent = refus.
   Le receiver refuse toute configuration/binding non autorisé. Un STATUS inconnu
   n'est pas un SUBMIT. Nettoyer même après deadline/déconnexion/crash.
6. Matérialiser uniquement les artefacts vérifiés dans l'espace du job, lancer
   l'entrée Node bornée, vérifier readiness puis exécuter le programme de confiance
   préparé par `prepareRunnerBrowser`. Le service de signature et les clés restent
   dans le superviseur, hors de cet espace. Limiter CPU/RAM/PIDs/disque/durée et
   taille des logs/evidence ; calculer les métriques réellement disponibles.
7. Installer la policy publique, CA et KeyObject via les services Builder existants :
   `browser: new DedicatedWebRunner(policy, new PrivateHttpsRunnerTransport(policy, ca), key)`.
   Créer la demande existante `resource_reservation` liée à
   `runnerApprovalAction(policy)` pour le produit ; seul le propriétaire la décide.
   Cette documentation ne crée ni n'approuve cette demande.
8. Avant activation : prouver le sandbox effectif, absence de réseau sortant/montages
   sensibles/secrets/CDP public ; séparation de deux produits ; limites, cleanup,
   perte de connexion et idempotence. Ensuite seulement approuver le runner.

## Critères d'acceptation de l'infrastructure

Une première preuve doit effectuer une navigation et un clic réels avec Chromium
sandboxé, puis un parcours d'application générée : formulaire, résultat, erreur
compréhensible, reload/persistance lorsque requis et viewport responsive pertinent.
Capturer moteur/version, observations sémantiques, diagnostics et captures bornées,
bindés à l'artefact et au plan figé. Un défaut réel doit rester FAIL après réparation
et produire un nouveau receipt pour l'artefact réparé. Vérifier aussi timeout,
CANCEL avec destruction attestée, reconnexion STATUS et absence de double exécution.

L'activation ne doit pas remplacer une interaction obligatoire par HTTP 200, une
capture ou un double. La promotion restera dérivée par les profiles/capability
registry existants, après répétitions indépendantes appropriées ; jamais manuelle.

## Validation

Environnement de commandes :
`PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH` ; pour la régression,
`NODE_USE_ENV_PROXY=1 NODE_OPTIONS=--use-system-ca`. Ces options concernent les
tests de l'orchestrateur, pas l'egress des produits.

| Commande / vérification | Résultat |
| --- | --- |
| `pnpm exec vitest run src/__tests__/product-factory/web-runner.test.ts --reporter=json --outputFile=/tmp/lot-6mb-web/targeted-final.json` | 49/49 PASS ; signatures réelles locales, transport et runner simulés |
| `pnpm exec vitest run src/__tests__/product-factory/model-builder.test.ts src/__tests__/product-factory/acceptance-benchmark.test.ts src/__tests__/product-factory/optimization-execution.test.ts --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=/tmp/lot-6mb-web/regression-investigation.json` | 42/42 PASS : ModelBuilder 25, benchmark 16, optimisation 1 |
| `timeout 20s pnpm exec vitest run src/__tests__/context-hardening.test.ts --maxWorkers=1 --minWorkers=1 --reporter=verbose` | Exit 124 ; même timeout connu, aucun résultat d'assertion fourni |

Tests ciblés : authentification et tampering, endpoint/configuration/TLS CA,
paths/hash/manifest/limites, approbation propriétaire réelle en SQLite, produit
étranger, nonce/identité/environment/plan falsifiés, délai, CANCEL, révocation,
rupture réseau et accusé SUBMIT perdu, reprise STATUS, cleanup inconnu, booléens
falsifiés, persistance/reload/idempotence et FAIL immuable. Une déclaration REAL
sur un transport SIMULATED ne peut pas produire de preuve de promotion.

Historique honnête des régressions :

- Première tentative non escaladée : 1 961/2 015 PASS, 54 FAIL. Les fixtures worker
  échouent en `mkdir` sous `/home/agent/.automaton/workspace`, hors des writable
  roots actuels. Aucune modification de tests ou production pour cacher ce blocage.
- L'autorisation de ce chemin avait été accordée au Lot 6M ; elle a été réutilisée
  pour les commandes de fixtures. Cela n'élargit ni le sandbox produit ni le
  réseau/les permissions du runner. Aucun changement de sécurité de production.
- Première régression autorisée à quatre workers : **2 011/2 015 PASS, 4 FAIL**.
  Cette exécution a précédé les six derniers cas unitaires du backend.
  Les quatre échecs sont : `private HTTP acceptance: 'habit-log'` et
  `'stock-reconciliation'` (3 tentatives au lieu des 2 attendues), ModelBuilder
  `isolates two simultaneous model builds with different code and persisted data`
  (NEEDS_REPLAN au lieu de PASS), et le test unique d'`optimization-execution`
  (PASS non atteint).
- Le dossier du dernier montre deux `ECONNREFUSED 127.0.0.1:8080` après readiness
  réussie puis une erreur préexistante du chemin HTTP lorsque le timeout restant
  est fractionnaire : `Received 7869.214479000002`. Les sources de
  `application-acceptance.ts` et `docker-product-sandbox.ts` sont inchangées.
- Investigation : les trois fichiers passent intégralement, 42/42, avec un seul
  worker. Une mesure minimale séparée du Docker sandbox donne exit 0 en environ
  254/257 ms pour deux commandes Node triviales ; pas de délai fixe de dix secondes.
  Un snapshot de container pendant la relance indique `oom_kill 0` ; ce snapshot
  ne démontre pas l'absence d'OOM lors du run précédent.
- La cause complète des quatre échecs n'est pas établie. La charge concurrente
  et le timing sont des hypothèses, pas des conclusions. Aucun changement
  spéculatif, augmentation de timeout ou assertion affaiblie dans ces suites.
  Une dernière régression complète à deux workers est consignée ci-dessous.

| Validation finale sur le code terminé | Résultat |
| --- | --- |
| `pnpm exec vitest run --exclude '**/context-hardening.test.ts' --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=/tmp/lot-6mb-web/broad-final.json` | **2 021/2 021 PASS, 83 fichiers, zéro échec** |
| Product Factory dans ce run | 407/407 PASS : Lots 1–4C 197 ; R 44 ; 5R 41 ; 6R 39 ; 6M 37 ; nouveau backend 49 |
| ModelBuilder dans ce run | 25/25 PASS |
| `pnpm typecheck` | Exit 0 |
| `pnpm exec tsc -p /tmp/lot-6mb-web/test-tsconfig.json` | Exit 0 ; configuration stricte temporaire incluant les nouveaux tests et les tests 6M/imports |
| `pnpm build` | Exit 0 ; runtime et CLI |
| `node dist/index.js --help` | Exit 0 ; aucun daemon démarré |
| `git diff --check` | Exit 0 |

Cette suite couvre également Task Graph, workers/HarnessRegistry, ResourceManager,
PolicyEngine, sécurité/injection, approvals, dépenses/finance, migrations et
persistance. Aucun nouveau fichier de test n'est exclu. Le timeout
context-hardening demeure séparé ; son exit 124 ne signifie ni PASS ni FAIL
d'assertion. La régression finale à deux workers est verte, mais la cause complète
des quatre échecs antérieurs à quatre workers reste non établie.

Les contrôles TypeScript/build ont été répétés après cette régression et sont
également verts. Le premier run autorisé avait chevauché des builds de validation ;
le run final a été effectué sans build concurrent. Cette différence ne suffit pas
à établir la cause des échecs. Aucun composant de production n'a été modifié pour
les rendre verts.

Archives locales : `/tmp/lot-6mb-web/targeted-final.json`, `broad-final.json`,
`broad-authorized.json`, `regression-investigation.json`, logs associés,
`context-hardening.log`, `docker-timing.json`, `container-diagnostics.json`,
`preservation.json`. Ces preuves de test ne sont pas des preuves de marché.

## Android et suites futures

Cette phase n'ajoute ni émulateur, adb, device, permission ou promotion Android.
Avant la phase Android : runner/device autorisé, SDK/ADB/images épinglés,
virtualisation/KVM ou appareil de test isolé, ressources bornées, sandbox et réseau
revus, test signing distinct du signing de production, installation/launch/UI
réellement démontrés. Réutiliser le même Task Graph/leases/receipts ; une preuve Web
ne certifiera jamais Android, et Android ne certifiera pas iOS.

La stratégie 6R reste indépendante : Android peut rester le choix stratégique
pendant que l'exécution est BLOCKED. Aucun Lot 7R/8R commencé.

## Préservation

HEAD : `d8f816881fd24b6f5e3d616e59edec387a447667`.
`constitution.md` inchangé ; hash SHA-256
`d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
Aucun commit, push, merge, PR, déploiement public, paiement, publication,
campagne, store submission ou provisionnement payant. Les modifications des
lots antérieurs sont conservées ; le sandbox Docker de production est inchangé.

L'inventaire initial compte 301 fichiers sous `src/docs/scripts` et les fichiers
de configuration inclus. Les six fichiers listés ci-dessus sont les seules
modifications intentionnelles de fichiers existants de cette phase ; les 295
autres sont identiques octet pour octet. Trois fichiers sont ajoutés.

Résumé `git status --short` inchangé dans sa structure : onze fichiers suivis
déjà modifiés avant cette phase (`messaging.test.ts`, `test-db.ts`,
`harness-types.ts`, `worker-inference-bridge.ts`, `config.ts`, `event-stream.ts`,
`local-worker.ts`, `task-graph.ts`, `database.ts`, `schema.ts`, `types.ts`) ;
répertoires non suivis `docs/`, `scripts/product-factory/`,
`src/__tests__/product-factory/`, `src/product-factory/` et fichier
`src/state/factory-tasks.ts`, conservés avec les travaux antérieurs et cette phase.
Les six fichiers modifiés et les trois ajoutés de cette phase se trouvent dans
ces répertoires déjà non suivis.
