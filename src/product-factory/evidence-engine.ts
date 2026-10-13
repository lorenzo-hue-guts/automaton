import { createHash } from "node:crypto";
import { ulid } from "ulid";
import type { AutomatonDatabase } from "../types.js";
import { sanitizeToolResult } from "../agent/injection-defense.js";
import { SOURCE_TYPES, SCORE_WEIGHTS, type AtomicEvidence, type DiscoverySignal, type EvidenceProvenance } from "./discovery-types.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export function validateSignal(signal: DiscoverySignal): void {
  for (const field of ["opportunityId", "sourceRef", "independenceKey", "summary", "excerpt"] as const) if (typeof signal[field] !== "string" || !signal[field].trim() || signal[field].length > 50_000) throw new Error(`Invalid provenance/content: ${field}`);
  if (!SOURCE_TYPES.includes(signal.sourceType) || !Number.isFinite(Date.parse(signal.capturedAt)) || !Number.isFinite(signal.reliability) || signal.reliability < 0 || signal.reliability > 1 || !Object.hasOwn(SCORE_WEIGHTS, signal.criterion) || !["supports", "refutes"].includes(signal.relation) || !["observation", "inference", "hypothesis"].includes(signal.kind) || !Array.isArray(signal.tags) || signal.tags.some((t) => typeof t !== "string" || !t.trim() || t.length > 200) || signal.tags.length > 100 || (signal.sentiment !== undefined && !["positive", "neutral", "negative"].includes(signal.sentiment))) throw new Error("Invalid evidence provenance");
}
/** External excerpts remain data in Evidence. Only IDs/counts enter system audit memory. */
export class EvidenceEngine {
  constructor(private readonly db: AutomatonDatabase, private readonly creatorAddress: string, private readonly enabled: boolean) {}
  ingest(providerId: string, signal: DiscoverySignal): { evidence: AtomicEvidence; duplicate: boolean } {
    if (!this.enabled) throw new Error("Product Factory is disabled");
    if (!providerId.trim()) throw new Error("Provider identity required");
    validateSignal(signal);
    const opportunity = this.db.productFactory.getDiscoveryOpportunity(signal.opportunityId);
    if (!opportunity || opportunity.discovery.creatorAddress !== this.creatorAddress) throw new Error("Unknown or foreign opportunity");
    // Capture timestamp and provider are excluded: repeated collection is idempotent.
    const fingerprint = hash(JSON.stringify([signal.sourceType, normalized(signal.sourceRef), normalized(signal.excerpt), signal.criterion, signal.relation, signal.kind]));
    return this.db.raw.transaction(() => {
      const row = this.db.raw.prepare("SELECT id FROM factory_evidence WHERE opportunity_id = ? AND signal_fingerprint = ?").get(signal.opportunityId, fingerprint) as { id: string } | undefined;
      if (row) return { evidence: this.db.productFactory.getAtomicEvidence(row.id)!, duplicate: true };
      const provenance: EvidenceProvenance = {
        opportunityId: signal.opportunityId, sourceType: signal.sourceType, sourceRef: signal.sourceRef,
        independenceKey: normalized(signal.independenceKey), capturedAt: new Date(signal.capturedAt).toISOString(),
        summary: sanitizeToolResult(signal.summary), excerpt: sanitizeToolResult(signal.excerpt),
        ...(signal.sentiment ? { sentiment: signal.sentiment } : {}), reliability: signal.reliability,
        tags: [...new Set(signal.tags)].sort(), relation: signal.relation, kind: signal.kind, criterion: signal.criterion,
        providerId, trust: "untrusted-external-data", contentHash: hash(signal.excerpt), fingerprint,
      };
      const evidence: AtomicEvidence = { id: ulid(), createdAt: new Date().toISOString(), opportunityId: signal.opportunityId, source: signal.sourceRef, content: provenance.excerpt, confidence: signal.reliability, provenance };
      this.db.productFactory.insertAtomicEvidence(evidence);
      // A new observation invalidates an old assessment result, including brief eligibility.
      const next = { ...opportunity.discovery };
      delete next.score; delete next.transition;
      this.db.productFactory.updateDiscoveryOpportunity(opportunity.id, next, opportunity.status === "rejected" ? "rejected" : "evaluating");
      return { evidence, duplicate: false };
    }).immediate();
  }
  list(opportunityId: string): AtomicEvidence[] {
    const opportunity = this.db.productFactory.getDiscoveryOpportunity(opportunityId);
    if (!opportunity || opportunity.discovery.creatorAddress !== this.creatorAddress) throw new Error("Unknown or foreign opportunity");
    return this.db.productFactory.listAtomicEvidence(opportunityId);
  }
}
