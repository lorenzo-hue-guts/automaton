# Product Factory foundations

This module is disabled by default and is not registered in the agent loop or heartbeat.
It implements local records and lifecycle transitions only. It has no launch, advertising,
payment, inference, resource allocation or autonomous orchestration executor.

`AutomatonDatabase.productFactory` uses the runtime's existing SQLite connection and
transactions. Migration V12 adds 14 `factory_` tables without changing the treasury,
Task Graph, heartbeat or memory schemas. Experiments and features can reference existing
goals/tasks. Metric snapshots belong to products; they do not replace runtime metrics.
Learnings are durable domain records; the existing memory system remains responsible for
retrieval and ingestion. Future work must adapt to the existing Task Graph, heartbeat and
policy engine through `ProductFactoryInfrastructure`, not start another runtime.

`ProductFactory` requires explicit enabled configuration. The configured creator owns
products and product revenue; `revenueCents` is reporting data, never an operational credit
balance. `operationalBudgetCents` and resource reservations are limits/accounting intents,
not spending or allocation APIs. No product revenue is forwarded to the Automaton treasury.

Only the configured creator can decide a product's pending approval. Validation requires
an experiment approval, building a prototype approval. Approvals are local audit records,
not credentials or overrides of the existing policy engine. The caller of the lifecycle
must obtain the creator identity from trusted runtime configuration; string identity checks
are not authentication. No external/untrusted tool surface is exposed in this step.

Events are append-only at the SQL boundary; a stage/approval change and its audit event
commit or roll back together. Products cannot change creator. No lifecycle stage represents
a public launch. Configuration loading rejects unsafe or malformed settings and old configs
resolve to disabled defaults. Constitutions and existing safety rules remain unchanged.

## Local managers and existing Task Graph

V13 extends the existing V12 tables and `task_graph`; it adds no tables and rebuilds none.
Legacy `stage` is preserved. `portfolio_state` tracks research, building, launch_ready,
validation, optimizing, scaling, pivoting, killed and archived. These are local planning
labels: no SCALE/PIVOT/KILL evaluator or public launch executor exists. `PortfolioManager`
records explicit creator decisions, enforces product capacity and isolates paused/failed
products. Terminal products require a new explicit decision and a new action plan.

`FactoryOrchestrator` persists state in the existing KV and state events in `event_stream`.
Its synchronous, transactional tick traverses OBSERVING, PLANNING, DISPATCHING, EXECUTING,
EVALUATING and REPLANNING, returning to EXECUTING or IDLE. PAUSED/FAILED stop dispatch but
still permit lease expiry cleanup. Product-specific errors pause only that product;
infrastructure errors roll back the cycle and persist FAILED until explicit resume.
`heartbeatTask()` adapts to the existing `HeartbeatTaskFn`; it is not automatically registered
and creates no timer. The caller must provide the existing PolicyEngine through the admission
adapter; missing admission, deny and quarantine all block dispatch. No worker or tool executes
inside the cycle.

Factory actions use the existing Task Graph goals, dependencies, estimated/actual costs,
timeouts and retry counters. Each product gets its own goals to avoid shared goal failure.
An action ID is unique per product; repeat planning returns the same task. Metadata includes
productId, factoryActionId, resourceClass, reservationId, deadline, urgency, requiresApproval,
preemptible, criticalIncident, resourceUnits and scoring signals. Approvals are scoped to an
exact action ID and product. Factory tasks are excluded from the legacy ready-task query so
the existing funding/agent-dispatch loop cannot automatically execute or finance them.
Only local Factory assignments with a matching reservation are allowed.

## Resource allocation and lifecycle

Each action consumes one primary class slot (build, research, monitoring, inference, compute
or experiment), `resourceUnits` of shared compute capacity and an estimated operational cost.
Admission checks global/per-product concurrency, class limits, experiment capacity, shared
compute units, global/per-product operational budgets and a separate inference budget.
Product revenue never increases these budgets. Budgets are cumulative local accounting caps,
not external payment APIs; costs reported by an outcome are accumulated across retries.
Underestimated actual costs remain recorded and prevent further over-budget allocation.
Existing spend tracking and financial policy remain the execution boundary for future workers.

Pure scoring uses business impact, urgency, evidence confidence, strategic fit, user impact,
estimated cost, risk, dependency readiness, deadline and an unbounded age bonus. Critical
incidents sort first; ordinary eligible work eventually outranks newer ordinary work through
aging, subject to hard constraints and critical incident precedence. Tie-breaking uses the
persisted task ID. Default limits reserve one concurrent slot and one compute unit for incidents.
Explicit overrides can change these reserves. Critical work can preempt the lowest-scoring
preemptible **assigned** tasks. Running work is never preempted without worker acknowledgement.
An unsuccessful preemption attempt rolls back without disturbing the victim.

`ResourceManager.assign()` acquires an immediate SQLite transaction, checks current persistent
usage, writes/revives a stable reservation ID for the task and assigns it atomically. Retries
release then reuse that same reservation row. A unique index prevents double reservations;
a SQL guard rejects assignment without a matching live reservation. Status triggers release
leases on completion, terminal failure, retry, cancellation and dependency blocking, including
calls made by existing Task Graph helpers. Replan releases active assignments without consuming
retry counts. Timeout reconciliation uses the existing retry policy and releases exhausted tasks.
Capacity snapshots are persisted in the existing V12 table with remaining class/compute/budget
capacity. Factory audit goals are retained when pruning completed legacy goals.

All managers remain local. Enablement is explicit, all budgets default to zero and Factory stays
disabled by default. Before integrating a real worker, require policy evaluation for each actual
tool, enforce cost envelopes, and acknowledge cancellation before releasing a running worker's
physical capacity. This batch does not connect analytics, acquisition, dashboards or deployments.

## Discovery, Evidence and opportunity selection (batch 3)

V14 extends the V12 opportunity/Evidence tables with typed discovery metadata and a unique
per-opportunity signal fingerprint. It rebuilds the existing Decision table transactionally
so a Decision can reference an opportunity before a product exists. Existing product Decisions
and foreign keys survive. There are still exactly 14 Factory tables, one SQLite connection,
one Task Graph, and the existing memory `event_stream`/KV.

`DiscoveryProvider.collect()` returns normalized atomic signals or observations proposing a
problem. Only `FixtureDiscoveryProvider` ships, and the registry currently accepts fixture mode
only. No transport, credential lookup or external SDK is used. `planDiscovery()` can create
opportunities from observations; `planResearch()` constrains ingestion to specified existing
opportunities. Both require an existing owned portfolio product as their Task Graph research
context; neither creates a product. Workers explicitly call `runAssigned()` after the existing
Factory policy/admission and Resource Manager have assigned the action. Separate source goals
isolate goal failures. Research uses research slots and shared compute, never build slots.
No scheduler, heartbeat or automatic registration is added.

Batches are bounded to 1,000 signals, validated and ingested atomically. Provider errors use
existing retry counts and stable reservations; provider-controlled errors never enter trusted
memory. Optional task `failureScope: "action"` keeps exhausted source retries from pausing the
whole product; the old default remains product-level failure. Cancellation/replan/lease expiry
prevents late writes. Providers must be registered again on runtime reload; task bindings,
reservations, Evidence and decisions remain durable.

Evidence records capture source type/ref, provider, date, summary/excerpt, SHA256 content hash,
reliability, tags, optional sentiment, supports/refutes, independence key, kind and score criterion.
One signal is one atomic claim. Fingerprints normalize source/content and include criterion,
relation and kind, excluding provider and capture date; repeated collection does not duplicate
Evidence. Syndicated copies must share an independence key. External text uses existing prompt
boundary sanitization and explicit `untrusted-external-data` marking; sanitization does not make
it trusted. Only IDs/counts and local state enter audit memory, never raw excerpts or exceptions.
New Evidence invalidates cached scores and any pending brief transition. Historic Decisions
remain available. Rejected/archived opportunities require an explicit decision to reopen.

The local assessor supplies eight values in [0,1], estimated operational cost, risk and unverified
hypotheses. External text does not supply trusted assessments automatically. Weights are problem
20, willingness to pay 20, market 15, differentiation 10, technical ease 10, operational cost 10,
recurring revenue 10, acquisition 5. For each criterion, sum the maximum reliability per independent
group for support S and refutation R; inference counts half and hypotheses count zero. Points are
`weight * assessment * S/(S+R)` (zero without support). Confidence sums
`weight/100 * min(1,(S+R)/2) * (S/(S+R))^2`. One independent reliable observation gives 50% confidence;
two agreeing independent observations saturate it. Contradiction lowers both points and confidence.
Breakdowns, evidence IDs, unverified criteria and hypotheses are persisted. Scores are invalid
without non-hypothesis, positive-reliability Evidence; legacy Evidence without structured provenance
cannot validate a new score. Totals use six decimal places and classify at 55/70/80.

Selection rescoring uses durable Evidence inside an immediate transaction. Priority is total
plus 20*confidence, 10*independent evidence quality and 2*source diversity (capped at five), minus
log2(1+estimated cents) and 20*risk; persistent ID resolves ties. Selection needs score >=70 and
confidence >=0.35. Below 55 is REJECT; other insufficient candidates become RESEARCH_MORE.
Token-set Jaccard similarity >=0.75 with the existing portfolio or selected briefs yields ARCHIVE.
Capacity considers active portfolio/pending briefs, current build/global/compute availability,
critical reserves and operational budget, never product revenue. Pending briefs consume planning
headroom but do not acquire execution reservations. Resource Manager must revalidate any future
work. Explicit SELECT, RESEARCH_MORE, REJECT and ARCHIVE decisions are supported. SELECT records
a Decision and memory audit event with `brief_pending`; it builds no brief/product, launches nothing
and conveys no financial or publication authority. Defaults and safety locks remain unchanged.

## Product Brief, private build and deployment (batch 4)

`ProductBriefEngine` captures a SELECT Decision, the source score/Evidence IDs and all local brief
fields: problem/users, value/solution, critical hypotheses, MVP features, exclusions, architecture,
hypothetical pricing, verifiable criteria, risks, estimates, metrics, success criterion IDs and
failure conditions. Incomplete drafts can be persisted but cannot enter review/build. Review
creates an owned local draft product and an action-scoped pending creator approval. Reviewed
briefs are immutable; a changed source selection or newly ingested Evidence invalidates their
eligibility. No automatic human approval exists.

`BuildPlanner.plan()` requires a complete approved current brief, then transactionally creates
one existing Task Graph Goal and an idempotent DAG: architecture -> setup -> per-feature
implementation -> per-feature tests -> packaging -> security/instrumentation -> validation ->
private deployment. Independent feature/test nodes can retry separately. Every node carries the
existing factory/resource/cost/priority/dependency/retry/timeout metadata. Build, research and
monitoring retain the existing class limits; validation/private deployment use monitoring.
The build approval authorizes only the local approved plan. Private deployment and rollback each
require an additional exact-action creator approval.

`BuildEngine.registerHarness(registry)` registers the local harness on the existing registry.
Pass `engine.workerHooks()` to the existing `LocalWorkerPool` together with its PolicyEngine,
ToolContext and SpendTracker. `engine.connectWorkers(pool)` attaches dispatch after the existing
Factory tick commits; the returned function unregisters it. It adds no timer or second execution
loop. The existing heartbeat can call that same tick. Factory worker spawn reloads the durable task
and fails closed without hooks/policy context, even if caller metadata is stripped. Hooks require
a live Resource Manager reservation, an owned active product and the immutable approved brief.
The deterministic harness calls the existing `executeTool()` policy gate before its step tool.
Factory work does not use the less restricted legacy coding harness. Legacy worker behavior stays
unchanged. Worker outcomes go through Resource Manager/Task Graph acknowledgement and stable
retry reservations; per-attempt compute units, elapsed time and actual/estimated costs are recorded.
Reported failure/crash costs are accounted before retry. The shipped fixture has zero actual cost,
no inference request, remote VM, shell, network, exposed port, domain or financial operation.

The safe fixture builder generates small CommonJS feature scaffolds, real local smoke tests,
a package bundle, an exact-template security check and a functioning request counter. It is a
workflow demonstration, not an AI implementation of arbitrary business requirements. Artifact
paths reject traversal and symlink ancestors/targets, and receipts record byte SHA256/size. Tests
verify on-disk source against the expected generated template, then execute only regenerated
known code in Node's VM with a timeout. Node VM is **not** treated as a security boundary: modified
filesystem/external code is rejected before any evaluation.

`BuildValidator` requires successful structured Task Graph results matched to locally generated
receipts, completed build/tests/security/instrumentation, intact expected artifacts and every brief
criterion verified by a known check. Free-form agent success cannot satisfy it. The fixture supports
`feature:<index>`, `artifact:<path>`, `security:no-network` and `metric:request_count` targets. Unknown
or unmeasured business criteria fail closed. Security checks here establish the constrained fixture
properties; they are not a general scanner for arbitrary applications.

The only enabled deployment provider is `SyntheticPrivateDeploymentProvider`. Deployment is a
versioned reversible intent referencing the build digest, never a listener or running public service.
It records private visibility, null public URL, false external accessibility and zero cost. Deployment
and rollback run as approved policy-gated worker tasks. Only a verified active private deployment
can promote a managed brief product to `launch_ready`; the existing Portfolio Manager also guards
that transition against missing proof, rollback or modified artifacts. Legacy portfolio labels
remain compatible. `PublicLaunchGate` checks a creator-approved exact `public-launch:<buildId>`
action, never accepts a build/private-deploy approval in its place, and **always returns allowed:false**
in this batch, including after human approval. There is no public launch executor or public provider.

Briefs, builds, task bindings, receipts/attempts, deployment metadata and readiness proofs use
versioned records in the existing SQLite KV with Task Graph/product/approval references validated
by services. The existing memory event stream records metadata audit events. No migration or new
table is needed; all 14 Factory tables and earlier records remain intact. Files live in an explicitly
configured local artifact root. Reopening SQLite preserves state and reservations; lost running
workers recover through existing timeout/retry reconciliation. Provider/harness/dispatcher instances
must be explicitly attached again on restart. A new build revision for an already-built product is
not automatically scheduled; it needs a future explicit revision workflow.

A changed Evidence set blocks further construction/readiness but does not block separately approved
private rollback. SQLite transactions cannot undo filesystem writes; orphaned partial files are
unusable without acknowledged receipts, and retries rewrite the same confined paths idempotently.

## Model-driven private builds (batch 4B)

The optional model harness complements the batch 4 fixture path. Reference insights,
versioned architectures, multifile model changes and bounded verification attempts use
BuildStore/SQLite, the same Task Graph and LocalWorkerPool. The supplied execution backend
is offline, unprivileged Docker with no host mounts or published ports. Execution acceptance
is defined in the approved brief; compiling alone cannot promote a model build.
See [the implementation report](../../docs/product-factory-lot4b.md) for setup, demonstrated
capabilities, persistence, limits and the distinction between real execution and fake models.

## Company Operating System (Lot R)

Company governance is disabled by default alongside Product Factory.
`CompanyOperatingSystem` is a synchronous domain facade over the existing
FactoryOrchestrator/database, not another scheduler, worker or external executor.
`CompanyStore` uses the same SQLite/WAL connection and V15 append-only versioned
records; existing Evidence and Decision are extended.

New governed builds bind a versioned Product Contract to the existing Brief,
require greenlight, exact human build/capital approvals and relevant quality
proofs. Existing pre-company briefs remain compatible. Company caps augment
ResourceManager and never add product revenue to operating capital.

Real evidence ingestion requires a trusted configured verifier; synthetic/model
evidence is explicitly lower tier. Missing economics remain UNKNOWN. No
analytics connectors, campaigns, payments, public executor or autonomous
optimization are introduced. See [the Lot R report](../../docs/product-factory-lot-r.md)
and [creator-specific initial target data](../../docs/examples/company-owner-targets.initial.json).

## Lot 5R analytics

`FactoryAnalytics` is an opt-in, bounded analytics service on Company OS and the
existing SQLite database (V16). It verifies/minimizes/deduplicates connector data,
uses canonical Company economics, and publishes versioned evidence/snapshots and
Judge dossiers. `ReadOnlyAnalyticsProvider` is a production SDK/verifier port;
`SyntheticAnalyticsProvider` cannot assert observed economic results. Collection
uses existing Task Graph reservations and the optional `FactoryAnalyticsHarness`
in LocalWorkerPool/HarnessRegistry. No new scheduler or commercial execution.

Missing coverage/costs remain UNKNOWN. Runtime pseudonym keys must be stable and
are never persisted; incompatible key changes fail closed. Historical snapshots
and reviews are immutable. See [Lot 5R report](../../docs/product-factory-lot-5r.md)
for verified behavior, simulated inputs and deferred live connectors.
