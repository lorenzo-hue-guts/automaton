import { assertCompanyQuality } from './company-guards.js';
import path from "node:path";
import type { AutomatonDatabase } from "../types.js";
import { ProductBriefEngine } from "./product-brief.js";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import { getTaskById } from "../state/database.js";
import { BuildStore, buildHash } from "./build-store.js";
import { inspectArtifact } from "./local-artifacts.js";
import type { BuildValidation, BuildRecord, BuildReceipt } from "./build-types.js";
export function receiptHash(receipt: Omit<BuildReceipt, "hash">): string { return buildHash(JSON.stringify(receipt)); }
export class BuildValidator {
  constructor(private readonly store: BuildStore, private readonly factory: FactoryOrchestrator, private readonly allowedRoot: string) {}
  validate(id: string, requireValidationTask = false): BuildValidation {
    const build = this.store.build(id), errors: string[] = [];
    if (!build) throw new Error("Unknown build");
    if (build.artifactRoot !== path.join(path.resolve(this.allowedRoot), build.id)) throw new Error("Unexpected build root");
    const brief = this.store.brief(build.briefId);
    if (!brief) throw new Error("Build brief missing");
    try { new ProductBriefEngine(this.store, this.factory).requireApproved(build.briefId); }
    catch { errors.push("Brief approval or source decision no longer valid"); }
    const checks = new Map<string, boolean>(), artifacts = new Map<string, string>();
    for (const entry of build.tasks.filter((t) => !["private_deployment", "rollback"].includes(t.step) && (requireValidationTask || t.step !== "validation"))) {
      const task = getTaskById(this.store.db.raw, entry.taskId), receipt = build.receipts[entry.taskId];
      const result = task?.result as { success?: boolean; factoryReceipt?: { hash: string; buildId: string } } | null;
      if (task?.status !== "completed" || !result?.success || !receipt || result.factoryReceipt?.hash !== receipt.hash || result.factoryReceipt.buildId !== id) { errors.push(`Missing successful structured result: ${entry.step}:${entry.taskId}`); continue; }
      const { hash, ...body } = receipt;
      if (hash !== receiptHash(body) || receipt.taskId !== task.id || receipt.attempt !== task.retryCount || receipt.step !== entry.step) errors.push(`Invalid receipt: ${task.id}`);
      for (const check of receipt.checks) { checks.set(check.id, (checks.get(check.id) ?? true) && check.passed); if (!check.passed) errors.push(`Failed check: ${check.id}`); }
      for (const artifact of receipt.artifacts) {
        try {
          const current = inspectArtifact(build.artifactRoot, artifact.path);
          if (current.sha256 !== artifact.sha256 || current.size !== artifact.size) errors.push(`Artifact modified: ${artifact.path}`);
          artifacts.set(artifact.path, current.sha256); checks.set(`artifact:${artifact.path}`, current.sha256 === artifact.sha256);
        } catch { errors.push(`Artifact missing/unsafe: ${artifact.path}`); }
      }
    }
    for (const criterion of brief.content.validationCriteria) if (checks.get(criterion.target) !== true) errors.push(`Unverified brief criterion: ${criterion.id}`);
    if (!build.model) for (let i = 0; i < brief.content.mvpFeatures.length; i++) if (checks.get(`feature:${i}`) !== true) errors.push(`Required tests failed/missing: feature ${i}`);
    for (const required of build.model ? ["model:typecheck", "model:build", "model:run", "model:integration", "model:reproducible", "security:no-secrets"] : ["artifact:bundle.cjs", "security:no-network", "metric:request_count"]) if (checks.get(required) !== true) errors.push(`Required verification missing: ${required}`);
    if (build.model) for (const probe of brief.content.acceptanceProbes ?? []) {
      const evidence=build.model.attempts.at(-1)?.acceptance?.find(e=>e.probeId===probe.id);
      if (!evidence?.passed || evidence.execution!=="real" || evidence.briefId!==brief.id || evidence.contractHash!==buildHash(JSON.stringify(probe))) errors.push(`Missing real approved acceptance evidence: ${probe.id}`);
    }
    if (build.model && build.model.status !== "PASS") errors.push("Model verification loop has not passed");
    if (build.tasks.some((t) => ["failed", "cancelled"].includes(getTaskById(this.store.db.raw, t.taskId)?.status ?? ""))) errors.push("Known blocking task failure/cancellation");
    return { passed: errors.length === 0, errors, checkedAt: new Date().toISOString(), artifactDigest: buildHash(JSON.stringify([...artifacts.entries()].sort(([a], [b]) => a.localeCompare(b)))) };
  }
  promote(id: string): void {
    if (!this.factory.resources.config.enabled) throw new Error("Product Factory is disabled");
    this.store.db.raw.transaction(() => {
    const build = this.store.build(id)!;
    assertCompanyQuality(this.store.db,this.store.brief(build.briefId)!);
    const validation = this.validate(id, true), deployment = build.deploymentId ? this.store.deployment(build.deploymentId) : undefined;
    const task = build.tasks.find((t) => t.step === "private_deployment");
    if (!validation.passed || !deployment || deployment.status !== "active" || deployment.visibility !== "private" || deployment.publicUrl !== null || deployment.externallyAccessible !== false || deployment.buildDigest !== validation.artifactDigest || !task || getTaskById(this.store.db.raw, task.taskId)?.status !== "completed") throw new Error("Verified private deployment required before launch_ready");
    this.store.db.setKV(`product-factory:launch-readiness:${build.productId}`, JSON.stringify({ buildId: id, deploymentId: deployment.id, artifactDigest: validation.artifactDigest }));
    this.factory.portfolio.setState(build.productId, "launch_ready", "Structured tests, artifacts, security, instrumentation and private deployment verified");
    this.store.audit("build.launch_ready_private_only", { buildId: id, productId: build.productId, deploymentId: deployment.id });
    }).immediate();
  }
}
/** There is deliberately no public executor. Human approval alone cannot enable this batch. */
export class PublicLaunchGate {
  constructor(private readonly store: BuildStore, private readonly factory: FactoryOrchestrator) {}
  check(productId: string, approvalId?: string): { humanApproved: boolean; allowed: false; reason: string } {
    const buildId = this.store.db.getKV(`product-factory:product-build:${productId}`);
    const approval = approvalId ? this.store.db.productFactory.get("approvals", approvalId) : undefined;
    const humanApproved = !!this.factory.portfolio.get(productId) && !!buildId && approval?.status === "approved" && approval.decidedBy === this.factory.creatorAddress && approval.productId === productId && approval.factoryActionId === `public-launch:${buildId}`;
    return { humanApproved, allowed: false, reason: humanApproved ? "Public launch remains disabled; no public provider exists" : "Explicit human public-launch approval required; public launch disabled" };
  }
}

/** Guard existing portfolio transitions for managed briefs; legacy products remain compatible. */
export function assertManagedLaunchReadiness(db: AutomatonDatabase, productId: string): void {
  if (!db.getKV(`product-factory:product-brief:${productId}`)) return;
  try {
    const proof = JSON.parse(db.getKV(`product-factory:launch-readiness:${productId}`) ?? "null") as { buildId: string; deploymentId: string; artifactDigest: string } | null;
    if (!proof || db.getKV(`product-factory:product-build:${productId}`) !== proof.buildId) throw new Error();
    const product = db.productFactory.get("products", productId)!;
    const store = new BuildStore(db, product.creatorAddress);
    const build = store.build(proof.buildId), deployment = store.deployment(proof.deploymentId);
    if (!build || build.productId !== productId || db.getKV(`product-factory:product-brief:${productId}`) !== build.briefId || build.status !== "private_deployed" || !deployment || deployment.status !== "active" || deployment.visibility !== "private" || deployment.publicUrl !== null || deployment.externallyAccessible !== false || deployment.buildDigest !== proof.artifactDigest || !build.validation?.passed) throw new Error();
    const brief = store.brief(build.briefId)!;
    assertCompanyQuality(db,brief);
    const opportunity = db.productFactory.getDiscoveryOpportunity(brief.opportunityId);
    if (opportunity?.status !== "accepted" || opportunity.discovery.transition !== "brief_pending" || opportunity.discovery.decisionId !== brief.selectionDecisionId || JSON.stringify(opportunity.discovery.score) !== JSON.stringify(brief.sourceScore)) throw new Error();
    const artifacts = new Map<string, string>();
    for (const entry of build.tasks.filter((t) => t.step !== "rollback")) {
      const task = getTaskById(db.raw, entry.taskId), receipt = build.receipts[entry.taskId];
      const result = task?.result as { success?: boolean; factoryReceipt?: { hash: string } } | null;
      if (task?.status !== "completed" || !result?.success || !receipt || result.factoryReceipt?.hash !== receipt.hash) throw new Error();
      for (const a of receipt.artifacts) { const actual = inspectArtifact(build.artifactRoot, a.path); if (actual.sha256 !== a.sha256 || actual.size !== a.size) throw new Error(); artifacts.set(a.path, actual.sha256); }
    }
    if (buildHash(JSON.stringify([...artifacts.entries()].sort(([a], [b]) => a.localeCompare(b)))) !== proof.artifactDigest) throw new Error();
  } catch { throw new Error("Verified build and active private deployment required for launch_ready"); }
}
