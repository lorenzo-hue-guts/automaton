import type { AcceptanceProbe, ModelBuildState } from "./model-build-types.js";
import type { JsonValue } from "./types.js";
import type { OpportunityScore } from "./discovery-types.js";
export interface BriefCriterion { id: string; kind: "test" | "artifact" | "security" | "metric"; target: string; description: string }
export interface ProductBriefContent {
  acceptanceProbes?: AcceptanceProbe[];
  applicationContract?: JsonValue;
  companyContext?: JsonValue;
  problem: string; targetUsers: string[]; valueProposition: string; proposedSolution: string;
  criticalHypotheses: string[]; mvpFeatures: { id: string; title: string; acceptanceCriterion: string }[];
  nonGoals: string[]; architecture: string; hypotheticalPricing: string;
  validationCriteria: BriefCriterion[]; risks: string[];
  estimatedCostCents: number; complexity: "low" | "medium" | "high";
  metrics: string[]; successCriteria: string[]; failureCriteria: string[];
}
export interface ProductBrief {
  companyContract?: {key:string;revision:number;hash:string;decisionId:string};
  version: 1; id: string; creatorAddress: string; opportunityId: string; selectionDecisionId: string;
  evidenceIds: string[]; sourceScore: OpportunityScore; content: ProductBriefContent;
  productId: string | null; approvalId: string | null; createdAt: string;
}
export type BuildStep = "reference_research" | "model_build" | "architecture" | "setup" | "implementation" | "tests" | "packaging" | "security" | "instrumentation" | "validation" | "private_deployment" | "rollback";
export interface BuildTaskBinding { buildId: string; step: BuildStep; featureIndex?: number }
export interface BuildArtifact { path: string; sha256: string; size: number }
export interface BuildCheck { id: string; passed: boolean; detail: string }
export interface BuildReceipt {
  taskId: string; step: BuildStep; attempt: number; artifacts: BuildArtifact[]; checks: BuildCheck[];
  computeUnits: number; costCents: number; durationMs: number; hash: string;
}
export interface BuildValidation { passed: boolean; errors: string[]; checkedAt: string; artifactDigest: string }
export interface BuildRecord {
  model?: ModelBuildState;
  version: 1; id: string; creatorAddress: string; briefId: string; productId: string; goalId: string;
  artifactRoot: string; status: "planned" | "building" | "validated" | "private_deployed" | "failed" | "rolled_back";
  tasks: { taskId: string; step: BuildStep; featureIndex?: number }[];
  receipts: Record<string, BuildReceipt>; attempts: { taskId: string; attempt: number; success: boolean; costCents: number; computeUnits: number; durationMs: number }[]; validation?: BuildValidation; deploymentId?: string; createdAt: string;
}
export interface PrivateDeployment {
  version: 1; id: string; buildId: string; productId: string; provider: "synthetic-local";
  buildDigest: string; status: "active" | "rolled_back"; visibility: "private";
  publicUrl: null; externallyAccessible: false; costCents: 0; createdAt: string; rolledBackAt?: string;
}
export interface PrivateDeploymentProvider {
  readonly id: "synthetic-local";
  deploy(build: BuildRecord, validation: BuildValidation): PrivateDeployment;
  rollback(deployment: PrivateDeployment): PrivateDeployment;
}
