import type { Database } from "better-sqlite3";
import { RESOURCE_CLASSES, type FactoryTaskMetadata, type ResourceClass } from "../product-factory/scheduling-types.js";

export function validateFactoryTaskMetadata(factory: FactoryTaskMetadata): void {
  if (factory.failureScope !== undefined && !["product", "action"].includes(factory.failureScope)) throw new Error("Invalid failure scope");
  if (!factory.productId?.trim() || !factory.factoryActionId?.trim() || !RESOURCE_CLASSES.includes(factory.resourceClass)) throw new Error("Invalid factory task identity/class");
  if (!Number.isSafeInteger(factory.urgency) || factory.urgency < 0 || factory.urgency > 100) throw new Error("Invalid task urgency");
  if (!Number.isFinite(factory.resourceUnits) || factory.resourceUnits <= 0) throw new Error("Invalid resource units");
  if (factory.deadline && !Number.isFinite(Date.parse(factory.deadline))) throw new Error("Invalid deadline");
  for (const key of ["requiresApproval", "preemptible", "criticalIncident"] as const) if (typeof factory[key] !== "boolean") throw new Error(`Invalid ${key}`);
  for (const key of ["businessImpact", "evidenceConfidence", "strategicFit", "userImpact", "risk"] as const) {
    const value = factory.signals?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid allocation signal: ${key}`);
  }
}

export function attachFactoryTaskMetadata(db: Database, taskId: string, factory: FactoryTaskMetadata): void {
  validateFactoryTaskMetadata(factory);
  if (factory.reservationId) throw new Error("Reservations are assigned by ResourceManager");
  const row = db.prepare("SELECT status, product_id, estimated_cost_cents, actual_cost_cents, max_retries, retry_count, timeout_ms FROM task_graph WHERE id = ?").get(taskId) as {
    status: string; product_id: string | null; estimated_cost_cents: number; actual_cost_cents: number;
    max_retries: number; retry_count: number; timeout_ms: number;
  } | undefined;
  if (!row || row.status !== "pending" || row.product_id) throw new Error("Factory metadata requires a new pending task");
  for (const key of ["estimated_cost_cents", "actual_cost_cents", "max_retries", "retry_count", "timeout_ms"] as const) {
    if (!Number.isSafeInteger(row[key]) || row[key] < (key === "timeout_ms" ? 1 : 0)) throw new Error(`Invalid Factory task ${key}`);
  }
  const goal = db.prepare("SELECT goal_id FROM task_graph WHERE id = ?").get(taskId) as { goal_id: string };
  const mixed = db.prepare("SELECT id FROM task_graph WHERE goal_id = ? AND id != ? AND (product_id IS NULL OR product_id != ?) LIMIT 1").get(goal.goal_id, taskId, factory.productId);
  if (mixed) throw new Error("A Factory goal cannot mix products or runtime tasks");
  db.prepare(`UPDATE task_graph SET product_id = ?, factory_action_id = ?, resource_class = ?, deadline = ?, urgency = ?,
    requires_approval = ?, preemptible = ?, critical_incident = ?, resource_units = ?, factory_details = ? WHERE id = ?`).run(
    factory.productId, factory.factoryActionId, factory.resourceClass, factory.deadline ?? null, factory.urgency,
    Number(factory.requiresApproval), Number(factory.preemptible), Number(factory.criticalIncident), factory.resourceUnits,
    JSON.stringify({ signals: factory.signals, approvalId: factory.approvalId ?? null, failureScope: factory.failureScope ?? "product" }), taskId,
  );
}

export function getFactoryConcurrency(db: Database, scope: { productId?: string; resourceClass?: ResourceClass } = {}): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM task_graph WHERE product_id IS NOT NULL AND status IN ('assigned','running')
    AND (? IS NULL OR product_id = ?) AND (? IS NULL OR resource_class = ?)`)
    .get(scope.productId ?? null, scope.productId ?? null, scope.resourceClass ?? null, scope.resourceClass ?? null) as { count: number };
  return row.count;
}
