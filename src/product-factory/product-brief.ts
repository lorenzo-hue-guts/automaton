import { validateBrowserProbe } from './surface-browser.js';
import { assertCompanyBrief } from './company-guards.js';
import { privateRoute } from "./application-acceptance.js";
import { ulid } from "ulid";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import { BuildStore } from "./build-store.js";
import type { ProductBrief, ProductBriefContent } from "./build-types.js";

export function briefErrors(content: ProductBriefContent): string[] {
  const errors: string[] = [];
  const text = (s: unknown) => typeof s === "string" && s.trim().length > 0 && s.length <= 10_000;
  for (const key of ["problem", "valueProposition", "proposedSolution", "architecture", "hypotheticalPricing"] as const) if (!text(content[key])) errors.push(`Missing ${key}`);
  for (const key of ["targetUsers", "criticalHypotheses", "nonGoals", "risks", "metrics", "successCriteria", "failureCriteria"] as const) if (!Array.isArray(content[key]) || content[key].length < 1 || content[key].length > 100 || content[key].some((v) => !text(v))) errors.push(`Invalid ${key}`);
  if (!Number.isSafeInteger(content.estimatedCostCents) || content.estimatedCostCents < 0 || !["low", "medium", "high"].includes(content.complexity)) errors.push("Invalid estimate");
  if (!Array.isArray(content.mvpFeatures) || !content.mvpFeatures.length || content.mvpFeatures.length > 30 || content.mvpFeatures.some((f) => !text(f.id) || !text(f.title) || !text(f.acceptanceCriterion)) || new Set(content.mvpFeatures.map((f) => f.id)).size !== content.mvpFeatures.length) errors.push("Invalid MVP features");
  if (!Array.isArray(content.validationCriteria) || !content.validationCriteria.length || content.validationCriteria.length > 100 || content.validationCriteria.some((c) => !text(c.id) || !text(c.target) || !text(c.description) || !["test", "artifact", "security", "metric"].includes(c.kind)) || new Set(content.validationCriteria.map((c) => c.id)).size !== content.validationCriteria.length) errors.push("Invalid validation criteria");
  if (Array.isArray(content.successCriteria) && content.successCriteria.some((id) => !content.validationCriteria?.some((c) => c.id === id))) errors.push("Success criteria must reference verifiable criterion IDs");
  if (content.acceptanceProbes !== undefined) {
    if (!Array.isArray(content.acceptanceProbes) || !content.acceptanceProbes.length || content.acceptanceProbes.length > 50 || content.acceptanceProbes.some((p) => !text(p.id) || !text(p.entry) || p.entry.split("/").includes("..") || p.entry.startsWith("/") || !Array.isArray(p.featureIds) || p.featureIds.some((id) => !content.mvpFeatures.some((f) => f.id === id)) || !["functional", "integration", "startup", "error", "persistence", "metric"].includes(p.kind)) || new Set(content.acceptanceProbes.map((p) => p.id)).size !== content.acceptanceProbes.length) errors.push("Invalid acceptance probes");
    else for (const p of content.acceptanceProbes) {
      if (p.transport && !["cli","http","browser"].includes(p.transport)) errors.push("Invalid acceptance transport");
      if (p.transport === "http" && (!p.http || !privateRoute(p.http.path) || !["GET","POST","PUT","PATCH","DELETE"].includes(p.http.method) || !Number.isInteger(p.http.status) || p.http.status<100 || p.http.status>599 || p.http.assertions?.some(a=>!/^\w+(?:\.\w+)*$/.test(a.path) || a.minimum!==undefined&&!Number.isFinite(a.minimum)))) errors.push("Invalid private HTTP probe");
      if (p.transport === "browser") {try{validateBrowserProbe(p);}catch{errors.push("Invalid browser journey");}}
    }
    if (Array.isArray(content.acceptanceProbes)) for (const feature of content.mvpFeatures) if (!content.acceptanceProbes.some((p) => p.featureIds.includes(feature.id))) errors.push(`Unverified feature: ${feature.id}`);
  }
  return errors;
}
export class ProductBriefEngine {
  constructor(readonly store: BuildStore, private readonly factory: FactoryOrchestrator) {}
  private enabled(): void { if (!this.factory.resources.config.enabled) throw new Error("Product Factory is disabled"); }
  assertCurrent(brief: ProductBrief): void {
    const o = this.store.db.productFactory.getDiscoveryOpportunity(brief.opportunityId);
    const decision = this.store.db.productFactory.get("decisions", brief.selectionDecisionId);
    if (!o || o.discovery.creatorAddress !== this.factory.creatorAddress || o.status !== "accepted" || o.discovery.transition !== "brief_pending" || o.discovery.decisionId !== brief.selectionDecisionId || decision?.outcome !== "SELECT" || decision.opportunityId !== o.id || !o.discovery.score?.valid || JSON.stringify(o.discovery.score) !== JSON.stringify(brief.sourceScore)) throw new Error("Selected opportunity changed or lacks Evidence");
    if (JSON.stringify(brief.evidenceIds) !== JSON.stringify(decision.evidenceIds)) throw new Error("Brief Evidence differs from selection Decision");
    for (const id of brief.evidenceIds) if (this.store.db.productFactory.getAtomicEvidence(id)?.opportunityId !== o.id) throw new Error("Missing brief Evidence");
  }
  create(opportunityId: string, content: ProductBriefContent): ProductBrief {
    this.enabled();
    const o = this.store.db.productFactory.getDiscoveryOpportunity(opportunityId);
    if (!o?.discovery.score || !o.discovery.decisionId || o.discovery.creatorAddress !== this.factory.creatorAddress) throw new Error("Selected opportunity required");
    const brief: ProductBrief = { version: 1, id: ulid(), creatorAddress: this.factory.creatorAddress, opportunityId, selectionDecisionId: o.discovery.decisionId, evidenceIds: [...o.discovery.score.evidenceIds], sourceScore: structuredClone(o.discovery.score), content: structuredClone(content), productId: null, approvalId: null, createdAt: new Date().toISOString() };
    this.assertCurrent(brief);
    this.store.db.raw.transaction(() => { this.store.saveBrief(brief); this.store.audit("brief.created", { briefId: brief.id, opportunityId, decisionId: brief.selectionDecisionId }); }).immediate();
    return brief;
  }
  requestReview(id: string): ProductBrief {
    this.enabled();
    return this.store.db.raw.transaction(() => {
      const brief = this.store.brief(id);
      if (!brief) throw new Error("Unknown brief");
      this.assertCurrent(brief);
      const errors = briefErrors(brief.content);
      if (errors.length) throw new Error(`Incomplete brief: ${errors.join(", ")}`);
      if (brief.approvalId) return brief;
      // Creating a local owned draft is not construction or publication.
      const previous = this.store.db.raw.prepare("SELECT id FROM factory_products WHERE opportunity_id = ? AND creator_address = ?").get(brief.opportunityId, this.factory.creatorAddress) as { id: string } | undefined;
      const productId = previous?.id ?? this.factory.portfolio.create(this.store.db.productFactory.get("opportunities", brief.opportunityId)!.title).id;
      if (this.store.db.getKV(`product-factory:product-build:${productId}`)) throw new Error("Product already has a build; explicit revision workflow required");
      if (!this.factory.portfolio.canReceiveWork(productId)) throw new Error("Product cannot receive work");
      this.store.db.raw.prepare("UPDATE factory_products SET opportunity_id = ? WHERE id = ?").run(brief.opportunityId, productId);
      const approvalId = ulid();
      this.store.db.productFactory.insert("approvals", { id: approvalId, productId, factoryActionId: `brief:${brief.id}:build`, action: "prototype", status: "pending", requestedBy: this.factory.creatorAddress, decidedBy: null, decidedAt: null, createdAt: new Date().toISOString() });
      this.store.db.setKV(`product-factory:product-brief:${productId}`, brief.id);
      const reviewed = { ...brief, productId, approvalId };
      this.store.saveBrief(reviewed); this.store.audit("brief.review_requested", { briefId: id, productId, approvalId });
      return reviewed;
    }).immediate();
  }
  requireApproved(id: string): ProductBrief {
    this.enabled();
    const brief = this.store.brief(id);
    if (!brief) throw new Error("Unknown brief");
    this.assertCurrent(brief);
    if (briefErrors(brief.content).length) throw new Error("Incomplete brief");
    const approval = brief.approvalId ? this.store.db.productFactory.get("approvals", brief.approvalId) : undefined;
    if (!brief.productId || !approval || approval.productId !== brief.productId || approval.factoryActionId !== `brief:${brief.id}:build` || approval.status !== "approved" || approval.decidedBy !== brief.creatorAddress) throw new Error("Human creator approval required for build");
    assertCompanyBrief(this.store.db,brief);
    return brief;
  }
}
