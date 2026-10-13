import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, getTaskById, getTasksByGoal } from "../../state/database.js";
import { taskRowToTaskNode, cancelTask, completeTask } from "../../orchestration/task-graph.js";
import { LocalWorkerPool } from "../../orchestration/local-worker.js";
import { HarnessRegistry } from "../../agent/harness-registry.js";
import { PolicyEngine } from "../../agent/policy-engine.js";
import { SpendTracker } from "../../agent/spend-tracker.js";
import { BuildEngine, FactoryOrchestrator, OpportunityEngine, EvidenceEngine, ProductFactory, SCORE_WEIGHTS, createFactoryPolicyAdmission, resolveProductFactoryConfig } from "../../product-factory/index.js";
import { artifactPath, writeArtifact } from "../../product-factory/local-artifacts.js";
import type { ProductBriefContent, BuildRecord, ProductBrief, ScoreCriterion } from "../../product-factory/index.js";
import type { AutomatonDatabase, PolicyRule, ToolContext } from "../../types.js";
import { createTestConfig, createTestIdentity, MockConwayClient, MockInferenceClient } from "../mocks.js";

const now = new Date("2026-10-07T12:00:00Z");
const creator = "creator";
function config(buildSlots = 2) { return resolveProductFactoryConfig({ enabled: true, maxActiveProducts: 20, operationalBudgetCents: 100, resources: { globalConcurrency: 6, perProductConcurrency: 3, buildSlots, monitoringSlots: 2, researchSlots: 2, computeUnits: 8, criticalReservedSlots: 1, perProductBudgetCents: 50 } }); }
function content(features = 1): ProductBriefContent {
  return { problem: "A verified local workflow problem", targetUsers: ["Local fixture testers"], valueProposition: "Deterministic testable local artifact", proposedSolution: "Generate isolated fixture feature functions", criticalHypotheses: ["User demand remains a hypothesis"], mvpFeatures: Array.from({ length: features }, (_, i) => ({ id: `feature-${i}`, title: `Feature ${i}`, acceptanceCriterion: "Echo a string and return the exact feature label" })), nonGoals: ["Public access", "Payments"], architecture: "CommonJS local fixture bundle with no dependencies", hypotheticalPricing: "Hypothetical subscription only", validationCriteria: [{ id: "smoke", kind: "test", target: "feature:0", description: "Feature smoke invocation succeeds" }, { id: "bundle", kind: "artifact", target: "artifact:bundle.cjs", description: "Expected bundle present" }, { id: "security", kind: "security", target: "security:no-network", description: "No transport or public listener" }, { id: "metrics", kind: "metric", target: "metric:request_count", description: "Counter increments" }], risks: ["Fixture behavior does not establish business viability"], estimatedCostCents: 9, complexity: "low", metrics: ["request_count"], successCriteria: ["smoke", "bundle", "security", "metrics"], failureCriteria: ["Any failed required test", "Missing or modified artifact"] };
}
let directory: string, filename: string;
let db: AutomatonDatabase, factory: FactoryOrchestrator, engine: BuildEngine, policy: PolicyEngine, pool: LocalWorkerPool;
let inference: { chat: ReturnType<typeof vi.fn> };
let counter: number;
const context = (): ToolContext => ({ identity: createTestIdentity(), config: createTestConfig(), db, conway: new MockConwayClient(), inference: new MockInferenceClient() });
function initialize(rules: PolicyRule[] = [], limits = config()) {
  policy = new PolicyEngine(db.raw, rules);
  factory = new FactoryOrchestrator(db, limits, creator, createFactoryPolicyAdmission(policy, (task) => ({
    tool: { name: "factory_admission", description: "Local assignment", parameters: {}, category: "memory", riskLevel: "safe", execute: async () => "unused" }, args: { taskId: task.id }, context: context(), turnContext: { inputSource: "system", turnToolCallCount: 0, sessionSpend: new SpendTracker(db.raw) },
  })));
  engine = new BuildEngine(db, factory, path.join(directory, "artifacts"));
  const registry = new HarnessRegistry(); engine.registerHarness(registry);
  inference = { chat: vi.fn(async () => { throw new Error("External inference forbidden"); }) };
  pool = new LocalWorkerPool({ db: db.raw, inference, conway: context().conway, harnessRegistry: registry, identity: createTestIdentity(), config: createTestConfig(), tools: [], toolContext: context(), policyEngine: policy, spendTracker: new SpendTracker(db.raw), factoryHooks: engine.workerHooks(), allowedEditRoot: directory });
}
function selected(): string {
  const opportunityEngine = new OpportunityEngine(db, factory), evidence = new EvidenceEngine(db, creator, true);
  const n = ++counter, o = opportunityEngine.create(`Fixture ${n}`, `Unique category${n} workflow`);
  for (const criterion of Object.keys(SCORE_WEIGHTS) as ScoreCriterion[]) evidence.ingest("fixture", { opportunityId: o.id, sourceType: "forum", sourceRef: `fixture://${n}/${criterion}`, independenceKey: "source", capturedAt: now.toISOString(), summary: `Observed ${criterion}`, excerpt: `Evidence for ${criterion}`, reliability: 1, tags: [], relation: "supports", kind: "observation", criterion });
  opportunityEngine.assess(o.id, { values: Object.fromEntries(Object.keys(SCORE_WEIGHTS).map((k) => [k, 1])) as Record<ScoreCriterion, number>, estimatedCostCents: 0, risk: 0, unverifiedHypotheses: [] });
  expect(opportunityEngine.decide(o.id, "SELECT", "Local candidate only").action).toBe("SELECT");
  return o.id;
}
function approve(id: string, decision: "approved" | "rejected" = "approved") { new ProductFactory(db, config(), creator).decideApproval(id, decision); }
function brief(features = 1): ProductBrief {
  const b = engine.briefs.create(selected(), content(features));
  const reviewed = engine.briefs.requestReview(b.id); approve(reviewed.approvalId!); return reviewed;
}
function planned(features = 1): BuildRecord { return engine.planner.plan(brief(features).id); }
function approvePrivate(build: BuildRecord) {
  const task = getTaskById(db.raw, build.tasks.find((t) => t.step === "private_deployment")!.taskId)!;
  approve(task.factory!.approvalId!);
}
async function wave() {
  factory.tick(now);
  const assigned = db.raw.prepare("SELECT id FROM task_graph WHERE status = 'assigned' AND agent_role = 'factory-local-build'").all() as { id: string }[];
  for (const { id } of assigned) pool.spawn(taskRowToTaskNode(getTaskById(db.raw, id)!));
  await pool.waitForIdle();
  return assigned.length;
}
async function finish(build: BuildRecord, deployment = true) {
  if (deployment) approvePrivate(build);
  for (let i = 0; i < 20; i++) if (!await wave()) break;
  return engine.store.build(build.id)!;
}
beforeEach(() => {
  vi.setSystemTime(now); directory = fs.mkdtempSync(path.join(os.tmpdir(), "factory-build-")); filename = path.join(directory, "state.db");
  db = createDatabase(filename); counter = 0; initialize();
});
afterEach(async () => { await pool.shutdown(); if (db.raw.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.useRealTimers(); });

describe("Product Brief and build planning", () => {
  it("links selected opportunity, Decision, Evidence and complete brief fields", () => {
    const id = selected(), b = engine.briefs.create(id, content());
    expect(b.opportunityId).toBe(id);
    expect(db.productFactory.get("decisions", b.selectionDecisionId)?.outcome).toBe("SELECT");
    expect(b.evidenceIds).toHaveLength(8); expect(b.sourceScore.total).toBe(100);
    expect(engine.store.brief(b.id)).toEqual(b);
    expect(db.productFactory.list("products")).toEqual([]);
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM task_graph").get()).toEqual({ count: 0 });
  });
  it("incomplete, unapproved and rejected briefs never create build tasks", () => {
    const incomplete = engine.briefs.create(selected(), { ...content(), targetUsers: [], architecture: "" });
    expect(() => engine.briefs.requestReview(incomplete.id)).toThrow("Incomplete");
    expect(() => engine.planner.plan(incomplete.id)).toThrow("Incomplete");
    const b = engine.briefs.requestReview(engine.briefs.create(selected(), content()).id);
    expect(() => engine.planner.plan(b.id)).toThrow("approval required");
    approve(b.approvalId!, "rejected");
    expect(() => engine.planner.plan(b.id)).toThrow("approval required");
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM task_graph").get()).toEqual({ count: 0 });
  });
  it("refuses stale selection after new Evidence invalidates it", () => {
    const b = brief();
    new EvidenceEngine(db, creator, true).ingest("new", { opportunityId: b.opportunityId, sourceType: "reddit", sourceRef: "fixture://counter", independenceKey: "counter", capturedAt: now.toISOString(), summary: "No need", excerpt: "Contradicting evidence", reliability: 1, tags: [], relation: "refutes", kind: "observation", criterion: "problem" });
    expect(() => engine.planner.plan(b.id)).toThrow("changed");
  });
  it("creates an idempotent existing Task Graph DAG with independent feature/test pairs", () => {
    const b = brief(2), build = engine.planner.plan(b.id);
    expect(engine.planner.plan(b.id)).toEqual(build);
    const tasks = getTasksByGoal(db.raw, build.goalId);
    expect(tasks).toHaveLength(11);
    expect(build.tasks.filter((t) => t.step === "implementation")).toHaveLength(2);
    expect(tasks.reduce((sum, t) => sum + t.estimatedCostCents, 0)).toBe(b.content.estimatedCostCents);
    for (const task of tasks) {
      expect(task.factory).toMatchObject({ productId: b.productId, resourceUnits: 1, urgency: 60 });
      expect(task.maxRetries).toBe(2); expect(task.timeoutMs).toBe(60_000);
      for (const dep of task.dependencies) expect(tasks.some((t) => t.id === dep)).toBe(true);
    }
    const architecture = build.tasks.find((t) => t.step === "architecture")!;
    const setup = build.tasks.find((t) => t.step === "setup")!;
    factory.tick(now);
    expect(getTaskById(db.raw, architecture.taskId)?.status).toBe("assigned");
    expect(getTaskById(db.raw, setup.taskId)?.status).toBe("pending");
    expect(factory.resources.decision(getTaskById(db.raw, setup.taskId)!, now).allowed).toBe(false);
    expect(build.tasks.filter((t) => ["validation", "private_deployment"].includes(t.step)).every((t) => getTaskById(db.raw, t.taskId)?.factory?.resourceClass === "monitoring")).toBe(true);
  });
  it("fails closed while Factory is disabled", () => {
    const disabled = new BuildEngine(db, new FactoryOrchestrator(db, undefined, creator), directory);
    expect(() => disabled.briefs.create("missing", content())).toThrow("disabled");
    expect(() => disabled.planner.plan("missing")).toThrow("disabled");
    expect(() => disabled.validator.promote("missing")).toThrow("disabled");
  });
});

describe("existing workers, policies and resource accounting", () => {
  it("respects build slots across products and keeps research slots available", async () => {
    const a = planned(2), b = planned(2);
    factory.tick(now);
    expect(factory.resources.leases(true).filter((r) => r.resourceClass === "build")).toHaveLength(2);
    for (const { taskId } of [a.tasks[0], b.tasks[0]]) pool.spawn(taskRowToTaskNode(getTaskById(db.raw, taskId)!));
    await pool.waitForIdle();
    await wave();
    factory.tick(now);
    const active = factory.resources.leases(true);
    expect(active.filter((r) => r.resourceClass === "build")).toHaveLength(2);
    const discoveryProduct = factory.portfolio.create("Independent research");
    const task = factory.planAction({ goalId: factory.createProductGoal(discoveryProduct.id, "Research", "Local research"), title: "Research", description: "Separate resources", factory: { productId: discoveryProduct.id, factoryActionId: "research-independent", resourceClass: "research", urgency: 10, requiresApproval: false, preemptible: true, criticalIncident: false, resourceUnits: 1, signals: { businessImpact: 0.5, evidenceConfidence: 0.5, strategicFit: 0.5, userImpact: 0.5, risk: 0 } } });
    factory.tick(now);
    expect(getTaskById(db.raw, task.id)?.status).toBe("assigned");
  });
  it("policy denial prevents the actual build tool from writing artifacts", async () => {
    const build = planned();
    const deny: PolicyRule = { id: "deny-factory-tool", priority: 10000, description: "Deny the actual local tool", appliesTo: { by: "all" }, evaluate: (request) => request.tool.name === "factory_build_step" ? { rule: "test-deny", action: "deny", reasonCode: "TEST_DENY", humanMessage: "Denied actual build tool" } : null };
    initialize([deny]);
    await wave();
    expect(getTaskById(db.raw, build.tasks[0].taskId)?.retryCount).toBe(1);
    expect(fs.existsSync(build.artifactRoot)).toBe(false);
    expect(factory.resources.leases(true)).toEqual([]);
    expect(engine.store.build(build.id)?.receipts).toEqual({});
    expect(inference.chat).not.toHaveBeenCalled();
  });
  it("isolates exhausted worker failure and lets other products complete", async () => {
    const bad = planned(), good = planned();
    const badTask = bad.tasks[0].taskId;
    const deny: PolicyRule = { id: "isolated-denial", priority: 10000, description: "Deny the actual local tool", appliesTo: { by: "all" }, evaluate: (request) => request.tool.name === "factory_build_step" && request.args.taskId === badTask ? { rule: "test-deny", action: "deny", reasonCode: "FAIL_ONE", humanMessage: "Only this action" } : null };
    initialize([deny]); approvePrivate(good);
    for (let i = 0; i < 20; i++) await wave();
    expect(getTaskById(db.raw, badTask)?.status).toBe("failed");
    expect(engine.store.build(bad.id)?.status).toBe("failed");
    expect(factory.portfolio.get(bad.productId)?.paused).toBe(true);
    expect(engine.store.build(good.id)?.status).toBe("private_deployed");
    expect(factory.portfolio.get(good.productId)?.portfolioState).toBe("launch_ready");
    expect(factory.state).not.toBe("FAILED");
  });
  it("reuses the same task and reservation on retry", async () => {
    const build = planned(), taskId = build.tasks[0].taskId;
    initialize([{ id: "once", priority: 10000, description: "Deny the actual local tool", appliesTo: { by: "all" }, evaluate: (request) => request.tool.name === "factory_build_step" ? { rule: "test-deny", action: "deny", reasonCode: "RETRY", humanMessage: "Retry fixture" } : null }]);
    factory.tick(now);
    const id = getTaskById(db.raw, taskId)!.factory!.reservationId;
    pool.spawn(taskRowToTaskNode(getTaskById(db.raw, taskId)!)); await pool.waitForIdle();
    initialize(); await wave();
    expect(getTaskById(db.raw, taskId)?.status).toBe("completed");
    expect(getTaskById(db.raw, taskId)?.factory?.reservationId).toBe(id);
    expect(factory.resources.leases().filter((r) => r.taskId === taskId)).toHaveLength(1);
    expect(engine.store.build(build.id)?.attempts.map((a) => a.success)).toEqual([false, true]);
  });
  it("persists compute, costs, structured acknowledgement and releases completed leases", async () => {
    const build = await finish(planned());
    expect(build.status).toBe("private_deployed");
    expect(build.attempts).toHaveLength(9);
    expect(build.attempts.every((a) => a.computeUnits === 1 && a.costCents === 0 && a.success)).toBe(true);
    for (const t of build.tasks) {
      const task = getTaskById(db.raw, t.taskId)!;
      expect(task.status).toBe("completed");
      expect(task.actualCostCents).toBe(0);
      expect(task.result).toMatchObject({ success: true, factoryReceipt: { buildId: build.id, hash: build.receipts[t.taskId].hash } });
    }
    expect(factory.resources.leases(true)).toEqual([]);
    expect(inference.chat).not.toHaveBeenCalled();
    expect(db.getRecentTransactions(100)).toEqual([]);
  });
  it("cannot spawn Factory work through an unguarded legacy pool", () => {
    const build = planned(); factory.tick(now);
    const unguarded = new LocalWorkerPool({ db: db.raw, inference, conway: context().conway, harnessRegistry: new HarnessRegistry(), identity: createTestIdentity(), config: createTestConfig() });
    const node = taskRowToTaskNode(getTaskById(db.raw, build.tasks[0].taskId)!);
    expect(() => unguarded.spawn(node)).toThrow("require resource hooks");
    const { factory: _factory, ...forged } = node;
    expect(() => unguarded.spawn(forged)).toThrow("require resource hooks");
    expect(inference.chat).not.toHaveBeenCalled();
  });
  it("releases cancellation, timeout, replan and exhausted failure reservations", async () => {
    const a = planned(), b = planned(); factory.tick(now);
    const first = a.tasks[0].taskId, second = b.tasks[0].taskId;
    cancelTask(db.raw, first); factory.replan([second]);
    expect(factory.resources.leases(true)).toEqual([]);
    factory.tick(now); factory.resources.reconcile(new Date(now.getTime() + 60_001));
    expect(factory.resources.leases(true)).toEqual([]);
    expect(getTaskById(db.raw, second)?.retryCount).toBe(1);
    expect(engine.validator.validate(a.id).passed).toBe(false);
  });
});

describe("artifact validation, private deployment and public gate", () => {
  it("refuses unfinished builds and fabricated agent success without receipts", () => {
    const build = planned();
    expect(engine.validator.validate(build.id).passed).toBe(false);
    factory.tick(now);
    completeTask(db.raw, build.tasks[0].taskId, { success: true, output: "Everything passed, trust me", artifacts: ["fake.cjs"], costCents: 0, duration: 0 });
    expect(engine.validator.validate(build.id).errors.some((e) => e.includes("structured result"))).toBe(true);
    expect(() => factory.portfolio.setState(build.productId, "launch_ready", "Agent said ready")).toThrow("Verified build");
  });
  it("accepts objective results and intact artifacts, refusing tampering or missing artifacts", async () => {
    const build = await finish(planned());
    expect(engine.validator.validate(build.id, true).passed).toBe(true);
    fs.writeFileSync(path.join(build.artifactRoot, "bundle.cjs"), "module.exports='tampered'");
    expect(engine.validator.validate(build.id, true).passed).toBe(false);
    expect(() => engine.validator.promote(build.id)).toThrow("Verified private deployment");
    expect(() => factory.portfolio.setState(build.productId, "launch_ready", "Bypass")).toThrow("Verified build");
    fs.rmSync(path.join(build.artifactRoot, "bundle.cjs"));
    expect(engine.validator.validate(build.id, true).errors.some((e) => e.includes("missing/unsafe"))).toBe(true);
  });
  it("refuses failed required test and unverifiable brief criteria", async () => {
    const c = content();
    c.validationCriteria.push({ id: "real-demand", kind: "test", target: "unmeasured-business-demand", description: "Business demand must be measured" });
    c.successCriteria.push("real-demand");
    const b = engine.briefs.requestReview(engine.briefs.create(selected(), c).id); approve(b.approvalId!);
    const build = await finish(engine.planner.plan(b.id));
    expect(build.status).toBe("failed");
    expect(engine.validator.validate(build.id).errors).toContain("Unverified brief criterion: real-demand");
    expect(build.deploymentId).toBeUndefined();
  });
  it("requires separate creator approval for private deployment", async () => {
    const build = await finish(planned(), false);
    const task = build.tasks.find((t) => t.step === "private_deployment")!;
    expect(build.status).toBe("validated");
    expect(factory.portfolio.get(build.productId)?.portfolioState).toBe("validation");
    expect(getTaskById(db.raw, task.taskId)?.status).toBe("pending");
    expect(build.deploymentId).toBeUndefined();
    approvePrivate(build); await wave();
    expect(engine.store.build(build.id)?.status).toBe("private_deployed");
  });
  it("records private-only synthetic metadata and rolls it back through approved worker task", async () => {
    const build = await finish(planned());
    expect(engine.store.deployment(build.deploymentId!)).toMatchObject({ provider: "synthetic-local", status: "active", visibility: "private", publicUrl: null, externallyAccessible: false, costCents: 0 });
    expect(factory.portfolio.get(build.productId)?.portfolioState).toBe("launch_ready");
    const rollback = engine.requestRollback(build.id);
    expect(engine.requestRollback(build.id)).toEqual(rollback);
    await wave(); expect(getTaskById(db.raw, rollback.taskId)?.status).toBe("pending");
    approve(rollback.approvalId); await wave();
    expect(engine.store.deployment(build.deploymentId!)?.status).toBe("rolled_back");
    expect(factory.portfolio.get(build.productId)?.portfolioState).toBe("validation");
    expect(factory.resources.leases(true)).toEqual([]);
    expect(() => factory.portfolio.setState(build.productId, "launch_ready", "Bypass rollback")).toThrow("Verified build");
  });
  it("never authorizes public launch, including after explicit scoped human approval", async () => {
    const build = await finish(planned());
    expect(engine.publicLaunch.check(build.productId)).toMatchObject({ humanApproved: false, allowed: false });
    const briefRecord = engine.store.brief(build.briefId)!;
    expect(engine.publicLaunch.check(build.productId, briefRecord.approvalId!)).toMatchObject({ humanApproved: false, allowed: false });
    db.productFactory.insert("approvals", { id: "public-request", productId: build.productId, factoryActionId: `public-launch:${build.id}`, action: "resource_reservation", status: "pending", requestedBy: creator, decidedBy: null, decidedAt: null, createdAt: now.toISOString() });
    expect(engine.publicLaunch.check(build.productId, "public-request").humanApproved).toBe(false);
    approve("public-request");
    expect(engine.publicLaunch.check(build.productId, "public-request")).toMatchObject({ humanApproved: true, allowed: false });
    expect(factory.resources.config.allowPublicLaunch).toBe(false);
  });
  it("persists build/deployment and active reservations across physical database reopen", async () => {
    const build = planned(); factory.tick(now);
    const lease = factory.resources.leases(true)[0].id;
    db.close(); db = createDatabase(filename); initialize();
    expect(engine.store.build(build.id)?.status).toBe("planned");
    expect(factory.resources.leases(true)[0].id).toBe(lease);
    pool.spawn(taskRowToTaskNode(getTaskById(db.raw, build.tasks[0].taskId)!)); await pool.waitForIdle();
    const completed = await finish(build);
    db.close(); db = createDatabase(filename); initialize();
    expect(engine.store.build(build.id)).toEqual(completed);
    expect(engine.store.deployment(completed.deploymentId!)?.status).toBe("active");
    expect(engine.validator.validate(build.id, true).passed).toBe(true);
    expect(factory.resources.leases(true)).toEqual([]);
    expect(db.raw.pragma("foreign_key_check")).toEqual([]);
  });
  it("confines artifacts and rejects live or dangling symlinks", () => {
    const root = path.join(directory, "confined"); fs.mkdirSync(root);
    expect(() => artifactPath(root, "../escape.txt")).toThrow("Unsafe");
    fs.symlinkSync(path.join(directory, "outside.txt"), path.join(root, "evil.txt"));
    expect(() => writeArtifact(root, "evil.txt", "never write")).toThrow("Symlink");
    expect(fs.existsSync(path.join(directory, "outside.txt"))).toBe(false);
  });
});

it("keeps reviewed brief content immutable", () => {
  const b = brief();
  expect(() => engine.store.saveBrief({ ...b, content: { ...b.content, architecture: "Changed after approval" } })).toThrow("immutable");
  expect(engine.store.brief(b.id)?.content).toEqual(b.content);
});

it("runs through a dispatcher attached to the existing Factory tick, with no polling scheduler", async () => {
  const build = planned(); approvePrivate(build);
  const disconnect = engine.connectWorkers(pool);
  for (let i = 0; i < 12; i++) { factory.tick(now); await pool.waitForIdle(); }
  disconnect();
  expect(engine.store.build(build.id)?.status).toBe("private_deployed");
  expect(factory.resources.leases(true)).toEqual([]);
  expect(db.getHeartbeatEntries()).toEqual([]);
});

it("rejects failed required tests and never executes tampered filesystem code", async () => {
  const build = planned();
  await wave(); await wave(); await wave();
  const marker = path.join(directory, "must-not-exist");
  fs.writeFileSync(path.join(build.artifactRoot, "feature-0.cjs"), `module.exports=require('fs').writeFileSync(${JSON.stringify(marker)},'bad');`);
  for (let i = 0; i < 4; i++) await wave();
  expect(fs.existsSync(marker)).toBe(false);
  const test = build.tasks.find((t) => t.step === "tests")!;
  expect(getTaskById(db.raw, test.taskId)?.status).toBe("failed");
  expect(engine.validator.validate(build.id).passed).toBe(false);
  expect(engine.store.build(build.id)?.deploymentId).toBeUndefined();
});

it("creates no network, VM, port, domain, inference charge or financial effect", async () => {
  const transport = vi.fn(() => { throw new Error("External transport forbidden"); });
  vi.stubGlobal("fetch", transport);
  const toolContext = context();
  const spies = [vi.spyOn(toolContext.conway, "exec"), vi.spyOn(toolContext.conway, "createSandbox"), vi.spyOn(toolContext.conway, "exposePort"), vi.spyOn(toolContext.conway, "transferCredits"), vi.spyOn(toolContext.conway, "registerDomain")];
  const registry = new HarnessRegistry(); engine.registerHarness(registry);
  pool = new LocalWorkerPool({ db: db.raw, inference, conway: toolContext.conway, harnessRegistry: registry, identity: createTestIdentity(), config: createTestConfig(), toolContext, policyEngine: policy, spendTracker: new SpendTracker(db.raw), factoryHooks: engine.workerHooks(), allowedEditRoot: directory });
  try {
    const build = await finish(planned());
    expect(build.status).toBe("private_deployed");
    expect(transport).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(inference.chat).not.toHaveBeenCalled();
    expect(db.getRecentTransactions(100)).toEqual([]);
    expect(db.productFactory.get("products", build.productId)?.revenueCents).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

it("permits approved private rollback after new Evidence invalidates further building", async () => {
  const build = await finish(planned()), b = engine.store.brief(build.briefId)!;
  new EvidenceEngine(db, creator, true).ingest("new", { opportunityId: b.opportunityId, sourceType: "reddit", sourceRef: "fixture://rollback-counter", independenceKey: "counter", capturedAt: now.toISOString(), summary: "Need retracted", excerpt: "Counter evidence after private deployment", reliability: 1, tags: [], relation: "refutes", kind: "observation", criterion: "problem" });
  expect(engine.validator.validate(build.id, true).passed).toBe(false);
  const rollback = engine.requestRollback(build.id); approve(rollback.approvalId); await wave();
  expect(engine.store.deployment(build.deploymentId!)?.status).toBe("rolled_back");
  expect(factory.resources.leases(true)).toEqual([]);
});
