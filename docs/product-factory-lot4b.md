# Product Factory — lot 4B

Le mode modèle complète le builder déterministe du lot 4. Il est opt-in :
`BuildEngine` reçoit explicitement `ModelBuilderServices`, puis
`planner.plan(briefId, { limits, references: true })`. Aucun branchement au
heartbeat ou démarrage automatique n'est ajouté. La Factory reste désactivée
par défaut. Aucun service externe ni modèle payant n'a été appelé pour ce lot.

## Architecture effectivement retenue

Un Goal et le Task Graph existant portent le DAG optionnel :
`reference_research → architecture → model_build → validation → private_deployment`.
La recherche utilise les research slots, architecture/build les build slots,
validation/déploiement les monitoring slots. Les ressources, approbations,
policies et acknowledgements restent ceux des lots précédents. Le même
LocalWorkerPool exécute un nouveau harness; aucun ordonnanceur supplémentaire.

Les providers de références retournent des observations atomiques (patterns,
fonctionnalités attendues, différenciateurs, forces/faiblesses, plaintes,
onboarding, pricing, améliorations, anti-patterns). Chaque insight conserve
source/type/date/provider/licence/confiance/hash et porte explicitement
`untrusted-external-data`. Seuls les providers fixtures sont activés. Les
sources défaillantes, invalides, trop volumineuses ou aux licences non examinées
sont isolées. Aucun code, asset ou marque n'est importé depuis une référence.
Une consigne système fixe impose une implémentation originale; un garde refuse
la reproduction verbatim des longs résumés de références. Ce garde est
heuristique, pas une preuve juridique d'originalité.

`WorkerInferenceProductBuildModel` réutilise le client d'inférence existant,
avec une enveloppe de coût et une fonction de tarification fournies par
l'intégrateur de confiance. Le modèle retourne architecture, modifications de
fichiers, diagnostic et disposition. Il ne choisit pas un scaffold dans le
code de production. L'architecture comprend stack, composants, données, API,
frontend/backend/auth, paiements mock uniquement, instrumentation, tests,
déploiement, dépendances approuvées, commandes et artefacts attendus. Les
révisions sont conservées et liées au brief, Evidence et insights.

## Exécution et vérification

Les opérations passent par `executeTool` et le PolicyEngine fourni au worker.
Un refus empêche l'action correspondante. Les protections existantes ne sont
pas modifiées. Les outils Factory ajoutent des contrôles internes de ownership,
brief approuvé, réservation active, confinement, budget et dépendances.

Le backend fourni lance uniquement Node.js/TypeScript dans une image locale
immuable. Docker : aucun pull, aucun réseau, aucun port publié, aucun montage
hôte, filesystem racine en lecture seule, utilisateur non privilégié,
capabilities supprimées, limites mémoire/CPU/processus et tmpfs bornés. Les sorties sont bornées; un artefact dont la lecture est tronquée est refusé,
plutôt que persisté partiellement. Aucune
exécution hôte du code généré et aucun fallback non isolé. Les dépendances sont
uniquement des packages hors ligne explicitement approuvés (version, licence,
fichiers avec hashes vérifiés); aucun accès registry ni lifecycle script.

Chaque tentative suit PLAN/IMPLEMENT/BUILD/RUN/TEST/INSPECT/RETEST, ou FIX après
échec. Les erreurs structurées sont renvoyées au modèle. Après répétition du
même motif d'échec, la demande devient `replan`, autorisant une nouvelle
architecture et des modifications de code tout en conservant les critères MVP
approuvés. Les plafonds coût/compute/durée/commandes/itérations arrêtent la boucle
avec BLOCKED/FAILED/NEEDS_REPLAN. Une intervention demandée crée une approval
traçable; elle ne redémarre pas automatiquement le build.

Les probes d'acceptation sont définies dans le brief avant son approbation.
Le modèle ne peut pas les remplacer. Elles vérifient des sorties JSON attendues
et codes de sortie de processus réels : MVP, démarrage, intégration, erreurs,
instrumentation, persistance lorsque pertinente. Typecheck/build seuls ne
suffisent pas. Une seconde compilation doit reproduire les hashes des
artefacts. Le validator du lot 4 exige les receipts liés aux résultats du Task
Graph et les artefacts correspondants, puis le PASS de la boucle modèle.

Les modifications, hashes, commandes/stdout/stderr, critères, erreurs,
diagnostics, raisons, coûts, unités compute et durées sont persistés dans le KV
SQLite existant via BuildStore. Les unités compute comptent les appels modèle et commandes exécutées, avec leurs
durées; elles ne mesurent pas les tokens/GPU ni un coût matériel facturé.
Aucune nouvelle migration : V12–V14 sont
réutilisées. Les charges modèle sont comptabilisées dans task_graph avant appel
(enveloppe), puis ajustées à la tarification réelle; une charge incertaine reste
réservée/comptabilisée conservativement. Les revenus produit ne financent pas
ces budgets. Le garde de charge tient compte atomiquement des réservations
d'inférence classiques; en retour, le Resource Manager déduit les charges modèle
du budget d'inférence partagé, y compris dans les capacity snapshots.
Les fichiers restent dans le workspace de build du lot 4.

Après reload, architecture/tentatives/limites/code manifest/receipts et DAG
restent disponibles. Un conteneur orphelin peut être supprimé/recréé seulement
avec l'identité persistée, le label du build et l'image attendue. Ses données
éphémères ne sont pas restaurées : les probes repartent d'un sandbox propre.

## Démonstration et limites

Les fakes de modèle produisent trois applications avec code métier différent :
CRUD de clients persistant, analyse CSV groupée, et publication/recherche/
bookmarks de contenu persistants. Leur code est réellement compilé et exécuté;
les réponses du modèle et les références restent déterministes et synthétiques.
Cela démontre une boucle de construction multifichier et de réparation, pas
la capacité d'un LLM réel à construire arbitrairement une application.

Le runtime testé est Node.js/TypeScript avec frontière CLI JSON. Aucun frontend
navigateur, endpoint HTTP, screenshot, auth réelle ou paiement réel n'est démontré.
Des providers/probes supplémentaires peuvent réutiliser le même harness et
Task Graph, mais doivent apporter leurs propres preuves d'isolation et
acceptance. Le scanner de secrets est heuristique; il ne remplace pas une revue
sécurité complète. Le client d'inférence existant n'offre pas d'annulation : un
appel expiré est abandonné par le worker et son enveloppe conservée, sans nouvelle
itération; l'arrêt distant doit être apporté par un futur adapter compatible.

Le private deployment reste le provider synthétique du lot 4 : métadonnées
réversibles et artefacts validés, pas un hébergement applicatif permanent.
`launch_ready` ne publie rien. PublicLaunchGate reste fermé, même avec approval.
Analytics, acquisition, SCALE/PIVOT/KILL et dashboard restent hors périmètre.

Prochaine étape recommandée : renforcer le runtime d'acceptation avec un
parcours navigateur/HTTP privé dans le même sandbox, puis évaluer un modèle
réel sur un brief inédit sous budget explicitement autorisé. Aucun connecteur
Analytics n'est nécessaire pour cette évaluation.

## Fichiers de ce lot

Créés :
- `src/product-factory/model-build-types.ts`
- `src/product-factory/reference-research.ts`
- `src/product-factory/model-build-model.ts`
- `src/product-factory/model-build-harness.ts`
- `src/product-factory/model-builder.ts`
- `src/product-factory/docker-product-sandbox.ts`
- `src/__tests__/product-factory/model-builder.test.ts`
- `src/__tests__/product-factory/fixtures/model-applications.ts`
- `docs/product-factory-lot4b.md`

Étendus :
- `src/product-factory/build-types.ts`
- `src/product-factory/product-brief.ts`
- `src/product-factory/build-planner.ts`
- `src/product-factory/build-engine.ts`
- `src/product-factory/build-validator.ts`
- `src/product-factory/resource-manager.ts`
- `src/product-factory/index.ts`
- `src/product-factory/README.md`
- `src/agent/harness-types.ts`

Les autres changements non commités appartiennent aux lots précédents et sont conservés.
La préparation Docker est enregistrée hors dépôt dans
`/workspace/.onboarding-tools/prepare-product-sandbox.py` et dans le brouillon
cloud-environment-onboarding; manifests et lockfiles du dépôt n'ont pas changé.

## Validation finale

- `pnpm run typecheck` : PASS.
- Typecheck explicite des cinq fichiers de tests Product Factory via
  `pnpm exec tsc -p /tmp/product-factory-tsconfig.json` : PASS.
- `pnpm run build` (runtime + CLI) : PASS.
- Suite pertinente complète : **541 tests, 14 fichiers, aucun échec/skip**.
  Product Factory : 172 (147 des lots 1–4 + 25 nouveaux).
  Task Graph/workers : 74; policy : 26; sécurité/injection : 229;
  financial/spend tracker : 40.
- Vérification ciblée supplémentaire du refus des artefacts tronqués : PASS.
- `git diff --check` : PASS.

Commande de suite pertinente :

```bash
export PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH
export NODE_USE_ENV_PROXY=1
export NODE_OPTIONS=--use-system-ca
pnpm exec vitest run src/__tests__/product-factory \
  src/__tests__/orchestration/task-graph.test.ts \
  src/__tests__/orchestration/local-worker-harness.test.ts \
  src/__tests__/orchestration/local-worker-security.test.ts \
  src/__tests__/policy-engine.test.ts src/__tests__/tools-security.test.ts \
  src/__tests__/financial.test.ts src/__tests__/spend-tracker.test.ts \
  src/__tests__/injection-defense.test.ts src/__tests__/command-injection.test.ts \
  --maxWorkers=4 --minWorkers=1
```

Cette validation ne prétend pas couvrir l'intégralité de la suite du dépôt.
Les échecs de développement constatés avant correction concernaient la fixture
CRUD (lecture après suppression), le diagnostic de timeout masqué et la
réapprobation incorrecte dans le test de reprise; ils ne subsistent pas dans les
runs finaux. Aucun test réseau défaillant n'a été contourné.

Branche : `feature/product-factory`; HEAD inchangé :
`d8f816881fd24b6f5e3d616e59edec387a447667`.
Working tree volontairement non propre : lots précédents et ce lot non commités.
`constitution.md` inchangé (SHA256
`d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`).
Aucun commit/push/merge; aucun lancement public, achat, paiement ou transaction.
