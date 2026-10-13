# Lot 6R — optimization, surfaces and controlled capital intelligence

This lot extends the existing Company OS. It does not prove real profitability,
real market validation, arbitrary external-model generation, or mobile capability.
Economic and market acceptance uses deterministic, contract-compatible provider
fixtures. Private application acceptance executes actual code in the existing
Docker sandbox.

## Integration map and persistence

The pre-implementation audit is in
[the integration map](product-factory-lot-6r-integration-map.md). CompanyOperatingSystem,
CompanyStore, Company evidence/decisions/contracts/quality/health, Lot 5R analytics,
FactoryOrchestrator, PortfolioManager, Task Graph, ResourceManager, LocalWorkerPool,
HarnessRegistry, PolicyEngine, SpendTracker and Builder are reused.

There is no new scheduler, heartbeat, database, approval system or worker engine.
No migration is added: the current schema stays **V16**. Existing V15
`company_records` supports coherent additive record kinds, revisions, hashes,
optimistic concurrency, creator scoping and identical-input idempotency. Existing
V12 hypotheses/experiments and approvals, Task Graph metadata and resource leases
are used for experiment plans and execution. Historical migrations are unchanged.

New record kinds: `surfaceBenchmark`, `productSurfaceDecision`,
`builderSurfaceCapability`, `optimizationMonetization`, `optimizationOpportunity`,
`optimizationIntervention`, `optimizationSelection`, `optimizationDecision`,
`optimizationPrivateOutcome`, `optimizationScaleReadiness`, `optimizationCapital`,
`optimizationLearning`. Generic CompanyOS.record cannot bypass their guarded
services. No new financial transaction store exists.

## Files for this lot

Added:

- `src/product-factory/optimization-types.ts`
- `src/product-factory/optimization-config.ts`
- `src/product-factory/product-surfaces.ts`
- `src/product-factory/optimization-logic.ts`
- `src/product-factory/optimization-service.ts`
- `src/product-factory/optimization-execution.ts`
- `src/__tests__/product-factory/fixtures/optimization-fixture.ts`
- `src/__tests__/product-factory/optimization-adversarial.test.ts`
- `src/__tests__/product-factory/optimization-company.test.ts`
- `src/__tests__/product-factory/optimization-execution.test.ts`
- `docs/product-factory-lot-6r.md`

Modified relative to the preserved implementation baseline (Lots 1–5R plus the completed 6R0 audit):

- `docs/product-factory-lot-6r-integration-map.md`: original audit retained; completion note added.

- `src/product-factory/company-types.ts`: optional surface references on existing
  BusinessCase/ProductContract and optional optimization context on CapitalProposal;
  additive CompanyEntityMap records.
- `src/product-factory/company-store.ts`: new kinds in existing store whitelist.
- `src/product-factory/company-os.ts`: guarded record admission, optional/required
  surface reference validation and surface context in the existing Contract→Brief path.
- `src/product-factory/company-guards.ts`: exact current Contract/surface check;
  unsupported validation surface blocks Builder; private experiment compute/duration
  contributes to existing usage budgets, including failed execution.
- `src/product-factory/config.ts`: optional conservative optimization configuration.
- `src/product-factory/index.ts`: exports.
- `src/orchestration/task-graph.ts`: optional structured private-experiment receipt
  in the existing TaskResult. No graph replacement or parallel scheduler.

Prior uncommitted files are preserved; git status also includes those earlier lots.

## Product surface and market intelligence

All eleven surfaces are explicit: WEB_SAAS, WEB_APP, PWA,
MOBILE_CROSS_PLATFORM, ANDROID, IOS, API_SERVICE, DESKTOP, BROWSER_EXTENSION,
MULTI_SURFACE, UNDECIDED. Monetization is a separate decision.

Market Format Benchmarks retain direct/adjacent product observations, outcome,
format, price ranges, channels, onboarding, complaints, source references, evidence,
capture/expiry dates and interpretation. They explicitly forbid copying. Evidence
is untrusted input, not executable instructions.

Surface Fit uses explainable contextual rules, not a universal weighted truth:
native workflows, integration/service workflows, embedded browser workflows,
desktop requirements, mobile sessions/notification value, web distribution and
collaboration. Arbitrary additional factors remain auditable. Missing workflow
support returns UNDECIDED. Competitor prevalence is recorded, not treated as a
command. Higher-level observed context overrides lower-level synthetic claims;
staleness, refutation and material platform risks reduce confidence.

A proven narrow question may use a materially cheaper alternative for validation.
Long-term and validation surfaces remain separate. Choosing native does not silently
turn into Web because the Builder finds Web easier. MULTI_SURFACE requires distinct
workflow/incremental-value evidence. Surface changes create new versions/decisions;
Contracts bind exact hashes/revisions. Builder input includes the problem, outcome,
constraints, evidence and surface decision without making Builder the economic owner.

New optimization-era Contracts require a surface when the Factory optimization
configuration is enabled. Older Contracts retain compatibility. Unsupported
validation surfaces are explicitly blocked by the existing Builder gate.

## Builder capability honesty and mobile roadmap

Initial registry status is conservative:

| Surface | Overall status | Actual scope |
| --- | --- | --- |
| API_SERVICE / WEB_APP / WEB_SAAS | PARTIALLY_SUPPORTED | Existing Node/TypeScript, compilation/tests/runtime/private HTTP with deterministic model doubles; per-capability defaults EXPERIMENTAL, no universal browser/UI/auth/payment claim |
| PWA | NOT_IMPLEMENTED | No PWA-specific installation/offline/browser acceptance demonstrated |
| ANDROID / IOS / MOBILE_CROSS_PLATFORM | NOT_IMPLEMENTED | No generation/compilation/device/packaging acceptance |
| DESKTOP / BROWSER_EXTENSION / MULTI_SURFACE | NOT_IMPLEMENTED | No surface-specific acceptance demonstrated |
| UNDECIDED | NOT_IMPLEMENTED | Not an execution capability |

Every SUPPORTED claim requires a real, owned, validated build proof in the
implemented proof verifier. Model claims, synthetic opinion and Web build receipts
cannot establish Android/iOS support. Full surface support requires every relevant
capability, not just compilation.

| Requested mobile capability | Android | iOS | Cross-platform |
| --- | --- | --- | --- |
| Project generation | NOT_IMPLEMENTED | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| Compilation | NOT_IMPLEMENTED | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| Emulator/simulator/device launch | NOT_IMPLEMENTED | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| Interaction/runtime testing | NOT_IMPLEMENTED | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| Packaging | NOT_IMPLEMENTED | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| Signing readiness | NOT_IMPLEMENTED | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| Store artifact readiness | NOT_IMPLEMENTED | NOT_IMPLEMENTED | NOT_IMPLEMENTED |

`MOBILE_ACCEPTANCE_CONTRACT` specifies generation, dependency resolution,
compile/build, tests, launch, actual navigation/device interaction, persistence,
network behavior, responsive layout, crashes, permissions, packaging, signing,
release artifacts, store metadata and privacy. It is a **contract**, not implemented
mobile tooling. Store submission remains separate from artifact readiness.

Recommended next Builder step: a narrow Android harness/immutable SDK image using
existing workers, Task Graph, resource leases, policy and Contract acceptance, then
real emulator/device journeys. iOS requires an authorized macOS/Xcode runner.
Prove each capability independently before promoting its status. No real browser
journey was run for this lot; the existing Lot 4C interface remains available for a
future quality adapter.

## Monetization and purchase friction

FREE, FREEMIUM, monthly/annual subscription, ONE_TIME, USAGE, CREDITS, PER_SEAT,
TRANSACTION, COMMISSION, B2B_CONTRACT, HYBRID, NO_MONETIZATION_YET and DO_NOT_BUILD
are represented. Recurring pricing requires recurring value. Price/fee ranges,
platform constraints, review/refund mechanics and expiry/provenance are retained.
There are no eternal hard-coded store fees. Purchase trust remains UNKNOWN or
HYPOTHESIS unless fresh observed supporting behavior exists. This lot neither
charges a customer nor changes live pricing.

## Optimization and experiment decisions

The engine reads exact Lot 5R report/funnel revisions and canonical definitions.
Critical health prioritizes reliability/PROTECT; falling contribution can prioritize
cost before growth; measured funnel and retention problems can prioritize activation,
conversion or retention. Missing baseline data stays UNKNOWN. Explanations remain
candidate mechanisms, not causal claims.

Seventeen opportunity classes cover acquisition through PRODUCT_SURFACE and
NEW_PRODUCT. Each intervention retains customer value, uncertainty, evidence,
assumptions, expected contribution/VOI ranges, money, Builder hours, compute,
inference, duration, downside, reversibility, risks, dependencies and a frozen
measurement plan. Different mechanisms are generated; their economic effects are
not fabricated. Pricing, retention, cost and distribution mechanisms remain
hypotheses tied to observed problems, not live commercial commands.

Selection filters unethical/prohibited actions, meaningless cheap activity,
insufficient/stale confidence, unresolved dependencies/critical assumptions/risks
and resource overruns. It prioritizes critical uncertainty and chooses a cheap
meaningful feasible experiment. HOLD/do nothing is valid. Duplicate/superficial
mechanisms are rejected. Selection creates an existing Company Decision and
immutable Company experiment, not a separate experiment orchestrator.

Primary metrics, period, population and guardrails remain frozen. Result decisions
bind exact analytics protocol/report revisions; missing, inconclusive, synthetic,
low-confidence or guardrail-damaged results cannot establish unconditional adoption.
Possible recommendations are ADOPT, ITERATE, RETEST, ROLL_BACK, HOLD, REJECT,
SCALE_CANDIDATE and PIVOT. A recommendation never authorizes its execution.

## Private execution and autonomy boundaries

The implemented private executor is intentionally narrow: re-execute approved
Contract acceptance probes against a same-product validated Builder artifact.
It does not generate arbitrary new commercial variants or mutate live products.
The existing Builder remains responsible for code generation/repair; its explicit
second-build revision/replan invariant is preserved.

A persisted selection creates one existing Goal/Task with product/action identity,
experiment resource class, declared cost, timeout, retry bound and isolated failure
scope. Idempotent planning returns the same task, including after completion/failure.
ResourceManager assigns the reservation; worker hooks acknowledge start/completion/
terminal failure and release through existing mechanisms. Persistent receipts seal
selection, outcome hash, compute and artifact identity. Failed probes do not stop
other products. No second worker pool architecture is introduced; the adapter can
register with and compose hooks into the existing pool/registry/dispatcher.

Every parent and nested tool action passes PolicyEngine. Before execution it checks
own task/lease/product, enabled flags, existing company allocation caps, current
approved build/quality and immutable artifact receipts. The same existing sandbox
has network-none, no host repository mount, no secrets, no public ports, non-root,
read-only root/capability/resource limits. Compiled artifacts are validated/read,
then copied through the sandbox API. Sandbox identities are task-specific.

The real private run checks readiness and HTTP/CLI criteria. Browser execution is
explicitly unavailable. Wall-clock/compute limits stop verification; compute and
failed duration remain accounted. Private outcomes are SYNTHETIC population
evidence even when the runtime execution is real. They are not customer demand,
purchases or economic success. No model inference occurs in this probe executor;
its tracked financial cost is zero, not a claim that infrastructure is universally
free.

Autonomy levels RECOMMEND_ONLY, PRIVATE_EXPERIMENT, OWNER_APPROVAL_REQUIRED,
POLICY_APPROVED_AUTONOMOUS and PROHIBITED are descriptive. Existing policy decides.
External commercial proposals are forced to owner-approval-required. Approval
requests persist once, waiting blocks only the action, and there is deliberately
**no external commercial executor**, including after approval.

## Capital, scale and portfolio

Existing Company capital comparisons retain probabilities/ranges, downside,
reversibility, strategic value, evidence, risk and sunk-cost exclusion. Optimization
adds exact fresh observed report lineage, complete contribution, marginal saturation
checks, scarce Builder-hour comparison and target context. Money/Builder/compute/
inference/time remain bounded. Comparisons are explainable rows, not opaque scores.
PROTECT priority remains available in Crisis. Capital requests revalidate their
frozen proposal/report inputs and reuse existing creator approval/commitment logic.
They do not transfer money or refill operating capital from product revenue.

Scale Readiness preserves separate checks for current Contract quality/surface,
observed data/freshness, Product Health, contribution, relevant retention,
repeatable acquisition/marginal return, security/dependency risk and support/capacity.
Non-recurring Contracts do not universally require subscription retention. Missing
required evidence blocks scale. SCALE becomes HOLD when readiness fails.
HARVEST preserves stable profitable healthy products. PIVOT/KILL remain audited
company portfolio overlays using existing lifecycle/cancellation behavior, not an
external autonomous commercial action. Historical spending alone never wins.

Revenue Gap can inform comparisons but neither rewrites Owner Targets nor forces
new products. Highest gross revenue, traffic, downloads, users, shortest payback,
Web/mobile, subscription, historical winners and sunk costs have no unconditional
priority. Improvement may beat a new product; a new opportunity can also win if
its evidence-backed future return justifies it.

Channel/surface/cross-product learning stores provenance, outcomes, measurement
references and transferability. Success elsewhere is a hypothesis until relevant
product evidence supports transfer. Canonical metric versions, refunds/costs,
periods and guardrails are not redefined to manufacture wins. Decision Memory
retains baseline, alternatives, selected intervention, expected and actual result,
capital/Builder resources, risk/confidence and hindsight.

## Adversarial and company acceptance

| Scenarios | Demonstrated decision invariant |
| --- | --- |
| A/Q/X | Mobile recommendation persists; unsupported/fake capability rejected; unsupported mobile Contract blocked by existing Builder gate |
| B/C/D/T/U | Context beats prevalence; long-term/validation separate; no unsubstantiated multi-surface; history versioned; platform risk lowers confidence |
| E | Store/payment trust needs evidence, not subscription assumptions |
| F | Activation bottleneck drives materially different interventions |
| G/H/O/W | Gross growth, destructive discounts and historic averages do not justify bad marginal economics/scale |
| I | Retention guardrail damage prevents unconditional conversion win |
| J/P | Target pressure does not authorize deception/cancellation obstruction |
| K/L/S | Builder opportunity cost matters; sunk cost excluded; HOLD valid |
| M | Mature profitable healthy product can be HARVESTED |
| N/V | Observed evidence dominates; cross-product transfer remains hypothesis |
| R | SQLite restart restores records/selection without duplicate experiment |

Additional tests cover invalid currency/confidence/configuration, cross-product
scope, empty/invalid protocols, incompatible periods, stale analytics, canonical
experiment guardrail removal, approvals/idempotency and capital/resource ceilings.

The E2E four-product simulation includes Owner Target, forecast/Revenue Gap,
limited capital/Builder hours, observed-port analytics, market formats, interventions,
frozen measured experiment, capital comparison, approval waiting, HARVEST/HOLD,
Weekly Review/Recovery and Decision Memory. Product A selects activation improvement;
B preserves mobile long-term/PWA validation without capability; C harvests; D earns
20,000 synthetic-contract cents gross with -1,000 contribution and is held.
The 100,000-cent Owner Target remains missed; gap is 60,000–80,000 cents. No
transactions occur. These are **deterministic economic simulations**, not real revenue.

## Configuration and production integration

Optimization is disabled by default; private experiments are independently disabled.
Defaults: 12 alternatives, zero experiment spend/inference, one Builder hour,
8 compute units, 30 seconds and minimum confidence 0.5. Explicit configuration can
bound these more narrowly; ceilings reject invalid/fractional monetary/time units
and excessive candidate/runtime limits. Existing Factory and Company flags/caps
remain authoritative. Company policy admission is mandatory and defaults to denial
when no admission implementation is supplied.

Production construction uses the existing CompanyPolicyAdmission, not a new policy:

```ts
const optimization = new FactoryOptimization(company, {
  admission: createCompanyPolicyAdmission(policy, () => toolContext),
});
optimization.initializeCapabilities();
const opportunity = optimization.identify("activation-review", reportKey, {
  funnelKey,
});
```

The opt-in private adapter registers `factory-optimization` in the existing
HarnessRegistry. Add its tools to the existing pool catalog and route its hooks
by `task.agentRole`; retain Builder/analytics hooks for their roles. Its
`connectWorkers(existingPool)` dispatcher returns an unregister callback and
selects only the current creator's assigned optimization tasks. There is no timer,
new production worker service or implicit start. Production tool/policy/spend/lease
contexts are mandatory. Tests use deterministic admission doubles and exercise
actual PolicyEngine denial in the worker path.

## Deliberately deferred and remaining limitations

- No real market/customer/commerce evidence was collected for Lot 6R. No live
  credentials or commercial accounts were used. Deterministic provider receipts
  validate the OBSERVED contract path, not actual customer behavior.
- No external real model generation benchmark was added. Existing production
  inference bridge remains available; contract-compatible model doubles generate
  the private test application. No arbitrary application generation claim.
- Private execution revalidates an approved artifact. Applying an arbitrary
  optimization patch/variant still requires the existing Builder and an explicit
  authorized Contract/build revision/replan; this lot does not bypass its second-
  build invariant. External live intervention execution is unavailable.
- Surface/capital rules are explainable heuristics and preserve factors/ranges.
  They do not prove universal optimality, causality or scientific certainty.
- Opportunity generation is bounded deterministic mechanism reasoning, not a
  production model performing fresh competitive research or campaigns.
- No real browser or mobile runtime/device acceptance. No universal Web/SaaS,
  PWA, UI, signing or deployment capability.
- Capital recommendations/local approvals are not purchases, payments, ad spend
  or operating-budget transfers. Product revenue stays creator-owned.
- Lot 7R 24/7 operations/autonomy/continuous learning and Lot 8R dashboard are not
  implemented. No automatic scheduler/heartbeat registration or live acquisition,
  pricing, campaigns, public release or app-store submission.

## Final invariants

Recommendation != approval. Experiment result != scale authorization.
Capital proposal != spend. Surface decision != public deployment.
Pricing hypothesis != live price change. GTM plan != campaign execution.
Mobile recommendation != store submission.

Constitution/policy/security/creator constraints outrank all recommendations.
Owner Targets are not changed, missing economics stay unknown, historical decision
reasoning is retained, and Company/Factory disabled-by-default behavior is preserved.

Channel comparisons are persisted as existing `optimizationLearning` records with
structured `channelComparison` factors. They require comparable product, period,
currency and metric-definition versions and distinct explicit channels. CAC,
contribution, retention, payback, marginal return, saturation and confidence remain
separate. Missing customer quality/economics prevents a scale-candidate claim.
These records do not authorize spend. Capital comparisons require an exact frozen
proposal report binding when multiple channels/reports concern the same product;
they reject ambiguous bindings and incompatible currency/period comparisons.


New-product capital is not permanently excluded for lacking historical product
profit. A bounded, reversible RESEARCH/VALIDATION option needs a matching Business
Case value-of-information experiment, resource bounds and fresh public/economic
support. A new BUILD option needs a current approved, surface-aware Product Contract,
Business Case price/serving-cost hypotheses and an executable validation surface.
These options are explicitly `ESTIMATED_OPTION`, with confidence capped at 0.5;
they do not create observed profitability. An incomplete existing observed baseline
is never replaced with a fabricated profit. Growth/scale still require observed
complete economics and readiness. Frozen Business Case/Contract revisions are
checked again at capital request. Declared inference, duration and customer value
remain visible; missing legacy values stay unknown. Inference estimates cannot
exceed declared operating capital or conservatively available inference capacity.

## Final validation results

All completed checks used the existing Node/pnpm toolchain, proxy and system-CA
settings; TLS validation stayed enabled:

```sh
export PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH
export NODE_USE_ENV_PROXY=1
export NODE_OPTIONS=--use-system-ca
pnpm exec vitest run src/__tests__/product-factory/optimization-adversarial.test.ts
pnpm exec vitest run src/__tests__/product-factory/optimization-company.test.ts
pnpm exec vitest run src/__tests__/product-factory/optimization-execution.test.ts
pnpm exec vitest run --exclude '**/context-hardening.test.ts' --maxWorkers=4 --minWorkers=1 --reporter=json --outputFile=/tmp/lot-6r-validation.json
pnpm typecheck
pnpm exec tsc -p /tmp/lot-6r-test-tsconfig.json
pnpm build
node dist/index.js --help
git diff --check
timeout --signal=TERM --kill-after=2s 20s pnpm exec vitest run src/__tests__/context-hardening.test.ts --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

The strict test configuration mirrors repository compiler settings, overrides the
usual test exclusion and includes the three new optimization test files/imported
fixtures. Its temporary path is above; it does not modify repository configuration.

| Check | Final result |
| --- | --- |
| Lot 6R | **39/39 PASS**: adversarial 24, company/persistence/E2E 14, real private execution integration 1 |
| Lot 5R | **41/41 PASS**: adversarial 18, intelligence 13, persistence 9, E2E 1 |
| Lot R | **44/44 PASS**: adversarial 21, persistence 17, E2E 5, Company Builder 1 |
| Lots 1–4C | **197/197 PASS**: foundations 32, managers/resources 46, discovery 44, build 25, model Builder 25, model contracts 9, unknown acceptance benchmark 16 |
| All Product Factory files | **321/321 PASS**, 18 files |
| Broad regression excluding only `context-hardening.test.ts` | **1,935/1,935 PASS**, **81/81 files**, approximately **369.77 seconds**, exit 0 |
| Task Graph | **61/61 PASS** in broad regression |
| PolicyEngine / command injection / injection defense / tools security | **26/26**, **102/102**, **56/56**, **71/71 PASS** |
| LocalWorker harness/security | **5/5**, **8/8 PASS** |
| HarnessRegistry | **5/5 PASS**, other harness tests also pass in broad run |
| Financial / SpendTracker | **23/23**, **17/17 PASS** |
| Migrations, approvals, ResourceManager, SQLite restart | Covered by the passing foundation/manager/Company/analytics/optimization persistence and broad tests |
| Production typecheck | exit **0** |
| Strict new-test typecheck | exit **0** |
| Runtime + CLI package build (`pnpm build`) | exit **0** |
| Built runtime CLI `--help` | exit **0**; Automaton was not started with `--run` |
| `git diff --check` | exit **0** |
| Separate context-hardening retry | **INCOMPLETE / TIMEOUT**, external 20-second deadline, exit **124**; no completed assertion report |

The entire repository suite is **not claimed green**: the unchanged known
context-hardening file remains unvalidated because of its timeout. It was not
modified or weakened. The prior intermittent Builder failure did not recur in
three completed broad checkpoints (1,929, then 1,931, then 1,935 passing tests).
Its earlier root cause remains unestablished; this lot does not claim to cure it.
No new regression remains in the completed suite.

One initial broad attempt omitted the existing proxy/system-CA flags. It stalled
on read-only balance fetches and was stopped; it produced no complete assertion
report and is not counted as validation. Correct environment activation restored
the successful broad runs without changing tests, RPC mocks or TLS protection.

During incremental development, the new integration test exposed and corrected:
invalid refund fixture categorization (unknown profit correctly prevented selection),
missing ResourceManager start acknowledgement, a disallowed V12 experiment terminal
status and a fractional subprocess timeout. Fixes stayed within the new adapter.
Creator-scoped dispatch and exact capital/channel bindings received targeted tests.
No unrelated production refactor or speculative Builder fix was made.

Evidence files in this workspace: `/tmp/lot-6r-validation.json`,
`/tmp/lot-6r-command-results.json`, `/tmp/lot-6r-e2e-results.json`,
`/tmp/lot-6r-context-hardening.log` and per-command logs. The E2E outputs are explicitly
marked deterministic contract simulations, not market/economic success.

## Final repository and prohibited-action check

- Branch: **feature/product-factory**.
- HEAD: **d8f816881fd24b6f5e3d616e59edec387a447667**.
- Constitution unchanged; SHA-256:
  **d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e**.
- No migration beyond V16; no historical schema rewrite.
- No commit, push, merge or PR; index remains empty.
- No public deployment or public ports; no generated-app containers remained after
  completed acceptance.
- No real campaign, advertising spend, live pricing change, payment/financial
  transfer, store submission or commercial-account creation.
- Creator ownership and product-revenue/operating-capital separation preserved.
- Lots 7R/8R not started.
- Working tree remains intentionally dirty with preserved earlier lots: 11 tracked
  modified paths and four untracked top-level entries. Relative to the saved
  implementation baseline: 11 added files, 8 modified files, no deletions.

```text
 M src/__tests__/orchestration/messaging.test.ts
 M src/__tests__/orchestration/test-db.ts
 M src/agent/harness-types.ts
 M src/agent/worker-inference-bridge.ts
 M src/config.ts
 M src/memory/event-stream.ts
 M src/orchestration/local-worker.ts
 M src/orchestration/task-graph.ts
 M src/state/database.ts
 M src/state/schema.ts
 M src/types.ts
?? docs/
?? src/__tests__/product-factory/
?? src/product-factory/
?? src/state/factory-tasks.ts
```

## Evidence classification

**DEMONSTRATED:** persistent/versioned governance, canonical comparison, resource
and policy boundaries, actual isolated Node compilation/private HTTP probes,
terminal reservation release, durable outcome/hash and SQLite reload.

**SIMULATED / FIXTURE-ONLY:** economic/market observations, measured optimization
outcomes and company decisions from deterministic contract-compatible source/model
doubles. No real demand, revenue, customer retention or profitability demonstration.

**INTERFACE-READY:** existing configured inference bridge, optional verified
analytics providers, future market-format evidence, mobile capability contract and
existing browser-acceptance adapter.

**NOT_IMPLEMENTED:** actual Android/iOS/cross-platform build/device/signing/store
capability, real browser journey in this lot, live commercial intervention executor,
Lot 7R continuous autonomy and Lot 8R dashboard.

**BLOCKED:** execution requiring an unsupported validation surface, missing/stale
required evidence, failed Contract quality, policy denial or exhausted resources.
