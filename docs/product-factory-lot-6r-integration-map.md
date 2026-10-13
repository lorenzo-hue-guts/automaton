# Lot 6R — audit and integration map

Audit completed before substantial implementation. The received specification
ends mid-sentence in Phase 6R22; this map covers the received requirements through
6R21 and identifies extension points. It does not substitute for the missing
continuation or claim Lot 6R implementation/validation.

## Starting state

- Branch: `feature/product-factory`.
- HEAD: `d8f816881fd24b6f5e3d616e59edec387a447667`.
- Existing dirty working tree for Lots 1–5R is preserved.
- Current schema: V16, following Company OS V15 and analytics V16.
- Constitution SHA-256:
  `d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
- Latest clean broad regression: 1,896/1,896 tests, 78 files, excluding the known
  separate context-hardening timeout. Original intermittent Builder failure was
  not reproduced; its root cause remains unestablished.

## Integration points

| Existing mechanism | Actual implementation | Lot 6R reuse / bounded extension |
| --- | --- | --- |
| Company domain | `company-types.ts`, `CompanyOperatingSystem` in `company-os.ts` | Extend existing BusinessCase/ProductContract and governance records; preserve optional backward compatibility |
| Durable history | `CompanyStore` in `company-store.ts`, SQLite `company_records` | Creator-scoped, append-only revisions, hash integrity, optimistic revision checks, identical-input idempotency and existing memory events; reuse this store |
| Business Case / Contract | `createContract`, `approveContract`, `contractBrief` | Attach auditable surface/monetization reasoning; retain exact version/hash/decision links into ProductBrief |
| Council / rights | `company-governance.ts`, `council`, `decide`, `company-policy.ts` | Decisions remain subject to policy/creator/quality; no new approval system |
| Evidence | `company-evidence.ts`, existing atomic Evidence, claims and assumptions | Surface choices, expected returns and learning must carry provenance, freshness, contradictions and nature |
| Analytics | `FactoryAnalytics` in `analytics-service.ts`, metric/journey/intelligence modules | Read exact report/definition versions, quality, funnel bottlenecks, cohorts, CAC/payback, saturation candidates and diagnostic hypotheses; no correlation-to-causation promotion |
| Experiment definitions | `CompanyOperatingSystem.experiment` | Already creates V12 hypotheses/experiments and an immutable `experimentPlan`; reuse IDs, metric definition versions and frozen success/failure criteria |
| Experiment measurement | `experimentProtocol`, `experiment`, `analyzeExperiment` | Existing exposure/primary metric/guardrail/sample checks feed governed decisions; never directly authorize SCALE |
| Capital | `CapitalProposal`, `capitalComparisons`, `requestAllocation`, `commitAllocation`, `releaseAllocation` | Compare marginal alternatives and scarce resources; reuse creator approval binding and local commitments, not financial execution |
| Operating resource caps | `company-guards.ts`, `companyProductUsage`, `ResourceManager` | Continue enforcing capital, compute, Builder-time, product/approval and incident capacity; product revenue is not operating capital |
| Portfolio | `PortfolioManager`, `portfolioState`, `portfolioAlternatives`, shadow/graveyard records | Extend economic overlays without replacing technical lifecycle; preserve active/shadow alternatives, HARVEST and auditable KILL/ARCHIVE |
| Product Health / quality | `health`, `quality`, `qualityResult`, `assertCompanyQuality` | Health and mandatory Contract quality remain release/scaling blockers independent of revenue |
| Goals / tasks | `FactoryOrchestrator.createProductGoal`, `planAction`, existing Task Graph | Private experiment actions get product/action metadata, dependencies, costs, timeout, retries, approval and failure scope on the existing graph |
| Research tasks | `CompanyOperatingSystem.planResearch` | Existing idempotent product-scoped research tasks; research capacity must not be silently changed into build work |
| Resource leases | `ResourceManager`, `state/factory-tasks.ts` | Classes already include build/research/monitoring/inference/compute/experiment; assignment reservation and terminal/replan reconciliation remain centralized |
| Workers / tools | `LocalWorkerPool`, `HarnessRegistry`, Factory build/analytics harnesses, `executeTool` | Any new private experiment harness uses existing worker registration/tool-policy/lease mechanisms |
| Builder | `BuildEngine`, `BuildPlanner`, `ModelBuilder`, model adapter, `BuildStore` | Existing brief/architecture/build/repair/acceptance workflow; do not duplicate execution for optimization |
| Acceptance / isolation | `DockerProductSandbox`, application/browser acceptance | Keep network-none, no host mounts/public ports, fixed image, non-root/caps/resource limits; no fake browser or mobile evidence |
| Memory / learning | `decide`, `learning`, growth/capability/benchmark records | Persist original reasoning, versioned outcomes and transfer hypotheses; synthetic successes cannot become real demand/capability |
| Revenue Gap / forecast | `scorecard`, `review`, `forecast`, analytics dossier/forecast links | Compare interventions against durable economics and measured drivers; no automatic new-product creation or target rewriting |
| Heartbeat | Existing heartbeat scheduler and `FactoryOrchestrator.heartbeatTask()` adapter | No new scheduler/timer or automatic registration; Factory/Company/analytics defaults remain disabled |

## Implementation constraints discovered

1. `BuildPlanner.plan` refuses a second build for an existing product unless an
   explicit revision/replan path is provided. Existing-product optimization must
   not silently bypass this invariant or create an unrelated Builder.
2. Capital commitments already bind proposal revision, decision, creator approval,
   product and usage baselines. New comparison logic must preserve those bindings
   and recheck capacity through the existing ResourceManager.
3. Company capital comparisons already protect critical health/crisis, reject stale
   assumptions/unresolved risks and require stronger evidence for material build,
   growth and scaling. Additional readiness must strengthen these gates.
4. Economic portfolio overlays coexist with `research`, `building`, `launch_ready`,
   `validation`, `optimizing`, `scaling`, `pivoting`, `killed`, `archived`. KILL/ARCHIVE
   route through existing cancellation/resource cleanup. Economic strategy and
   public execution are distinct.
5. Analytics providers are optional read-only SDK ports with deterministic contract
   doubles in tests. No live connector/data was validated. Missing, stale, synthetic
   or incomplete economics must not become observed optimization gains.
6. Experiments already have frozen Company and analytics protocols. Alternative
   interventions should create legitimate new protocols rather than redefine a
   primary metric/population after seeing results.
7. `company_records.kind` is extensible text; service kind whitelists and domain
   types determine supported records. Most new governance can reuse this table.
   No migration is added by this audit; need for one depends on the complete spec.

## Builder surface reality

- Demonstrated: deterministic model-contract doubles producing materially different
  Node/TypeScript applications, real isolated compilation/runtime, private HTTP
  requests, persistence/restart and repair acceptance.
- Production model path exists through the worker inference bridge; arbitrary
  unknown-product generation by a real external model was not demonstrated.
- Browser adapter exists; no real browser journey was demonstrated by Lot 4C.
- No Android/iOS/emulator/device/signing/store-submission capability is verified.
- No public deployment or real financial/commercial execution is available for
  this lot's acceptance.

The future surface registry must distinguish strategic surface fit from verified
technical capability, and long-term surface from a cheaper validation surface.
Node/HTTP evidence cannot establish complete WEB_SAAS, PWA, browser UX, native mobile
or multi-surface capability by itself.

## Scope of this audit

Only this document is added. No domain, runtime, config, migration, policy,
constitution, tests or execution behavior is changed. No commit/push/merge/PR,
public deployment, payment or campaign. Substantial Lot 6R implementation awaits
the missing continuation from Phase 6R22 onward, including final tests and
completion requirements.

## Completion note

The complete continuation was subsequently received and Lot 6R implementation
was authorized. The original audit above is retained as its historical starting
state. Implementation, validation and remaining limitations are documented in
[the Lot 6R report](product-factory-lot-6r.md). Company records supported all
additions; no migration beyond V16 was necessary.
