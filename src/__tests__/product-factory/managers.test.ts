import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, getReadyTasks, getTaskById, insertTask } from "../../state/database.js";
import { assignTask, completeTask, failTask, cancelTask, createGoal, pruneCompletedGoals } from "../../orchestration/task-graph.js";
import { getFactoryConcurrency } from "../../state/factory-tasks.js";
import { PolicyEngine } from "../../agent/policy-engine.js";
import { SpendTracker } from "../../agent/spend-tracker.js";
import * as schema from "../../state/schema.js";
import { FactoryOrchestrator, ProductFactory, PortfolioManager, ResourceManager, compareAllocations, explainAllocation,
  createFactoryPolicyAdmission, resolveProductFactoryConfig } from "../../product-factory/index.js";
import type { AllocationSignals, FactoryTaskMetadata, PortfolioState, ResourceClass } from "../../product-factory/index.js";
import type { AutomatonDatabase, PolicyRule, TickContext } from "../../types.js";
import { createTestConfig, createTestIdentity, MockConwayClient, MockInferenceClient } from "../mocks.js";

const now = new Date("2026-10-07T12:00:00.000Z");
const creator = "creator";
const signals: AllocationSignals = { businessImpact: 0.5, evidenceConfidence: 0.5, strategicFit: 0.5, userImpact: 0.5, risk: 0.2 };
const result = { success: true, output: "Local completion", artifacts: [], costCents: 0, duration: 1 };
let directory: string;
let filename: string;
let db: AutomatonDatabase;
let factory: FactoryOrchestrator;
let actionCounter: number;
function config(resources: Record<string, number> = {}, other: Record<string, unknown> = {}) {
  return resolveProductFactoryConfig({ enabled: true, maxActiveProducts: 10, maxConcurrentExperiments: 2,
    operationalBudgetCents: 100, resources: { globalConcurrency: 6, perProductConcurrency: 2, criticalReservedSlots: 1,
      buildSlots: 3, researchSlots: 3, monitoringSlots: 2, inferenceSlots: 2, computeUnits: 10, perProductBudgetCents: 50, ...resources }, ...other });
}
function admission(rules: PolicyRule[] = []) {
  const engine = new PolicyEngine(db.raw, rules);
  return createFactoryPolicyAdmission(engine, (task) => ({
    tool: { name: "factory_local_work", description: "Local accounting only", parameters: {}, riskLevel: "safe", category: "memory", execute: async () => "unused" },
    args: { taskId: task.id }, context: { identity: createTestIdentity(), config: createTestConfig(), db, conway: new MockConwayClient(), inference: new MockInferenceClient() },
    turnContext: { inputSource: "system", turnToolCallCount: 0, sessionSpend: new SpendTracker(db.raw) },
  }));
}
function action(productId: string, resourceClass: ResourceClass = "research", patch: Partial<FactoryTaskMetadata> = {}, cost = 0, goalId?: string) {
  return factory.planAction({ goalId: goalId ?? factory.createProductGoal(productId, "Local goal", "No external effects"), title: `Action ${++actionCounter}`, description: "Local work",
    estimatedCostCents: cost, factory: { productId, factoryActionId: `action-${actionCounter}`, resourceClass, urgency: 20,
      requiresApproval: false, preemptible: true, criticalIncident: false, resourceUnits: 1, signals, ...patch } });
}
beforeEach(() => {
  vi.setSystemTime(now);
  directory = mkdtempSync(path.join(tmpdir(), "factory-managers-"));
  filename = path.join(directory, "state.db");
  db = createDatabase(filename);
  factory = new FactoryOrchestrator(db, config(), creator, admission());
  actionCounter = 0;
});
afterEach(() => { if (db.raw.open) db.close(); rmSync(directory, { recursive: true, force: true }); vi.useRealTimers(); });

describe("portfolio isolation", () => {
  it("keeps the previous local lifecycle compatible with portfolio pause/archive/reactivation", () => {
    const p = factory.portfolio.create("Compatible");
    const local = new ProductFactory(db, config(), creator);
    local.transitionProduct(p.id, "paused");
    expect(factory.portfolio.canReceiveWork(p.id)).toBe(false);
    factory.portfolio.setState(p.id, "research", "Explicit creator resume");
    expect(factory.portfolio.canReceiveWork(p.id)).toBe(true);
    local.transitionProduct(p.id, "archived");
    expect(factory.portfolio.get(p.id)?.portfolioState).toBe("archived");
    expect(factory.portfolio.canReceiveWork(p.id)).toBe(false);
  });
  it("supports at least five simultaneous products and all requested portfolio states", () => {
    const states: PortfolioState[] = ["research", "building", "launch_ready", "validation", "optimizing", "scaling", "pivoting", "killed", "archived"];
    states.forEach((state) => factory.portfolio.create(state, state));
    expect(factory.portfolio.list()).toHaveLength(9);
    expect(factory.portfolio.list().map((p) => p.portfolioState).sort()).toEqual([...states].sort());
    expect(factory.portfolio.list().filter((p) => factory.portfolio.canReceiveWork(p.id))).toHaveLength(7);
    expect(db.getRecentTransactions(100)).toEqual([]);
  });
  it("requires a new explicit decision to reactivate killed/archived products", () => {
    const p = factory.portfolio.create("Terminal");
    factory.portfolio.setState(p.id, "killed", "Creator explicitly stops local work");
    expect(() => action(p.id)).toThrow("Product cannot receive");
    factory.portfolio.setState(p.id, "research", "Creator explicitly restarts local research");
    expect(action(p.id).factory?.productId).toBe(p.id);
    factory.portfolio.setState(p.id, "archived", "Archive");
    expect(getTaskById(db.raw, getReadyTasks(db.raw, { factoryOnly: true })[0]?.id ?? "missing")).toBeUndefined();
    expect(db.productFactory.list("decisions", { productId: p.id })).toHaveLength(3);
  });
  it("isolates pending approvals to their exact action and product", () => {
    const p1 = factory.portfolio.create("Approval blocked");
    const p2 = factory.portfolio.create("Ready");
    const blocked = action(p1.id, "build", { requiresApproval: true, approvalId: "approval" });
    const ready = action(p2.id);
    db.productFactory.insert("approvals", { id: "approval", productId: p1.id, factoryActionId: blocked.factory!.factoryActionId,
      action: "prototype", status: "pending", requestedBy: creator, decidedBy: null, decidedAt: null, createdAt: now.toISOString() });
    const cycle = factory.tick(now);
    expect(cycle.decisions.find((d) => d.taskId === blocked.id)?.reason).toContain("approval");
    expect(getTaskById(db.raw, ready.id)?.status).toBe("assigned");
    expect(getTaskById(db.raw, blocked.id)?.status).toBe("pending");
    db.raw.prepare("UPDATE factory_approvals SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = 'approval'").run(creator, now.toISOString());
    expect(factory.resources.assign(blocked.id, now).allowed).toBe(true);
    const another = action(p1.id, "monitoring", { requiresApproval: true, approvalId: "approval" });
    expect(factory.resources.decision(another, now).reason).toContain("approval");
  });
  it("a product failure does not stop other products or the factory", () => {
    const bad = factory.portfolio.create("Bad");
    const good = factory.portfolio.create("Good");
    const failing = action(bad.id);
    factory.resources.assign(failing.id, now);
    factory.resources.fail(failing.id, "Terminal local failure", false);
    const surviving = action(good.id);
    const cycle = factory.tick(now);
    expect(cycle.state).toBe("EXECUTING");
    expect(factory.portfolio.get(bad.id)?.failure).toContain("Terminal task failure");
    expect(getTaskById(db.raw, surviving.id)?.status).toBe("assigned");
    expect(factory.resources.leases(true)).toHaveLength(1);
  });
  it("a throwing product admission is isolated and its reservations released", () => {
    const bad = factory.portfolio.create("Bad");
    const good = factory.portfolio.create("Good");
    const a = action(bad.id);
    const b = action(good.id);
    const normal = admission();
    factory = new FactoryOrchestrator(db, config(), creator, (task) => { if (task.factory?.productId === bad.id) throw new Error("Product planner failure"); return normal(task); });
    const cycle = factory.tick(now);
    expect(cycle.errors).toEqual([{ productId: bad.id, message: "Product planner failure" }]);
    expect(getTaskById(db.raw, a.id)?.status).toBe("cancelled");
    expect(getTaskById(db.raw, b.id)?.status).toBe("assigned");
    expect(cycle.state).not.toBe("FAILED");
  });
});

describe("resource scheduling", () => {
  it("preserves compute capacity for critical incidents even while normal work is running", () => {
    factory = new FactoryOrchestrator(db, config({ computeUnits: 2, criticalReservedComputeUnits: 1 }), creator, admission());
    const normal = action(factory.portfolio.create("Normal").id, "research");
    factory.resources.assign(normal.id, now); factory.resources.start(normal.id);
    const tooLarge = action(factory.portfolio.create("Large").id, "compute");
    expect(factory.resources.assign(tooLarge.id, now).reason).toContain("reserved for critical");
    const critical = action(factory.portfolio.create("Critical").id, "monitoring", { criticalIncident: true });
    expect(factory.resources.assign(critical.id, now).allowed).toBe(true);
    expect(factory.resources.leases(true)).toHaveLength(2);
  });
  it("enforces a distinct inference budget while preserving the operational budget", () => {
    factory = new FactoryOrchestrator(db, config({ inferenceBudgetCents: 5 }), creator, admission());
    const p = factory.portfolio.create("Inference");
    const costly = action(p.id, "inference", {}, 6);
    expect(factory.resources.assign(costly.id, now).reason).toBe("Inference budget exhausted");
    const allowed = action(p.id, "inference", {}, 5);
    factory.resources.assign(allowed.id, now); factory.resources.complete(allowed.id, { ...result, costCents: 5 });
    const next = action(p.id, "inference", {}, 1);
    expect(factory.resources.assign(next.id, now).reason).toBe("Inference budget exhausted");
  });
  it("respects global and per-product concurrency and reserves incident capacity", () => {
    factory = new FactoryOrchestrator(db, config({ globalConcurrency: 3, perProductConcurrency: 1, researchSlots: 3 }), creator, admission());
    const p1 = factory.portfolio.create("One");
    const p2 = factory.portfolio.create("Two");
    const p3 = factory.portfolio.create("Incident");
    const a = action(p1.id); const another = action(p1.id); const b = action(p2.id); const c = action(p3.id);
    expect(factory.resources.assign(a.id, now).allowed).toBe(true);
    expect(factory.resources.assign(another.id, now).reason).toContain("Product concurrency");
    expect(factory.resources.assign(b.id, now).allowed).toBe(true);
    expect(factory.resources.assign(c.id, now).reason).toContain("reserved for critical");
    const incident = action(p3.id, "monitoring", { criticalIncident: true });
    expect(factory.resources.assign(incident.id, now).allowed).toBe(true);
    expect(getFactoryConcurrency(db.raw)).toBe(3);
    const otherIncident = action(p2.id, "monitoring", { criticalIncident: true, preemptible: false });
    // Existing queued work may be preempted, but never increases total concurrency.
    factory.resources.assign(otherIncident.id, now);
    expect(getFactoryConcurrency(db.raw)).toBeLessThanOrEqual(3);
  });
  it.each(["build", "research", "monitoring", "inference", "experiment"] as const)("enforces %s class capacity", (resourceClass) => {
    factory = new FactoryOrchestrator(db, config({ buildSlots: 1, researchSlots: 1, monitoringSlots: 1, inferenceSlots: 1 }, { maxConcurrentExperiments: 1 }), creator, admission());
    const p1 = factory.portfolio.create("One"); const p2 = factory.portfolio.create("Two");
    const a = action(p1.id, resourceClass); const b = action(p2.id, resourceClass);
    expect(factory.resources.assign(a.id, now).allowed).toBe(true);
    expect(factory.resources.assign(b.id, now).reason).toContain("Resource class limit");
    expect(getFactoryConcurrency(db.raw, { resourceClass })).toBe(1);
  });
  it("prioritizes a critical incident over a more valuable pending task", () => {
    factory = new FactoryOrchestrator(db, config({ buildSlots: 1 }), creator, admission());
    const ordinary = action(factory.portfolio.create("Normal").id, "build", { urgency: 100, signals: { ...signals, businessImpact: 1 } });
    const incident = action(factory.portfolio.create("Incident").id, "build", { criticalIncident: true, urgency: 0 });
    const cycle = factory.tick(now);
    expect(cycle.decisions[0].taskId).toBe(incident.id);
    expect(getTaskById(db.raw, incident.id)?.status).toBe("assigned");
    expect(getTaskById(db.raw, ordinary.id)?.status).toBe("pending");
  });
  it("preempts only preemptible assigned work to make room for a critical incident", () => {
    factory = new FactoryOrchestrator(db, config({ buildSlots: 1 }), creator, admission());
    const normal = action(factory.portfolio.create("Normal").id, "build");
    factory.resources.assign(normal.id, now);
    const incident = action(factory.portfolio.create("Incident").id, "build", { criticalIncident: true });
    const cycle = factory.tick(now);
    expect(cycle.decisions.find((d) => d.taskId === incident.id)?.allowed).toBe(true);
    expect(getTaskById(db.raw, normal.id)?.status).toBe("pending");
    expect(factory.resources.leases().find((r) => r.taskId === normal.id)?.releasedReason).toBe("critical-preemption");
    expect(factory.resources.leases(true).map((r) => r.taskId)).toEqual([incident.id]);
  });
  it("does not preempt running or non-preemptible tasks", () => {
    factory = new FactoryOrchestrator(db, config({ buildSlots: 1 }), creator, admission());
    const normal = action(factory.portfolio.create("Normal").id, "build");
    factory.resources.assign(normal.id, now); factory.resources.start(normal.id);
    const incident = action(factory.portfolio.create("Incident").id, "build", { criticalIncident: true });
    expect(factory.resources.assign(incident.id, now).allowed).toBe(false);
    expect(getTaskById(db.raw, normal.id)?.status).toBe("running");
  });
  it("unbounded age bonus prevents starvation by newer eligible normal tasks", () => {
    factory = new FactoryOrchestrator(db, config({ researchSlots: 1 }), creator, admission());
    const old = action(factory.portfolio.create("Old").id, "research", { urgency: 0, signals: { businessImpact: 0, evidenceConfidence: 0, strategicFit: 0, userImpact: 0, risk: 1 } });
    db.raw.prepare("UPDATE task_graph SET created_at = ? WHERE id = ?").run(new Date(now.getTime() - 100 * 3_600_000).toISOString(), old.id);
    const fresh = action(factory.portfolio.create("Fresh").id, "research", { urgency: 100, signals: { businessImpact: 1, evidenceConfidence: 1, strategicFit: 1, userImpact: 1, risk: 0 } });
    const cycle = factory.tick(now);
    expect(cycle.decisions[0].taskId).toBe(old.id);
    expect(cycle.decisions[0].components.ageBonus).toBe(1000);
    expect(getTaskById(db.raw, fresh.id)?.status).toBe("pending");
  });
  it("produces deterministic scoring explanations including every required factor", () => {
    const task = action(factory.portfolio.create("Scored").id, "compute", { deadline: new Date(now.getTime() + 3600_000).toISOString() }, 10);
    const a = explainAllocation(task, now, true);
    expect(a).toEqual(explainAllocation(task, now, true));
    expect(Object.keys(a.components)).toEqual(["businessImpact", "urgency", "evidenceConfidence", "strategicFit", "userImpact", "estimatedCost", "risk", "dependencies", "ageBonus", "deadline"]);
    expect(compareAllocations(a, a)).toBe(0);
  });
  it("accounts for compute units and operational budgets without product revenue", () => {
    factory = new FactoryOrchestrator(db, config({ computeUnits: 2, criticalReservedComputeUnits: 0, perProductBudgetCents: 15 }, { operationalBudgetCents: 20 }), creator, admission());
    const p1 = factory.portfolio.create("One"); const p2 = factory.portfolio.create("Two");
    db.raw.prepare("UPDATE factory_products SET revenue_cents = 999999 WHERE id = ?").run(p1.id);
    const a = action(p1.id, "compute", { resourceUnits: 2 }, 10);
    expect(factory.resources.assign(a.id, now).allowed).toBe(true);
    const b = action(p2.id, "compute", {}, 10);
    expect(factory.resources.assign(b.id, now).reason).toContain("Compute capacity");
    factory.resources.complete(a.id, { ...result, costCents: 10 });
    const tooMuch = action(p1.id, "inference", {}, 6);
    expect(factory.resources.assign(tooMuch.id, now).reason).toContain("Product operational budget");
    expect(factory.resources.assign(b.id, now).allowed).toBe(true);
    const third = action(factory.portfolio.create("Three").id, "inference", {}, 1);
    expect(factory.resources.assign(third.id, now).reason).toContain("Operational budget");
    expect(db.getRecentTransactions(100)).toEqual([]);
  });
});

describe("reservation lifecycle and persistence", () => {
  it("status and reservation cleanup roll back together on a terminal-state failure", () => {
    const task = action(factory.portfolio.create("Atomic cleanup").id);
    factory.resources.assign(task.id, now);
    db.raw.exec("CREATE TRIGGER reject_release BEFORE UPDATE OF status ON factory_resource_reservations WHEN NEW.status = 'released' BEGIN SELECT RAISE(ABORT, 'release unavailable'); END;");
    expect(() => completeTask(db.raw, task.id, result)).toThrow("release unavailable");
    expect(getTaskById(db.raw, task.id)?.status).toBe("assigned");
    expect(factory.resources.leases(true)).toHaveLength(1);
  });
  it("rejects a second live reservation for the same task at the SQL boundary", () => {
    const task = action(factory.portfolio.create("Unique").id);
    factory.resources.assign(task.id, now);
    expect(() => db.raw.prepare(`INSERT INTO factory_resource_reservations
      (id,created_at,product_id,task_id,resource,units,operational_cost_cents,status,expires_at,resource_class,managed)
      VALUES ('duplicate', ?, ?, ?, 'compute', 1, 0, 'reserved', ?, 'research', 1)`)
      .run(now.toISOString(), task.factory!.productId, task.id, now.toISOString())).toThrow("UNIQUE");
    expect(factory.resources.leases(true)).toHaveLength(1);
  });
  it("retry and duplicate assignment never double a persistent reservation", () => {
    const task = action(factory.portfolio.create("Retry").id);
    const first = factory.resources.assign(task.id, now);
    expect(factory.resources.assign(task.id, now).reservationId).toBe(first.reservationId);
    expect(factory.resources.leases()).toHaveLength(1);
    factory.resources.fail(task.id, "Retry", true, 2);
    expect(factory.resources.leases(true)).toHaveLength(0);
    expect(getTaskById(db.raw, task.id)?.retryCount).toBe(1);
    expect(factory.resources.assign(task.id, now).reservationId).toBe(first.reservationId);
    expect(factory.resources.leases()).toHaveLength(1);
    factory.resources.complete(task.id, { ...result, costCents: 3 });
    expect(getTaskById(db.raw, task.id)?.actualCostCents).toBe(5);
    expect(factory.resources.leases(true)).toHaveLength(0);
  });
  it("reload retains active assignments and prevents over-allocation", () => {
    const cfg = config({ researchSlots: 1 });
    factory = new FactoryOrchestrator(db, cfg, creator, admission());
    const p1 = factory.portfolio.create("One"); const p2 = factory.portfolio.create("Two");
    const a = action(p1.id); const b = action(p2.id);
    const id = factory.resources.assign(a.id, now).reservationId;
    factory.tick(now);
    db.close(); db = createDatabase(filename);
    factory = new FactoryOrchestrator(db, cfg, creator, admission());
    expect(factory.state).toBe("EXECUTING");
    expect(factory.resources.leases(true)).toHaveLength(1);
    expect(factory.resources.assign(a.id, now).reservationId).toBe(id);
    expect(factory.resources.assign(b.id, now).allowed).toBe(false);
    expect(getTaskById(db.raw, a.id)?.factory?.reservationId).toBe(id);
  });
  it.each(["completed", "failed", "cancelled", "retry"])("existing Task Graph %s helper releases reservations atomically", (outcome) => {
    const task = action(factory.portfolio.create("Outcome").id);
    factory.resources.assign(task.id, now);
    if (outcome === "completed") completeTask(db.raw, task.id, result);
    if (outcome === "failed") failTask(db.raw, task.id, "Failure", false);
    if (outcome === "cancelled") cancelTask(db.raw, task.id);
    if (outcome === "retry") failTask(db.raw, task.id, "Retry", true);
    expect(factory.resources.leases(true)).toHaveLength(0);
  });
  it("timeouts release resources and reuse the same reservation on retry", () => {
    const task = action(factory.portfolio.create("Timeout").id);
    const id = factory.resources.assign(task.id, now).reservationId;
    factory.resources.reconcile(new Date(now.getTime() + task.timeoutMs));
    expect(factory.resources.leases(true)).toHaveLength(0);
    expect(factory.resources.leases()[0].releasedReason).toBe("timeout");
    expect(getTaskById(db.raw, task.id)?.retryCount).toBe(1);
    expect(factory.resources.assign(task.id, now).reservationId).toBe(id);
  });
  it("exhausted timeout retries terminate and do not leak", () => {
    const task = action(factory.portfolio.create("No retries").id);
    db.raw.prepare("UPDATE task_graph SET max_retries = 0 WHERE id = ?").run(task.id);
    factory.resources.assign(task.id, now);
    factory.resources.reconcile(new Date(now.getTime() + task.timeoutMs));
    expect(getTaskById(db.raw, task.id)?.status).toBe("failed");
    expect(factory.resources.leases(true)).toHaveLength(0);
  });
  it("replan releases assignments without increasing retry counts", () => {
    const task = action(factory.portfolio.create("Replan").id);
    const id = factory.resources.assign(task.id, now).reservationId;
    factory.replan([task.id]);
    expect(factory.resources.leases(true)).toHaveLength(0);
    expect(getTaskById(db.raw, task.id)?.retryCount).toBe(0);
    expect(factory.resources.assign(task.id, now).reservationId).toBe(id);
  });
  it("reservation+assignment roll back together if Task Graph assignment fails", () => {
    const task = action(factory.portfolio.create("Atomic").id);
    db.raw.exec("CREATE TRIGGER reject_assignment BEFORE UPDATE OF status ON task_graph WHEN NEW.status = 'assigned' BEGIN SELECT RAISE(ABORT, 'assignment unavailable'); END;");
    expect(() => factory.resources.assign(task.id, now)).toThrow("assignment unavailable");
    expect(factory.resources.leases()).toEqual([]);
    expect(getTaskById(db.raw, task.id)?.factory?.reservationId).toBeNull();
    expect(getTaskById(db.raw, task.id)?.status).toBe("pending");
  });
  it("serializes shared limits across two SQLite connections", () => {
    const cfg = config({ researchSlots: 1 });
    factory = new FactoryOrchestrator(db, cfg, creator, admission());
    const a = action(factory.portfolio.create("One").id); const b = action(factory.portfolio.create("Two").id);
    const second = createDatabase(filename);
    try {
      const manager = new ResourceManager(second, cfg, creator);
      factory.resources.assign(a.id, now);
      expect(manager.assign(b.id, now).allowed).toBe(false);
      expect(manager.leases(true)).toHaveLength(1);
    } finally { second.close(); }
  });
});

describe("Factory cycle and Task Graph compatibility", () => {
  it("uses the existing heartbeat contract without creating another timer or database", async () => {
    action(factory.portfolio.create("Heartbeat").id);
    const heartbeat = factory.heartbeatTask();
    const context: TickContext = { db: db.raw, startedAt: now, tickId: "local-tick", creditBalance: 0, usdcBalance: 0,
      survivalTier: "normal", lowComputeMultiplier: 1, config: { entries: [], defaultIntervalMs: 60_000, lowComputeMultiplier: 4 } };
    const taskContext = { identity: createTestIdentity(), config: createTestConfig(), db, conway: new MockConwayClient() };
    expect((await heartbeat.run(context, taskContext)).shouldWake).toBe(false);
    expect(factory.state).toBe("EXECUTING");
    const other = createDatabase(":memory:");
    try { await expect(heartbeat.run({ ...context, db: other.raw }, taskContext)).rejects.toThrow("existing database"); }
    finally { other.close(); }
  });
  it("a paused factory still releases expired leases without dispatching more work", () => {
    const task = action(factory.portfolio.create("Pause cleanup").id);
    factory.resources.assign(task.id, now);
    factory.pause();
    const cycle = factory.tick(new Date(now.getTime() + task.timeoutMs));
    expect(cycle.state).toBe("PAUSED");
    expect(cycle.decisions).toEqual([]);
    expect(factory.resources.leases(true)).toEqual([]);
    expect(getTaskById(db.raw, task.id)?.status).toBe("pending");
  });
  it("rejects invalid resource limits and preserves default disabled/zero-budget configuration", () => {
    for (const resources of [{ globalConcurrency: 0 }, { criticalReservedSlots: 2 }, { computeUnits: 1 },
      { perProductConcurrency: -1 }, { inferenceBudgetCents: NaN }, { ageBonusPerHour: 0 }, { unknown: 1 }]) {
      expect(() => resolveProductFactoryConfig({ resources })).toThrow();
    }
    const resolved = resolveProductFactoryConfig();
    expect(resolved.enabled).toBe(false);
    expect(resolved.operationalBudgetCents).toBe(0);
    expect(resolved.resources.inferenceBudgetCents).toBe(0);
    resolved.resources.buildSlots = 999;
    expect(resolveProductFactoryConfig().resources.buildSlots).toBe(1);
  });
  it("preserves Factory audit goals while pruning legacy completed goals", () => {
    const task = action(factory.portfolio.create("Audit").id);
    factory.resources.assign(task.id, now); factory.resources.complete(task.id, result);
    const goal = createGoal(db.raw, "Legacy", "Legacy pruning");
    const legacy = insertTask(db.raw, { goalId: goal.id, title: "Legacy", description: "Legacy" });
    completeTask(db.raw, legacy, result);
    pruneCompletedGoals(db.raw, "2099-01-01T00:00:00.000Z");
    expect(getTaskById(db.raw, legacy)).toBeUndefined();
    expect(getTaskById(db.raw, task.id)?.status).toBe("completed");
    expect(factory.resources.leases()).toHaveLength(1);
  });
  it("runs the full requested cycle without a timer or real execution", () => {
    action(factory.portfolio.create("Cycle").id);
    const cycle = factory.tick(now);
    expect(cycle.trace).toEqual(["OBSERVING", "PLANNING", "DISPATCHING", "EXECUTING", "EVALUATING", "REPLANNING", "EXECUTING"]);
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM event_stream WHERE type = 'factory_state'").get()).toEqual({ count: 7 });
    expect((db.raw.prepare("SELECT MIN(token_count) AS tokens FROM event_stream WHERE type = 'factory_state'").get() as { tokens: number }).tokens).toBeGreaterThan(0);
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM factory_capacity_snapshots").get()).toEqual({ count: 1 });
    expect(db.getRecentTransactions(100)).toEqual([]);
    expect(db.getHeartbeatEntries()).toEqual([]);
  });
  it("does no work when disabled and persists PAUSED/resume", () => {
    const disabled = new FactoryOrchestrator(db, undefined, creator, admission());
    expect(disabled.tick(now)).toEqual({ state: "IDLE", trace: [], decisions: [], errors: [] });
    expect(() => disabled.portfolio.create("Forbidden")).toThrow("disabled");
    action(factory.portfolio.create("Paused").id);
    factory.pause();
    expect(factory.tick(now).trace).toEqual([]);
    expect(new FactoryOrchestrator(db, config(), creator, admission()).state).toBe("PAUSED");
    factory.resume(); expect(factory.tick(now).state).toBe("EXECUTING");
  });
  it("fails closed without policy admission and respects policy deny", () => {
    const task = action(factory.portfolio.create("Denied").id);
    const unavailable = new FactoryOrchestrator(db, config(), creator);
    expect(unavailable.tick(now).decisions[0].reason).toContain("NO_POLICY_GATE");
    const deny: PolicyRule = { id: "existing-deny", priority: 1, description: "Deny local dispatch", appliesTo: { by: "all" },
      evaluate: () => ({ rule: "existing-deny", action: "deny", reasonCode: "TEST_DENY", humanMessage: "Policy must win" }) };
    factory = new FactoryOrchestrator(db, config(), creator, admission([deny]));
    expect(factory.tick(now).decisions[0].reason).toContain("TEST_DENY");
    expect(getTaskById(db.raw, task.id)?.status).toBe("pending");
    expect(factory.resources.leases()).toEqual([]);
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM policy_decisions").get()).toEqual({ count: 1 });
  });
  it("keeps Factory tasks out of the existing funding/dispatch path", () => {
    const factoryTask = action(factory.portfolio.create("Factory").id);
    const goal = createGoal(db.raw, "Legacy", "Existing workflow");
    const legacyTask = insertTask(db.raw, { goalId: goal.id, title: "Legacy task", description: "Existing" });
    expect(getReadyTasks(db.raw).map((t) => t.id)).toEqual([legacyTask]);
    expect(getReadyTasks(db.raw, { factoryOnly: true }).map((t) => t.id)).toEqual([factoryTask.id]);
    expect(() => assignTask(db.raw, factoryTask.id, "legacy-agent")).toThrow("ResourceManager reservation");
    assignTask(db.raw, legacyTask, "legacy-agent");
    expect(getTaskById(db.raw, legacyTask)?.status).toBe("assigned");
  });
  it("rejects invalid costs/retry counters even through the shared low-level insertion helper", () => {
    const p = factory.portfolio.create("Costs");
    const goalId = factory.createProductGoal(p.id, "Cost goal", "Local accounting");
    const valid = action(p.id, "research", {}, 0, goalId);
    for (const patch of [{ actualCostCents: -1 }, { estimatedCostCents: 0.5 }, { timeoutMs: 0 }, { maxRetries: -1 }, { retryCount: 0.5 }]) {
      expect(() => insertTask(db.raw, { goalId, title: "Invalid", description: "Invalid", factory: { ...valid.factory!, factoryActionId: "invalid", reservationId: null }, ...patch })).toThrow("Invalid Factory task");
    }
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM task_graph WHERE product_id = ?").get(p.id)).toEqual({ count: 1 });
  });
  it("reuses the Task Graph dependency checks and idempotent action identity", () => {
    const p = factory.portfolio.create("DAG");
    const goalId = factory.createProductGoal(p.id, "DAG goal", "Local dependencies");
    const a = action(p.id, "research", {}, 0, goalId);
    const plan = { goalId, title: "Dependent", description: "Depends on parent", dependencies: [a.id], factory: { ...a.factory!, factoryActionId: "dependent", reservationId: null } };
    const b = factory.planAction(plan);
    expect(factory.planAction(plan).id).toBe(b.id);
    expect(factory.resources.assign(b.id, now).allowed).toBe(false);
    factory.resources.assign(a.id, now); factory.resources.complete(a.id, result);
    expect(factory.resources.assign(b.id, now).allowed).toBe(true);
  });
  it("does not let a historical failure undo a new explicit creator decision", () => {
    const p = factory.portfolio.create("Recovered"); const task = action(p.id);
    factory.resources.assign(task.id, now); factory.resources.fail(task.id, "Terminal", false);
    factory.tick(now);
    factory.portfolio.setState(p.id, "research", "Explicit recovery with a new plan");
    const fresh = action(p.id);
    factory.tick(now);
    expect(factory.portfolio.get(p.id)?.failure).toBeNull();
    expect(getTaskById(db.raw, fresh.id)?.status).toBe("assigned");
  });
  it("a global infrastructure failure persists FAILED and permits explicit recovery", () => {
    db.raw.exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON factory_capacity_snapshots BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END;");
    action(factory.portfolio.create("Recover").id);
    expect(factory.tick(now).state).toBe("FAILED");
    expect(factory.resources.leases()).toEqual([]);
    expect(factory.tick(now).trace).toEqual([]);
    db.raw.exec("DROP TRIGGER reject_snapshot");
    factory.resume(); expect(factory.tick(now).state).toBe("EXECUTING");
  });
});

describe("V12 to V13 additive upgrade", () => {
  it("adds metadata while preserving V12 products, events and reservation rows", () => {
    const oldPath = path.join(directory, "v12.db");
    const old = new Database(oldPath);
    for (const sql of [schema.CREATE_TABLES, schema.MIGRATION_V2, schema.MIGRATION_V3, schema.MIGRATION_V4, schema.MIGRATION_V4_ALTER,
      schema.MIGRATION_V4_ALTER2, schema.MIGRATION_V4_ALTER_INBOX_STATUS, schema.MIGRATION_V4_ALTER_INBOX_RETRY, schema.MIGRATION_V4_ALTER_INBOX_MAX_RETRIES,
      schema.MIGRATION_V5, schema.MIGRATION_V6, schema.MIGRATION_V7, schema.MIGRATION_V8, schema.MIGRATION_V9, schema.MIGRATION_V9_ALTER_CHILDREN_ROLE,
      schema.MIGRATION_V10, schema.MIGRATION_V11, schema.MIGRATION_V12]) old.exec(sql);
    old.exec("INSERT INTO schema_version(version) VALUES (12)");
    old.prepare("INSERT INTO factory_products(id,created_at,creator_address,name,stage,revenue_cents) VALUES ('old', ?, 'creator', 'Old', 'building', 125)").run(now.toISOString());
    old.prepare("INSERT INTO factory_resource_reservations(id,created_at,product_id,resource,units,operational_cost_cents,status,expires_at) VALUES ('old-res', ?, 'old', 'compute', 1, 0, 'requested', ?)").run(now.toISOString(), now.toISOString());
    old.close();
    const migrated = createDatabase(oldPath);
    try {
      expect(migrated.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get()).toEqual({ version: schema.SCHEMA_VERSION });
      const portfolio = new PortfolioManager(migrated, config(), creator);
      expect(portfolio.get("old")?.portfolioState).toBe("building");
      expect(portfolio.get("old")?.revenueCents).toBe(125);
      expect(migrated.productFactory.get("resourceReservations", "old-res")?.status).toBe("requested");
      expect(migrated.raw.pragma("foreign_key_check")).toEqual([]);
      expect(migrated.raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'factory_%'").get()).toEqual({ count: 14 });
    } finally { migrated.close(); }
  });
});
