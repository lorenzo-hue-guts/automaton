import type { EvidenceGovernance, DecisionMetadata } from './company-types.js';
import type { AutomatonDatabase, HeartbeatTaskFn } from "../types.js";
import type { PolicyEngine } from "../agent/policy-engine.js";
import type { EventStream } from "../memory/event-stream.js";
import type { MemoryRetriever } from "../memory/retrieval.js";
import type * as TaskGraph from "../orchestration/task-graph.js";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface FactoryRecord {
  id: string;
  createdAt: string;
}
export type ProductStage = "draft" | "validating" | "building" | "paused" | "archived";
export interface Opportunity extends FactoryRecord {
  title: string;
  problem: string;
  status: "new" | "evaluating" | "accepted" | "rejected";
}
export interface Evidence extends FactoryRecord {
  company?: EvidenceGovernance;
  opportunityId: string;
  source: string;
  content: string;
  confidence: number;
}
/** Ownership and revenue belong to the creator, never to the Automaton treasury. */
export interface Product extends FactoryRecord {
  opportunityId: string | null;
  creatorAddress: string;
  name: string;
  stage: ProductStage;
  revenueCents: number;
}
export interface Hypothesis extends FactoryRecord {
  productId: string;
  statement: string;
  successCriterion: string;
  status: "proposed" | "testing" | "supported" | "refuted";
}
export interface Experiment extends FactoryRecord {
  productId: string;
  hypothesisId: string;
  goalId: string | null;
  taskId: string | null;
  status: "planned" | "running" | "completed" | "cancelled";
  method: string;
}
export interface ProductMetricSnapshot extends FactoryRecord {
  productId: string;
  experimentId: string | null;
  metrics: { [key: string]: number };
  capturedAt: string;
}
export interface Feedback extends FactoryRecord {
  productId: string;
  source: string;
  content: string;
}
export interface Feature extends FactoryRecord {
  productId: string;
  title: string;
  description: string;
  status: "proposed" | "planned" | "built" | "rejected";
  taskId: string | null;
}
export interface Decision extends FactoryRecord {
  company?: DecisionMetadata;
  productId: string | null;
  opportunityId?: string;
  rationale: string;
  evidenceIds: string[];
  outcome: string;
}
export interface Learning extends FactoryRecord {
  productId: string;
  experimentId: string | null;
  content: string;
  confidence: number;
}
/** Accounting intent only; this primitive does not allocate resources or spend funds. */
export interface ResourceReservation extends FactoryRecord {
  productId: string;
  taskId: string | null;
  resource: "compute" | "storage" | "inference";
  units: number;
  operationalCostCents: number;
  status: "requested" | "reserved" | "released";
  expiresAt: string;
}
export interface CapacitySnapshot extends FactoryRecord {
  availableComputeUnits: number;
  availableStorageMb: number;
  availableOperationalBudgetCents: number;
  capturedAt: string;
}
export interface Approval extends FactoryRecord {
  factoryActionId?: string;
  productId: string;
  action: "prototype" | "experiment" | "resource_reservation";
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
}
export type FactoryEventType = "product.created" | "product.stage_changed" | "approval.decided";
export interface FactoryEvent extends FactoryRecord {
  productId: string;
  type: FactoryEventType;
  actor: string;
  payload: { [key: string]: JsonValue };
}
export interface FactoryEntities {
  opportunities: Opportunity; evidence: Evidence; products: Product; hypotheses: Hypothesis;
  experiments: Experiment; metricSnapshots: ProductMetricSnapshot; feedback: Feedback; features: Feature;
  decisions: Decision; learnings: Learning; resourceReservations: ResourceReservation;
  capacitySnapshots: CapacitySnapshot; approvals: Approval; events: FactoryEvent;
}
export type FactoryEntityKind = keyof FactoryEntities;
/** Integration boundary: reuse the runtime's instances; do not instantiate a parallel runtime. */
export interface ProductFactoryInfrastructure {
  database: AutomatonDatabase;
  taskGraph: typeof TaskGraph;
  policy: PolicyEngine;
  memory: MemoryRetriever;
  eventStream: EventStream;
}
/** Future tasks register with the existing heartbeat, rather than owning a timer. */
export interface ProductFactoryHeartbeatTask {
  name: string;
  run: HeartbeatTaskFn;
}
