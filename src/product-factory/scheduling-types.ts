import type { PolicyDecision } from "../types.js";
import type { TaskGraphRow } from "../state/database.js";

export const RESOURCE_CLASSES = ["build", "research", "monitoring", "inference", "compute", "experiment"] as const;
export type ResourceClass = typeof RESOURCE_CLASSES[number];
export type PortfolioState = "research" | "building" | "launch_ready" | "validation" | "optimizing" | "scaling" | "pivoting" | "killed" | "archived";
export type FactoryState = "IDLE" | "OBSERVING" | "PLANNING" | "DISPATCHING" | "EXECUTING" | "EVALUATING" | "REPLANNING" | "PAUSED" | "FAILED";
export interface AllocationSignals {
  businessImpact: number;
  evidenceConfidence: number;
  strategicFit: number;
  userImpact: number;
  risk: number;
}
export interface FactoryTaskMetadata {
  /** Isolate research-provider failures; default remains product-wide. */
  failureScope?: "product" | "action";
  productId: string;
  factoryActionId: string;
  resourceClass: ResourceClass;
  reservationId?: string | null;
  deadline?: string | null;
  urgency: number;
  requiresApproval: boolean;
  approvalId?: string | null;
  preemptible: boolean;
  criticalIncident: boolean;
  resourceUnits: number;
  signals: AllocationSignals;
}
export interface ResourceLimits {
  globalConcurrency: number;
  perProductConcurrency: number;
  criticalReservedSlots: number;
  criticalReservedComputeUnits: number;
  buildSlots: number;
  researchSlots: number;
  monitoringSlots: number;
  inferenceSlots: number;
  inferenceBudgetCents: number;
  computeUnits: number;
  perProductBudgetCents: number;
  ageBonusPerHour: number;
}
export interface AllocationExplanation {
  taskId: string;
  score: number;
  components: Record<string, number>;
  dependenciesSatisfied: boolean;
  criticalIncident: boolean;
}
export interface AllocationDecision extends AllocationExplanation { allowed: boolean; reason: string; reservationId?: string }
export type FactoryAdmission = (task: TaskGraphRow) => Pick<PolicyDecision, "action" | "reasonCode" | "humanMessage">;
