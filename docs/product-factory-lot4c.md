# Lot 4C — acceptance du Builder généraliste

## Verdict

Le chemin de production du Builder est raccordé au client d'inférence existant,
et l'acceptance a désormais des preuves HTTP réelles dans Docker. La capacité
à généraliser avec un **modèle externe réel** reste **non démontrée** dans cet
environnement. Les deux applications UI restent `BLOCKED` car leur critère
navigateur obligatoire ne peut pas être exécuté dans l'image isolée actuelle.
Ce lot ne suffit donc pas à déclarer la factory autonome prête.

Les cinq briefs sont nouveaux par rapport aux fixtures du lot 4B. Leur modèle
d'inférence de test est un compilateur déterministe de contrats AST, au langage
borné. Il ne choisit pas parmi cinq applications prédéfinies et ne branche pas
sur les noms des produits : les contrats déterminent données, règles, routes
et modules. Il partage toutefois un transport HTTP, une stack Node/TypeScript
et des primitives fixes. Cela démontre l'intégration, l'adaptation de ce langage
de contrats et les parcours réels, **pas** une compréhension généraliste d'un
brief en langage naturel. Les diagnostics/corrections du double sont scriptés.

## Intégration effectivement retenue

`BuildPlanner → Task Graph → FactoryOrchestrator/ResourceManager →
LocalWorkerPool → HarnessRegistry(factory-model-build) → ModelBuilder →
WorkerInferenceProductBuildModel → createWorkerInferenceBridge → client
d'inférence unifié configuré`.

Aucun deuxième scheduler, worker, policy engine ou stockage. Le builder reçoit
brief approuvé, Evidence, références non fiables et résultats des tentatives.
Son prompt système fixe demande architecture, fichiers, diagnostic, plan de
réparation et remediation des critères approuvés. Les contenus du brief et des
références restent dans le message utilisateur. Le code de production ne
contient pas le compilateur AST du double de test.

`configuredProductBuildModel` distingue client de production et état
`unavailable`. Client absent, conversion de coûts absente ou plafond invalide
ne provoquent aucun fallback vers une fixture. Le bridge conserve maintenant
les coûts, tokens et métadonnées provider/modèle. Le prix vient de ces
métadonnées de confiance, jamais du JSON généré. En cas de retries/providers
échoués dont le coût n'est pas détaillé, l'enveloppe est conservée de façon
prudente. Chaque appel est tracé dans l'état persistant.

Dans les tests, ce chemin utilise `ContractInferenceDouble` comme backend du
client unifié. L'absence de credentials modèle appropriés a empêché une
validation externe sûre ; aucun appel à un LLM externe n'a été effectué.

## Acceptance HTTP et navigateur

Une architecture peut déclarer un runtime HTTP privé. Le sandbox démarre le
vrai processus Node puis un client de confiance, exécuté **dans le même
conteneur**, vérifie readiness, routes, statuts, corps et assertions approuvées.
Les chemins doivent être relatifs ; la destination est toujours
`127.0.0.1`. Il n'y a ni port publié, ni proxy hôte, ni changement réseau Docker.
Les fixtures vérifient plusieurs requêtes, erreurs, règles métier et redémarrage
du processus avec conservation des données lorsque le brief l'exige.

`SandboxChromiumAcceptance` fournit un adaptateur CDP avec navigation,
remplissage, clic et résultats visibles. Il utilise un navigateur **dans le
sandbox**, sans `--no-sandbox`. Le binaire Chromium présent sur l'hôte n'est pas
utilisé pour du code non fiable. L'image approuvée n'a pas Chromium : aucun
parcours navigateur réel n'est revendiqué. Le contrat de l'adaptateur a une
couverture déterministe ; les critères UI obligatoires enregistrent une preuve
indisponible et empêchent `PASS`/`launch_ready`.

Chaque preuve conserve `briefId`, hash du probe approuvé, révision
d'architecture, transport, nature real/simulated/unavailable, observation,
succès et raison d'échec. `BuildValidator` exige une preuve **réelle réussie**
pour chaque probe, en plus des checks et artefacts existants. La compilation
ou une affirmation du modèle ne peuvent pas remplacer ces preuves.

## Benchmark indépendant

Les résultats bruts du dernier run sont conservés dans
[product-factory-lot4c-benchmark.json](product-factory-lot4c-benchmark.json).
Ils comprennent IDs de build/brief, révision, structure générée, unités compute,
durée et raison terminale. Les coûts indiqués sont des coûts d'inférence tracés
du **double gratuit**, pas des estimations commerciales du build ou de Docker.

| Brief | Type | Modules métier générés | Parcours principal | Build | Runtime | HTTP | Browser réel | Persistance | Acceptance | Réparation | Itérations | Coût tracé | Statut |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| purchase-review | workflow/business SaaS | approve.ts, queue.ts, request.ts | Soumettre → refus lecteur → approbation unique | OK | OK | OK | N/A | OK + restart | OK | typecheck | 2 | 0 ¢ (double) | PASS |
| habit-log | personal productivity UI | checkin.ts, habit.ts, progress.ts | Habitude → check-in unique → progression | OK | OK | OK | indisponible | OK + restart | bloquée UI | démarrage | 2 | 0 ¢ (double) | BLOCKED |
| stock-reconciliation | data/import/reporting | import.ts, report.ts | Importer inventaire → rapport écarts | OK | OK | OK | N/A | OK + restart | OK | variance erronée | 2 | 0 ¢ (double) | PASS |
| linked-knowledge | knowledge/content UI | backlinks.ts, link.ts, note.ts | Notes → liens → backlinks, refus auto-lien | OK | OK | OK | indisponible | OK + restart | bloquée UI | JSON tronqué | 2 | 0 ¢ (double) | BLOCKED |
| dimension-conversion | stateless API/service | convert.ts | Conversion unités → refus dimension incompatible | OK | OK | OK | N/A | N/A | OK | aucune | 1 | 0 ¢ (double) | PASS |


Les modules métier et règles sont différents. Une variante supplémentaire
modifie un facteur de conversion à 42 sans changer le nom du produit, puis
vérifie le nouveau résultat HTTP : cela couvre l'adaptation du compilateur de
contrats, pas une preuve de généralisation d'un LLM. Les trois `PASS` passent
aussi la validation et le provider de déploiement privé **synthétique** existant.
Le serveur exécuté pour l'acceptance est réel et temporaire ; aucun hébergement
privé durable n'est ajouté dans ce lot.

## Réparation, budgets et reprise

Les erreurs réelles de compilation, démarrage et acceptance sont observées
puis fournies au modèle : `OBSERVE → DIAGNOSE → PLAN_FIX → FIX/IMPLEMENT →
BUILD → RUN → RETEST`. Le JSON tronqué/malformé est refusé et entre dans la boucle
de correction avec son coût conservé. Les tests du lot 4B couvrent aussi timeout,
plafond d'itérations et replan après erreurs répétées. Les refus de dépendance,
chemin ou policy restent bloquants, sans fallback permissif.

Un test de budget s'arrête après architecture, recharge l'état, demande une
approbation humaine exacte et poursuit le même DAG. `ModelBuildResume` lie
l'approbation au hash des plafonds et des IDs d'actions à reprendre. Modifier
ces plafonds après approbation est refusé. Les actions terminées ne sont pas
dupliquées ; les actions annulées par la pause existante sont réactivées avec
leurs dépendances, et les coûts/compute/temps déjà consommés sont conservés.

Un autre test simule une interruption entre actions, ferme/recharge SQLite,
requeue via ResourceManager, supprime uniquement le conteneur orphelin dont
l'identité appartient au build et réexécute dans un sandbox neuf. L'architecture
terminée n'est pas régénérée ; la tentative interrompue est conservée. Ce n'est
pas la simulation d'un crash à chaque instruction ni une garantie de reprise
exactly-once de tout effet externe.

Les limites existantes d'inférence, itérations, durée, commandes et compute
restent en vigueur. L'attente du modèle réagit à AbortSignal ; l'API d'inférence
existante ne permet pas d'annuler une requête externe déjà partie. Son enveloppe
reste réservée en cas de résultat incertain. Les tests utilisent des coûts
synthétiques pour prouver l'épuisement et la reprise, sans dépense réelle.

## Sécurité et isolation

Les checks policy existants précèdent les opérations sensibles, y compris
démarrage HTTP, requêtes privées et navigateur. Un refus HTTP empêche la première
requête d'acceptance. Les bindings build/task/product sont vérifiés, ainsi que
le propriétaire de la réservation ; une réservation étrangère ne déclenche
aucune inférence pour le build.

Docker conserve `network=none`, filesystem read-only, zéro montage hôte, zéro
port publié, uid 10000, capabilities supprimées, no-new-privileges, 256 MiB,
1 CPU, 64 processus et tmpfs bornés. Deux builds utilisent simultanément le
même port 8080 dans des conteneurs distincts. Les tests inspectent les paramètres,
vérifient l'absence des fichiers de dépôt/wallet et variables de secrets et
l'échec d'une connexion sortante. Les validations de chemins, symlinks, fichiers,
artefacts bornés, secrets hardcodés et dépendances approuvées restent actives.
Ces tests vérifient les barrières configurées ; ils ne constituent pas une
preuve formelle d'absence de vulnérabilité Docker ou Node.

Les recettes restent séparées du budget opérationnel et la propriété du créateur
est préservée. Factory reste désactivée par défaut. La public launch gate du
lot 4 reste fermée ; aucune publication réelle n'est implémentée.

## Fichiers de ce lot

Créés :

- `src/product-factory/application-acceptance.ts`
- `src/product-factory/browser-acceptance.ts`
- `src/product-factory/model-build-resume.ts`
- `src/__tests__/product-factory/acceptance-benchmark.test.ts`
- `src/__tests__/product-factory/model-contract.test.ts`
- `src/__tests__/product-factory/fixtures/acceptance-contracts.ts`
- `src/__tests__/product-factory/fixtures/contract-inference-double.ts`
- `docs/product-factory-lot4c.md`
- `docs/product-factory-lot4c-benchmark.json`

Modifiés, par rapport au lot 4B conservé :

- `src/agent/harness-types.ts`, `src/agent/worker-inference-bridge.ts`
- `src/product-factory/build-engine.ts`, `build-planner.ts`, `build-types.ts`,
  `build-validator.ts`, `docker-product-sandbox.ts`, `index.ts`,
  `model-build-model.ts`, `model-build-types.ts`, `model-builder.ts`,
  `product-brief.ts`

**Aucune migration ajoutée** : réutilisation de SQLite et des enregistrements
versionnés existants. Le schéma déjà modifié dans le working tree appartient
aux lots antérieurs.

## Validation finale

Commandes finales (Node 22.23.3 et pnpm 10.28.1 via le PATH de l’onboarding,
`NODE_USE_ENV_PROXY=1`, `NODE_OPTIONS=--use-system-ca`) :

- `pnpm typecheck` : **PASS**.
- `pnpm exec tsc --noEmit -p /tmp/product-factory-tsconfig.json` : **PASS** ;
  vérifie aussi les sept fichiers de tests Product Factory et leurs fixtures.
- `pnpm build` : **PASS**, runtime et package CLI compilés.
- `node packages/cli/dist/index.js --help` : **PASS**, aucune commande active exécutée.
- `pnpm exec vitest run --exclude '**/context-hardening.test.ts' --maxWorkers=4 --minWorkers=1` :
  **70 fichiers / 1 811 tests PASS**, 260,12 secondes. Cela inclut les lots 1–4C,
  Task Graph, LocalWorkerPool/harness, policy/security/injection, ressources,
  budgets, financial/spend tracker et les autres suites du dépôt.
- Product Factory dans ce run : **197 tests PASS** dans sept fichiers
  (32 foundations, 46 managers, 44 discovery, 25 build, 25 model-builder,
  16 acceptance-benchmark, 9 model-contract).
- `timeout --kill-after=2s 20s pnpm exec vitest run src/__tests__/context-hardening.test.ts --maxWorkers=1 --minWorkers=1` :
  **timeout, exit 124**, aucun résultat de test avant interruption. Ce fichier
  avait déjà bloqué l’onboarding ; il contient notamment une entrée répétitive
  de 500 000 caractères. La cause exacte n’a pas été profilée dans ce lot.
  La suite complète du dépôt n’est **pas** déclarée passée et ce fichier n’a
  pas été modifié. Aucun test réseau en échec n’a été rendu artificiellement vert.
- `git diff --check` : **PASS**.
- SHA256 de constitution vérifié ; aucun conteneur de build encore actif.

Les runs intermédiaires ont révélé un défaut de reprise (timeout fractionnaire
non accepté par le Task Graph puis descendants annulés restant inactifs).
Il a été corrigé ; le run final vérifie aussi le refus d’une approbation dont
les plafonds ont été modifiés. Les JSON et le tableau ci-dessus viennent du
run final. Les logs sont dans `/tmp/lot4c-{broad-tests,typecheck,test-typecheck,
build,cli-smoke,context-hardening}.log` dans l’environnement courant.

Branche `feature/product-factory`. HEAD inchangé :
`d8f816881fd24b6f5e3d616e59edec387a447667`.
Le working tree était déjà non propre et conserve intégralement les lots
précédents ; les nouvelles modifications restent non commitées.
Résumé `git status --short` final : 11 fichiers suivis modifiés ; répertoires
`docs/`, `src/product-factory/`, `src/__tests__/product-factory/` et fichier
`src/state/factory-tasks.ts` non suivis. La majorité de cet état appartient
aux lots précédents ; la liste ci-dessus isole les changements du lot 4C.
`constitution.md` inchangé, SHA256
`d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
Aucun commit, push, merge ou PR. Aucune transaction, paiement, publication
publique ou exécution de production. Aucun travail Analytics, Lot R ou Growth.

La prochaine étape d'acceptance est un run explicitement autorisé avec un
provider modèle réel et un coût plafonné, puis une image navigateur approuvée
compatible avec les protections existantes et de vrais parcours UI. Il faudra
répéter ce benchmark sans le compilateur AST avant d'affirmer une généralisation
autonome. Ces validations externes n'ont pas été lancées dans ce lot.
