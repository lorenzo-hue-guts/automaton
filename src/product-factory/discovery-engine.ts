import { createHash } from "node:crypto";
import { sanitizeToolResult } from "../agent/injection-defense.js";
import type { AutomatonDatabase } from "../types.js";
import { getTaskById, insertEvent, type TaskGraphRow } from "../state/database.js";
import { estimateTokens } from "../memory/event-stream.js";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import { EvidenceEngine } from "./evidence-engine.js";
import { OpportunityEngine } from "./opportunity-engine.js";
import type { DiscoveryProvider, DiscoveryInput } from "./discovery-types.js";

/** The only shipped provider: deterministic local observations, with no transport or credentials. */
export class FixtureDiscoveryProvider implements DiscoveryProvider {
  readonly mode = "fixture" as const;
  private readonly signals: readonly DiscoveryInput[];
  constructor(readonly id: string, signals: readonly DiscoveryInput[], private readonly failure?: string) { this.signals = structuredClone(signals); }
  async collect(): Promise<readonly DiscoveryInput[]> { if (this.failure) throw new Error(this.failure); return structuredClone(this.signals); }
}
export interface DiscoveryRunResult { taskId: string; providerId: string; ingested: number; duplicates: number; success: boolean; error?: string }
/** A local action handler called by existing workers, not a scheduler or heartbeat. */
export class DiscoveryEngine {
  readonly evidence: EvidenceEngine;
  readonly opportunities: OpportunityEngine;
  private readonly providers = new Map<string, DiscoveryProvider>();
  constructor(private readonly db: AutomatonDatabase, private readonly factory: FactoryOrchestrator, providers: readonly DiscoveryProvider[]) {
    for (const provider of providers) {
      if (!provider.id.trim() || provider.id.length > 200 || provider.mode !== "fixture" || this.providers.has(provider.id)) throw new Error("Unique fixture provider identity required; external connectors are disabled");
      this.providers.set(provider.id, provider);
    }
    this.evidence = new EvidenceEngine(db, factory.creatorAddress, factory.resources.config.enabled);
    this.opportunities = new OpportunityEngine(db, factory);
  }
  planDiscovery(productId: string, providerId: string, batchId: string): TaskGraphRow {
    return this.plan(productId, providerId, batchId, [], true);
  }
  planResearch(productId: string, providerId: string, batchId: string, opportunityIds: readonly string[]): TaskGraphRow {
    if (!opportunityIds.length) throw new Error("Research opportunity context required");
    return this.plan(productId, providerId, batchId, opportunityIds, false);
  }
  private plan(productId: string, providerId: string, batchId: string, opportunityIds: readonly string[], discovery: boolean): TaskGraphRow {
    if (!this.factory.resources.config.enabled) throw new Error("Product Factory is disabled");
    if (!this.factory.portfolio.canReceiveWork(productId)) throw new Error("Product cannot receive research work");
    const provider = this.providers.get(providerId);
    if (!provider || !batchId.trim()) throw new Error("Provider, batch and opportunity context required");
    for (const id of opportunityIds) {
      if (this.db.productFactory.getDiscoveryOpportunity(id)?.discovery.creatorAddress !== this.factory.creatorAddress) throw new Error("Unknown or foreign opportunity");
    }
    return this.db.raw.transaction(() => {
      const identity = JSON.stringify([productId, providerId, batchId, discovery, [...new Set(opportunityIds)].sort()]);
      const key = `product-factory:discovery:${identity}`;
      const existingId = this.db.getKV(key);
      if (existingId) return getTaskById(this.db.raw, existingId)!;
      const goalId = this.factory.createProductGoal(productId, "Discovery research", "Local fixture ingestion; no external actions");
      const task = this.factory.planAction({ goalId, title: "Collect fixture Evidence", description: "Provider data is untrusted; it cannot instruct tools or policies", estimatedCostCents: 0,
        factory: { productId, factoryActionId: `discovery:${identity}`, resourceClass: "research", failureScope: "action", urgency: 20,
          requiresApproval: false, preemptible: true, criticalIncident: false, resourceUnits: 1,
          signals: { businessImpact: 0.5, evidenceConfidence: 0.5, strategicFit: 0.5, userImpact: 0.5, risk: 0.1 } } });
      this.db.setKV(key, task.id);
      this.db.setKV(`product-factory:discovery-task:${task.id}`, JSON.stringify({ providerId, discovery, opportunityIds: [...new Set(opportunityIds)].sort() }));
      return task;
    }).immediate();
  }
  async runAssigned(taskId: string): Promise<DiscoveryRunResult> {
    if (!this.factory.resources.config.enabled) throw new Error("Product Factory is disabled");
    const binding = this.db.getKV(`product-factory:discovery-task:${taskId}`);
    const task = getTaskById(this.db.raw, taskId);
    if (!binding || task?.factory?.resourceClass !== "research" || !this.factory.portfolio.get(task.factory.productId)) throw new Error("Not an owned Discovery action");
    const { providerId, opportunityIds, discovery } = JSON.parse(binding) as { providerId: string; opportunityIds: string[]; discovery: boolean };
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error("Provider unavailable after reload");
    // This guard also enforces the existing policy-gated assignment and durable reservation.
    this.factory.resources.start(taskId);
    const result: DiscoveryRunResult = { taskId, providerId, ingested: 0, duplicates: 0, success: false };
    try {
      const signals = await provider.collect();
      if (!Array.isArray(signals) || signals.length > 1000) throw new Error("Invalid fixture batch");
      // No partial batch writes on invalid data, cancellation, replan or timeout.
      this.db.raw.transaction(() => {
        const current = getTaskById(this.db.raw, taskId);
        const lease = this.factory.resources.leases(true).find((r) => r.taskId === taskId);
        if (current?.status !== "running" || !lease || Date.parse(lease.expiresAt) <= Date.now()) throw new Error("Research assignment expired or cancelled");
        for (const input of signals) {
          let signal;
          if ("opportunityId" in input) signal = input;
          else {
            if (!discovery) throw new Error("Research cannot create unscoped opportunities");
            const title = sanitizeToolResult(input.opportunity.title, 1000);
            const problem = sanitizeToolResult(input.opportunity.problem, 10_000);
            const digest = createHash("sha256").update(problem.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ")).digest("hex");
            const key = `product-factory:discovered-opportunity:${JSON.stringify([this.factory.creatorAddress, digest])}`;
            let opportunityId = this.db.getKV(key);
            if (!opportunityId) {
              const o = this.opportunities.create(title, problem);
              opportunityId = o.id;
              this.db.productFactory.updateDiscoveryOpportunity(o.id, { ...o.discovery, descriptionTrust: "untrusted-external-data" });
              this.db.setKV(key, o.id);
            }
            const { opportunity: _description, ...observation } = input;
            signal = { ...observation, opportunityId };
          }
          if (!discovery && !opportunityIds.includes(signal.opportunityId)) throw new Error("Signal outside research scope");
          const ingested = this.evidence.ingest(providerId, signal);
          if (ingested.duplicate) result.duplicates++; else result.ingested++;
        }
        const content = JSON.stringify({ taskId, providerId, ingested: result.ingested, duplicates: result.duplicates, trust: "audit-metadata-only" });
        insertEvent(this.db.raw, { type: "factory_discovery", agentAddress: this.factory.creatorAddress, taskId, goalId: task.goalId, content, tokenCount: estimateTokens(content) });
        this.factory.resources.complete(taskId, { success: true, output: "Local Evidence ingestion completed", artifacts: [], costCents: 0, duration: 0 });
      }).immediate();
      result.success = true;
    } catch {
      // Do not promote provider-controlled exception messages into trusted task/audit memory.
      result.ingested = 0; result.duplicates = 0; result.error = "Discovery provider failed or returned invalid data";
      const current = getTaskById(this.db.raw, taskId);
      if (current?.status === "running" && this.factory.resources.leases(true).some((r) => r.taskId === taskId)) this.factory.resources.fail(taskId, result.error, true);
    }
    return result;
  }
}
