import { deriveSurfaceExecutionCapability, validateSurfaceReceipt, surfaceRef } from './surface-acceptance.js';
import { acceptanceProfile } from './surface-adapters.js';
import type { SurfaceEnvironment, SurfaceExecutionCapability } from './surface-builder-types.js';
import { ulid } from 'ulid';
import { qualityResult } from './company-governance.js';
import { comparable } from './analytics-intelligence.js';
import type { CompanyOperatingSystem, CompanyActor } from './company-os.js';
import { canonical } from './company-store.js';
import { BuildStore } from './build-store.js';
import type { CompanyAdmission } from './company-policy.js';
import type { CompanyEntityMap, CompanyRecord, Range } from './company-types.js';
import type { AnalyticsReport } from './analytics-types.js';
import { resolveOptimizationConfig } from './optimization-config.js';
import { initialSurfaceCapability, reasonAboutSurface, validateSurface } from './product-surfaces.js';
import { OPTIMIZATION_CLASSES, MONETIZATION_FORMATS, PRODUCT_SURFACES, SURFACE_CAPABILITIES, AUTONOMY_LEVELS } from './optimization-types.js';
import type { OptimizationKind, OptimizationConfig, RecordRef, MarketFormatBenchmark, ProductSurfaceDecision, SurfaceFactor, SurfaceAssessment, BuilderSurfaceCapability, MonetizationDecision, Intervention, OptimizationOutcome, OptimizationLearning, OptimizationCapacity, ChannelIntelligence } from './optimization-types.js';
import { interventionMechanisms, selectValuableExperiment, guardedOptimizationOutcome, ethicalIntervention } from './optimization-logic.js';
import { getTaskById } from '../state/database.js';
export const optimizationRef = (r: {
    key: string;
    revision: number;
    hash: string;
}): RecordRef => ({ key: r.key, revision: r.revision, hash: r.hash });
/** On-demand governance facade. No scheduler, execution engine or independent storage. */
export class FactoryOptimization {
    readonly config: OptimizationConfig;
    readonly clock: () => Date;
    constructor(readonly company: CompanyOperatingSystem, private readonly options: {
        config?: unknown;
        clock?: () => Date;
        admission?: CompanyAdmission;
    } = {}) {
        this.config = resolveOptimizationConfig(options.config ?? company.factory.resources.config.optimization ?? {});
        this.clock = options.clock ?? (() => new Date());
    }
    private enabled() {
        if (!this.config.enabled || !this.company.config.enabled || !this.company.store.get('company', 'operating-model')?.body.config.enabled || !this.company.factory.resources.config.enabled)
            throw Error('Optimization / Company / Factory disabled');
    }
    private permit(action: string, productId: string | null, capitalCents = 0) {
        this.enabled();
        const r = this.options.admission?.({ action, productId, capitalCents, externalExecution: false });
        if (!r?.allowed)
            throw Error('Optimization policy denied: ' + (r?.reason ?? 'Admission unavailable'));
    }
    private owns(p: string) {
        if (!this.company.factory.portfolio.get(p))
            throw Error('Unknown/foreign optimization product');
    }
    private provenance(body: {
        evidenceIds: string[];
        assumptionIds?: string[];
        confidence?: number;
    }) {
        for (const id of body.evidenceIds)
            this.company.evidence.require(id);
        for (const key of body.assumptionIds ?? [])
            if (!this.company.store.get('assumption', key))
                throw Error('Unknown optimization assumption');
        if (body.confidence !== undefined && (!Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 1))
            throw Error('Invalid optimization confidence');
    }
    private freshConfidence(ids: string[], given: number) {
        const e = ids.map(id => this.company.evidence.require(id)), fresh = e.filter(x => this.company.evidence.effectiveLevel(x, this.clock()) !== null), level = Math.max(-1, ...fresh.map(x => x.company!.level)), relevant = fresh.filter(x => x.company!.level === level);
        const refutes = relevant.filter(x => x.provenance.relation === 'refutes').length;
        return Math.min(given, ...e.map(x => x.provenance.reliability), e.length ? 1 : 0) * (fresh.length === e.length ? 1 : .25) * (refutes ? 1 / (refutes + 1) : 1);
    }
    private append<K extends OptimizationKind>(kind: K, key: string, body: CompanyEntityMap[K], revision?: number): CompanyRecord<K> {
        canonical(body);
        return this.company.store.append(kind, key, body, revision ?? this.company.store.get(kind, key)?.revision ?? 0, this.clock());
    }
    report(key: string) {
        this.enabled();
        const r = this.company.store.get('analyticsReport', key);
        if (!r)
            throw Error('Analytics report required');
        if (r.body.scope.productIds.length !== 1)
            throw Error('Product-scoped optimization report required');
        this.owns(r.body.scope.productIds[0]);
        return r;
    }
    private reportFresh(r: AnalyticsReport) {
        return !r.quality.stale && this.clock().getTime() - Date.parse(r.asOf) <= r.calculationConfig.freshnessMs && r.quality.confidence >= this.config.minConfidence;
    }
    private observed(r: AnalyticsReport) {
        return r.scope.nature === 'OBSERVED' || r.scope.nature === 'CALCULATED_FROM_OBSERVED';
    }
    private range(r: Range) {
        if (!Number.isFinite(r.low) || !Number.isFinite(r.high) || r.low > r.high || r.confidence < 0 || r.confidence > 1 || !Number.isFinite(r.confidence) || !r.unit.trim())
            throw Error('Invalid optimization range');
        this.provenance(r);
    }
    initializeCapabilities() {
        this.permit('REGISTER_CAPABILITIES', null);
        return PRODUCT_SURFACES.map(s => this.company.store.get('builderSurfaceCapability', s) ?? this.append('builderSurfaceCapability', s, initialSurfaceCapability(s, this.clock().toISOString())));
    }
    capabilitiesFromAcceptance(surface:BuilderSurfaceCapability['surface'],environment:SurfaceEnvironment) {
        this.permit('REGISTER_CAPABILITY',null);validateSurface(surface);
        const builds=new BuildStore(this.company.store.db,this.company.factory.creatorAddress);
        const owned=this.company.store.list('surfaceReceipt').filter(r=>r.body.binding.surface===surface);
        for(const r of owned){const p=this.company.store.get('surfacePlan',r.body.plan.key,r.body.plan.revision),b=builds.build(r.body.binding.buildId);if(!p||p.hash!==r.body.plan.hash||!b||b.productId!==r.body.binding.productId||b.briefId!==r.body.binding.briefId)throw Error('Owned exact surface acceptance required');validateSurfaceReceipt(r.body,p.body);}
        const old=this.company.store.get('builderSurfaceCapability',surface),base=old?.body??initialSurfaceCapability(surface,this.clock().toISOString());
        const mandatory=acceptanceProfile(surface).mandatory;
        const granular=Object.fromEntries([...new Set([...mandatory,...acceptanceProfile(surface).optional])].map(capability=>{const derived=deriveSurfaceExecutionCapability(surface,capability,owned.map(r=>r.body),environment);return [capability,{status:derived.status,state:derived.state,receiptRefs:owned.filter(r=>r.body.observations.some(o=>o.capability===capability)).map(surfaceRef),reason:derived.reason}];}));
        const map:Partial<Record<keyof typeof base.capabilities,SurfaceExecutionCapability>>={generation:'PROJECT_GENERATION',compilation:'COMPILATION',automatedTesting:'UNIT_TEST',runtime:surface==='ANDROID'||surface==='IOS'?'MOBILE_LAUNCH':'RUNTIME_START',interaction:surface==='ANDROID'||surface==='IOS'?'MOBILE_INTERACTION':'BROWSER_INTERACTION',navigation:'BROWSER_NAVIGATION',persistence:'PERSISTENCE',networkBehavior:'NETWORK_BEHAVIOR',packaging:'PACKAGE',signing:'SIGNING_READINESS'};
        const capabilities={...base.capabilities};for(const [legacy,c] of Object.entries(map)){const g=granular[c!];if(g&&(owned.some(r=>r.body.observations.some(o=>o.capability===c))||g.status==='BLOCKED'&&['MOBILE_LAUNCH','MOBILE_INTERACTION'].includes(c!)))capabilities[legacy as keyof typeof capabilities]={status:g.status,proof:null};}
        const status=mandatory.every(c=>granular[c].status==='SUPPORTED')?'SUPPORTED':mandatory.some(c=>['SUPPORTED','EXPERIMENTAL'].includes(granular[c].status))?'PARTIALLY_SUPPORTED':owned.length?'BLOCKED':base.status;
        return this.append('builderSurfaceCapability',surface,{...base,status,capabilities,acceptanceEvidence:granular,verifiedAt:this.clock().toISOString(),changeReason:'Derived from owned immutable surface acceptance; strategy unchanged',limitations:[...base.limitations,'Capability-specific technical evidence; no commercial or arbitrary-model claims']});
    }
    capability(input: BuilderSurfaceCapability, actor: CompanyActor = 'BUILDER') {
        this.permit('REGISTER_CAPABILITY', null);
        if(input.acceptanceEvidence)throw Error('Use capabilitiesFromAcceptance for granular receipt evidence');
        if (!['SUPPORTED', 'PARTIALLY_SUPPORTED', 'EXPERIMENTAL', 'NOT_IMPLEMENTED', 'BLOCKED'].includes(input.status))
            throw Error('Invalid overall capability');
        if (!['BUILDER', 'CREATOR'].includes(actor))
            throw Error('Builder owns capability acceptance');
        validateSurface(input.surface);
        for (const c of SURFACE_CAPABILITIES) {
            const v = input.capabilities[c];
            if (!v || !['SUPPORTED', 'PARTIALLY_SUPPORTED', 'EXPERIMENTAL', 'NOT_IMPLEMENTED', 'BLOCKED'].includes(v.status))
                throw Error('Incomplete capability registry');
            if (v.status === 'SUPPORTED') {
                const proof = v.proof;
                if (!proof || proof.surface !== input.surface || proof.execution !== 'real' || !['API_SERVICE', 'WEB_APP', 'WEB_SAAS'].includes(proof.surface))
                    throw Error('Real surface-specific acceptance required; mobile capability NOT_IMPLEMENTED');
                const b = new BuildStore(this.company.store.db, this.company.factory.creatorAddress).build(proof.buildId), a = b?.model?.attempts.at(-1);
                if (b?.model?.status !== 'PASS' || !a || !['compilation', 'automatedTesting', 'runtime', 'persistence', 'networkBehavior', 'packaging'].includes(c) || !a.checks.some(x => x.id === 'model:integration' && x.passed) || !b.validation?.passed)
                    throw Error('Capability not demonstrated by validated Builder');
                if (c === 'runtime' && (!b.model?.architectures.at(-1)?.runtime || !a.acceptance?.some(e => e.transport === 'http' && e.execution === 'real' && e.passed)))
                    throw Error('Real HTTP runtime proof required for HTTP surface');
                if (c === 'persistence' && (!a.acceptance?.some(x => x.probeId === proof.probeId && x.passed && x.execution === 'real') || new BuildStore(this.company.store.db, this.company.factory.creatorAddress).brief(b.briefId)?.content.acceptanceProbes?.find(p => p.id === proof.probeId)?.kind !== 'persistence'))
                    throw Error('Persistence execution proof required');
            }
        }
        if (input.status === 'SUPPORTED' && SURFACE_CAPABILITIES.some(c => input.capabilities[c].status !== 'SUPPORTED'))
            throw Error('Surface cannot claim full support without complete acceptance');
        return this.append('builderSurfaceCapability', input.surface, input);
    }
    benchmark(key: string, input: MarketFormatBenchmark) {
        this.permit('MARKET_FORMAT_RESEARCH', null);
        this.provenance(input);
        if (input.copyingPermitted !== false || this.company.store.db.productFactory.getDiscoveryOpportunity(input.opportunityId)?.discovery.creatorAddress !== this.company.factory.creatorAddress || !input.observations.length)
            throw Error('Invalid benchmark / copying forbidden');
        for (const o of input.observations) {
            validateSurface(o.surface);
            if (!o.sourceRefs.length || !o.evidenceIds.length || !Number.isFinite(Date.parse(o.capturedAt)) || !Number.isFinite(Date.parse(o.expiresAt)) || Date.parse(o.expiresAt) <= Date.parse(o.capturedAt) || Date.parse(o.capturedAt) > this.clock().getTime())
                throw Error('Benchmark provenance required');
            this.provenance(o);
            if (o.pricing)
                this.range(o.pricing);
        }
        return this.append('surfaceBenchmark', key, input);
    }
    surface(key: string, input: {
        productId: string | null;
        opportunityId: string;
        benchmarkKey: string;
        factors: SurfaceFactor[];
        alternatives: SurfaceAssessment[];
        evidenceIds: string[];
        assumptionIds: string[];
        riskKeys: string[];
        rationale: string;
        confidence: number;
        changeReason: string;
        preferred?: 'ANDROID' | 'IOS' | 'WEB_SAAS' | 'MULTI_SURFACE';
        secondarySurfaces?: ProductSurfaceDecision['secondarySurfaces'];
    }) {
        this.permit('SURFACE_DECISION', input.productId);
        if (input.productId)
            this.owns(input.productId);
        this.provenance(input);
        const b = this.company.store.get('surfaceBenchmark', input.benchmarkKey);
        if (!b || b.body.opportunityId !== input.opportunityId)
            throw Error('Matching market benchmark required');
        const factors = input.factors.map(f => {
            this.provenance(f);
            return { ...f, confidence: this.freshConfidence(f.evidenceIds, f.confidence) };
        }).filter(f => !input.factors.some(other => other.name === f.name && Math.max(-1, ...other.evidenceIds.map(id => this.company.evidence.effectiveLevel(this.company.evidence.require(id), this.clock()) ?? -1)) > Math.max(-1, ...f.evidenceIds.map(id => this.company.evidence.effectiveLevel(this.company.evidence.require(id), this.clock()) ?? -1))));
        for (const a of input.alternatives) {
            validateSurface(a.surface);
            this.range(a.effortHours);
            this.range(a.validationCost);
            if (a.expectedContribution)
                this.range(a.expectedContribution);
            if (a.maintenanceCost)
                this.range(a.maintenanceCost);
            this.provenance(a);
        }
        const r = reasonAboutSurface(factors, b.body, input.alternatives), reasons = [...r.reasons];
        let long = r.longTerm;
        if (input.preferred) {
            validateSurface(input.preferred);
            if (!input.changeReason.trim() || !input.evidenceIds.length)
                throw Error('Explicit surface rationale/evidence required');
            if (input.preferred === 'MULTI_SURFACE' && (!(input.secondarySurfaces?.length) || !factors.some(f => f.name === 'multi_surface_value' && f.value === true && f.confidence >= .5)))
                throw Error('MULTI_SURFACE needs distinct proven workflows and incremental value');
            long = input.preferred;
            reasons.push('Entrepreneur explicit alternative: ' + input.changeReason);
        }
        if (!input.changeReason.trim())
            throw Error('Surface version change reason required');
        const risks = input.riskKeys.map(k => this.company.store.get('risk', k));
        if (risks.some(x => !x))
            throw Error('Unknown platform risk');
        const confidence = this.freshConfidence(input.evidenceIds, input.confidence) * (risks.some(x => x!.body.status === 'open' && x!.body.impact !== 'low') ? .5 : 1);
        const old = this.company.store.get('productSurfaceDecision', key);
        const content = { ...input, benchmarkRef: optimizationRef(b), factors, primarySurface: long, secondarySurfaces: input.secondarySurfaces ?? [], longTermSurface: long, validationSurface: r.validation === r.longTerm ? long : r.validation, capabilityStatus: this.company.store.get('builderSurfaceCapability', long)?.body.status ?? 'NOT_IMPLEMENTED', validationCapabilityStatus: this.company.store.get('builderSurfaceCapability', r.validation === r.longTerm ? long : r.validation)?.body.status ?? 'NOT_IMPLEMENTED', reasons, unverifiedHypotheses: r.hypotheses, confidence };
        if (old && canonical({ ...old.body, decisionId: '' }) === canonical({ ...content, decisionId: '' }))
            return old;
        const d = this.company.decide(`surface:${key}:${(old?.revision ?? 0) + 1}`, 'SURFACE_RECOMMENDATION', input.rationale, { productId: input.productId, opportunityId: input.opportunityId, evidenceIds: input.evidenceIds, assumptionIds: input.assumptionIds, inputs: JSON.parse(canonical(content)), versions: { [`benchmark:${b.key}`]: b.revision }, alternatives: input.alternatives.map(a => a.surface) });
        return this.append('productSurfaceDecision', key, { ...content, decisionId: d.id });
    }
    attachContract(contractKey: string, surfaceKey: string) {
        this.enabled();
        const c = this.company.store.get('contract', contractKey), s = this.company.store.get('productSurfaceDecision', surfaceKey);
        if (!c || !s || s.body.productId !== c.body.productId || s.body.opportunityId !== c.body.opportunityId)
            throw Error('Contract/surface scope mismatch');
        return this.company.createContract(contractKey, { ...c.body, status: 'draft', surfaceDecision: optimizationRef(s), changeReason: 'Surface decision ' + s.key + ' revision ' + s.revision }, 'ENTREPRENEUR', c.revision);
    }
    monetization(key: string, input: Omit<MonetizationDecision, 'decisionId'>) {
        this.permit('MONETIZATION_HYPOTHESIS', input.productId);
        this.owns(input.productId);
        this.provenance(input);
        if (!MONETIZATION_FORMATS.includes(input.format))
            throw Error('Unknown monetization format');
        if (input.format.startsWith('SUBSCRIPTION') && !input.recurringValue?.trim())
            throw Error('Recurring value required');
        if (!['UNKNOWN', 'HYPOTHESIS', 'EVIDENCE_SUPPORTED'].includes(input.purchaseTrust))
            throw Error('Invalid purchase trust');
        if (input.storeEconomics) {
            this.provenance(input.storeEconomics);
            if (Date.parse(input.storeEconomics.expiresAt) <= this.clock().getTime() || !Number.isFinite(Date.parse(input.storeEconomics.expiresAt)))
                throw Error('Store economics stale');
        }
        if (input.price)
            this.range(input.price);
        if (input.storeEconomics?.fee)
            this.range(input.storeEconomics.fee);
        const supported = input.trustEvidenceIds.some(id => {
            const e = this.company.evidence.require(id);
            return e.provenance.relation === 'supports' && (this.company.evidence.effectiveLevel(e, this.clock()) ?? -1) >= 3;
        });
        if (input.purchaseTrust === 'EVIDENCE_SUPPORTED' && !supported)
            throw Error('Purchase trust is unproven hypothesis');
        const old = this.company.store.get('optimizationMonetization', key), d = this.company.decide(`monetization:${key}:${(old?.revision ?? 0) + 1}`, 'MONETIZATION_HYPOTHESIS', input.rationale, { productId: input.productId, evidenceIds: input.evidenceIds, inputs: JSON.parse(canonical(input)) });
        return this.append('optimizationMonetization', key, { ...input, decisionId: d.id });
    }
    identify(key: string, reportKey: string, options: {
        funnelKey?: string;
        comparisonKey?: string;
        retentionMinimum?: number;
        evidenceIds?: string[];
    } = {}) {
        const r = this.report(reportKey), p = r.body.scope.productIds[0];
        this.permit('IDENTIFY_OPTIMIZATION', p);
        let kind: CompanyEntityMap['optimizationOpportunity']['class'] = 'PRODUCT_VALUE', metric = 'contribution', problem = 'Investigate the strongest measured value uncertainty';
        const health = this.company.store.get('health', p)?.body, prior = options.comparisonKey ? this.report(options.comparisonKey) : null;
        if (prior)
            comparable(r.body, prior.body);
        if (health?.status === 'critical') {
            kind = 'RELIABILITY';
            metric = 'errorRate';
            problem = 'Critical Product Health requires PROTECT before growth';
        }
        else if (r.body.metrics.contribution?.value !== null && (r.body.metrics.contribution.value! < 0 || prior && r.body.metrics.grossRevenue.value! > prior.body.metrics.grossRevenue.value! && r.body.metrics.contribution.value! < prior.body.metrics.contribution.value!)) {
            kind = 'COST';
            problem = 'Revenue does not establish healthy economics; contribution deteriorates';
        }
        else if (options.funnelKey) {
            const f = this.company.store.get('analyticsFunnel', options.funnelKey);
            if (!f || f.body.reportKey !== r.key || f.body.reportRevision !== r.revision)
                throw Error('Exact funnel/report lineage required');
            const bottleneck = f.body.bottlenecks[0];
            if (bottleneck) {
                kind = /activ/i.test(bottleneck.stage) ? 'ACTIVATION' : 'CONVERSION';
                metric = kind === 'ACTIVATION' ? 'activation' : 'conversion';
                problem = bottleneck.reason;
            }
        }
        else if (options.retentionMinimum !== undefined && r.body.metrics.retention?.value !== null && r.body.metrics.retention?.value < options.retentionMinimum) {
            kind = 'RETENTION';
            metric = 'retention';
            problem = 'Retention below the declared product requirement';
        }
        const baseline = r.body.metrics[metric] ?? { value: null, unit: 'unknown', nature: 'UNKNOWN' as const, evidenceIds: [], confidence: 0, eventIds: [], sourceIds: [], reason: 'Relevant metric unavailable' };
        const snapshot = this.company.store.list('economicSnapshot').find(s => s.body.analytics?.hash === r.hash);
        const proofMetric = snapshot?.body.metrics[metric as keyof typeof snapshot.body.metrics] ?? snapshot?.body.unitEconomics[metric];
        const ids = options.evidenceIds ?? proofMetric?.evidenceIds ?? baseline.evidenceIds;
        this.provenance({ evidenceIds: ids });
        return this.append('optimizationOpportunity', key, { productId: p, class: kind, problem, reportRef: optimizationRef(r), metric, baseline, mechanism: 'Candidate diagnosis, not a causal conclusion', expectedUpside: null, dependencies: [], measurementPlan: 'Frozen canonical metric definitions with guardrails and explicit population', causal: false, evidenceIds: ids, assumptionIds: [], rationale: problem, confidence: Math.min(baseline.confidence, r.body.quality.confidence, this.freshConfidence(ids, 1)) * (this.reportFresh(r.body) ? 1 : .25) });
    }
    mechanisms(opportunityKey: string) {
        this.enabled();
        const o = this.company.store.get('optimizationOpportunity', opportunityKey);
        if (!o)
            throw Error('Optimization opportunity required');
        return interventionMechanisms(o.body.class);
    }
    intervention(key: string, input: Intervention) {
        this.permit('PROPOSE_INTERVENTION', input.productId, input.capitalCents);
        this.owns(input.productId);
        this.provenance(input);
        const opportunity = this.company.store.get('optimizationOpportunity', input.opportunityKey);
        if (!opportunity || opportunity.body.productId !== input.productId || !OPTIMIZATION_CLASSES.includes(input.class) || !AUTONOMY_LEVELS.includes(input.autonomy))
            throw Error('Unknown opportunity/class/autonomy');
        for (const n of [input.capitalCents, input.computeUnits, input.inferenceCents, input.durationMs, input.downsideCents])
            if (!Number.isSafeInteger(n) || n < 0)
                throw Error('Invalid intervention resource estimate');
        if (!Number.isFinite(input.builderHours) || input.builderHours < 0)
            throw Error('Invalid Builder hours');
        if (!['RESEARCH', 'PRIVATE_ARTIFACT_PROBE', 'EXTERNAL_COMMERCIAL'].includes(input.execution) || !input.measurement.population.trim() || !input.measurement.primaryMetric.trim() || !input.measurement.metricDefinitions.length || !input.measurement.guardrails.length || !input.measurement.stopConditions.length)
            throw Error('Frozen meaningful experiment protocol required');
        for (const k of input.criticalAssumptionIds)
            if (!this.company.store.get('assumption', k))
                throw Error('Unknown critical assumption');
        for (const k of input.riskKeys)
            if (!this.company.store.get('risk', k))
                throw Error('Unknown intervention risk');
        if (input.informationValue)
            this.range(input.informationValue);
        if (input.expectedContribution)
            this.range(input.expectedContribution);
        for (const m of input.measurement.metricDefinitions)
            if (!this.company.store.get('metricDefinition', m.key, m.revision))
                throw Error('Canonical metric definition required');
        if (input.expectedContribution && input.expectedContribution.unit !== `${this.company.config.currency}:cents`)
            throw Error('Contribution currency mismatch');
        if (!Number.isFinite(Date.parse(input.measurement.period.start)) || Date.parse(input.measurement.period.start) >= Date.parse(input.measurement.period.end))
            throw Error('Invalid experiment period');
        return this.append('optimizationIntervention', key, { ...input, confidence: this.freshConfidence(input.evidenceIds, input.confidence), autonomy: ethicalIntervention(input) ? input.execution === 'EXTERNAL_COMMERCIAL' ? 'OWNER_APPROVAL_REQUIRED' : input.autonomy : 'PROHIBITED' });
    }
    capacity(): OptimizationCapacity {
        const c = this.config, db = this.company.store.db, alloc = this.company.store.list('allocation').filter(a => a.body.status !== 'released'), spent = (db.raw.prepare('SELECT COALESCE(SUM(actual_cost_cents),0) n FROM task_graph WHERE product_id IS NOT NULL').get() as {
            n: number;
        }).n;
        return { capitalCents: Math.max(0, Math.min(c.maxExperimentCostCents, this.company.config.maxCapitalCents, this.company.factory.resources.config.operationalBudgetCents) - spent - alloc.reduce((s, a) => s + a.body.capitalCents, 0)), builderHours: Math.max(0, Math.min(c.maxExperimentBuilderHours, this.company.config.maxBuilderHours - alloc.reduce((s, a) => s + a.body.builderHours, 0))), computeUnits: Math.max(0, Math.min(c.maxExperimentComputeUnits, this.company.config.maxComputeUnits - alloc.reduce((s, a) => s + a.body.computeUnits, 0))), inferenceCents: Math.max(0, Math.min(c.maxExperimentInferenceCents, this.company.factory.resources.config.resources.inferenceBudgetCents - spent)), durationMs: c.maxExperimentDurationMs };
    }
    select(key: string, opportunityKey: string, candidateKeys: string[]) {
        this.enabled();
        if (candidateKeys.length > this.config.maxCandidates || new Set(candidateKeys).size !== candidateKeys.length)
            throw Error('Bounded distinct candidates required');
        const o = this.company.store.get('optimizationOpportunity', opportunityKey);
        if (!o)
            throw Error('Unknown optimization opportunity');
        this.permit('SELECT_EXPERIMENT', o.body.productId);
        const candidates = candidateKeys.map(k => {
            const r = this.company.store.get('optimizationIntervention', k);
            if (!r || r.body.opportunityKey !== opportunityKey || r.body.productId !== o.body.productId)
                throw Error('Candidate scope mismatch');
            return r;
        });
        if (new Set(candidates.map(c => c.body.mechanism.toLowerCase().replace(/\s+/g, ' ').trim())).size !== candidates.length)
            throw Error('Materially distinct interventions required');
        const old = this.company.store.get('optimizationSelection', key);
        if (old) {
            if (old.body.opportunityKey !== opportunityKey || canonical(old.body.candidateRefs) !== canonical(candidates.map(optimizationRef)))
                throw Error('Selection idempotency inputs changed');
            return old;
        }
        const opportunityReport = this.company.store.get('analyticsReport', o.body.reportRef.key, o.body.reportRef.revision);
        const currentCandidates = candidates.map(c => ({ ...c, body: { ...c.body, confidence: Math.min(this.freshConfidence(c.body.evidenceIds, c.body.confidence), opportunityReport && this.reportFresh(opportunityReport.body) && c.body.dependencies.every(id => getTaskById(this.company.store.db.raw, id)?.status === 'completed') && c.body.criticalAssumptionIds.every(id => {
                    const a = this.company.store.get('assumption', id)?.body;
                    return a?.status === 'valid' && Date.parse(a.expiresAt) > this.clock().getTime();
                }) && !c.body.riskKeys.some(id => {
                    const r = this.company.store.get('risk', id)?.body;
                    return r?.status === 'open' && r.impact === 'critical';
                }) ? 1 : 0) } }));
        const ranked = selectValuableExperiment(currentCandidates, this.capacity(), this.config.minConfidence), selected = candidates.find(x => x.key === ranked.selected), d = this.company.decide(`optimization-select:${key}`, selected ? 'EXPERIMENT' : 'HOLD', ranked.reasons.join('; '), { productId: o.body.productId, evidenceIds: o.body.evidenceIds, inputs: JSON.parse(canonical({ opportunityRef: optimizationRef(o), candidateRefs: candidates.map(optimizationRef), ranking: ranked })), alternatives: candidateKeys });
        const experimentKey = selected && d.company?.policy.allowed ? `optimization:${key}` : null;
        if (experimentKey) {
            const i = selected!.body;
            this.company.experiment(experimentKey, { productId: i.productId, statement: i.uncertainty, success: i.measurement.primaryMetric, failure: 'Primary or guardrail failure', stop: i.measurement.stopConditions.join('; '), metricDefinitions: i.measurement.metricDefinitions, evidenceIds: i.evidenceIds });
        }
        return this.append('optimizationSelection', key, { opportunityKey, candidateRefs: candidates.map(optimizationRef), selected: experimentKey ? optimizationRef(selected!) : null, reasons: ranked.reasons, alternatives: ranked.rows, decisionId: d.id, companyExperimentKey: experimentKey, taskId: null, approvalId: null, status: 'RECOMMENDATION' });
    }
    outcome(key: string, selectionKey: string, requested: OptimizationOutcome, resultKey: string | null, hindsight: string) {
        const s = this.company.store.get('optimizationSelection', selectionKey);
        if (!s?.body.selected)
            throw Error('Selected experiment required');
        const i = this.company.store.get('optimizationIntervention', s.body.selected.key, s.body.selected.revision)!, o = this.company.store.get('optimizationOpportunity', s.body.opportunityKey)!, result = resultKey ? this.company.store.get('analyticsExperiment', resultKey) : null;
        this.permit('OPTIMIZATION_DECISION', i.body.productId);
        if (resultKey && (!result || this.company.store.get('analyticsExperimentProtocol', result.body.protocolKey, result.body.protocolRevision)?.body.companyExperimentKey !== s.body.companyExperimentKey))
            throw Error('Exact selected experiment analytics required');
        if (!['ADOPT', 'ITERATE', 'RETEST', 'ROLL_BACK', 'HOLD', 'REJECT', 'SCALE_CANDIDATE', 'PIVOT'].includes(requested))
            throw Error('Invalid optimization outcome');
        if (result) {
            const protocol = this.company.store.get('analyticsExperimentProtocol', result.body.protocolKey, result.body.protocolRevision)!.body;
            if (protocol.primaryEvent !== i.body.measurement.primaryMetric || canonical(protocol.period) !== canonical(i.body.measurement.period) || canonical(protocol.guardrails.map(g => g.eventName).sort()) !== canonical([...i.body.measurement.guardrails].sort()))
                throw Error('Frozen primary metric, population period and guardrails mismatch');
        }
        const report = result ? this.report(result.body.reportKey) : null;
        if (result && report?.revision !== result.body.reportRevision)
            throw Error('Experiment analytics report changed; retest');
        const r = guardedOptimizationOutcome(requested, result?.body ?? null, !!report && this.observed(report.body) && this.reportFresh(report.body) && result!.body.confidence >= this.config.minConfidence, this.company.store.get('health', i.body.productId)?.body.status);
        const d = this.company.decide(`optimization-outcome:${key}`, r.outcome, r.reasons.join('; '), { productId: i.body.productId, evidenceIds: i.body.evidenceIds, inputs: JSON.parse(canonical({ selection: optimizationRef(s), baseline: o.body.baseline, result: result?.body ?? null, expected: i.body.expectedContribution, hindsight })), alternatives: s.body.candidateRefs.map(x => x.key), versions: { [`selection:${s.key}`]: s.revision } });
        return this.append('optimizationDecision', key, { selectionRef: optimizationRef(s), analyticsResultRef: result ? optimizationRef(result) : null, requestedOutcome: requested, outcome: d.company?.policy.allowed ? r.outcome : 'HOLD', reasons: r.reasons, decisionId: d.id, baseline: o.body.baseline, expectedEffect: i.body.expectedContribution, actualResult: result?.body ?? null, hindsight, executionAuthorized: false });
    }
    capital(key: string, proposalKeys: string[], reportKeys: string[], targetKey: string | null = null) {
        this.permit('COMPARE_OPTIMIZATION_CAPITAL', null);
        if (proposalKeys.length > this.config.maxCandidates || new Set(proposalKeys).size !== proposalKeys.length || new Set(reportKeys).size !== reportKeys.length)
            throw Error('Bounded distinct capital alternatives required');
        const reports = reportKeys.map(k => this.report(k));
        if (reports.some(r => r.body.scope.currency !== this.company.config.currency || canonical(r.body.scope.period) !== canonical(reports[0].body.scope.period)))
            throw Error('Comparable capital report currency/period required');
        if (targetKey && !this.company.store.get('target', targetKey))
            throw Error('Owner Target required');
        const proposals = proposalKeys.map(k => {
            const r = this.company.store.get('proposal', k);
            if (!r)
                throw Error('Capital proposal required');
            return r;
        });
        const rows = this.company.capitalComparisons(proposalKeys).map(r => {
            const p = proposals.find(x => x.key === r.key)!;
            const scoped = reports.filter(x => x.body.scope.productIds[0] === p.body.productId);
            const refs = p.body.optimization?.reportRefs;
            const bound = refs?.length ? refs : undefined;
            if (scoped.length > 1 && !bound)
                throw Error('Ambiguous product/channel reports; exact proposal report binding required');
            if (bound && (bound.length !== 1 || !scoped.some(x => x.hash === bound[0].hash && x.key === bound[0].key && x.revision === bound[0].revision)))
                throw Error('Exact capital analytics binding required');
            const report = bound ? scoped.find(x => x.hash === bound[0].hash) : scoped[0];
            let eligible = r.eligible, confidence = this.freshConfidence(p.body.evidenceIds, r.confidence), reasons = [r.reason];
            let basis: 'OBSERVED_BASELINE' | 'ESTIMATED_OPTION' | 'UNKNOWN' = 'OBSERVED_BASELINE';
            const optionVersions: Record<string, number> = {};
            if (!report) {
                const business = this.company.store.list('businessCase').find(b => b.body.opportunityId === p.body.opportunityId);
                const experiment = business?.body.experiments.find(e => e.key === p.key && e.costCents === p.body.capitalCents && e.builderHours === p.body.builderHours && e.informationValue.low > 0);
                const staged = ['RESEARCH', 'VALIDATION'].includes(p.body.action) && !!experiment && p.body.reversibility === 'EASILY_REVERSIBLE' && p.body.capitalCents <= this.config.maxExperimentCostCents && p.body.builderHours <= this.config.maxExperimentBuilderHours;
                const contract = this.company.store.list('contract').find(c => c.body.productId === p.body.productId && c.body.opportunityId === p.body.opportunityId && c.body.status === 'approved');
                const surface = contract?.body.surfaceDecision && this.company.store.get('productSurfaceDecision', contract.body.surfaceDecision.key, contract.body.surfaceDecision.revision);
                const greenlit = p.body.action === 'BUILD' && !!contract && !!business && contract.body.businessCaseKey === business.key && contract.body.businessCaseRevision === business.revision && !!business.body.servingCost && !!business.body.pricing.price && !!surface && surface.hash === contract!.body.surfaceDecision!.hash && ['WEB_APP', 'WEB_SAAS', 'API_SERVICE'].includes(surface.body.validationSurface) && !['NOT_IMPLEMENTED', 'BLOCKED'].includes(this.company.store.get('builderSurfaceCapability', surface.body.validationSurface)?.body.status ?? 'NOT_IMPLEMENTED');
                if ((staged || greenlit) && p.body.evidenceIds.some(id => (this.company.evidence.effectiveLevel(this.company.evidence.require(id), this.clock()) ?? -1) >= 2)) {
                    basis = 'ESTIMATED_OPTION';
                    confidence = Math.min(confidence, .5);
                    optionVersions[`businessCase:${business!.key}`] = business!.revision;
                    if (greenlit)
                        optionVersions[`contract:${contract!.key}`] = contract!.revision;
                    reasons.push('Bounded reversible information option / approved new Product Contract; future economics are estimates, not observed profit');
                }
                else {
                    eligible = false;
                    basis = 'UNKNOWN';
                    reasons.push('No observed baseline or governed bounded information/new-product option; HOLD preserves UNKNOWN');
                }
            }
            else if (!this.reportFresh(report.body) || !this.observed(report.body) || report.body.metrics.contribution.value === null) {
                eligible = false;
                basis = 'UNKNOWN';
                reasons.push('Observed baseline stale/synthetic/incomplete; do not replace known missing costs with estimates');
            }
            const inferenceCents = p.body.optimization?.inferenceCents ?? null, durationMs = p.body.optimization?.durationMs ?? null;
            if ([inferenceCents, durationMs].some(n => n !== null && (!Number.isSafeInteger(n) || n < 0)))
                throw Error('Invalid capital inference/time estimate');
            if (inferenceCents !== null && (inferenceCents > p.body.capitalCents || inferenceCents > Math.max(0, this.company.factory.resources.config.resources.inferenceBudgetCents - (this.company.store.db.raw.prepare('SELECT COALESCE(SUM(actual_cost_cents),0) n FROM task_graph WHERE product_id IS NOT NULL').get() as {
                n: number;
            }).n - this.company.store.list('allocation').filter(a => a.body.status !== 'released').reduce((sum, a) => sum + a.body.capitalCents, 0)))) {
                eligible = false;
                reasons.push('Inference requirement exceeds declared operating capital/capacity');
            }
            const unit = report && this.company.store.list('analyticsUnits').find(u => u.body.reportKey === report.key && u.body.reportRevision === report.revision);
            if (p.body.action === 'SCALE' && report && !this.scaleReadiness(`capital-scale:${key}:${p.key}`, report.key).body.ready) {
                eligible = false;
                reasons.push('Mandatory scale readiness/Contract quality not satisfied');
            }
            if (p.body.action === 'SCALE' && (unit?.body.marginal.saturationCandidate || !p.body.marginalContribution || p.body.marginalContribution.low <= 0)) {
                eligible = false;
                reasons.push('Marginal return/saturation does not justify scaling');
            }
            if (p.body.expectedProfit.unit !== `${this.company.config.currency}:cents` || p.body.marginalContribution && p.body.marginalContribution.unit !== p.body.expectedProfit.unit)
                throw Error('Capital contribution currency mismatch');
            if (confidence < this.config.minConfidence) {
                eligible = false;
                reasons.push('Fresh confidence/contradictions insufficient');
            }
            const expected = (p.body.marginalContribution ?? p.body.expectedProfit).low * p.body.successProbability.low * confidence - p.body.downsideCents;
            if (expected <= 0)
                eligible = false;
            return { key: r.key, eligible, inferenceCents, durationMs, customerValue: p.body.optimization?.customerValue ?? 'UNKNOWN / legacy proposal; strategic rationale in original proposal', basis, optionVersions, priority: r.priority, expectedMarginalProfit: expected, returnOnBuilderHour: p.body.builderHours ? expected / p.body.builderHours : null, capitalCents: r.capitalCents, builderHours: r.builderHours, computeUnits: r.computeUnits, confidence, reasons };
        }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.priority === 'PROTECT') - Number(a.priority === 'PROTECT') || (b.returnOnBuilderHour ?? -Infinity) - (a.returnOnBuilderHour ?? -Infinity) || (b.expectedMarginalProfit ?? -Infinity) - (a.expectedMarginalProfit ?? -Infinity) || a.capitalCents - b.capitalCents || a.key.localeCompare(b.key));
        const selected = rows.find(r => r.eligible)?.key ?? null;
        const p = proposals.find(r => r.key === selected);
        const d = this.company.decide(`optimization-capital:${key}`, selected ? 'ALLOCATE' : 'HOLD', 'Marginal durable economics, scarce Builder capacity and alternatives; target is not a safety override', { productId: p?.body.productId ?? null, evidenceIds: p?.body.evidenceIds ?? [], capitalCents: p?.body.capitalCents ?? 0, versions: p ? { [`proposal:${p.key}`]: p.revision, ...rows.find(r => r.key === p.key)!.optionVersions } : {}, inputs: JSON.parse(canonical({ rows, reportRefs: reports.map(optimizationRef), targetKey })), alternatives: proposalKeys });
        return this.append('optimizationCapital', key, { proposalRefs: proposals.map(optimizationRef), rows, selected: d.company?.policy.allowed ? selected : null, holdAllowed: true, decisionId: d.id, reportRefs: reports.map(optimizationRef), objective: 'durable-contribution-customer-value', targetKey });
    }
    /** Local capital commitment requests reuse the existing creator approval workflow. */
    requestCapitalAllocation(key: string, comparisonKey: string) {
        this.permit('REQUEST_OPTIMIZATION_CAPITAL', null);
        const comparison = this.company.store.get('optimizationCapital', comparisonKey);
        if (!comparison?.body.selected || !comparison.body.decisionId)
            throw Error('Eligible governed capital comparison required');
        const ref = comparison.body.proposalRefs.find(r => r.key === comparison.body.selected)!;
        const proposal = this.company.store.get('proposal', ref.key);
        if (!proposal || proposal.hash !== ref.hash || proposal.revision !== ref.revision)
            throw Error('Capital proposal changed; compare again');
        for (const rr of comparison.body.reportRefs) {
            const report = this.report(rr.key);
            if (report.hash !== rr.hash || !this.reportFresh(report.body))
                throw Error('Capital analytics changed/stale; compare again');
        }
        const decision = this.company.store.db.productFactory.get('decisions', comparison.body.decisionId);
        for (const kind of ['businessCase', 'contract'] as const)
            for (const [versionKey, revision] of Object.entries(decision?.company?.versions ?? {})) {
                if (versionKey.startsWith(kind + ':') && this.company.store.get(kind, versionKey.slice(kind.length + 1))?.revision !== revision)
                    throw Error('Capital option inputs changed; compare again');
            }
        return this.company.requestAllocation(key, ref.key, comparison.body.decisionId);
    }
    scaleReadiness(key: string, reportKey: string) {
        const r = this.report(reportKey), p = r.body.scope.productIds[0];
        this.permit('ASSESS_SCALE', p);
        const contract = this.company.store.list('contract').find(c => c.body.productId === p && c.body.status === 'approved');
        const quality = contract && this.company.store.get('quality', `${contract.key}:${contract.revision}`);
        const retentionRequired = !contract || /subscription|usage|credits|seat|annual|hybrid/.test(contract.body.pricing.model);
        const health = this.company.store.get('health', p)?.body, units = this.company.store.list('analyticsUnits').find(x => x.body.reportKey === r.key && x.body.reportRevision === r.revision), risk = this.company.store.list('risk').filter(x => x.body.affectedProducts.includes(p) && x.body.status === 'open'), requirements = [{ name: 'Contract quality and surface acceptance', passed: !!contract && !!quality && qualityResult(contract.body, quality.body).passed && (!contract.body.surfaceDecision || (() => {
                    const s = this.company.store.get('productSurfaceDecision', contract.body.surfaceDecision!.key, contract.body.surfaceDecision!.revision);
                    return !!s && s.hash === contract.body.surfaceDecision!.hash && ['WEB_APP', 'WEB_SAAS', 'API_SERVICE'].includes(s.body.validationSurface);
                })()), reason: 'Current approved Contract gates and actually executable surface required; no fake mobile/browser acceptance' }, { name: 'observed value and data quality', passed: this.observed(r.body) && this.reportFresh(r.body), reason: 'Real observed/calculated inputs with fresh quality' }, { name: 'product health', passed: health?.status === 'healthy', reason: 'Healthy product required; revenue does not override reliability' }, { name: 'contribution economics', passed: r.body.metrics.contribution.value !== null && r.body.metrics.contribution.value > 0, reason: 'Relevant costs complete and contribution positive' }, { name: 'retention', passed: !retentionRequired || r.body.metrics.retention?.value !== null && r.body.metrics.retention?.value > 0 && r.body.metrics.retention.confidence >= this.config.minConfidence, reason: retentionRequired ? 'Observed retained value with adequate sample' : 'Non-recurring Contract; retention is not a universal subscription requirement' }, { name: 'acquisition repeatability and marginal return', passed: !!units && !units.body.marginal.saturationCandidate && units.body.marginal.recentContributionPerCost !== null && units.body.marginal.recentContributionPerCost > 0, reason: 'Marginal contribution, not historical clicks/customer count' }, { name: 'security/privacy/dependency risk', passed: !risk.some(x => x.body.impact === 'critical'), reason: 'No unresolved critical material dependency/security risk' }, { name: 'operational/support capacity', passed: this.company.factory.resources.leases(true).length < this.company.factory.resources.config.resources.globalConcurrency && health?.factors.support === 'healthy', reason: 'Capacity and support readiness must be evidenced' }].map(x => ({ ...x, required: true, evidenceIds: r.body.metrics.contribution.evidenceIds }));
        return this.append('optimizationScaleReadiness', key, { productId: p, reportRef: optimizationRef(r), requirements, ready: requirements.every(x => x.passed), reasons: requirements.filter(x => !x.passed).map(x => x.reason), executionAuthorized: false });
    }
    portfolio(key: string, reportKey: string, requested: 'SCALE' | 'HOLD' | 'HARVEST' | 'PIVOT' | 'KILL', rationale: string) {
        const r = this.report(reportKey), p = r.body.scope.productIds[0];
        this.permit('PORTFOLIO_OPTIMIZATION', p);
        let outcome = requested;
        const readiness = requested === 'SCALE' ? this.scaleReadiness(`scale:${key}`, reportKey) : null;
        if (requested === 'SCALE' && !readiness!.body.ready)
            outcome = 'HOLD';
        if (requested === 'KILL' && (!this.reportFresh(r.body) || !this.observed(r.body)))
            outcome = 'HOLD';
        const d = this.company.decide(`optimization-portfolio:${key}`, outcome, rationale, { productId: p, evidenceIds: r.body.metrics.profit.evidenceIds, inputs: JSON.parse(canonical({ report: optimizationRef(r), requested, readiness: readiness?.body ?? null, historicalSpendExcluded: true })), versions: { [`report:${r.key}`]: r.revision } });
        if (d.company?.policy.allowed)
            this.company.portfolioState(p, { productId: p, state: outcome, decisionId: d.id, capitalIntensity: outcome === 'HARVEST' ? 'minimal' : 'validation', relationships: [], monitoring: 'normal', reviewCadence: 'weekly', evidenceIds: r.body.metrics.profit.evidenceIds, assumptionIds: [], rationale, confidence: r.body.quality.confidence });
        return d;
    }
    /** Read-only comparison using canonical channel-scoped analytics; no campaign executor. */
    channels(key: string, reportKeys: string[]) {
        this.permit('COMPARE_CHANNEL_INTELLIGENCE', null);
        const reports = reportKeys.map(k => this.report(k));
        if (!reports.length || reports.length > this.config.maxCandidates)
            throw Error('Bounded channel reports required');
        const first = reports[0], productId = first.body.scope.productIds[0];
        if (reports.some(r => r.body.scope.productIds[0] !== productId || r.body.scope.currency !== first.body.scope.currency || canonical(r.body.scope.period) !== canonical(first.body.scope.period) || canonical(r.body.definitionVersions) !== canonical(first.body.definitionVersions) || !r.body.scope.dimensions?.channel) || new Set(reports.map(r => r.body.scope.dimensions!.channel)).size !== reports.length)
            throw Error('Comparable distinct channel scope/definitions required');
        const unknown = (unit: string): AnalyticsReport['metrics'][string] => ({ value: null, unit, nature: 'UNKNOWN', confidence: 0, evidenceIds: [], eventIds: [], sourceIds: [], reason: 'Required canonical channel measure unavailable' });
        const ids = [...new Set(reports.flatMap(r => this.company.store.list('economicSnapshot').find(s => s.body.analytics?.hash === r.hash)?.body.metrics.profit.evidenceIds ?? []))];
        const rows = reports.map(r => {
            const units = this.company.store.list('analyticsUnits').find(u => u.body.reportKey === r.key && u.body.reportRevision === r.revision)?.body;
            const cac = units?.cac ?? r.body.metrics.cac ?? unknown(`${r.body.scope.currency}:cents`), payback = units?.payback ?? r.body.metrics.payback ?? unknown('months'), retention = r.body.metrics.retention ?? unknown('fraction'), contribution = r.body.metrics.contribution;
            const reasons: string[] = [];
            if (!this.reportFresh(r.body) || !this.observed(r.body))
                reasons.push('Fresh observed channel evidence required');
            if (cac.value === null || payback.value === null || retention.value === null)
                reasons.push('Customer quality/CAC/retention/payback unknown; clicks are not success');
            if (contribution.value === null || contribution.value <= 0)
                reasons.push('Complete positive contribution missing');
            if (!units || units.marginal.saturationCandidate || units.marginal.recentContributionPerCost === null || units.marginal.recentContributionPerCost <= 0)
                reasons.push('Positive repeatable marginal return unproven or saturating');
            return { channel: r.body.scope.dimensions!.channel!, reportRef: optimizationRef(r), cac, contribution, retention, payback, marginalReturn: units?.marginal.recentContributionPerCost ?? null, saturation: units?.marginal.saturationCandidate ?? null, confidence: Math.min(r.body.quality.confidence, cac.confidence, retention.confidence, payback.confidence), scaleCandidate: !reasons.length, reasons };
        });
        const channelComparison: ChannelIntelligence = { productId, period: first.body.scope.period, currency: first.body.scope.currency, rows, executionAuthorized: false };
        return this.learning(key, { productId, sourceProductId: null, kind: 'channel', surface: null, outcome: 'Compare customer quality and marginal economics; no spend or scale authorization', measurementRefs: reports.map(optimizationRef), nature: ids.length && reports.every(r => this.observed(r.body) && this.reportFresh(r.body)) ? 'CALCULATED_FROM_OBSERVED_DATA' : 'HYPOTHESIS', transferability: 'UNVERIFIED', decisionId: '', evidenceIds: ids, assumptionIds: [], confidence: Math.min(...rows.map(r => r.confidence)), rationale: 'Canonical channel definitions, UNKNOWN retained, no causal claim', channelComparison });
    }
    learning(key: string, input: OptimizationLearning) {
        this.permit('OPTIMIZATION_LEARNING', input.productId);
        this.owns(input.productId);
        this.provenance(input);
        if (input.sourceProductId) {
            this.owns(input.sourceProductId);
            if (input.sourceProductId !== input.productId && input.transferability === 'UNVERIFIED' && input.nature !== 'HYPOTHESIS')
                throw Error('Cross-product transfer is a hypothesis until evidenced');
        }
        if (input.sourceProductId !== input.productId && input.transferability === 'EVIDENCE_SUPPORTED' && !input.evidenceIds.some(id => {
            const e = this.company.evidence.require(id);
            return e.company?.productId === input.productId && (this.company.evidence.effectiveLevel(e, this.clock()) ?? -1) >= 3;
        }))
            throw Error('Target-product transferability evidence required');
        if (input.nature === 'CALCULATED_FROM_OBSERVED_DATA' && !input.evidenceIds.some(id => (this.company.evidence.effectiveLevel(this.company.evidence.require(id), this.clock()) ?? -1) >= 3))
            throw Error('Observed learning requires observed evidence');
        return this.append('optimizationLearning', key, input);
    }
    requestExternalApproval(selectionKey: string) {
        const { selection: s, intervention: i } = this.privateSelection(selectionKey);
        this.permit('REQUEST_OPTIMIZATION_APPROVAL', i.body.productId);
        if (i.body.execution !== 'EXTERNAL_COMMERCIAL' || !ethicalIntervention(i.body) || i.body.autonomy === 'PROHIBITED')
            throw Error('No approvable external experiment');
        if (s.body.approvalId)
            return this.company.store.db.productFactory.get('approvals', s.body.approvalId)!;
        return this.company.store.db.raw.transaction(() => {
            const id = ulid();
            this.company.store.db.productFactory.insert('approvals', { id, productId: i.body.productId, factoryActionId: `optimization-approval:${s.key}:${s.hash}`, action: 'experiment', status: 'pending', requestedBy: this.company.factory.creatorAddress, decidedBy: null, decidedAt: null, createdAt: this.clock().toISOString() });
            this.append('optimizationSelection', s.key, { ...s.body, approvalId: id, status: 'BLOCKED' }, s.revision);
            return this.company.store.db.productFactory.get('approvals', id)!;
        }).immediate();
    }
    privateSelection(key: string) {
        this.enabled();
        const s = this.company.store.get('optimizationSelection', key);
        if (!s?.body.selected)
            throw Error('Selected experiment required');
        const i = this.company.store.get('optimizationIntervention', s.body.selected.key, s.body.selected.revision)!;
        return { selection: s, intervention: i };
    }
    planPrivate(key: string, buildId: string, probeIds: string[]) {
        const { selection: s, intervention: i } = this.privateSelection(key);
        this.permit('PRIVATE_EXPERIMENT', i.body.productId);
        if (!this.config.allowPrivateExperiments || i.body.execution !== 'PRIVATE_ARTIFACT_PROBE' || i.body.autonomy !== 'PRIVATE_EXPERIMENT' || !ethicalIntervention(i.body))
            throw Error('Private execution disabled or action prohibited');
        if (s.body.taskId) {
            if (canonical(s.body.executionBinding) !== canonical({ buildId, probeIds }))
                throw Error('Private execution binding cannot change');
            return getTaskById(this.company.store.db.raw, s.body.taskId)!;
        }
        const bs = new BuildStore(this.company.store.db, this.company.factory.creatorAddress), build = bs.build(buildId), brief = build && bs.brief(build.briefId);
        if (!build || build.productId !== i.body.productId || build.model?.status !== 'PASS' || !build.validation?.passed || !brief || !probeIds.length || probeIds.some(id => !brief.content.acceptanceProbes?.some(p => p.id === id)))
            throw Error('Same-product validated artifact and approved Contract probes required');
        return this.company.store.db.raw.transaction(() => {
            const goal = this.company.factory.createProductGoal(i.body.productId, 'Controlled private optimization experiment', 'No external commercial action'), task = this.company.factory.planAction({ goalId: goal, title: 'Private approved artifact probes', description: 'Execute frozen approved probes in existing isolated sandbox only', estimatedCostCents: i.body.capitalCents, maxRetries: 1, timeoutMs: this.config.maxExperimentDurationMs, factory: { productId: i.body.productId, factoryActionId: `optimization:${key}`, resourceClass: 'experiment', resourceUnits: 1, urgency: 60, requiresApproval: false, preemptible: true, criticalIncident: false, failureScope: 'action', signals: { businessImpact: .5, evidenceConfidence: i.body.confidence, strategicFit: .5, userImpact: .5, risk: 0 } } });
            this.company.store.db.raw.prepare("UPDATE task_graph SET agent_role='factory-optimization' WHERE id=?").run(task.id);
            this.append('optimizationSelection', key, { ...s.body, taskId: task.id, status: 'PLANNED', executionBinding: { buildId, probeIds } }, s.revision);
            this.company.store.db.raw.prepare('UPDATE factory_experiments SET goal_id=?,task_id=? WHERE id=?').run(goal, task.id, this.company.store.get('experimentPlan', s.body.companyExperimentKey!)!.body.experimentId);
            return getTaskById(this.company.store.db.raw, task.id)!;
        }).immediate();
    }
}
