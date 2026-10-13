import type { EconomicMetric, EconomicSnapshot, MetricValue } from './company-types.js';

export const ANALYTICS_CATEGORIES = ['ACQUISITION','PRODUCT_USAGE','ACTIVATION','VALUE','COMMERCE','SUBSCRIPTION','RETENTION','CHURN','SUPPORT','RELIABILITY','COST','EXPERIMENT'] as const;
export type AnalyticsCategory = typeof ANALYTICS_CATEGORIES[number];
export type MeasurementNature = 'MODEL'|'SYNTHETIC'|'PUBLIC'|'OBSERVED'|'CALCULATED_FROM_OBSERVED';
export type AnalyticsSourceType = 'PAYMENTS_BILLING'|'PRODUCT_ANALYTICS'|'WEB_ANALYTICS'|'MARKETPLACE'|'ADVERTISING'|'CRM_SALES'|'SUPPORT'|'INFRASTRUCTURE_COST';
export type AnalyticsEntity = 'user'|'account'|'customer'|'anonymous'|'session'|'order'|'subscription';
export interface AnalyticsPeriod { start:string; end:string }
/** A connector's normalized input is still untrusted. Identifiers never persist verbatim. */
export interface AnalyticsInput {
  eventId?:string; productId:string; eventName:string; category:AnalyticsCategory; occurredAt:string;
  currency?:string; amountCents?:number; quantity?:number;
  identifiers?:Partial<Record<AnalyticsEntity,string>>;
  properties?:Record<string,string|number|boolean>;
  economicMetric?:EconomicMetric; paymentStatus?:'settled'|'pending'|'trial';
  correctionOf?:string; correction?:'refund'|'chargeback'|'reversal';
}
export interface AnalyticsObservation {
  id:string; eventId:string; providerId:string; sourceType:AnalyticsSourceType; productId:string;
  eventName:string; category:AnalyticsCategory; occurredAt:string; receivedAt:string;
  currency:string|null; amountCents:number|null; quantity:number;
  identifiers:Partial<Record<AnalyticsEntity,string>>; properties:Record<string,string|number|boolean>;
  economicMetric:EconomicMetric|null; paymentStatus:'settled'|'pending'|'trial'|null;
  correctionOf:string|null; correction:'refund'|'chargeback'|'reversal'|null;
  nature:MeasurementNature; verification:'VERIFIED'|'UNVERIFIED'; confidence:number; schemaVersion:1;
  provenance:{sourceId:string; receiptHash:string; payloadHash:string; trust:'untrusted-external-data'};
}
export interface AnalyticsSource {
  id:string; type:AnalyticsSourceType; mode:'fixture'|'read-only'; nature:Exclude<MeasurementNature,'CALCULATED_FROM_OBSERVED'>;
  reliability:number; authoritativeMetrics:EconomicMetric[]; coverageMetrics:string[];
}
export interface AnalyticsBatch { events:unknown[]; cursor:string|null; coverage:{productId:string;period:AnalyticsPeriod;metrics:string[];complete:boolean}[] }
/** No credentials, request headers or native sensitive payloads in this interface's persisted state. */
export interface AnalyticsProvider {
  readonly source:AnalyticsSource;
  collect(context:{cursor:string|null;signal:AbortSignal}):Promise<AnalyticsBatch>;
  normalize(raw:unknown):AnalyticsInput;
  /** receiptRef identifies the canonical financial fact/line item, not a webhook transport envelope. */
  verify?(raw:unknown,input:AnalyticsInput):{verified:boolean;receiptRef:string};
  verifyCoverage?(batch:AnalyticsBatch):boolean;
}
export interface AnalyticsConfig { enabled:boolean; maxBatchEvents:number; maxPeriodEvents:number; providerTimeoutMs:number; freshnessMs:number; retentionDays:number; minSample:number; anomalyMinHistory:number; anomalyPersistence:number }
export interface AnalyticsCoverage { providerId:string;productId:string;period:AnalyticsPeriod;metrics:string[];complete:boolean;nature:MeasurementNature;verified:boolean;receivedAt:string }
export interface AnalyticsProviderState { providerId:string; cursor:string|null; status:'healthy'|'degraded'|'unavailable';at:string;accepted:number;duplicates:number;rejected:number;reason:string|null }
export type QualityCheck = 'COMPLETENESS'|'FRESHNESS'|'UNIQUENESS'|'VALIDITY'|'CONSISTENCY'|'TIMELINESS'|'SOURCE_TRUST';
export interface AnalyticsDataQuality { checks:Record<QualityCheck,{status:'PASS'|'WARN'|'FAIL';reason:string}>;confidence:number;warnings:string[];sampleSize:number;stale:boolean }
export interface AnalyticsScope { productIds:string[]; period:AnalyticsPeriod;currency:string;nature:MeasurementNature;dimensions?:Partial<Record<'channel'|'campaign'|'plan'|'region',string>> }
export interface AnalyticsMetric extends MetricValue { denominator?:{entity:AnalyticsEntity|'event';count:number;definition:string};eventIds:string[];sourceIds:string[] }
export interface AnalyticsReport {
  scope:AnalyticsScope;asOf:string;calculationVersion:1;calculationConfig:AnalyticsConfig;coverageRefs:{key:string;revision:number;hash:string}[];definitionVersions:Record<string,number>;inputHash:string;
  eventIds:string[];eventHashes:string[];coverageMetrics:string[];quality:AnalyticsDataQuality;
  economics:EconomicSnapshot;metrics:Record<string,AnalyticsMetric>;
  reconciliation:{metric:string;authoritative:number|null;reported:number;sourceId:string;reason:string}[];
}
export interface FunnelDefinition { productId:string;entity:AnalyticsEntity;steps:{name:string;eventName:string}[];windowMs:number;firstValueStep:string|null;changeReason:string }
export interface FunnelResult { definitionKey:string;definitionRevision:number;reportKey:string;reportRevision:number;entity:AnalyticsEntity;stages:{name:string;count:number;conversion:number|null;dropOff:number|null;medianTimeMs:number|null}[];timeToFirstValueMs:number|null;sampleSize:number;confidence:number;warnings:string[];eventIds:string[];bottlenecks:{stage:string;reason:string;causal:false}[] }
export interface CohortDefinition { productId:string;entity:AnalyticsEntity;entryEvent:string;returnEvents:string[];kind:'activity'|'account'|'paid_subscription'|'repeat_purchase';groupBy:'entry_day'|'channel'|'campaign'|'plan'|'version'|'segment';observationWindowMs:number;changeReason:string }
export interface CohortResult { definitionKey:string;definitionRevision:number;reportKey:string;reportRevision:number;groups:{key:string;members:number;eligible:number;retained:number;retention:number|null;activation:number|null;revenueCents:number|null;contributionCents:number|null;confidence:number;warnings:string[]}[];eventIds:string[] }
export interface AttributionDefinition { productId:string;entity:'customer'|'account';model:'FIRST_TOUCH'|'LAST_TOUCH'|'DIRECT'|'PROVIDER_REPORTED'|'CUSTOM'|'UNKNOWN';windowMs:number;reliable:boolean;changeReason:string }
export interface UnitEconomicsResult { reportKey:string;reportRevision:number;attributionKey:string;attributionRevision:number;cac:AnalyticsMetric;ltv:{state:'OBSERVED_TO_DATE'|'ESTIMATED'|'MATURE_COHORT'|'INSUFFICIENT_DATA';value:AnalyticsMetric;assumptions:string[]};payback:AnalyticsMetric;marginal:{historicalContributionPerCost:number|null;recentContributionPerCost:number|null;saturationCandidate:boolean};warnings:string[] }
export interface ExperimentAnalyticsProtocol { companyExperimentKey:string;productId:string;entity:AnalyticsEntity;control:string;variant:string;primaryEvent:string;guardrails:{eventName:string;maxIncrease:number}[];period:AnalyticsPeriod;minSample:number;changeReason:string }
export interface ExperimentAnalyticsResult { protocolKey:string;protocolRevision:number;reportKey:string;reportRevision:number;control:{exposed:number;converted:number};variant:{exposed:number;converted:number};difference:number|null;confidence:number;guardrails:{eventName:string;control:number;variant:number;passed:boolean}[];status:'INCONCLUSIVE'|'GUARDRAIL_FAILED'|'CANDIDATE_IMPROVEMENT';nature:MeasurementNature;eventIds:string[];causal:false }
export interface AnalyticsDiagnosis { reportKey:string;reportRevision:number;comparisonKey:string|null;comparisonRevision:number|null;facts:{metric:string;current:number|null;previous:number|null;change:number|null}[];explanations:{driver:string;reason:string;confidence:number;causal:false}[];contradictions:string[];missingEvidence:string[];eventIds:string[] }
export interface AnalyticsAnomaly { reportKey:string;reportRevision:number;metric:string;value:number;baseline:number;relativeChange:number;confidence:number;historySamples:number;consecutive:number;severity:'candidate'|'material'|'critical';causal:false }
export interface AnalyticsDossier { reportKey:string;reportRevision:number;snapshotKey:string;metrics:Record<string,AnalyticsMetric>;quality:AnalyticsDataQuality;diagnosisKey:string|null;anomalyKeys:string[];sourceIds:string[];eventHashes:string[] }
