import type { JsonValue } from "./types.js";
import type { BuildCheck } from "./build-types.js";
export type ReferenceInsightKind = "common_pattern" | "expected_feature" | "differentiator" | "strength" | "weakness" | "recurring_complaint" | "onboarding" | "pricing" | "improvement" | "anti_pattern";
export interface ReferenceObservation { kind: ReferenceInsightKind; summary: string; confidence: number; sourceRef: string; capturedAt: string; sourceType: "public_page" | "public_review" | "public_docs" | "open_source"; license?: string }
export interface ProductReferenceInsight extends ReferenceObservation { providerId: string; contentHash: string; trust: "untrusted-external-data" }
export interface ProductReferenceProvider { readonly id: string; readonly mode: "fixture"; collect(problem: string): Promise<readonly ReferenceObservation[]> }
export interface ProductArchitecture {
  surface?: import("./optimization-types.js").ProductSurface;
  revision: number; stack: string[]; components: string[]; dataModel: string[]; api: string[];
  frontend: string; backend: string; auth: string; payments: "mock-only"; instrumentation: string[];
  tests: string[]; deploymentRequirements: string[]; referenceInsightIds: string[];
  dependencies: { name: string; version: string }[];
  runtime?: { kind: "http"; port: number; readinessPath: string };
  commands: { lint: string[]; typecheck: string[]; build: string[]; test: string[]; run: string[] };
  compiledArtifacts: string[];
}
export interface AcceptanceProbe { id: string; featureIds: string[]; entry: string; input: JsonValue; expected: JsonValue; expectedExitCode?: number; transport?: "cli" | "http" | "browser"; http?: { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; status: number; restartBefore?: boolean; assertions?: { path: string; minimum?: number; equals?: JsonValue }[] }; browser?: { path: string; steps: BrowserJourneyStep[]; firstValueStep?:number; viewports?: import("./surface-builder-types.js").SurfaceViewport[]; persistenceLayer?: "browser-local"|"application-database"|"server" }; kind: "functional" | "integration" | "startup" | "error" | "persistence" | "metric" }
export type SemanticBrowserTarget = {kind:'role';role:string;name:string}|{kind:'label'|'testId';name:string};
export type BrowserJourneyStep = { action:'NAVIGATE'|'ASSERT_URL';path:string }|{action:'RELOAD'|'BACK'|'SCREENSHOT'|'READ_ACCESSIBLE_STATE'}|{action:'CLICK'|'SUBMIT'|'WAIT_FOR'|'ASSERT_VISIBLE'|'SCROLL';target:SemanticBrowserTarget}|{action:'TYPE'|'SELECT';target:SemanticBrowserTarget;value:string}|{action:'ASSERT_TEXT';target:SemanticBrowserTarget;text:string}|{action:'ASSERT_STATE';target:SemanticBrowserTarget;state:'enabled'|'checked'|'focused'}| { action: "fill"; selector: string; value: string } | { action: "click"; selector: string } | { action: "visible"; selector: string; text: string };
export interface AcceptanceEvidence { probeId: string; briefId: string; contractHash: string; architectureRevision: number; transport: "cli" | "http" | "browser"; execution: "real" | "simulated" | "unavailable"; passed: boolean; observed: JsonValue; reason: string }
export interface BrowserAcceptanceProvider { readonly dedicated?: import("./web-runner.js").DedicatedWebBackend; readonly execution: "real" | "simulated" | "unavailable"; run(session: ProductSandboxSession, port: number, probe: AcceptanceProbe, timeoutMs: number): Promise<SandboxResult> }
export interface ModelBuildLimits { maxIterations: number; maxRepeatedFailures: number; maxCostCents: number; maxModelCostPerCallCents: number; maxDurationMs: number; maxCommandMs: number; maxComputeUnits: number }
export type VerificationPhase = "PLAN" | "IMPLEMENT" | "BUILD" | "RUN" | "TEST" | "INSPECT" | "FIX" | "RETEST" | "PASS" | "BLOCKED" | "FAILED" | "NEEDS_REPLAN" | "OBSERVE" | "DIAGNOSE" | "PLAN_FIX";
export interface CommandProof extends SandboxResult { phase: string; argv: string[] }
export interface VerificationAttempt { index: number; phases: VerificationPhase[]; changes: { path: string; sha256: string }[]; commands: CommandProof[]; checks: BuildCheck[]; errors: string[]; costCents: number; computeUnits: number; durationMs: number; nextReason: string; diagnosis?: string; repairPlan?: string[]; acceptance?: AcceptanceEvidence[]; interrupted?: boolean }
export interface InferenceEvidence { providerId: string; modelId: string; totalTokens: number; retries: number }
export interface ModelBuildState { version: 1; status: VerificationPhase; limits: ModelBuildLimits; costCents: number; computeUnits: number; elapsedMs: number; insights: ProductReferenceInsight[]; architectures: ProductArchitecture[]; attempts: VerificationAttempt[]; lastFailure?: string; lastError?: string; repeatCount: number; sandboxId?: string; adapterKind?: string; inferenceCalls?: { phase: string; costCents: number; inference?: InferenceEvidence }[]; resumeRequests?: { approvalId: string; limits: ModelBuildLimits; taskIds: string[]; requestHash: string; applied: boolean }[] }
export interface ModelBuildRequest { phase: "architecture" | "implement" | "fix" | "replan" | "acceptance_remediation"; brief: unknown; evidence: unknown[]; insights: readonly ProductReferenceInsight[]; architecture?: ProductArchitecture; previous?: VerificationAttempt; files: Record<string, string>; constraints?: { runtime: string; approvedDependencies: { name: string; version: string }[] } }
export interface ModelBuildResponse { costCents: number; inference?: InferenceEvidence; architecture?: ProductArchitecture; files?: { path: string; content: string }[]; diagnosis?: string; repairPlan?: string[]; disposition?: "continue" | "replan" | "approval_required" }
/** Bound must include provider retries. A charged failure reports cost via ModelBuildFailure. */
export interface ProductBuildModel { readonly adapterKind?: "production" | "deterministic" | "unavailable"; readonly maxCostPerCallCents: number; generate(request: ModelBuildRequest): Promise<ModelBuildResponse> }
export class ModelBuildFailure extends Error { constructor(message: string, readonly costCents: number, readonly kind: "request_failed" | "invalid_output" | "unavailable" = "request_failed") { super(message); } }
export interface SandboxResult { truncated?: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }
export interface ProductSandboxSession { readonly id: string; write(files: { path: string; content: string }[]): Promise<void>; startRuntime?(argv: string[], timeoutMs: number): Promise<SandboxResult>; stopRuntime?(): Promise<void>; exec(argv: string[], timeoutMs: number, input?: string): Promise<SandboxResult>; read(path: string): Promise<string>; close(): Promise<void> }
export interface ProductSandboxProvider { readonly imageDigest?:string; readonly isolation: "filesystem-and-network"; open(buildId: string, recoverySessionId?: string): Promise<ProductSandboxSession> }
export interface ApprovedPackage { name: string; version: string; license: string; files: { path: string; content: string; sha256: string }[] }
