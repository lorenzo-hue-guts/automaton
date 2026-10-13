# Lot R — R0 : audit et carte d'intégration

État de départ : branche `feature/product-factory`, HEAD
`d8f816881fd24b6f5e3d616e59edec387a447667`. Le working tree contient déjà les
lots 1–4C non commités. Ce document décrit l'audit ; il ne prétend pas que les
phases R1 et suivantes sont implémentées.

Les six parties de la spécification ont ensuite été réunies. Cette carte R0
a précédé l'implémentation ; le résultat et les validations figurent dans
[product-factory-lot-r.md](product-factory-lot-r.md).

## Mission et invariants à préserver

Mission conceptuelle demandée : identifier des opportunités, concevoir,
construire, commercialiser, opérer et améliorer des produits logiciels pour
maximiser la rentabilité durable du portefeuille appartenant au créateur.
North star : profit durable ajusté au risque et valeur client, soumis à la
constitution, aux policies, à la sécurité, à la qualité, aux preuves, au capital
disponible et aux approvals du créateur.

Recettes, profit, cash, activité et progrès sont des concepts distincts.
Les recettes produit ne financent pas automatiquement le budget opérationnel.
Les quatre fonctions permanentes demandées sont des responsabilités et droits
de décision ; elles n'impliquent pas quatre nouveaux agents permanents,
timers ou boucles LLM. Les capacités spécialisées sont appelables par contexte.

## Carte des infrastructures existantes

| Sujet | Implémentation actuelle | Extension envisagée, à confirmer avec le périmètre complet |
|---|---|---|
| SQLite/WAL | `src/state/database.ts`, connection `db.raw`, WAL, foreign keys, migrations transactionnelles ; `SCHEMA_VERSION=14` | Même connexion, méthodes typées et migrations additives uniquement si nécessaires. Aucun nouveau moteur de persistance. |
| Entités de base | `types.ts`, `store.ts` : opportunities, evidence, products, hypotheses, experiments, metricSnapshots, feedback, features, decisions, learnings, resourceReservations, capacitySnapshots, approvals, events | Réutiliser ces IDs, relations et stores ; ne pas créer un journal de décisions économique sans lien avec Decision. |
| Schéma V12 | Tables `factory_*`, FK produit/expérience/hypothèse, montants entiers en cents ; triggers ownership immuable, approvals créateur, événements append-only | Préserver triggers et ownership ; les nouveaux modèles doivent garder compte opérationnel et revenus créateur séparés. |
| Schéma V13 | Portfolio state, pauses/failures ; métadonnées Task Graph ; réservations gérées et contraintes d'assignation/libération | Réutiliser les réservations existantes pour toute tâche de recherche/gouvernance. |
| Schéma V14 | Métadonnées discovery/evidence, déduplication ; Decision peut précéder un produit et référencer une opportunity | Enrichir Evidence/Decision de façon compatible plutôt que les dupliquer. |
| Opportunités | `opportunity-engine.ts`, `opportunity-scoring.ts`, `discovery-types.ts` : 8 composantes /100, preuves, sélection déterministe, transition `brief_pending` | Business Case et desirability/viability doivent compléter le score, pas prétendre que le score prouve la rentabilité. Conserver le scoring ancien. |
| Evidence | `evidence-engine.ts` : source, capture, indépendance, résumé/extrait, relation supports/refutes, observation/inférence/hypothèse, fiabilité, tags, hash et trust non fiable | Ajouter niveau/nature économique, origine réelle/synthétique, validité/fraîcheur et claims sans reclassifier les anciennes fixtures comme comportements réels. |
| Discovery | `discovery-engine.ts`, providers `mode=fixture`, tâches research, erreurs de source isolées | Prévoir interfaces de futures preuves réelles sans activer scraping/connecteurs externes dans R. |
| Références | `reference-research.ts`, `ProductReferenceInsight` : patterns, pricing, faiblesses, plaintes, provenance, confidence, hash, sources publiques/licences allowlist | Réutiliser pour competitor observations et bibliothèque de principes, avec provenance et fraîcheur ; aucun contenu propriétaire copié. |
| Produits | `PortfolioManager` : scope créateur, capacité, research/building/launch_ready/validation/optimizing/scaling/pivoting/killed/archived, pause/cancel isolés | Séparer santé/qualité de recettes et état portfolio ; aucun SCALE/PIVOT/KILL automatique ajouté par anticipation. |
| Product Brief | `ProductBriefEngine` : lien SELECT Decision/opportunity/Evidence/score, validation, review et approval exacte ; `BuildStore` protège les briefs revus | Product Contract versionné lié au brief, sans changer les entrées anciennes ; nouvelles versions auditées, succès figé avant résultats. |
| Builds et déploiements | `BuildStore` : records `version=1` dans KV SQLite, bindings tasks, audits `event_stream` ; `BuildPlanner` produit Goal+DAG | Préserver schema/version des anciens builds. Contract/council/quality peuvent fournir des contraintes et gates supplémentaires pour les nouveaux produits concernés. |
| Orchestrator | `FactoryOrchestrator.tick()` transactionnel : OBSERVING→PLANNING→DISPATCHING→EXECUTING→EVALUATING→REPLANNING, états persistants, dispatch local, scope des erreurs | Services de gouvernance appelés par workflow ; ne pas ajouter un orchestrateur de compagnie concurrent. |
| Heartbeat | `src/heartbeat/scheduler.ts` DurableScheduler, `daemon.ts`, config SQLite ; `heartbeatTask()` Factory est un adaptateur optionnel | Toute future tâche périodique utilise la task map existante. Aucun enregistrement automatique ni nouveau timer dans R sans besoin explicite. |
| Task Graph | `src/orchestration/task-graph.ts`, helpers DB, `src/state/factory-tasks.ts` ; goals, DAG, retry/cost, Factory metadata, assignation locale avec réservation | Réutiliser pour expériences/recherches économiques et tâches de gouvernance exécutables. Pas de second DAG. |
| Resource Manager | `resource-manager.ts`, `allocation.ts` : slots build/research/monitoring/inference/compute/experiment, budgets, aging, incidents, réservations idempotentes persistantes | Capital allocation métier propose/plafonne des intentions ; ResourceManager reste l'autorité d'exécution des ressources. Revenus ne créent pas de capacité financière. |
| Workers/harness | `LocalWorkerPool`, `HarnessRegistry`, factory-local-build/factory-model-build et hooks before/complete/fail | Les quatre fonctions métier ne remplacent pas l'architecture worker et ne déclenchent pas de débats artificiels. |
| Modèle | `WorkerInferenceProductBuildModel`, `configuredProductBuildModel`, bridge vers client unifié ; états production/deterministic/unavailable | La gouvernance peut recevoir des assessments structurés mais ne traite pas la sortie d'un modèle comme preuve réelle ni comme autorité policy. |
| Exécution non fiable | `DockerProductSandbox` : digest immutable local, network-none, rootfs read-only, aucun mount/port, uid non privilégié, caps supprimées, ressources bornées | Aucune protection affaiblie pour des besoins commerciaux ou UI. |
| Acceptance HTTP | `application-acceptance.ts` : vrai runtime et client loopback intra-conteneur ; preuves liées au hash du probe approuvé | Réutiliser comme preuves FUNCTIONAL/RELIABILITY, sans les présenter comme preuve de demande ou achat. |
| Acceptance browser | `browser-acceptance.ts` : CDP fill/click/visible, dans sandbox, absence navigateur → indisponible | Gates UX/VISUAL/ONBOARDING nécessitent preuves adaptées ; BLOCKED/INSUFFICIENT_EVIDENCE si runtime absent. |
| Validation produit | `BuildValidator` : résultats structurés, receipts, hashes/artefacts, critères et preuves réelles ; promotion privée seulement | Gates du contrat complètent ces validations. Un compile PASS ne suffit pas ; aucun résultat modèle ne vaut automatiquement un test réel. |
| Public launch | `PublicLaunchGate.check()` retourne toujours `allowed:false` ; provider privé synthétique uniquement | Lot R ne doit ajouter aucun exécuteur public. |
| Policies | `src/agent/policy-engine.ts`, règles authority/financial/command/path/rate/validation ; admission Factory et tools/harness checks | Réutiliser exactement cette autorité. Council et droits de fonctions ne peuvent pas outrepasser deny/quarantine/approvals. |
| Finance opérationnelle | `SpendTracker` sur `spend_tracking`, fenêtres/limites ; coûts Task Graph et modèle conservés | Ne pas confondre ce spend tracker avec recettes, marge/profit/cash produit. Les prochains modèles économiques doivent les représenter explicitement sans transfert automatique. |
| Approvals | `ProductFactory.decideApproval()` et `factory_approvals`, créateur produit, actions exactes ; reprise liée au hash plafonds/actions | Étendre le vocabulaire au besoin, pas créer une deuxième validation humaine. Approbation humaine ne signifie pas autorisation de dépense/publication dans ce lot. |
| Decisions | `factory_decisions` : product/opportunity, outcome, rationale, evidenceIds | Council/company decisions enrichissent la même entité avec inputs, ownership, droits, désaccords, version et assumptions. |
| Learnings/expériences | Tables existantes reliées produit/hypothèse, goals/tasks facultatifs ; métriques génériques | Réutiliser pour protocoles figés, forecast-vs-actual et apprentissages avec niveau de preuve explicite. Ne pas revendiquer une performance économique sur fixtures. |
| Événements/mémoire | `factory_events` append-only pour lifecycle/approvals ; `event_stream` pour factory state/build audit ; mémoire existante | Événements structurés d'audit, pas un deuxième bus. Contenu externe demeure data non fiable. |
| Config | `resolveProductFactoryConfig`, defaults disabled/local-only, budgets zéro, approval true, public/ad/transactions false, ownership creator | Config de gouvernance conservative, compatible avec configs anciennes ; aucun canal commercial exécuté par défaut. |

## Lacunes constatées et risques d'intégration

1. `EvidenceKind` distingue observation/inférence/hypothèse mais ne dit pas si une
   observation est synthétique ou réelle. `providerId`, `sourceRef` ou une phrase
   de modèle ne suffisent pas à établir des niveaux 3–5. Les anciens records
   doivent garder une provenance inconnue/legacy prudente, sans promotion.
2. Pas de Confidence Ledger ni de registre d'assumptions critiques explicite.
   Le score cache est invalidé à l'ingestion, mais la fraîcheur et les changements
   d'assumptions ne sont pas encore des règles métier.
3. Le brief possède déjà pricing hypothétique, métriques et critères de succès/
   échec, mais pas Buyer/Business Case/GTM/contrat économique versionné complet.
4. `Product.revenueCents` est un cumul de recettes ; il ne représente ni profit,
   ni cash, ni rétention, ni santé produit. Aucun succès économique déduit de ce
   champ n'est acceptable.
5. Les services de recherche actuels sont fixtures-only. Des interfaces de
   gouvernance peuvent accepter de futures observations réelles, mais R ne doit
   pas activer les connecteurs futurs 5R ou exécuter acquisition/optimisation 6R.
6. Les droits Entrepreneuriat/Builder/Growth/Judge doivent être audités, avec
   résultats d'évidence dominant opinions. Une gate obligatoire ne peut pas être
   rendue NOT_APPLICABLE après avoir observé un échec.
7. Les contraintes SQL de Decision/events/approvals et les conventions de store
   doivent être examinées avant toute migration : éviter une duplication des
   concepts ou une modification inutile de toutes les tables V12.

## Preuves disponibles au départ, et limites

Lot 4C : cinq briefs distincts via un double d'inférence compatible contrat,
compilation/runtime/HTTP réellement exécutés dans Docker ; trois PASS complets,
deux BLOCKED faute de navigateur isolé. Aucun LLM externe réel ni parcours
navigateur réel démontré. Le privé reste synthétique. Ces preuves techniques
ne démontrent ni demande réelle, ni achat, ni rétention, ni profit.

Dernier run avant R : 70 fichiers / 1 811 tests verts, dont 197 Product Factory ;
`context-hardening.test.ts` interrompu après 20 secondes (124), suite complète
non déclarée passée. Cette référence n'est pas un nouveau run de validation R.

## État de cette phase

Audit R0 réalisé sur les sources et conventions existantes avant modification
du code. V15 étend ensuite ces infrastructures, sans changer les migrations
historiques ni introduire d'exécution commerciale. Aucun
commit/push/merge/PR, achat, paiement, compte commercial ou déploiement public.
`constitution.md` inchangé : SHA256
`d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
La spécification complète reçue en six parties est désormais la référence.
