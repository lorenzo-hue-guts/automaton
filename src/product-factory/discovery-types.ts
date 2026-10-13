import type { Evidence, Opportunity } from "./types.js";

export const SOURCE_TYPES = ["web", "forum", "reddit", "app_store", "google_play", "community", "social", "product_hunt", "competitor", "marketplace", "github", "trend", "technology", "regulation"] as const;
export type SourceType = typeof SOURCE_TYPES[number];
export const SCORE_WEIGHTS = Object.freeze({ problem: 20, willingnessToPay: 20, marketSize: 15, differentiation: 10, technicalEase: 10, operationalCost: 10, recurringRevenue: 10, acquisition: 5 });
export type ScoreCriterion = keyof typeof SCORE_WEIGHTS;
export type EvidenceKind = "observation" | "inference" | "hypothesis";
export interface DiscoverySignal {
  opportunityId: string;
  sourceType: SourceType;
  sourceRef: string;
  /** Same author/dataset/syndication chain must share a key, even across providers. */
  independenceKey: string;
  capturedAt: string;
  summary: string;
  excerpt: string;
  sentiment?: "positive" | "neutral" | "negative";
  reliability: number;
  tags: string[];
  relation: "supports" | "refutes";
  kind: EvidenceKind;
  criterion: ScoreCriterion;
}
export interface EvidenceProvenance extends DiscoverySignal {
  providerId: string;
  trust: "untrusted-external-data";
  contentHash: string;
  fingerprint: string;
}
export interface AtomicEvidence extends Evidence { provenance: EvidenceProvenance }
/** A normalized observation can propose a new problem without a preexisting opportunity. */
export interface DiscoveryObservation extends Omit<DiscoverySignal, "opportunityId"> {
  opportunity: { title: string; problem: string };
}
export type DiscoveryInput = DiscoverySignal | DiscoveryObservation;
export interface DiscoveryProvider {
  readonly id: string;
  readonly mode: "fixture";
  collect(): Promise<readonly DiscoveryInput[]>;
}
/** Values are local assessments, never instructions or scores extracted from external text. */
export interface OpportunityAssessment {
  values: Record<ScoreCriterion, number>;
  estimatedCostCents: number;
  risk: number;
  unverifiedHypotheses: string[];
}
export type OpportunityClassification = "archive_reject" | "research" | "prototype_validation_candidate" | "mvp_candidate";
export interface OpportunityScore {
  valid: boolean;
  breakdown: Record<ScoreCriterion, { weight: number; assessedValue: number; evidenceFactor: number; points: number; evidenceIds: string[] }>;
  total: number;
  confidence: number;
  classification: OpportunityClassification;
  evidenceIds: string[];
  evidenceQuality: number;
  evidenceDiversity: number;
  unverifiedHypotheses: string[];
}
export interface DiscoveryOpportunity extends Opportunity {
  discovery: { creatorAddress: string; descriptionTrust?: "untrusted-external-data"; assessment?: OpportunityAssessment; score?: OpportunityScore; transition?: "brief_pending"; decisionId?: string };
}
export type SelectionAction = "SELECT" | "RESEARCH_MORE" | "REJECT" | "ARCHIVE";
export interface SelectionResult { opportunityId: string; action: SelectionAction; rank: number; priority: number; reason: string; decisionId?: string }
