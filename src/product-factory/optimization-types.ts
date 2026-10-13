import type { Provenance, Range, Reversibility, CapitalProposal } from './company-types.js';
import type { AnalyticsMetric } from './analytics-types.js';
export const PRODUCT_SURFACES = ['WEB_SAAS', 'WEB_APP', 'PWA', 'MOBILE_CROSS_PLATFORM', 'ANDROID', 'IOS', 'API_SERVICE', 'DESKTOP', 'BROWSER_EXTENSION', 'MULTI_SURFACE', 'UNDECIDED'] as const;
export type ProductSurface = typeof PRODUCT_SURFACES[number];
export const SURFACE_CAPABILITIES = ['generation', 'dependencyResolution', 'compilation', 'automatedTesting', 'runtime', 'interaction', 'navigation', 'persistence', 'networkBehavior', 'responsiveLayout', 'crashDetection', 'permissions', 'packaging', 'signing', 'releaseArtifact', 'storeMetadata', 'privacy', 'deployment', 'storeSubmission'] as const;
export type SurfaceCapability = typeof SURFACE_CAPABILITIES[number];
export type CapabilityStatus = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'EXPERIMENTAL' | 'NOT_IMPLEMENTED' | 'BLOCKED';
export interface RecordRef {
    key: string;
    revision: number;
    hash: string;
}
export interface CapabilityProof {
    buildId: string;
    probeId?: string;
    execution: 'real';
    surface: ProductSurface;
}
export interface BuilderSurfaceCapability {
    acceptanceEvidence?: Record<string,{status:CapabilityStatus;state:"CURRENT"|"STALE"|"REGRESSED";receiptRefs:RecordRef[];reason:string}>;
    surface: ProductSurface;
    status: CapabilityStatus;
    capabilities: Record<SurfaceCapability, {
        status: CapabilityStatus;
        proof: CapabilityProof | null;
    }>;
    limitations: string[];
    verifiedAt: string;
    changeReason: string;
}
export interface SurfaceFactor {
    name: string;
    value: boolean | string | number;
    confidence: number;
    evidenceIds: string[];
    rationale: string;
}
export interface MarketFormatBenchmark extends Provenance {
    opportunityId: string;
    observations: {
        product: string;
        outcome: 'successful' | 'weak' | 'unknown';
        surface: ProductSurface;
        pricing: Range | null;
        channels: string[];
        onboarding: string;
        complaints: string[];
        sourceRefs: string[];
        evidenceIds: string[];
        capturedAt: string;
        expiresAt: string;
    }[];
    interpretation: string;
    copyingPermitted: false;
}
export interface SurfaceAssessment {
    surface: ProductSurface;
    customerValue: string;
    distributionAdvantage: string;
    effortHours: Range;
    validationCost: Range;
    maintenanceCost: Range | null;
    expectedContribution: Range | null;
    riskKeys: string[];
    reversibility: Reversibility;
    canTestCriticalQuestion: boolean;
    question: string;
    evidenceIds: string[];
}
export interface ProductSurfaceDecision extends Provenance {
    productId: string | null;
    opportunityId: string;
    benchmarkRef: RecordRef;
    primarySurface: ProductSurface;
    secondarySurfaces: ProductSurface[];
    longTermSurface: ProductSurface;
    validationSurface: ProductSurface;
    factors: SurfaceFactor[];
    alternatives: SurfaceAssessment[];
    capabilityStatus: CapabilityStatus;
    validationCapabilityStatus: CapabilityStatus;
    reasons: string[];
    unverifiedHypotheses: string[];
    riskKeys: string[];
    decisionId: string;
    changeReason: string;
}
export const MONETIZATION_FORMATS = ['FREE', 'FREEMIUM', 'SUBSCRIPTION_MONTHLY', 'SUBSCRIPTION_ANNUAL', 'ONE_TIME', 'USAGE', 'CREDITS', 'PER_SEAT', 'TRANSACTION', 'COMMISSION', 'B2B_CONTRACT', 'HYBRID', 'NO_MONETIZATION_YET', 'DO_NOT_BUILD'] as const;
export interface MonetizationDecision extends Provenance {
    productId: string;
    format: typeof MONETIZATION_FORMATS[number];
    reasonToPay: string;
    recurringValue: string | null;
    price: Range | null;
    purchaseTrust: 'UNKNOWN' | 'HYPOTHESIS' | 'EVIDENCE_SUPPORTED';
    trustEvidenceIds: string[];
    storeEconomics: {
        platform: string;
        fee: Range | null;
        paymentConstraints: string[];
        reviewFriction: string;
        refundMechanics: string;
        expiresAt: string;
        evidenceIds: string[];
    } | null;
    decisionId: string;
}
export const OPTIMIZATION_CLASSES = ['ACQUISITION', 'ACTIVATION', 'TIME_TO_VALUE', 'CONVERSION', 'PRICING', 'PACKAGING', 'RETENTION', 'CHURN', 'EXPANSION', 'RELIABILITY', 'PERFORMANCE', 'COST', 'SUPPORT', 'PRODUCT_VALUE', 'DISTRIBUTION', 'PRODUCT_SURFACE', 'NEW_PRODUCT'] as const;
export type OptimizationClass = typeof OPTIMIZATION_CLASSES[number];
export const AUTONOMY_LEVELS = ['RECOMMEND_ONLY', 'PRIVATE_EXPERIMENT', 'OWNER_APPROVAL_REQUIRED', 'POLICY_APPROVED_AUTONOMOUS', 'PROHIBITED'] as const;
export type AutonomyLevel = typeof AUTONOMY_LEVELS[number];
export interface OptimizationOpportunity extends Provenance {
    productId: string;
    class: OptimizationClass;
    problem: string;
    reportRef: RecordRef;
    metric: string;
    baseline: AnalyticsMetric;
    mechanism: string;
    expectedUpside: Range | null;
    dependencies: string[];
    measurementPlan: string;
    causal: false;
}
export interface Intervention extends Provenance {
    opportunityKey: string;
    productId: string;
    class: OptimizationClass;
    mechanism: string;
    customerValue: string;
    uncertainty: string;
    criticalAssumptionIds: string[];
    informationValue: Range | null;
    expectedContribution: Range | null;
    capitalCents: number;
    builderHours: number;
    computeUnits: number;
    inferenceCents: number;
    durationMs: number;
    downsideCents: number;
    reversibility: Reversibility;
    riskKeys: string[];
    dependencies: string[];
    measurement: {
        canAnswer: boolean;
        reason: string;
        metricDefinitions: {
            key: string;
            revision: number;
        }[];
        population: string;
        period: {
            start: string;
            end: string;
        };
        primaryMetric: string;
        guardrails: string[];
        stopConditions: string[];
    };
    execution: 'RESEARCH' | 'PRIVATE_ARTIFACT_PROBE' | 'EXTERNAL_COMMERCIAL';
    autonomy: AutonomyLevel;
    ethicalFlags: ('DECEPTION' | 'SPAM' | 'CANCELLATION_FRICTION' | 'UNSAFE' | 'UNAUTHORIZED_ACCESS')[];
}
export interface ExperimentSelection {
    opportunityKey: string;
    candidateRefs: RecordRef[];
    selected: RecordRef | null;
    reasons: string[];
    alternatives: {
        key: string;
        eligible: boolean;
        reason: string;
    }[];
    decisionId: string;
    companyExperimentKey: string | null;
    taskId: string | null;
    approvalId: string | null;
    executionBinding?: {
        buildId: string;
        probeIds: string[];
    };
    status: 'RECOMMENDATION' | 'PLANNED' | 'BLOCKED' | 'COMPLETED';
}
export type OptimizationOutcome = 'ADOPT' | 'ITERATE' | 'RETEST' | 'ROLL_BACK' | 'HOLD' | 'REJECT' | 'SCALE_CANDIDATE' | 'PIVOT';
export interface OptimizationDecision {
    selectionRef: RecordRef;
    analyticsResultRef: RecordRef | null;
    outcome: OptimizationOutcome;
    requestedOutcome: OptimizationOutcome;
    reasons: string[];
    decisionId: string;
    baseline: AnalyticsMetric;
    expectedEffect: Range | null;
    actualResult: unknown;
    hindsight: string;
    executionAuthorized: false;
}
export interface PrivateExperimentOutcome {
    selectionKey: string;
    taskId: string;
    buildId: string;
    productId: string;
    status: 'PASS' | 'FAIL';
    execution: 'real-private';
    nature: 'SYNTHETIC';
    failureReason?: string;
    checks: {
        probeId: string;
        passed: boolean;
        exitCode: number;
        reason: string;
    }[];
    durationMs: number;
    computeUnits: number;
    artifactDigest: string;
    publiclyAccessible: false;
    costCents: 0;
}
export interface ScaleReadiness {
    productId: string;
    reportRef: RecordRef;
    requirements: {
        name: string;
        required: boolean;
        passed: boolean;
        reason: string;
        evidenceIds: string[];
    }[];
    ready: boolean;
    reasons: string[];
    executionAuthorized: false;
}
export interface CapitalIntelligenceComparison {
    proposalRefs: RecordRef[];
    rows: {
        key: string;
        eligible: boolean;
        inferenceCents?: number | null;
        durationMs?: number | null;
        customerValue?: string;
        basis?: 'OBSERVED_BASELINE' | 'ESTIMATED_OPTION' | 'UNKNOWN';
        optionVersions?: Record<string, number>;
        expectedMarginalProfit: number | null;
        returnOnBuilderHour: number | null;
        capitalCents: number;
        builderHours: number;
        computeUnits: number;
        confidence: number;
        reasons: string[];
    }[];
    selected: string | null;
    holdAllowed: true;
    decisionId: string | null;
    reportRefs: RecordRef[];
    objective: 'durable-contribution-customer-value';
    targetKey: string | null;
}
export interface OptimizationConfig {
    enabled: boolean;
    allowPrivateExperiments: boolean;
    maxCandidates: number;
    maxExperimentCostCents: number;
    maxExperimentBuilderHours: number;
    maxExperimentComputeUnits: number;
    maxExperimentInferenceCents: number;
    maxExperimentDurationMs: number;
    minConfidence: number;
}
export interface ChannelIntelligence {
    productId: string;
    period: {
        start: string;
        end: string;
    };
    currency: string;
    rows: {
        channel: string;
        reportRef: RecordRef;
        cac: AnalyticsMetric;
        contribution: AnalyticsMetric;
        retention: AnalyticsMetric;
        payback: AnalyticsMetric;
        marginalReturn: number | null;
        saturation: boolean | null;
        confidence: number;
        scaleCandidate: boolean;
        reasons: string[];
    }[];
    executionAuthorized: false;
}
export interface OptimizationLearning extends Provenance {
    channelComparison?: ChannelIntelligence;
    productId: string;
    kind: 'surface' | 'channel' | 'cross_product';
    surface: ProductSurface | null;
    sourceProductId: string | null;
    outcome: string;
    measurementRefs: RecordRef[];
    nature: 'HYPOTHESIS' | 'CALCULATED_FROM_OBSERVED_DATA' | 'SYNTHETIC';
    transferability: 'UNVERIFIED' | 'EVIDENCE_SUPPORTED';
    decisionId: string;
}
export interface OptimizationEntityMap {
    surfaceBenchmark: MarketFormatBenchmark;
    productSurfaceDecision: ProductSurfaceDecision;
    builderSurfaceCapability: BuilderSurfaceCapability;
    optimizationMonetization: MonetizationDecision;
    optimizationOpportunity: OptimizationOpportunity;
    optimizationIntervention: Intervention;
    optimizationSelection: ExperimentSelection;
    optimizationDecision: OptimizationDecision;
    optimizationPrivateOutcome: PrivateExperimentOutcome;
    optimizationScaleReadiness: ScaleReadiness;
    optimizationCapital: CapitalIntelligenceComparison;
    optimizationLearning: OptimizationLearning;
}
export const OPTIMIZATION_KINDS = ['surfaceBenchmark', 'productSurfaceDecision', 'builderSurfaceCapability', 'optimizationMonetization', 'optimizationOpportunity', 'optimizationIntervention', 'optimizationSelection', 'optimizationDecision', 'optimizationPrivateOutcome', 'optimizationScaleReadiness', 'optimizationCapital', 'optimizationLearning'] as const satisfies readonly (keyof OptimizationEntityMap)[];
export type OptimizationKind = keyof OptimizationEntityMap;
export interface OptimizationCapacity {
    capitalCents: number;
    builderHours: number;
    computeUnits: number;
    inferenceCents: number;
    durationMs: number;
}
export type OptimizationProposal = CapitalProposal;
