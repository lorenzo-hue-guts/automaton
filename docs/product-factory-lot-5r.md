# Lot 5R — Analytics & Economic Intelligence

Le suivi de l'échec Builder de la suite élargie est documenté dans
[l'investigation dédiée](product-factory-builder-regression-investigation.md).
Les résultats ci-dessous conservent l'historique de la validation initiale.

## Portée et résultat

Lot 5R ajoute une couche analytique bornée, persistante et testable à Company OS.
Elle transforme des batches vérifiés en observations minimisées, métriques,
funnels/cohortes, diagnostics et dossiers Company. Elle n'exécute aucune campagne,
modification de prix, allocation financière externe ou publication.

**Aucun credential ni jeu de données live n'a été utilisé.** Les tests observés
utilisent des doubles déterministes des ports SDK/receipt de production dans des
bases temporaires. Ils valident les frontières et la logique ; ils ne prouvent
aucun revenu, achat, client, rétention ou résultat économique réel.

La limite Builder 4C reste intacte : pas de généralisation prouvée avec LLM externe
ni parcours navigateur réel. Ses sandbox, policies et gates ne sont pas modifiés.

## Audit 5R0 et infrastructures réutilisées

Voir [la carte d'intégration](product-factory-lot-5r-integration-map.md).

`CompanyOperatingSystem` demeure la façade compagnie. `CompanyStore` conserve les
records versionnés append-only ; `CompanyEvidence`/`EvidenceEngine` conservent les
preuves ; `deriveEconomics` reste la formule canonique. Owner Targets, forecasts,
reviews, health, capital, feedback et Decision Memory ne sont pas remplacés.

`FactoryAnalytics` est un service à la demande. Aucune boucle, timer, heartbeat,
Task Graph, Resource Manager, PolicyEngine ou worker parallèle n'est créé.
`planCollection()` utilise Company research → Factory goal/action existants et
research slots, avec rôle `factory-analytics`. Le harness optionnel se branche sur
HarnessRegistry/LocalWorkerPool et `executeTool` existants. Collect nécessite une
réservation active propre au produit ; retries, coûts et états terminaux restent
la responsabilité du Task Graph/Resource Manager. Une erreur de provider devient
une erreur d'action retentable, pas une panne compagnie.

L'admission fournie appelle et journalise PolicyEngine existant. L'absence
d'admission refuse l'ingestion/lecture. Une lecture read-only passe en catégorie
registry/caution ; les fixtures sont memory/safe. Les adapters sont des ports
internes de confiance, jamais des callbacks tirés du JSON d'un modèle.

## Fichiers exacts

Ajoutés :

- `src/product-factory/analytics-types.ts`
- `src/product-factory/analytics-config.ts`
- `src/product-factory/analytics-observations.ts`
- `src/product-factory/analytics-providers.ts`
- `src/product-factory/analytics-metrics.ts`
- `src/product-factory/analytics-journeys.ts`
- `src/product-factory/analytics-intelligence.ts`
- `src/product-factory/analytics-service.ts`
- `src/product-factory/analytics-harness.ts`
- `src/__tests__/product-factory/analytics-adversarial.test.ts`
- `src/__tests__/product-factory/analytics-intelligence.test.ts`
- `src/__tests__/product-factory/analytics-persistence.test.ts`
- `src/__tests__/product-factory/analytics-e2e.test.ts`
- `src/__tests__/product-factory/fixtures/analytics-fixture.ts`
- `docs/product-factory-lot-5r-integration-map.md`
- `docs/product-factory-lot-5r.md`
- `docs/product-factory-lot-5r-e2e.json`

Modifiés pour ce lot :

- `src/state/schema.ts`, `src/state/database.ts`
- `src/product-factory/company-types.ts`, `company-store.ts`, `company-os.ts`
- `src/product-factory/config.ts`, `index.ts`, `README.md`

Les autres modifications visibles dans Git appartiennent aux lots précédents et
sont conservées. Le snapshot de comparaison SHA-256 est
`/tmp/lot-5r-baseline/hashes.json`.

## Migration V16

Une seule migration additive après V15, sans réécriture historique :

- `analytics_observations` : événements minimisés, PK créateur/provider/event,
  index produit/date, JSON et hash d'intégrité ; UPDATE et REPLACE refusés.
- `analytics_event_receipts` : identité pseudonymisée minimale, fingerprint et
  référence financière nécessaires à dédup/corrections. Append-only, conservée
  indépendamment du détail utilisateur.

Les autres états analytiques utilisent `company_records` existant : sources,
checkpoints/health, couverture, quarantine, reports, définitions de journeys,
attribution, expériences, anomalies, diagnostics et dossiers. Pas de warehouse.

Le design permet une future purge des observations détaillées tout en gardant
les agrégats/hashes et reçus minimaux. Après disparition des inputs, le moteur
refuse de recalculer cette fenêtre comme si elle contenait zéro ; un replay reste
un duplicate. Aucune purge automatique ni nouveau scheduler n'est livré. La
rétention des reçus nécessaires à l'audit devra être fixée selon les obligations
et droits applicables avant raccordement de données réelles.

## Contrat et providers

`AnalyticsInput` est une normalisation encore non fiable. `AnalyticsObservation`
conserve ID provider/fingerprint, source/type, produit, identifiants pseudonymisés
par entity kind, event/category, occurred/received, devise, centimes entiers,
quantité, propriétés bornées, nature, verification, confidence, schemaVersion et
provenance/hashes. Catégories : acquisition, usage, activation, value, commerce,
subscription, retention, churn, support, reliability, cost et experiment.

Les natures MODEL/SYNTHETIC/PUBLIC/OBSERVED sont imposées par le provider enregistré,
pas le payload. Les métriques calculées depuis OBSERVED conservent lineage et
`CALCULATED_FROM_OBSERVED_DATA`, compatible avec Lot R. Leur confiance est bornée
par les sources et la qualité d'entrée.

Huit types de provider sont représentés : payments/billing, product analytics,
web analytics, marketplace, advertising, CRM/sales, support, infrastructure/cost.
`ReadOnlyAnalyticsProvider` accepte un SDK/transport autorisé, normalizer, verifier
et verifier de couverture. `SyntheticAnalyticsProvider` est exclusivement
SYNTHETIC et ne peut se présenter comme observation réelle.

La validation vérifie scope créateur/produit, dates avec timezone, événements
non futurs, montants/devise, propriétés, source, receipt et couverture. L'autorité
sur gross/refunds exige un provider billing/marketplace. Deux autorités concurrentes
pour la même mesure produisent UNKNOWN plutôt qu'une somme arbitraire.

## Idempotence, corrections et confidentialité

Provider event ID + source sont HMAC-pseudonymisés. Sans ID, un fingerprint
normalisé conservateur évite l'inflation au prix d'une possible sous-comptabilisation
de deux événements réellement indistinguables. Un ID rejoué avec un contenu
modifié est quarantiné. Deux envelopes transport liés au même receipt financier canonique ne sont pas comptés deux fois, même après purge ; un contenu contradictoire est rejeté. Le verifier SDK doit identifier le financial fact/line item canonique, pas seulement le webhook envelope. Le fingerprint du runtime pseudonym key empêche un changement
silencieux de clé de recréer les paiements après restart ; la clé n'est pas stockée.

Refund/chargeback/reversal sont de nouveaux événements. Référence au paiement,
produit/devise et cumul remboursé sont vérifiés ; un sur-remboursement est refusé.
Les dates de corrections restent leurs dates propres. Une arrivée tardive se
rattache à son occurred_at et crée un nouveau report/snapshot explicite ; une
Weekly Review ou cible historique ne se réécrit pas.

Aucun native payload, API header, secret ou carte n'est conservé. Identifiants
bruts/email sont remplacés par HMAC. Les propriétés sont une allowlist de dimensions
et mesures ; texte arbitraire/instructions sont abandonnés. Propriétés dangereuses
sont rejetées. Quarantine conserve digest HMAC et raison générique, pas le payload
ou l'erreur SDK. Les cursors sont des checkpoints normalisés très bornés
(page/nombre/history), pas des tokens d'API arbitraires ; les futurs SDK doivent
adapter leur pagination native à ce contrat.

## Metric Engine, économie et clients

Chaque report conserve scope/period/devise/nature/dimensions, définition/version,
event IDs/hashes, source IDs, références exactes aux couvertures, configuration/version du calcul, input hash, qualité et réconciliation. Reports et
Metric Definitions sont versionnés. Une définition modifiée sans calcul
compatible provoque un refus ; les définitions funnel/cohort/attribution exactes
sont également reliées aux métriques enrichies.

Dimensions supportées : produit/portfolio, channel, campaign, plan, region ; les
cohortes ajoutent entry day, version et segment. Users/accounts/customers/orders/
subscriptions restent des types d'identifiant distincts. Pas de dimensions libres
à haute cardinalité ajoutées.

Couverture complète vérifiée explicitement déclarée est nécessaire pour établir
un zéro. Missing/ambiguity/currency conflict reste UNKNOWN. Cash/committed capital
nécessitent une observation de stock ; leur absence ne vaut pas zéro.

Formules Lot R inchangées :

- net = gross − refunds ;
- contribution = net − payment fees − acquisition − model/API − hosting − variable − support ;
- profit = contribution − operating cost.

Une required cost inconnue garde contribution/profit inconnus. Les coûts doivent
être attribuables et disjoints dans les adapters ; aucune conversion FX implicite.
Les recettes produit ne modifient ni SpendTracker ni operating capital Automaton.

Métriques supplémentaires : first-purchase paying customers (lifecycle flag et
coverage explicites), active paid subscription customers, lost customers, expansion/
contraction revenue, ARPA par client payant, revenu par transaction, refund rate,
contribution margin et concentration du principal client. ARPU universel n'est
pas inféré d'un nombre d'utilisateurs quand le revenu est au niveau compte/client.

MRR = dernière valeur recurring settled active / intervalMonths ; ARR = 12×MRR,
run-rate, pas cash collecté. One-time/trial/unpaid exclus. GRR/NRR et customer churn
utilisent la population recurring d'ouverture, excluent les nouveaux entrants et
n'inventent pas une cause de churn. Voluntary/payment failure exigent un reason
explicite. L'état recurring ambigu est refusé plutôt que choisi arbitrairement.

## Funnels, cohortes, attribution, CAC/LTV/payback

Funnels versionnés : entity explicite, étapes ordonnées, fenêtre temporelle,
first-value et dénominateurs. Comptage distinct, conversions/drop-off et median
time-to-next/value sont calculés ; un mauvais ordre d'événements n'est pas une
conversion. Les bottlenecks >50% de drop-off sur sample suffisant sont candidats,
pas causes établies.

Cohortes : entrée, horizon, type activity/account/paid/repeat-purchase, groupBy et
return events explicites. Right-censoring exclut les entrées trop jeunes du
dénominateur ; tiny cohort baisse confidence et expose sample/warnings. Revenue
peut être attribué par entity ; contribution cohorte reste UNKNOWN sans allocation
de coûts fiable. Ouvrir deux fois l'app n'est pas une rétention universelle.

Attribution versionnée FIRST_TOUCH/LAST_TOUCH/DIRECT/PROVIDER_REPORTED/CUSTOM/UNKNOWN.
CUSTOM sans implémentation fiable reste inconnu. CAC nécessite spend, first-purchase
customer/account IDs, touches/window et coverage fiables ; sinon UNKNOWN. Ce n'est
pas une preuve causale d'acquisition incrémentale.

LTV expose OBSERVED_TO_DATE/INSUFFICIENT_DATA dans l'implémentation actuelle, avec
interfaces ESTIMATED/MATURE_COHORT réservées à un modèle ou une maturité explicitement
vérifiés. L'âge seul ne certifie aucune lifetime. Scorecard conserve LTV UNKNOWN
pour une cohorte jeune et sépare observedValueToDate. Payback calculable est une
estimation de jours à partir de la contribution par client/jour, jamais gross seul.

Marginal intelligence compare les contributions/coûts de première/seconde moitié
de période sur les sources autoritatives ; détérioration récente peut signaler
saturation malgré un bon historical average. Aucun spend exécuté.

## Expériences, qualité, réconciliation, anomalies et diagnostic

Protocoles reliés au Company experiment existant : control/variant, entity,
exposure, primary event, guardrails, fixed period et sample. Changement de primary/
population après outcome est refusé, même sous un alias du même experiment ; une
nouvelle Company experiment auditable est nécessaire. Cross-arm contamination
est refusée. Tiny sample ou garde négative empêche de déclarer un succès.
Un résultat positif est au plus CANDIDATE_IMPROVEMENT, jamais une décision de scale.

Qualité détaille COMPLETENESS, FRESHNESS, UNIQUENESS, VALIDITY, CONSISTENCY,
TIMELINESS, SOURCE_TRUST. Confiance calculée reste une heuristique explicable,
pas certitude scientifique. Reports stockés expirent aussi pour les calculs
ultérieurs, pas seulement lors d'une nouvelle collecte.

Billing est system of record ; le tracker contradictoire n'est ni moyenné ni
additionné. La discrepancy est persistée et baisse la confiance. Currency/nature/
period/population/definition incompatibles ne sont pas comparés.

Anomalies : historique comparable minimal, médiane/MAD, variation matérielle,
sample/confiance et persistance. Une seule pointe est candidate. Pulse peut recevoir
un signal matériel ; Crisis exige corroboration par health critique et persistance.
Diagnostics exposent faits/variations, drivers candidats, contradictions et missing
inputs. Coûts croissant plus vite que gross signalent marge en détérioration ; un
driver conversion/value en baisse peut expliquer un gap à investiguer. Toujours
`causal:false` ; aucun classement de causes certifiées.

## Intégration Company OS

`publish()` produit des Evidence atomiques par métrique, vérifiées par hash/version/lineage du
report, puis appelle `CompanyOperatingSystem.snapshot()` existant. Chaque preuve garde sa propre confiance et son niveau : tier 4 pour gross/refunds vérifiés, tier 3 pour usage/cohortes/costs, aucun gain de confiance hérité du revenu. Le verifier
préserve scope, period, currency et mesure exacte. Sources stale publient UNKNOWN.
Un snapshot figé requiert une nouvelle clé pour une correction.

`enrich()` raccorde conversion, first-value, retention/churn et unit intelligence
aux mesures publiables. `dossier()` fournit metric versions, quality et hashes ;
Company Weekly Review et Scorecard intègrent ce dossier, sans dashboard.

`forecastInputs()/forecast()` utilisent les fenêtres observées comparables et un
range historique transparent ; durée cible et hypothèse stationnaire sont
explicites, confiance baisse sur horizon plus long. Owner Target reste distinct
et inchangé ; Revenue Gap conserve un range, ne crée pas une nouvelle application.

Health dérive erreurs/support observés et garde les incidents critiques face à du
synthétique ou stale. Portfolio intelligence expose economics, health, risk,
capital et Builder cost séparément. Capital intelligence fournit CAC/payback/
marginal factors ; les propositions/decisions/approvals/allocation restent Lot R.
Pas de score opaque ni d'exécution automatique des alternatives.

## Adversarial A–X et E2E

| Scénario | Vérification |
| --- | --- |
| A/B | Duplicate compté une fois ; paiement/refund → net correct |
| C | Trial/signup ne produit pas client payant/revenu |
| D/E | Coût manquant → UNKNOWN ; synthétique reste synthétique |
| F/G/H | System of record + discrepancy ; stale baisse confiance ; mauvais payload quarantine |
| I/J | Devise et périodes incompatibles refusées |
| K/L | CAC insuffisant UNKNOWN ; jeune cohorte ne connaît pas sa LTV |
| M | Conversion positive + churn/refund guardrail négatif → pas de win |
| N/O | Détérioration de marge et de rendement marginal visibles |
| P/Q | Tiny cohort prudent ; panne provider isolée |
| R/S | Restart sans double revenu ; late event audité sans réécriture historique |
| T/U | Observé domine modèle ; recettes n'alimentent pas Automaton |
| V/W | Duplicate ne crée pas spike ; driver mesuré candidat, sans causalité |
| X | Gross en hausse/contribution en baisse visible dans dossier/scorecard |

Cas additionnels : identité de clé, sur-refund, replay contradictoire, secret/cursor,
reservation/timeout, migration/rollback, version de metric non implémentée,
retention/pruning, synthetic health incapable d'effacer incident, valid CAC/payback,
protocol expérimental figé et signal persistant robuste.

La [trace E2E](product-factory-lot-5r-e2e.json) est explicitement une simulation :

| Produit | Forme | Gross | Profit | Rétention d'activité définie |
| --- | --- | ---: | ---: | ---: |
| A | Subscription-like, bonne activation | €10 | €3,50 | 20% |
| B | Revenu moindre, bonnes economics | €8 | €7 | 80% |
| C | Gross élevé, acquisition/model coûteux | €50 | −€10 | 50% |

Duplicate/refund/tracker discrepancy, metric stale, capital limité, target €200,
forecast et Revenue Gap €118,40–188 sont inclus. La comparaison choisit
`proposal-1` (B), pas le plus gros revenu C. Target MISSED reste MISSED. Toutes
ces valeurs sont des fixtures ; aucun succès économique réel revendiqué.

## Persistance et restart

Tests : upgrade V15→V16, rollback, event IDs/receipts, replay reload, définitions,
reports/hashes, funnels/cohorts, attribution/units, protocol/result, qualité,
provider cursor/state, snapshot, dossier, scorecard/review et capital inputs.
Les records d'anomalies/diagnoses utilisent le même append-only CompanyStore.
Frozen report analysis n'absorbe pas de late events ajoutés après ses input IDs.

## Readiness et limites

| Input/capacité | État honnête |
| --- | --- |
| Pipeline canonique + port SDK read-only | Compatible données réelles vérifiées ; validé par doubles, aucun provider live démontré |
| Billing/product/web/marketplace/ad/CRM/support/infra | Types/ports présents ; connecteurs vendor live NOT IMPLEMENTED |
| SDK/receipt observé des tests | FIXTURE ONLY, doubles contract-compatible |
| SyntheticAnalyticsProvider | SYNTHETIC ONLY |
| Credentials/accounts/live revenue | NOT IMPLEMENTED / jamais utilisés |
| LTV extrapolée ou lifetime complète | NOT IMPLEMENTED, UNKNOWN/observed-to-date préservés |
| Attribution CUSTOM/statistiques avancées/cohort cost allocation | NOT IMPLEMENTED au-delà des contrats et UNKNOWN prudents |
| Dashboard/campagne/pricing/spend/auto-optimization | Déférés aux Lots 6R/7R/8R |

Les verifiers et déclarations de couverture sont des ports internes de confiance :
un vrai adapter doit vérifier le SDK, son identité et les receipts, pas renvoyer
simplement `true`. Les limites sont explicites ; un gros backfill doit être découpé
en fenêtres/pages. L'historique subscription est borné ; il ne remplace pas un ledger
billing complet. Pas de conversion FX ou de causal inference automatique.

Les futures policies de purge devront invalider les recalculs et respecter les
reçus/hashes utiles à l'audit. Aucun mécanisme automatique de purge commerciale ou
privacy subsystem parallèle. La production ne dépend pas d'un catalogue de fixtures,
mais son raccordement live reste à valider.

## Commandes et résultats finaux

Environnement réutilisé : Node 22.23.3 / pnpm 10.28.1, outil Node/pnpm du setup
existant. Réglages proxy/TLS existants : `NODE_USE_ENV_PROXY=1` et
`NODE_OPTIONS=--use-system-ca` ; aucune désactivation de vérification TLS.
Aucune nouvelle dépendance, configuration cloud ou credential ajouté.

```sh
pnpm typecheck
pnpm exec tsc --project /tmp/lot-5r-test-tsconfig.json --noEmit
pnpm build
node dist/index.js --help
pnpm exec vitest run src/__tests__/product-factory/analytics-*.test.ts --maxWorkers=4 --minWorkers=1
pnpm exec vitest run --exclude '**/context-hardening.test.ts' --maxWorkers=4 --minWorkers=1
pnpm exec vitest run src/__tests__/product-factory/model-builder.test.ts --maxWorkers=1 --minWorkers=1
timeout --kill-after=2s 20s pnpm exec vitest run src/__tests__/context-hardening.test.ts --maxWorkers=1 --minWorkers=1
git diff --check
```

| Check | Résultat constaté |
| --- | --- |
| Typecheck production | PASS, exit 0 |
| Typecheck explicite des nouveaux tests/fixtures | PASS, exit 0 |
| Build runtime et CLI | PASS, exit 0 |
| CLI help sans démarrer Automaton | PASS, exit 0 |
| Lot 5R final | **41 tests / 4 fichiers PASS**, 3,02 s |
| Suite large hors context-hardening | **1 890 PASS / 1 FAIL**, 77 fichiers PASS / 1 FAIL, 363,27 s |
| Model Builder isolé, suite entière | **25/25 PASS**, 243,46 s |
| Context-hardening isolé | **timeout 20 s**, exit 124 ; aucun résultat terminé |
| git diff --check | PASS |

Lot R : ses 44 tests passent dans la suite large. Les autres Product Factory Lots
1–4C passent, à l'exception de l'incident parallèle décrit ci-dessous, puis la suite
Model Builder entière passe isolément. La suite large couvre également Task Graph,
workers/harnesses, Builder/ModelAdapter, policy/security/injection, reservations,
approvals, financial/spend tracking et migrations. Les dernières protections
Analytics-only et métadonnées de reproductibilité sont couvertes par les 41 tests
finaux ; les nombres ne sont pas additionnés pour prétendre un nouveau run global.

**La suite globale n'est pas déclarée entièrement verte.** En parallèle, le test
`model-builder.test.ts > replans a repeated architecture failure and persists the
revision` a échoué sur `fake.calls.some(c => c.phase === 'replan')`, false au lieu de
true. Il a duré 74,43 s dans ce run. Sans modifier code/test/limites, la suite entière
25 tests repasse isolément ; ce test passe en 31,37 s. La cause exacte n'a pas été
établie. Une sensibilité à la charge/aux limites de commandes Docker reste une
hypothèse à investiguer, pas une explication démontrée.

Le timeout context-hardening connu est reproduit indépendamment. Son code et ses
protections ne sont pas modifiés. Certaines intégrations read-only existantes
peuvent afficher RPC 413/avertissements du proxy ; aucune transaction réelle envoyée.

Une première exécution large a été arrêtée : elle n'avait pas les réglages proxy
existants (timeout `GeneralHarness` web_fetch/x402 alias) et les sources avaient
encore changé pendant son exécution (cache de migration V16 incohérent). Ces
résultats ne sont pas utilisés comme validation. Les réglages proxy ont été repris,
puis les sources stabilisées pour la suite large rapportée. Le typecheck des tests
a aussi détecté un argument `shouldRetry` manquant dans un nouveau test ; corrigé
sans modifier ResourceManager. Aucun test n'a été désactivé ou affaibli pour passer.

## Invariants et état final

- Branche uniquement `feature/product-factory`.
- HEAD inchangé : `d8f816881fd24b6f5e3d616e59edec387a447667`.
- Constitution inchangée, SHA-256
  `d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
- Ownership créateur et séparation operating capital / recettes produit inchangées.
- Aucun commit, push, merge, PR ou déploiement public.
- Aucun achat, paiement, ad spend, transfert financier ou compte commercial réel.
- Aucun Lot 6R/7R/8R démarré ; ni dashboard ni optimization/exécution commerciale.
- Working tree volontairement non propre : 11 fichiers suivis modifiés, dossiers
  non suivis `docs/`, `src/__tests__/product-factory/`, `src/product-factory/`, et
  `src/state/factory-tasks.ts`, qui incluent les lots précédents conservés.
- Aucun conteneur de build encore actif à la vérification finale.

Prochaine étape recommandée : intégrer un premier SDK/vendor **read-only** derrière
les ports vérifiés et comparer ses receipts/couvertures à une source de référence,
avec credential injecté par l'environnement et données minimisées. Avant toute
optimisation Lot 6R, valider sur données live l'absence de duplications, les periods,
la qualité des coûts/attributions et l'exactitude du dossier Judge. Ne pas considérer
les fixtures actuelles comme cette validation live.
