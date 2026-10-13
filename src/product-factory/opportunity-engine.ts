import { monotonicFactory } from "ulid";
import type { AutomatonDatabase } from "../types.js";
import { insertEvent } from "../state/database.js";
import { estimateTokens } from "../memory/event-stream.js";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import { scoreOpportunity, validateAssessment } from "./opportunity-scoring.js";
import type { DiscoveryOpportunity, OpportunityAssessment, OpportunityScore, SelectionAction, SelectionResult } from "./discovery-types.js";

const nextId = monotonicFactory();
const tokens = (text: string) => new Set(text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter(Boolean));
export function opportunitySimilarity(a: string, b: string): number {
  const left = tokens(a), right = tokens(b);
  const common = [...left].filter((t) => right.has(t)).length;
  return left.size + right.size - common ? common / (left.size + right.size - common) : 0;
}
export interface SelectionCapacity { slots: number; budgetCents: number; portfolioProblems: readonly string[] }
/** Selection plans a brief only: no product, task, public launch, or financial transaction. */
export function rankOpportunities(opportunities: readonly DiscoveryOpportunity[], capacity: SelectionCapacity): SelectionResult[] {
  if (!Number.isSafeInteger(capacity.slots) || capacity.slots < 0 || !Number.isSafeInteger(capacity.budgetCents) || capacity.budgetCents < 0) throw new Error("Invalid selection capacity");
  const ranked = opportunities.map((opportunity) => {
    const s = opportunity.discovery.score, a = opportunity.discovery.assessment;
    const priority = s?.valid && a ? s.total + 20 * s.confidence + 10 * s.evidenceQuality + 2 * Math.min(5, s.evidenceDiversity) - Math.log2(1 + a.estimatedCostCents) - 20 * a.risk : -1;
    return { opportunity, priority };
  }).sort((a, b) => b.priority - a.priority || (a.opportunity.id < b.opportunity.id ? -1 : a.opportunity.id === b.opportunity.id ? 0 : 1));
  let slots = capacity.slots, budget = capacity.budgetCents;
  const problems = [...capacity.portfolioProblems];
  return ranked.map(({ opportunity: o, priority }, index) => {
    const score = o.discovery.score, assessment = o.discovery.assessment;
    let action: SelectionAction = "RESEARCH_MORE", reason = "Evidence or assessment missing";
    if (score?.valid && assessment) {
      if (score.total < 55) { action = "REJECT"; reason = "Score below 55"; }
      else if (score.total < 70 || score.confidence < 0.35) reason = "Insufficient score or confidence";
      else if (problems.some((problem) => opportunitySimilarity(problem, o.problem) >= 0.75)) { action = "ARCHIVE"; reason = "Near duplicate of portfolio or selected opportunity"; }
      else if (slots < 1 || assessment.estimatedCostCents > budget) reason = "Insufficient available capacity or operational budget";
      else { action = "SELECT"; reason = "Evidence-backed candidate for a future Product Brief"; slots--; budget -= assessment.estimatedCostCents; problems.push(o.problem); }
    }
    return { opportunityId: o.id, action, rank: index + 1, priority, reason };
  });
}

export class OpportunityEngine {
  constructor(private readonly db: AutomatonDatabase, private readonly factory: FactoryOrchestrator) {}
  private enabled(): void { if (!this.factory.resources.config.enabled) throw new Error("Product Factory is disabled"); }
  private owned(id: string): DiscoveryOpportunity {
    const o = this.db.productFactory.getDiscoveryOpportunity(id);
    if (!o || o.discovery.creatorAddress !== this.factory.creatorAddress) throw new Error("Unknown or foreign opportunity");
    return o;
  }
  create(title: string, problem: string): DiscoveryOpportunity {
    this.enabled();
    if (!title.trim() || !problem.trim() || title.length > 1000 || problem.length > 10_000) throw new Error("Opportunity description required");
    const opportunity: DiscoveryOpportunity = { id: nextId(), createdAt: new Date().toISOString(), title, problem, status: "new", discovery: { creatorAddress: this.factory.creatorAddress } };
    this.db.productFactory.insertDiscoveryOpportunity(opportunity);
    return opportunity;
  }
  assess(id: string, assessment: OpportunityAssessment): OpportunityScore {
    this.enabled(); validateAssessment(assessment);
    return this.db.raw.transaction(() => {
      const o = this.owned(id);
      const score = scoreOpportunity(assessment, this.db.productFactory.listAtomicEvidence(id));
      const metadata = { ...o.discovery, assessment, score };
      delete metadata.transition;
      this.db.productFactory.updateDiscoveryOpportunity(id, metadata, o.status === "rejected" ? "rejected" : "evaluating");
      return score;
    }).immediate();
  }
  private plan(): SelectionResult[] {
    const config = this.factory.resources.config;
    // Rescore from current durable Evidence, never trust a cached result after ingestion/restart.
    const all = this.db.productFactory.listDiscoveryOpportunities(this.factory.creatorAddress);
    const candidates = all.filter((o) => o.status !== "accepted" && o.status !== "rejected").map((o) => ({ ...o, discovery: { ...o.discovery, ...(o.discovery.assessment ? { score: scoreOpportunity(o.discovery.assessment, this.db.productFactory.listAtomicEvidence(o.id)) } : {}) } }));
    const products = this.factory.portfolio.list().filter((p) => !["killed", "archived"].includes(p.portfolioState));
    const selected = all.filter((o) => o.status === "accepted" && o.discovery.transition === "brief_pending");
    const snapshot = this.factory.resources.getSnapshot(this.factory.resources.snapshot())!;
    const problems = products.map((p) => p.opportunityId ? this.db.productFactory.get("opportunities", p.opportunityId)?.problem ?? p.name : p.name);
    const globalProducts = this.db.raw.prepare("SELECT COUNT(*) AS count FROM factory_products WHERE portfolio_state NOT IN ('killed','archived') AND stage != 'archived'").get() as { count: number };
    const slots = Math.max(0, Math.min(config.maxActiveProducts - globalProducts.count - selected.length,
      snapshot.resourceCapacity.build - selected.length, snapshot.resourceCapacity.global - config.resources.criticalReservedSlots,
      Math.floor(snapshot.availableComputeUnits - config.resources.criticalReservedComputeUnits)));
    const committed = selected.reduce((sum, o) => sum + (o.discovery.assessment?.estimatedCostCents ?? 0), 0);
    return rankOpportunities(candidates, { slots, budgetCents: Math.max(0, snapshot.availableOperationalBudgetCents - committed), portfolioProblems: [...problems, ...selected.map((o) => o.problem)] });
  }
  preview(): SelectionResult[] { this.enabled(); return this.db.raw.transaction(() => this.plan()).immediate(); }
  select(): SelectionResult[] {
    this.enabled();
    return this.db.raw.transaction(() => this.plan().map((result) => this.persist(result))).immediate();
  }
  decide(id: string, action: SelectionAction, rationale: string): SelectionResult {
    this.enabled();
    if (!["SELECT", "RESEARCH_MORE", "REJECT", "ARCHIVE"].includes(action) || !rationale.trim()) throw new Error("Explicit decision required");
    return this.db.raw.transaction(() => {
      const opportunity = this.owned(id);
      if (action === "SELECT" && opportunity.status === "accepted" && opportunity.discovery.transition === "brief_pending") return { opportunityId: id, action, rank: 0, priority: opportunity.discovery.score?.total ?? 0, reason: "Already selected", decisionId: opportunity.discovery.decisionId };
      const planned = this.plan().find((r) => r.opportunityId === id);
      if (action === "SELECT" && planned?.action !== "SELECT") throw new Error("Opportunity is not selectable");
      return this.persist({ opportunityId: id, action, rank: planned?.rank ?? 0, priority: planned?.priority ?? -1, reason: rationale });
    }).immediate();
  }
  private persist(result: SelectionResult): SelectionResult {
    const o = this.owned(result.opportunityId);
    const score = o.discovery.assessment ? scoreOpportunity(o.discovery.assessment, this.db.productFactory.listAtomicEvidence(o.id)) : undefined;
    const metadata = { ...o.discovery, ...(score ? { score } : {}) };
    const decisionId = nextId();
    const evidenceIds = score?.evidenceIds ?? [];
    this.db.productFactory.insert("decisions", { id: decisionId, createdAt: new Date().toISOString(), productId: null, opportunityId: o.id, outcome: result.action, evidenceIds, rationale: JSON.stringify({ reason: result.reason, rank: result.rank, priority: result.priority, score: score ?? null, next: result.action === "SELECT" ? "brief_pending" : null }) });
    delete metadata.transition;
    if (result.action === "SELECT") metadata.transition = "brief_pending";
    metadata.decisionId = decisionId;
    this.db.productFactory.updateDiscoveryOpportunity(o.id, metadata, result.action === "SELECT" ? "accepted" : result.action === "RESEARCH_MORE" ? "evaluating" : "rejected");
    const content = JSON.stringify({ decisionId, opportunityId: o.id, action: result.action, evidenceIds, trust: "audit-metadata-only", next: metadata.transition ?? null });
    insertEvent(this.db.raw, { type: "factory_discovery", agentAddress: this.factory.creatorAddress, content, tokenCount: estimateTokens(content) });
    return { ...result, decisionId };
  }
}
