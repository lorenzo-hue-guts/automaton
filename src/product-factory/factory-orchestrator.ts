import type { AutomatonDatabase, PolicyRequest } from "../types.js";
import type { PolicyEngine } from "../agent/policy-engine.js";
import { createGoal } from "../orchestration/task-graph.js";
import { getReadyTasks, getTaskById, insertEvent, insertTask, type TaskGraphRow } from "../state/database.js";
import { compareAllocations, explainAllocation } from "./allocation.js";
import { resolveProductFactoryConfig, type ProductFactoryConfig } from "./config.js";
import { PortfolioManager } from "./portfolio-manager.js";
import { ResourceManager } from "./resource-manager.js";
import type { AllocationDecision, FactoryAdmission, FactoryState, FactoryTaskMetadata } from "./scheduling-types.js";
import type { ProductFactoryHeartbeatTask } from "./types.js";
import { estimateTokens } from "../memory/event-stream.js";

/** Uses the existing policy rules and audit logger; approvals do not override a deny. */
export function createFactoryPolicyAdmission(engine: PolicyEngine, requestFor: (task: TaskGraphRow) => PolicyRequest): FactoryAdmission {
  return (task) => {
    const decision = engine.evaluate(requestFor(task));
    engine.logDecision(decision);
    return decision;
  };
}
export interface FactoryActionPlan {
  goalId: string;
  title: string;
  description: string;
  factory: FactoryTaskMetadata;
  dependencies?: string[];
  estimatedCostCents?: number;
  timeoutMs?: number;
  maxRetries?: number;
}
export interface FactoryCycleResult { state: FactoryState; trace: FactoryState[]; decisions: AllocationDecision[]; errors: { productId: string; message: string }[] }
const STATES: readonly FactoryState[] = ["IDLE", "OBSERVING", "PLANNING", "DISPATCHING", "EXECUTING", "EVALUATING", "REPLANNING", "PAUSED", "FAILED"];

/** Called by the existing runtime/heartbeat. It owns no timer, worker, funding or external executor. */
export class FactoryOrchestrator {
  readonly portfolio: PortfolioManager;
  readonly resources: ResourceManager;
  private readonly config: ProductFactoryConfig;
  private readonly stateKey: string;
  private readonly localDispatchers = new Set<() => void>();
  constructor(private readonly db: AutomatonDatabase, config: ProductFactoryConfig | undefined, readonly creatorAddress: string,
    private readonly admission: FactoryAdmission = () => ({ action: "deny", reasonCode: "NO_POLICY_GATE", humanMessage: "Policy gate unavailable" })) {
    this.config = resolveProductFactoryConfig(config);
    this.portfolio = new PortfolioManager(db, this.config, creatorAddress);
    this.resources = new ResourceManager(db, this.config, creatorAddress);
    this.stateKey = `product-factory:${creatorAddress}:state`;
  }
  /** Local worker adapters run after the existing cycle commits; no extra scheduler. */
  registerLocalDispatcher(dispatch: () => void): () => void {
    this.localDispatchers.add(dispatch);
    return () => { this.localDispatchers.delete(dispatch); };
  }
  get database(): AutomatonDatabase { return this.db; }
  get state(): FactoryState {
    const state = this.db.getKV(this.stateKey) ?? "IDLE";
    return STATES.includes(state as FactoryState) ? state as FactoryState : "FAILED";
  }
  private enabled(): void { if (!this.config.enabled) throw new Error("Product Factory is disabled"); }
  /** Optional registration with DurableScheduler's existing task map; no timer is created. */
  heartbeatTask(): ProductFactoryHeartbeatTask {
    return { name: "product_factory_tick", run: async (ctx) => {
      if (ctx.db !== this.db.raw) throw new Error("Factory heartbeat must use the existing database");
      const cycle = this.tick(ctx.startedAt);
      return { shouldWake: false, message: `Product Factory: ${cycle.state}; ${cycle.decisions.filter((d) => d.allowed).length} local assignments` };
    } };
  }
  private transition(state: FactoryState, trace: FactoryState[]): void {
    this.db.setKV(this.stateKey, state);
    const content = JSON.stringify({ state });
    insertEvent(this.db.raw, { type: "factory_state", agentAddress: this.creatorAddress, content, tokenCount: estimateTokens(content) });
    trace.push(state);
  }
  createProductGoal(productId: string, title: string, description: string): string {
    this.enabled();
    if (!this.portfolio.canReceiveWork(productId)) throw new Error("Product cannot receive work");
    return this.db.raw.transaction(() => {
      const goal = createGoal(this.db.raw, title, description);
      this.db.setKV(`product-factory:goal:${goal.id}`, productId);
      return goal.id;
    }).immediate();
  }
  planAction(plan: FactoryActionPlan): TaskGraphRow {
    this.enabled();
    if (!this.portfolio.canReceiveWork(plan.factory.productId)) throw new Error("Product cannot receive work without a new explicit decision");
    if (!plan.title.trim() || !plan.description.trim()) throw new Error("Action description required");
    for (const [key, value] of Object.entries({ cost: plan.estimatedCostCents ?? 0, retries: plan.maxRetries ?? 3, timeout: plan.timeoutMs ?? 300_000 })) {
      if (!Number.isSafeInteger(value) || value < (key === "timeout" ? 1 : 0)) throw new Error(`Invalid ${key}`);
    }
    return this.db.raw.transaction(() => {
      if (this.db.getKV(`product-factory:goal:${plan.goalId}`) !== plan.factory.productId) throw new Error("Use a Factory goal owned by this product");
      const existing = this.db.raw.prepare("SELECT id FROM task_graph WHERE product_id = ? AND factory_action_id = ?").get(plan.factory.productId, plan.factory.factoryActionId) as { id: string } | undefined;
      if (existing) return getTaskById(this.db.raw, existing.id)!;
      for (const dep of plan.dependencies ?? []) {
        const dependency = getTaskById(this.db.raw, dep);
        if (!dependency || dependency.goalId !== plan.goalId || dependency.factory?.productId !== plan.factory.productId) throw new Error("Dependency must belong to the product goal");
      }
      const id = insertTask(this.db.raw, { ...plan, priority: plan.factory.urgency, status: "pending" });
      return getTaskById(this.db.raw, id)!;
    }).immediate();
  }
  tick(now = new Date()): FactoryCycleResult {
    const result: FactoryCycleResult = { state: this.state, trace: [], decisions: [], errors: [] };
    if (!this.config.enabled) return result;
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid cycle time");
    if (["PAUSED", "FAILED"].includes(this.state)) {
      // Pausing dispatch must not suspend expiry/cleanup of already persistent leases.
      try { this.resources.reconcile(now); }
      catch (error) { result.errors.push({ productId: "", message: error instanceof Error ? error.message : String(error) }); }
      return result;
    }
    try {
      this.db.raw.transaction(() => {
        this.transition("OBSERVING", result.trace);
        this.resources.reconcile(now);
        this.transition("PLANNING", result.trace);
        const tasks = getReadyTasks(this.db.raw, { factoryOnly: true }).filter((task) => this.portfolio.get(task.factory!.productId));
        const ranked = tasks.map((task) => ({ task, explanation: explainAllocation(task, now, true, this.config.resources.ageBonusPerHour) }))
          .sort((a, b) => compareAllocations(a.explanation, b.explanation));
        this.transition("DISPATCHING", result.trace);
        for (const { task, explanation } of ranked) {
          try {
            const resourceDecision = this.resources.decision(task, now);
            const canAttemptPreemption = task.factory!.criticalIncident && /limit|capacity|budget/i.test(resourceDecision.reason);
            if (!resourceDecision.allowed && !canAttemptPreemption) { result.decisions.push(resourceDecision); continue; }
            const policy = this.admission(task);
            if (policy.action !== "allow") {
              result.decisions.push({ ...explanation, allowed: false, reason: `${policy.reasonCode}: ${policy.humanMessage}` });
              continue;
            }
            result.decisions.push(this.resources.assign(task.id, now));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.errors.push({ productId: task.factory!.productId, message });
            this.portfolio.pause(task.factory!.productId, message);
          }
        }
        this.transition("EXECUTING", result.trace);
        // Existing workers may report outcomes through Task Graph helpers; no executor runs here.
        this.transition("EVALUATING", result.trace);
        for (const product of this.portfolio.list()) {
          const failures = this.db.raw.prepare("SELECT id FROM task_graph WHERE product_id = ? AND status = 'failed'").all(product.id) as { id: string }[];
          for (const failed of failures) {
            const key = `product-factory:observed-failure:${failed.id}`;
            if (this.db.getKV(key)) continue;
            this.db.setKV(key, "observed");
            if (getTaskById(this.db.raw, failed.id)?.factory?.failureScope !== "action" && !product.paused) this.portfolio.pause(product.id, `Terminal task failure: ${failed.id}`);
          }
        }
        this.transition("REPLANNING", result.trace);
        this.resources.snapshot(now);
        this.transition(this.resources.leases(true).length ? "EXECUTING" : "IDLE", result.trace);
        result.state = this.state;
      }).immediate();
    } catch (error) {
      result.trace = [];
      result.decisions = [];
      result.errors.push({ productId: "", message: error instanceof Error ? error.message : String(error) });
      this.transition("FAILED", result.trace);
      result.state = "FAILED";
    }
    if (!["PAUSED", "FAILED"].includes(result.state)) {
      for (const dispatch of this.localDispatchers) {
        try { dispatch(); }
        catch { result.errors.push({ productId: "", message: "Local worker dispatch adapter failed" }); }
      }
    }
    return result;
  }
  pause(): void { this.enabled(); this.transition("PAUSED", []); }
  resume(): void { this.enabled(); this.transition("IDLE", []); }
  replan(taskIds: readonly string[]): void {
    this.enabled();
    this.db.raw.transaction(() => {
      this.transition("REPLANNING", []);
      for (const id of taskIds) this.resources.requeue(id);
      this.transition("IDLE", []);
    }).immediate();
  }
}
