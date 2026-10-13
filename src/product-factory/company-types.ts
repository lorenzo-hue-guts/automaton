import type { SurfaceEntityMap } from './surface-builder-types.js';
import type { OptimizationEntityMap,RecordRef } from './optimization-types.js';
import type { ProductBriefContent } from './build-types.js';
import type { JsonValue } from './types.js';
import type { AnalyticsSource,AnalyticsCoverage,AnalyticsProviderState,AnalyticsReport,FunnelDefinition,FunnelResult,CohortDefinition,CohortResult,AttributionDefinition,UnitEconomicsResult,ExperimentAnalyticsProtocol,ExperimentAnalyticsResult,AnalyticsDiagnosis,AnalyticsAnomaly,AnalyticsDossier } from './analytics-types.js';

export const COMPANY_MISSION = 'Automaton is an autonomous software company whose mission is to identify market opportunities, design, build, commercialize, operate and improve software products in order to maximize the durable profitability of the portfolio owned by its creator.';
export const COMPANY_FUNCTIONS = ['ENTREPRENEUR','BUILDER','GROWTH','JUDGE'] as const;
export type CompanyFunction = typeof COMPANY_FUNCTIONS[number];
export const COMPANY_CAPABILITIES = ['CFO','CUSTOMER_SUCCESS','MARKET_INTELLIGENCE','PRICING_PACKAGING','SECURITY_PRIVACY','LEGAL_COMPLIANCE','INCIDENT_RESPONSE','B2B_SALES'] as const;
export type EvidenceLevel = 0|1|2|3|4|5;
export type EvidenceOrigin = 'model'|'synthetic'|'public'|'observed';
export interface EvidenceGovernance {
  level: EvidenceLevel; origin: EvidenceOrigin; aspect: 'problem'|'money_flow'|'buyer'|'distribution'|'retention'|'economics'|'quality'|'risk';
  expiresAt: string; verificationRef: string; measurements?: Record<string,number>; currency?: string; periodStart?: string; periodEnd?: string; paymentStatus?:'settled'|'unpaid_trial'|'pending'; productId?:string|null;
}
export interface Provenance { evidenceIds: string[]; assumptionIds: string[]; rationale: string; confidence: number }
export interface Range { low: number; high: number; unit: string; confidence: number; assumptionIds: string[]; evidenceIds: string[] }
export type FactNature = 'FACT'|'ESTIMATE'|'HYPOTHESIS'|'SYNTHETIC'|'UNKNOWN'|'CALCULATED_FROM_OBSERVED_DATA';
export interface MetricValue { value: number|null; unit: string; nature: FactNature; evidenceIds: string[]; confidence: number; definition?: {key:string;revision:number}; reason?: string }
export type EconomicMetric = 'grossRevenue'|'refunds'|'netRevenue'|'paymentFees'|'acquisitionCost'|'modelCost'|'hostingCost'|'variableCost'|'supportCost'|'operatingCost'|'contribution'|'profit'|'cash'|'committedCapital';
export interface EconomicSnapshot { productId: string|null; start: string; end: string; currency: string; costBucketsDisjoint:true; analytics?:{reportKey:string;revision:number;hash:string}; metrics: Record<EconomicMetric,MetricValue>; unitEconomics: Record<string,MetricValue>; revenueQuality: Record<string,MetricValue>; healthKey?: string }
export interface CriticalAssumption extends Provenance { statement: string; status: 'valid'|'unverified'|'false'|'stale'; expiresAt: string; affectedProductIds: string[]; expected: Range|null }
export interface Claim extends Provenance { assumptionVersions?:Record<string,number>; statement: string; productId: string|null }
export interface ConfidenceEvaluation { claimKey: string; claimRevision: number; evaluatedAt: string; confidence: number; stale: boolean; supportingIds: string[]; refutingIds: string[]; contradictions: string[]; assumptionVersions: Record<string,number>; explanation: string[] }
export const REVIEW_CLASSES = ['PRAISE','PAIN','FEATURE_REQUEST','SWITCHING_TRIGGER','PRICING_COMPLAINT','RELIABILITY_ISSUE','UX_FRICTION','MISSING_INTEGRATION','SUPPORT_COMPLAINT','DEAL_BREAKER','POWER_USER_REQUEST'] as const;
export interface CompetitorObservation extends Provenance {
  competitor: string; segment: string; targetCustomer: string; pricing: Range|null; packaging: string[]; capabilities: string[]; positioning: string;
  strengths: string[]; weaknesses: string[]; reviews: {classification:typeof REVIEW_CLASSES[number];evidenceIds:string[];economicRelevance:'low'|'material'|'critical';rationale:string}[];
  observedAt: string; expiresAt: string; switchingComplaints: string[];
}
export interface BuyerModel { user: string; champion: string|null; buyer: string; decisionMaker: string|null; budgetOwner: string|null }
export interface MarketThesis extends Provenance {
  opportunityId: string; buyer: BuyerModel; moneyFlowEvidenceIds: string[]; purchaseTriggers: string[];
  switchability: {factors:Record<string,Range|null>;rationale:string;evidenceIds:string[]}; replacement: {thesis:string;evidenceIds:string[];uncertainties:string[]};
  competitiveResponse: {canCopy:boolean;canBundle:boolean;canRestrictAccess:boolean;risk:'low'|'material'|'fatal';rationale:string;evidenceIds:string[]};
  defensibility: {kind:string;hypothesis:string;evidenceIds:string[]}[];
}
export interface ProductPattern extends Provenance { category: 'onboarding'|'activation'|'navigation'|'time_to_value'|'pricing'|'paywall'|'premium'|'retention'|'ux_complaint'|'anti_pattern'; principle: string; referenceHashes: string[]; sourceRefs: string[]; license: string|null; expiresAt: string; copyingPermitted: false }
export const BUSINESS_MODELS = ['monthly_subscription','annual_subscription','one_time','license','usage','credits','commission','freemium','per_seat','b2b_annual','hybrid','none_yet','do_not_build'] as const;
export interface PricingHypothesis extends Provenance { model:typeof BUSINESS_MODELS[number]; price:Range|null; packaging:string[]; recurringValue:string|null; valueToCustomer:string; expansion:{offer:string;additionalValue:string}[] }
export interface BusinessCase extends Provenance {
  surfaceDecision?:RecordRef;
  opportunityId:string; buyer:BuyerModel; problem:string; currentWorkaround:string; currentCost:Range|null; whyNow:string; whySwitch:string; whyThis:string; reachBuyers:string; acquisitionCost:Range|null;
  reasonToStay:string; servingCost:Range|null; pricing:PricingHypothesis;
  accessibleRevenue:{customers:Range;penetration:Range;revenuePerCustomer:Range;period:string};
  revenueShapes:{customers:number;revenuePerCustomerCents:number;period:string;rationale:string}[];
  unfairOpportunity:string|null; wedge:string; expansion:string[]; invalidators:string[]; marketThesisKey:string;
  desirability:Record<string,{assessment:'supported'|'uncertain'|'refuted';evidenceIds:string[];rationale:string}>;
  preMortem:{risk:string;severity:'uncertain'|'material'|'fatal';evidenceIds:string[];mitigation:string}[];
  experiments:{key:string;costCents:number;builderHours:number;uncertainty:string;informationValue:Range;reversibility:Reversibility}[];
}
export const QUALITY_GATES = ['FUNCTIONAL','UTILITY','UX','VISUAL','VALUE_PROPOSITION','COMMERCIAL','BUSINESS_MODEL','SECURITY','INSTRUMENTATION','RELIABILITY','PERFORMANCE','ACCESSIBILITY','ONBOARDING','TIME_TO_VALUE'] as const;
export type QualityGate = typeof QUALITY_GATES[number];
export type GateStatus = 'PASS'|'FAIL'|'BLOCKED'|'NOT_APPLICABLE'|'INSUFFICIENT_EVIDENCE';
export interface ContractGate { gate:QualityGate; required:boolean; criterion:string; minimumLevel:EvidenceLevel; requiresBrowser:boolean }
export interface ProductContract extends Provenance {
  surfaceDecision?:RecordRef;
  productId:string; opportunityId:string; briefId:string|null; businessCaseKey:string; businessCaseRevision:number; status:'draft'|'reviewed'|'approved'|'superseded';
  buyer:BuyerModel; problem:string; currentWorkaround:string; currentSpend:Range|null; whyNow:string; whySwitch:string; promise:string; desiredOutcome:string; wedge:string; differentiation:string;
  capabilities:string[]; nonGoals:string[]; mainJourney:string; timeToFirstValue:Range|null; reasonToPay:string; reasonToStay:string; pricing:PricingHypothesis; gtmKey:string;
  acceptanceCriteria:{id:string;description:string}[]; designExpectations:string[]; gates:ContractGate[]; successMetrics:{key:string;definitionRevision:number;criterion:string}[]; constraints:string[]; risks:string[];
  briefContent:ProductBriefContent; changeReason:string; authorizedBy:CompanyFunction;
}
export interface QualityAssessment { productId:string; contractKey:string; contractRevision:number; gates:{gate:QualityGate;status:GateStatus;evidenceIds:string[];acceptance?:{buildId:string;probeId:string;surfaceReceiptKey?:string};rationale:string}[] }
export interface ProductHealth extends Provenance { productId:string; factors:Record<string,'healthy'|'degraded'|'critical'|'unknown'>; incidents:string[]; status:'healthy'|'degraded'|'critical'|'unknown'; errorBudgetRemaining:MetricValue }
export const GROWTH_CHANNELS = ['seo','content','community','partnership','creator','marketplace','legitimate_outbound','b2b_sales','paid_acquisition'] as const;
export interface GoToMarketPlan extends Provenance { productId:string; icp:string; buyer:string; firstQualifiedProspects:string; stage:'PRE_LAUNCH_VALIDATION'|'EARLY_ACQUISITION'|'VALIDATION_ACQUISITION'|'GROWTH'|'SCALE'; channels:typeof GROWTH_CHANNELS[number][]; message:string; offer:string; creativeHypothesis:string; funnel:string[]; conversion:Range|null; cac:Range|null; budgetCents:number; measurementKeys:string[]; stopConditions:string[]; execution:'disabled' }
export interface VoiceOfCustomer extends Provenance { productId:string; type:'onboarding'|'activation'|'support'|'feature_request'|'satisfaction'|'complaint'|'cancellation'|'expansion'|'recommendation'|'win'|'loss'|'non_buyer'; journeyStage:string; content:string; churnCause:'voluntary'|'payment_failed'|'seasonal'|'insufficient_value'|'ux'|'reliability'|'price'|'competitor'|'missing_feature'|'missing_integration'|'business_closed'|'support'|'migration'|'unknown'|null }
export type Reversibility = 'EASILY_REVERSIBLE'|'COSTLY_TO_REVERSE'|'EFFECTIVELY_IRREVERSIBLE';
export type CompanyAction = 'RESEARCH'|'VALIDATION'|'BUILD'|'ACQUISITION_VALIDATION'|'GROWTH'|'SCALE'|'FIX'|'RETENTION'|'PRICING'|'INFRASTRUCTURE'|'HOLD'|'PROTECT';
export interface CapitalProposal extends Provenance { optimization?:{interventionRef:RecordRef|null;reportRefs:RecordRef[];inferenceCents:number;durationMs:number;customerValue:string}; productId:string|null; opportunityId:string|null; action:CompanyAction; capitalCents:number; builderHours:number; computeUnits:number; expectedProfit:Range; successProbability:Range; downsideCents:number; upsideCents:number; paybackWeeks:Range|null; reversibility:Reversibility; strategicValue:string; marginalContribution:Range|null; historicalSpendCents:number; alternatives:string[]; riskKeys:string[]; approvalRequired:boolean }
export interface CapitalAllocation { proposalKey:string;proposalRevision:number; productId:string; decisionId:string;approvalId:string; status:'proposed'|'committed'|'released';capitalCents:number;builderHours:number;computeUnits:number;baselineCostCents:number;baselineDurationMs:number;baselineComputeUnits:number }
export interface OwnerTarget { periodStart:string; periodEnd:string; timezone:string; currency:string; metric:'grossRevenue'|'netRevenue'|'profit'; metricDefinition:{key:string;revision:number}; amountCents:number; creatorAuthorized:true; changeReason:string }
export interface StretchTarget { ownerTargetKey:string; ownerTargetRevision:number; amountCents:number; rationale:string; evidenceIds:string[] }
export interface Forecast extends Provenance { analyticsInputs?:{key:string;revision:number;hash:string}[]; productId:string|null; start:string;end:string;horizonWeeks:4|8|12; currency:string; processKey:string; metrics:Partial<Record<EconomicMetric,Range|null>>;capitalRequired:Range|null;builderHours:Range|null;acquisitionRequired:Range|null; risks:string[]; driverModel:{type:'saas'|'b2b'|'usage'|'transaction'|'custom';drivers:Record<string,Range|null>;explanation:string};freshUntil:string }
export interface ForecastOutcome { forecastKey:string;forecastRevision:number;actualSnapshotKey:string;actualSnapshotRevision:number;metric:EconomicMetric;actual:MetricValue;inRange:boolean|null;error:number|null;direction:'optimistic'|'pessimistic'|'in_range'|'unknown' }
export interface MetricDefinition { name:string;unit:string;kind:'ACTIVITY'|'PROGRESS'|'RESULT';formula:string;includes:string[];excludes:string[];changeReason:string }
export interface FrozenDossier { frozenAt:string;target:{key:string;revision:number};forecast:{key:string;revision:number}|null;snapshot:{key:string;revision:number};facts:Record<string,MetricValue>;health:Record<string,ProductHealth>;portfolioKeys:string[];experimentKeys:string[];riskKeys:string[];feedbackKeys:string[];hash:string;analytics?:AnalyticsDossier }
export interface DomainAssessment { function:CompanyFunction;summary:string;evidenceIds:string[];claims:string[];disagreements:string[];blocking:boolean }
export interface CompanyReview { type:'weekly'|'monthly';start:string;end:string;dossier:FrozenDossier;assessments:DomainAssessment[];decisionId:string;targetOutcome:'EXCEEDED'|'REACHED'|'NEAR'|'MISSED'|'UNKNOWN'|'SYNTHETIC';revenueGap:Range|null;stopDoing:string[];nextPriorities:string[];boardQuestion:string|null;repeatability:string|null }
export interface OperatingMode { mode:'NORMAL'|'RECOVERY'|'CRISIS'; productId:string|null;reason:string;evidenceIds:string[];consecutiveMisses:number;strategicReviewRequired:boolean;decisionId:string }
export type EconomicPortfolioState = 'EXPLORE'|'VALIDATE'|'GROW'|'SCALE'|'HARVEST'|'HOLD'|'PIVOT'|'KILL'|'ARCHIVE';
export interface PortfolioOverlay extends Provenance { productId:string;state:EconomicPortfolioState;decisionId:string;capitalIntensity:'minimal'|'validation'|'growth';monitoring:'normal'|'increased'|'critical';reviewCadence:'weekly'|'monthly';relationships:{productId:string;type:'complement'|'cross_sell'|'expansion'|'replacement'|'cannibalization'|'confusion'|'support_burden'|'synergy';evidenceIds:string[];rationale:string}[] }
export interface ShadowOpportunity extends Provenance { opportunityId:string;proposalKey:string;status:'available'|'held'|'rejected';reevaluationConditions:string[];representation:'improvement'|'feature'|'add_on'|'premium'|'plan'|'bundle'|'complementary_product'|'independent_product'|'replacement';alternatives:string[] }
export const RISK_TYPES = ['PLATFORM_CONCENTRATION','CUSTOMER_CONCENTRATION','CHANNEL_CONCENTRATION','SUPPLIER_API_CONCENTRATION','EXTERNAL_DEPENDENCY','REGULATORY','SECURITY','PRIVACY','REPUTATION','INFRASTRUCTURE','DATA_LOSS','FRAUD_BAD_TRAFFIC','COMPETITIVE_RESPONSE','ECONOMIC','PRODUCT_HEALTH'] as const;
export interface CompanyRisk extends Provenance { type:typeof RISK_TYPES[number];likelihood:Range|null;impact:'low'|'material'|'critical';affectedProducts:string[];mitigation:string;owner:CompanyFunction;status:'open'|'mitigated'|'closed' }
export interface ProductDependency extends Provenance { productId:string;kind:'model'|'api'|'payment'|'cloud'|'marketplace'|'channel'|'platform'|'dataset'|'library';name:string;riskKeys:string[];assumptionKeys:string[];backupExpectation:string;recoveryExpectation:string;privacy:{minimization:string;accessControl:string;retention:string;deletion:string;sensitiveLogging:string;secretSeparation:true;productIsolation:true} }
export interface CausalLearning extends Provenance { productId:string; intervention:string;exposedPopulation:string;expectedEffect:Range|null;observedEffect:MetricValue;externalFactors:string[];method:'randomized'|'controlled'|'observational';causalClaim:'supported'|'uncertain'|'refuted';changeRefs:string[] }
export interface DecisionMetadata extends Provenance { function:CompanyFunction;owner:string;logicalKey:string;versions:Record<string,number>;inputs:JsonValue;contradictions:string[];alternatives:string[];expectedOutcome:string;policy:{allowed:boolean;reason:string};approvalId:string|null;reversibility:Reversibility;rights:string[] }
export interface CompanyScorecard { capturedAt:string;analytics?:AnalyticsDossier;metrics:Record<string,MetricValue>;targetKey:string|null;forecastKey:string|null;revenueGap:Range|null;productHealth:Record<string,ProductHealth>;portfolioFactors:Record<string,MetricValue>;decisionIds:string[] }
export interface CompanyConfig { enabled:boolean;currency:string;timezone:string;materialMissRatio:number;strategicMissCount:number;minGreenlightLevel:EvidenceLevel;maxCapitalCents:number;maxBuilderHours:number;maxComputeUnits:number;forecastHorizons:(4|8|12)[];reviews:{weekly:boolean;monthly:boolean;dailyAnomaliesOnly:true};initialOwnerTargets:OwnerTarget[];maxRisk:'low'|'material';allowStretch:boolean }
export interface CompanyModel { mission:typeof COMPANY_MISSION;objective:'durable-risk-adjusted-portfolio-profit-and-customer-value';creatorAddress:string;config:CompanyConfig;functions:typeof COMPANY_FUNCTIONS;capabilities:typeof COMPANY_CAPABILITIES;hierarchy:string[];operatingLoop:readonly ['MAKE','GROW','PROTECT','REINVEST'] }
export interface CompanyEntityMap extends OptimizationEntityMap, SurfaceEntityMap {
  analyticsSource:AnalyticsSource;
  analyticsCoverage:AnalyticsCoverage;
  analyticsProvider:AnalyticsProviderState;
  analyticsQuarantine:{providerId:string;digest:string;at:string;reason:string};
  analyticsReport:AnalyticsReport;
  analyticsFunnelDefinition:FunnelDefinition;analyticsFunnel:FunnelResult;
  analyticsCohortDefinition:CohortDefinition;analyticsCohort:CohortResult;
  analyticsAttribution:AttributionDefinition;analyticsUnits:UnitEconomicsResult;
  analyticsExperimentProtocol:ExperimentAnalyticsProtocol;analyticsExperiment:ExperimentAnalyticsResult;
  analyticsDiagnosis:AnalyticsDiagnosis;analyticsAnomaly:AnalyticsAnomaly;analyticsDossier:AnalyticsDossier;
  assumptionImpact:{evaluatedAt:string;assumptionVersions:Record<string,number>;staleKeys:string[];affectedProducts:string[];affectedDecisionIds:string[];reviewRequired:boolean};
  company:CompanyModel; assumption:CriticalAssumption;claim:Claim;confidence:ConfidenceEvaluation;competitor:CompetitorObservation;marketThesis:MarketThesis;pattern:ProductPattern;businessCase:BusinessCase;contract:ProductContract;quality:QualityAssessment;health:ProductHealth;gtm:GoToMarketPlan;voice:VoiceOfCustomer;
  economicSnapshot:EconomicSnapshot;proposal:CapitalProposal;allocation:CapitalAllocation;target:OwnerTarget;stretch:StretchTarget;forecast:Forecast;forecastOutcome:ForecastOutcome;metricDefinition:MetricDefinition;review:CompanyReview;mode:OperatingMode;portfolio:PortfolioOverlay;shadow:ShadowOpportunity;graveyard:ShadowOpportunity;
  risk:CompanyRisk;dependency:ProductDependency;causal:CausalLearning;scorecard:CompanyScorecard;
  decisionOutcome:{decisionId:string;actual:MetricValue;hindsight:string;evidenceIds:string[]};
  benchmark:{productId:string;metrics:Record<string,MetricValue>;evidenceIds:string[]};
  capabilityLearning:{nature:FactNature;capability:string;market:string;outcome:string;benchmarkKeys:string[];evidenceIds:string[];confidence:number};
  growthLearning:{productId:string;channel:string;audience:string;message:string;offer:string;creativePattern:string;metrics:Record<string,MetricValue>;evidenceIds:string[];confidence:number};
  externalChange:{dependencyKeys:string[];description:string;evidenceIds:string[];observedAt:string};
  rollback:{decisionId:string;action:'price'|'packaging'|'offer'|'funnel'|'campaign'|'feature'|'deployment';previousVersion:string;stopConditions:string[];execution:'disabled';approvalId:string|null};
  pulse:{at:string;anomalies:{type:string;productId:string|null;severity:'material'|'critical';evidenceIds:string[];reason:string}[];decisionId:string|null};
  experimentPlan:{productId:string;hypothesisId:string;experimentId:string;metricDefinitions:{key:string;revision:number}[];success:string;failure:string;stop:string;evidenceIds:string[]};
}
export type CompanyKind=keyof CompanyEntityMap;
export interface CompanyRecord<K extends CompanyKind> { id:string;key:string;kind:K;revision:number;creatorAddress:string;createdAt:string;hash:string;body:CompanyEntityMap[K] }
