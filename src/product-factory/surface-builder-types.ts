import type { ProductSurface, CapabilityStatus } from './optimization-types.js';
import type { ProductArchitecture, AcceptanceProbe, ProductSandboxSession, SandboxResult } from './model-build-types.js';
export const SURFACE_ACCEPTANCE_KINDS = ['surfaceEnvironment','surfaceAdapter','surfaceProfile','surfacePlan','surfaceRun','surfaceReceipt','surfaceCapability','surfaceArtifact'] as const;
export type SurfaceExecutionCapability = 'PROJECT_GENERATION'|'DEPENDENCY_RESOLUTION'|'STATIC_VALIDATION'|'COMPILATION'|'UNIT_TEST'|'INTEGRATION_TEST'|'RUNTIME_START'|'HTTP_ACCEPTANCE'|'BROWSER_LAUNCH'|'BROWSER_NAVIGATION'|'BROWSER_INTERACTION'|'VISUAL_INSPECTION'|'ACCESSIBILITY'|'PERSISTENCE'|'NETWORK_BEHAVIOR'|'PERMISSIONS'|'MOBILE_LAUNCH'|'MOBILE_INTERACTION'|'CRASH_DETECTION'|'PACKAGE'|'SIGNING_READINESS'|'STORE_ARTIFACT_READINESS';
export type EvidenceStrength = 'MODEL_CLAIM'|'STATIC_INSPECTION'|'BUILD_RECEIPT'|'RUNTIME_RECEIPT'|'STRUCTURED_INTERACTION'|'DETERMINISTIC_ASSERTION'|'SCREENSHOT'|'VISUAL_MODEL_CRITIQUE'|'DEVICE_OR_BROWSER_ACCEPTANCE';
export interface SurfaceRef { key:string;revision:number;hash:string }
export interface SurfaceBinding { sourceHash?:string; productId:string;buildId:string;briefId:string;contract:SurfaceRef|null;surfaceDecision:SurfaceRef|null;architectureRevision:number;artifactHash:string;surface:ProductSurface }
export interface SurfaceEnvironment { id:string;os:string;toolchain:Record<string,string>;isolation:'filesystem-and-network';browser:'AVAILABLE'|'BLOCKED'|'NOT_IMPLEMENTED';androidBuild:'AVAILABLE'|'BLOCKED'|'NOT_IMPLEMENTED';androidRuntime:'AVAILABLE'|'BLOCKED'|'NOT_IMPLEMENTED';ios:'AVAILABLE'|'BLOCKED'|'NOT_IMPLEMENTED';reasons:string[];observedAt:string }
export interface SurfaceAcceptanceProfile { surface:ProductSurface;version:number;mandatory:SurfaceExecutionCapability[];optional:SurfaceExecutionCapability[];limitations:string[] }
export interface SurfaceViewport { name:'MOBILE'|'TABLET'|'DESKTOP';width:number;height:number }
export interface SurfaceAcceptancePlan { runner?: import("./web-runner.js").WebRunnerPolicy; environment?:SurfaceEnvironment; stage?:'BUILD'|'INTERACTION';expectedArtifactPaths?:string[]; binding:SurfaceBinding;profile:SurfaceRef;probe:AcceptanceProbe;viewports:SurfaceViewport[];timeoutMs:number;maxScreenshots:number;maxEvidenceBytes:number;mandatory:true;contractCriterionIds:string[];createdBeforeExecution:true;cleanup:'EPHEMERAL_CONTEXT';externalOrigins:[] }
export interface SurfaceFinding { type:string;severity:'warning'|'critical';strength:EvidenceStrength;message:string;step:number|null;viewport:string|null;blocking:boolean }
export interface SurfaceScreenshot { sha256:string;base64:string;step:number;route:string;viewport:string;format:'jpeg';timestamp:string }
export interface SurfaceObservation { capability:SurfaceExecutionCapability;passed:boolean;strength:EvidenceStrength;detail:string }
export interface SurfaceAcceptanceReceipt { runnerProof?: import("./web-runner.js").WebRunnerProof; browserEngine?:string|null;semanticState?:{viewport:string;step:number;title:string;route:string;snapshot:string}[]; binding:SurfaceBinding;plan:SurfaceRef;runId:string;status:'PASS'|'FAIL'|'BLOCKED'|'INCOMPLETE';execution:'real'|'unavailable';environment:SurfaceEnvironment;adapterId:string;adapterVersion:string;observations:SurfaceObservation[];findings:SurfaceFinding[];screenshots:SurfaceScreenshot[];durationMs:number;computeUnits:number;monetaryCostCents:null;firstValue:{achieved:boolean;steps:number;elapsedMs:number}|null;persistenceLayer:'none'|'memory'|'browser-local'|'application-database'|'server'|null;reproducibility:string[];limitations:string[] }
export interface SurfaceExecutionCapabilityEvidence {surface:ProductSurface;capability:SurfaceExecutionCapability;status:CapabilityStatus;state:'CURRENT'|'STALE'|'REGRESSED';receiptRefs:SurfaceRef[];environmentId:string;toolchainHash:string;reason:string}
export interface SurfaceEntityMap {
 surfaceEnvironment:SurfaceEnvironment;
 surfaceAdapter:{id:string;version:string;surfaces:ProductSurface[];limitations:string[]};
 surfaceProfile:SurfaceAcceptanceProfile;surfacePlan:SurfaceAcceptancePlan;
 surfaceRun:{plan:SurfaceRef;binding:SurfaceBinding;status:'RUNNING'|'COMPLETED'|'INTERRUPTED';taskId:string;attempt:number;receiptKey:string|null;runnerJob?:import('./web-runner.js').WebRunnerJob};
 surfaceReceipt:SurfaceAcceptanceReceipt;surfaceCapability:SurfaceExecutionCapabilityEvidence;
 surfaceArtifact:{binding:SurfaceBinding;path:string;sha256:string;size:number;type:'SOURCE'|'COMPILED'|'SCREENSHOT'|'APK'|'AAB'|'IPA';buildMode:'development'|'release'|'unsigned';signing:'NOT_CONFIGURED'|'TEST_SIGNING_ONLY'|'SIGNING_CONFIGURATION_READY'|'PRODUCTION_SIGNING_NOT_PERFORMED';storeReadiness:'NOT_IMPLEMENTED'|'BLOCKED'|'STRUCTURAL_CHECK_ONLY';receiptRef:SurfaceRef|null};
}
export interface SurfaceAdapterResolution { status:'READY'|'EXPERIMENTAL'|'BLOCKED'|'NOT_IMPLEMENTED'|'UNSUPPORTED_ENVIRONMENT';adapter:SurfaceBuilderAdapter|null;reason:string }
/** Bounded extension of the existing lifecycle, never a surface-selection service. */
export interface SurfaceBuilderAdapter {
 readonly id:string;readonly version:string;readonly surfaces:readonly ProductSurface[];
 validateEnvironment(environment:SurfaceEnvironment):SurfaceAdapterResolution['status'];
 validateArchitecture(architecture:ProductArchitecture):void;
 interact(session:ProductSandboxSession,port:number,plan:SurfaceAcceptancePlan):Promise<SandboxResult>;
}
export interface MacOSSurfaceJob { creatorAddress:string;binding:SurfaceBinding;plan:SurfaceRef;sourceHash:string;taskId:string;reservationId:string;approvalId:string;maxDurationMs:number;maxComputeUnits:number;network:'DENY';productionSigning:false;storeSubmission:false }
export interface MacOSSurfaceRunner { run(job:MacOSSurfaceJob):Promise<{receipt:SurfaceAcceptanceReceipt;runnerIdentity:string;signature:string;artifacts:{path:string;sha256:string}[]}> }

export interface VisualCritic { critique(input:{binding:SurfaceBinding;screenshotHashes:string[];semanticState:unknown;inferenceReservationId:string}):Promise<{findings:(SurfaceFinding & {strength:'VISUAL_MODEL_CRITIQUE'})[];trackedCostCents:number}> }
