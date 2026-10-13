# Lot 5R — carte d'intégration avant implémentation

Référence : branche `feature/product-factory`, HEAD
`d8f816881fd24b6f5e3d616e59edec387a447667`. Les modifications non commitées
Lots 1–4C et R sont conservées. Snapshot de contrôle local :
`/tmp/lot-5r-baseline/hashes.json`.

| Besoin 5R | Infrastructure existante | Intégration retenue |
| --- | --- | --- |
| Gouvernance | `CompanyOperatingSystem`, droits, admission PolicyEngine | Analytics fournit des mesures et diagnostics ; aucune décision commerciale automatique |
| Définitions/versioning | `company_records`, `CompanyStore`, `MetricDefinition` | Références exactes aux versions ; records analytiques append-only dans SQLite existant |
| Économie | `deriveEconomics`, `EconomicSnapshot`, `snapshot()` | Réutiliser les buckets/formules ; coûts absents restent UNKNOWN |
| Preuves | `CompanyEvidence`, `EvidenceEngine`, metadata V15 | Provider vérifié, lineage d'événements, provenance et nature explicites |
| Scorecard/reviews | `scorecard()`, `review()`, dossier Judge figé | Snapshot canonique et dossier analytique traçable, sans dashboard |
| Forecast/gap | `forecast()`, calibration, targets immuables | Inputs observés avec ranges ; jamais modification des objectifs |
| Product Health | `health()`, gates Contract et Builder | Signaux observés et données manquantes ; revenus ne neutralisent pas un incident |
| Capital/portfolio | Comparaisons/proposals/allocations existantes | Facteurs observés et rendements marginaux, aucune dépense exécutée |
| Feedback/mémoire | Tables feedback/learnings, causal records | Churn et explications avec provenance ; corrélation reste hypothèse |
| Expériences | Hypotheses/experiments et `experimentPlan` | Définitions figées, populations/expositions/guardrails ; aucun moteur d'exécution supplémentaire |
| Cadence/concurrence | Heartbeat durable, Task Graph, ResourceManager | Tâches locales de collecte/analyse dans le graph existant ; aucun timer dédié |
| Finance opérationnelle | SpendTracker, coûts Task Graph/reservations | Ne pas confondre operating capital et recettes client |
| Configuration | Factory et Company désactivées par défaut | Analytics optionnel, limites conservatrices ; providers sans credentials obligatoires |
| Persistance | SQLite/WAL V15 | Migration additive seulement si index/déduplication d'événements l'exigent ; aucune warehouse parallèle |
| Sécurité | PolicyEngine, approvals, sandbox 4C | Données externes non fiables, minimisation et redaction avant persistance ; aucun port/public launch/paiement |

Les abstractions existantes de Discovery et CompanyEvidence sont des ports de
sources, pas des connecteurs économiques live. Les adapter contrats Analytics
doivent vérifier identité, schéma, dates, devise, scope, unicité et autorité de
source ; un simple payload d'API ne devient pas une preuve observée fiable.

Limites initiales conservées : aucun LLM externe généraliste ni navigateur réel
démontré par les lots précédents. `context-hardening` présente un timeout connu.
Les données économiques de Lot R sont des doubles contract-compatible, pas
une preuve de revenu ou de rétention réels.

Implémentation retenue : V16 ajoute observations indexées et reçus minimaux de
 déduplication dans la base existante. Tous les autres records analytiques sont
versionnés par CompanyStore. Aucun connector vendor live ni credential requis.
Reports enrichis → Evidence existante → economicSnapshot → dossier analytics,
Scorecard/Weekly Review ; Task Graph/ResourceManager/HarnessRegistry restent les
seuls mécanismes de collecte/exécution et de retry.
