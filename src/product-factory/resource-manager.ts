import { companyResourceBlock } from './company-guards.js';
import { ulid } from "ulid";
import type { AutomatonDatabase } from "../types.js";
import { getReadyTasks, getTaskById, updateTaskStatus, type TaskGraphRow } from "../state/database.js";
import { getFactoryConcurrency } from "../state/factory-tasks.js";
import { assignTask, cancelTask, completeTask, failTask, type TaskResult } from "../orchestration/task-graph.js";
import { resolveProductFactoryConfig, type ProductFactoryConfig } from "./config.js";
import { PortfolioManager } from "./portfolio-manager.js";
import { explainAllocation } from "./allocation.js";
import type { AllocationDecision, ResourceClass } from "./scheduling-types.js";
import type { CapacitySnapshot } from "./types.js";

export interface ResourceLease { id: string; taskId: string; productId: string; resourceClass: ResourceClass; units: number; operationalCostCents: number; status: "reserved" | "released"; expiresAt: string; releasedReason: string | null }
class CapacityBlocked extends Error {}

export class ResourceManager {
  readonly config: Readonly<ProductFactoryConfig>;
  private readonly portfolio: PortfolioManager;
  constructor(private readonly db: AutomatonDatabase, config: ProductFactoryConfig | undefined, readonly creatorAddress: string) {
    const resolved = resolveProductFactoryConfig(config);
    this.config = Object.freeze({ ...resolved, resources: Object.freeze({ ...resolved.resources }) });
    this.portfolio = new PortfolioManager(db, this.config, creatorAddress);
  }
  private enabled(): void { if (!this.config.enabled) throw new Error("Product Factory is disabled"); }
  private task(id: string): TaskGraphRow {
    const task = getTaskById(this.db.raw, id);
    if (!task?.factory || !this.portfolio.get(task.factory.productId)) throw new Error("Unknown/foreign Factory task");
    return task;
  }
  leases(activeOnly = false): ResourceLease[] {
    const rows = this.db.raw.prepare(`SELECT r.* FROM factory_resource_reservations r JOIN factory_products p ON p.id = r.product_id
      WHERE r.managed = 1 AND p.creator_address = ? ${activeOnly ? "AND r.status = 'reserved'" : ""} ORDER BY r.created_at, r.id`).all(this.creatorAddress) as Record<string, unknown>[];
    return rows.map((r) => ({ id: r.id as string, taskId: r.task_id as string, productId: r.product_id as string,
      resourceClass: r.resource_class as ResourceClass, units: r.units as number, operationalCostCents: r.operational_cost_cents as number,
      status: r.status as ResourceLease["status"], expiresAt: r.expires_at as string, releasedReason: r.released_reason as string | null }));
  }
  private approvalAllowed(task: TaskGraphRow): boolean {
    const f = task.factory!;
    if (!f.requiresApproval) return true;
    if (!f.approvalId) return false;
    return !!this.db.raw.prepare(`SELECT a.id FROM factory_approvals a JOIN factory_products p ON p.id = a.product_id
      WHERE a.id = ? AND a.product_id = ? AND a.factory_action_id = ? AND a.status = 'approved' AND a.decided_by = p.creator_address`)
      .get(f.approvalId, f.productId, f.factoryActionId);
  }
  decision(task: TaskGraphRow, now: Date): AllocationDecision {
    const f = task.factory;
    if (!f) throw new Error("Not a Factory task");
    const ready = getReadyTasks(this.db.raw, { factoryOnly: true }).some((candidate) => candidate.id === task.id);
    const explanation = explainAllocation(task, now, ready, this.config.resources.ageBonusPerHour);
    const reject = (reason: string): AllocationDecision => ({ ...explanation, allowed: false, reason });
    if (!this.config.enabled) return reject("Factory disabled");
    if (!this.portfolio.canReceiveWork(f.productId)) return reject("Product inactive, paused or failed");
    const companyBlock=companyResourceBlock(this.db,this.creatorAddress,task);
    if(companyBlock)return reject(companyBlock);
    if (!this.approvalAllowed(task)) return reject("Action approval pending or rejected");
    const goal = this.db.raw.prepare("SELECT status FROM goals WHERE id = ?").get(task.goalId) as { status: string } | undefined;
    if (goal?.status !== "active") return reject("Goal inactive");
    if (!ready) return reject("Task not pending or dependencies incomplete");
    if (!Number.isSafeInteger(task.estimatedCostCents) || task.estimatedCostCents < 0 || !Number.isSafeInteger(task.timeoutMs) || task.timeoutMs < 1) return reject("Invalid cost/timeout");
    const limits = this.config.resources;
    const active = this.db.raw.prepare(`SELECT t.*, r.operational_cost_cents AS reserved_cost, r.units AS reserved_units FROM task_graph t
      JOIN factory_resource_reservations r ON r.task_id = t.id AND r.managed = 1 AND r.status = 'reserved'
      WHERE t.status IN ('assigned','running')`).all() as { product_id: string; resource_class: ResourceClass; critical_incident: number; reserved_cost: number; reserved_units: number }[];
    // Counts include all creators; no product can oversubscribe a shared connection.
    if (getFactoryConcurrency(this.db.raw) >= limits.globalConcurrency) return reject("Global concurrency limit");
    if (!f.criticalIncident && active.filter((r) => !r.critical_incident).length >= limits.globalConcurrency - limits.criticalReservedSlots) return reject("Capacity reserved for critical incidents");
    if (getFactoryConcurrency(this.db.raw, { productId: f.productId }) >= limits.perProductConcurrency) return reject("Product concurrency limit");
    const classLimit: Record<ResourceClass, number> = { build: limits.buildSlots, research: limits.researchSlots, monitoring: limits.monitoringSlots,
      inference: limits.inferenceSlots, compute: limits.globalConcurrency, experiment: this.config.maxConcurrentExperiments };
    if (getFactoryConcurrency(this.db.raw, { resourceClass: f.resourceClass }) >= classLimit[f.resourceClass]) return reject(`Resource class limit: ${f.resourceClass}`);
    if (active.reduce((sum, r) => sum + r.reserved_units, 0) + f.resourceUnits > limits.computeUnits) return reject("Compute capacity limit");
    if (!f.criticalIncident && active.filter((r) => !r.critical_incident).reduce((sum, r) => sum + r.reserved_units, 0) + f.resourceUnits > limits.computeUnits - limits.criticalReservedComputeUnits) return reject("Compute capacity reserved for critical incidents");
    const spent = this.db.raw.prepare("SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id IS NOT NULL").get() as { cents: number };
    const productSpent = this.db.raw.prepare("SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id = ?").get(f.productId) as { cents: number };
    if (spent.cents + active.reduce((sum, r) => sum + r.reserved_cost, 0) + task.estimatedCostCents > this.config.operationalBudgetCents) return reject("Operational budget exhausted");
    if (productSpent.cents + active.filter((r) => r.product_id === f.productId).reduce((sum, r) => sum + r.reserved_cost, 0) + task.estimatedCostCents > limits.perProductBudgetCents) return reject("Product operational budget exhausted");
    if (f.resourceClass === "inference") {
      const inferenceSpent = this.db.raw.prepare("SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id IS NOT NULL AND (resource_class = 'inference' OR agent_role = 'factory-model-build')").get() as { cents: number };
      if (inferenceSpent.cents + active.filter((r) => r.resource_class === "inference").reduce((sum, r) => sum + r.reserved_cost, 0) + task.estimatedCostCents > limits.inferenceBudgetCents) return reject("Inference budget exhausted");
    }
    return { ...explanation, allowed: true, reason: "Dependencies, approval and all resource/budget limits satisfied" };
  }
  /** Reservation and Task Graph assignment commit together under an immediate SQLite transaction. */
  assign(taskId: string, now = new Date()): AllocationDecision {
    this.enabled();
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid allocation time");
    return this.db.raw.transaction(() => {
      const task = this.task(taskId);
      const existing = this.leases(true).find((r) => r.taskId === taskId);
      if (existing && ["assigned", "running"].includes(task.status) && Date.parse(existing.expiresAt) > now.getTime()) {
        return { ...explainAllocation(task, now, true, this.config.resources.ageBonusPerHour), allowed: true, reason: "Existing idempotent reservation", reservationId: existing.id };
      }
      let decision = this.decision(task, now);
      if (!decision.allowed && task.factory!.criticalIncident) {
        // Only queued assignments can be safely preempted without stopping an executing worker.
        try {
          this.db.raw.transaction(() => {
            const candidates = this.db.raw.prepare(`SELECT t.id FROM task_graph t JOIN factory_products p ON p.id = t.product_id
              WHERE p.creator_address = ? AND t.status = 'assigned' AND t.preemptible = 1 AND t.critical_incident = 0`)
              .all(this.creatorAddress) as { id: string }[];
            candidates.sort((a, b) => explainAllocation(this.task(a.id), now, true, this.config.resources.ageBonusPerHour).score - explainAllocation(this.task(b.id), now, true, this.config.resources.ageBonusPerHour).score || (a.id < b.id ? -1 : 1));
            for (const victim of candidates) {
              this.requeue(victim.id, "critical-preemption");
              decision = this.decision(task, now);
              if (decision.allowed) return;
            }
            throw new CapacityBlocked(decision.reason);
          })();
        } catch (error) {
          if (!(error instanceof CapacityBlocked)) throw error;
          decision = this.decision(task, now);
        }
      }
      if (!decision.allowed) return decision;
      const id = `factory-reservation:${task.id}`;
      const f = task.factory!;
      const expiresAt = new Date(now.getTime() + task.timeoutMs).toISOString();
      this.db.raw.prepare(`INSERT INTO factory_resource_reservations
        (id, created_at, product_id, task_id, resource, units, operational_cost_cents, status, expires_at, resource_class, managed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, 1)
        ON CONFLICT(id) DO UPDATE SET units = excluded.units, operational_cost_cents = excluded.operational_cost_cents,
          status = 'reserved', expires_at = excluded.expires_at, released_reason = NULL`)
        .run(id, now.toISOString(), f.productId, task.id, f.resourceClass === "inference" ? "inference" : "compute", f.resourceUnits, task.estimatedCostCents, expiresAt, f.resourceClass);
      this.db.raw.prepare("UPDATE task_graph SET reservation_id = ? WHERE id = ?").run(id, task.id);
      assignTask(this.db.raw, task.id, `local://factory/${this.creatorAddress}`, id);
      return { ...decision, reservationId: id };
    }).immediate();
  }
  start(taskId: string): void {
    this.enabled();
    this.db.raw.transaction(() => {
      const task = this.task(taskId);
      if (task.status !== "assigned" || !this.leases(true).some((r) => r.taskId === taskId && Date.parse(r.expiresAt) > Date.now())) throw new Error("Task needs a live assignment");
      updateTaskStatus(this.db.raw, taskId, "running");
    }).immediate();
  }
  complete(taskId: string, result: TaskResult): void {
    this.enabled();
    this.db.raw.transaction(() => {
      const task = this.task(taskId);
      this.validateOutcome(task, result.costCents);
      completeTask(this.db.raw, taskId, { ...result, costCents: task.actualCostCents + result.costCents });
    }).immediate();
  }
  fail(taskId: string, error: string, shouldRetry: boolean, attemptCostCents = 0): void {
    this.enabled();
    this.db.raw.transaction(() => {
      const task = this.task(taskId);
      this.validateOutcome(task, attemptCostCents);
      this.db.raw.prepare("UPDATE task_graph SET actual_cost_cents = actual_cost_cents + ? WHERE id = ?").run(attemptCostCents, taskId);
      failTask(this.db.raw, taskId, error, shouldRetry);
    }).immediate();
  }
  private validateOutcome(task: TaskGraphRow, cost: number): void {
    if (!["assigned", "running"].includes(task.status) || !this.leases(true).some((r) => r.taskId === task.id)) throw new Error("Outcome requires an active reservation");
    if (!Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(task.actualCostCents + cost)) throw new Error("Invalid attempt cost");
  }
  cancel(taskId: string): void { this.enabled(); this.task(taskId); cancelTask(this.db.raw, taskId); }
  requeue(taskId: string, reason = "replan"): void {
    this.enabled();
    this.db.raw.transaction(() => {
      const task = this.task(taskId);
      if (["completed", "failed", "cancelled"].includes(task.status)) return;
      this.db.raw.prepare("UPDATE task_graph SET status = 'pending', assigned_to = NULL, started_at = NULL WHERE id = ?").run(taskId);
      this.db.raw.prepare("UPDATE factory_resource_reservations SET released_reason = ? WHERE task_id = ? AND managed = 1 AND status = 'released'").run(reason, taskId);
    })();
  }
  reconcile(now = new Date()): void {
    this.enabled();
    this.db.raw.transaction(() => {
      for (const lease of this.leases(true)) {
        const task = this.task(lease.taskId);
        if (!["assigned", "running"].includes(task.status)) {
          this.db.raw.prepare("UPDATE factory_resource_reservations SET status = 'released', released_reason = 'reconciled' WHERE id = ?").run(lease.id);
        } else if (!this.portfolio.canReceiveWork(lease.productId)) {
          cancelTask(this.db.raw, task.id);
        } else if (Date.parse(lease.expiresAt) <= now.getTime()) {
          failTask(this.db.raw, task.id, "Factory reservation timeout", true);
          this.db.raw.prepare("UPDATE factory_resource_reservations SET released_reason = 'timeout' WHERE id = ?").run(lease.id);
        }
      }
    }).immediate();
  }
  snapshot(now = new Date()): string {
    this.enabled();
    return this.db.raw.transaction(() => {
      const active = this.db.raw.prepare("SELECT units, operational_cost_cents, resource_class FROM factory_resource_reservations WHERE managed = 1 AND status = 'reserved'").all() as { units: number; operational_cost_cents: number; resource_class: ResourceClass }[];
      const id = ulid();
      const spent = this.db.raw.prepare("SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id IS NOT NULL").get() as { cents: number };
      this.db.productFactory.insert("capacitySnapshots", { id, createdAt: now.toISOString(), capturedAt: now.toISOString(), availableStorageMb: 0,
        availableComputeUnits: Math.max(0, this.config.resources.computeUnits - active.reduce((sum, r) => sum + r.units, 0)),
        availableOperationalBudgetCents: Math.max(0, this.config.operationalBudgetCents - spent.cents - active.reduce((sum, r) => sum + r.operational_cost_cents, 0)) });
      const inferenceSpent = this.db.raw.prepare("SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id IS NOT NULL AND (resource_class = 'inference' OR agent_role = 'factory-model-build')").get() as { cents: number };
      const available = { global: this.config.resources.globalConcurrency - getFactoryConcurrency(this.db.raw),
        build: this.config.resources.buildSlots - getFactoryConcurrency(this.db.raw, { resourceClass: "build" }),
        research: this.config.resources.researchSlots - getFactoryConcurrency(this.db.raw, { resourceClass: "research" }),
        monitoring: this.config.resources.monitoringSlots - getFactoryConcurrency(this.db.raw, { resourceClass: "monitoring" }),
        inference: this.config.resources.inferenceSlots - getFactoryConcurrency(this.db.raw, { resourceClass: "inference" }),
        experiment: this.config.maxConcurrentExperiments - getFactoryConcurrency(this.db.raw, { resourceClass: "experiment" }),
        inferenceBudgetCents: this.config.resources.inferenceBudgetCents - inferenceSpent.cents - active.filter((r) => r.resource_class === "inference").reduce((sum, r) => sum + r.operational_cost_cents, 0) };
      const bounded = Object.fromEntries(Object.entries(available).map(([key, value]) => [key, Math.max(0, value)]));
      this.db.raw.prepare("UPDATE factory_capacity_snapshots SET resource_capacity = ? WHERE id = ?").run(JSON.stringify(bounded), id);
      return id;
    })();
  }
  getSnapshot(id: string): (CapacitySnapshot & { resourceCapacity: Record<string, number> }) | undefined {
    const snapshot = this.db.productFactory.get("capacitySnapshots", id);
    if (!snapshot) return undefined;
    const row = this.db.raw.prepare("SELECT resource_capacity FROM factory_capacity_snapshots WHERE id = ?").get(id) as { resource_capacity: string };
    return { ...snapshot, resourceCapacity: JSON.parse(row.resource_capacity) as Record<string, number> };
  }
}
