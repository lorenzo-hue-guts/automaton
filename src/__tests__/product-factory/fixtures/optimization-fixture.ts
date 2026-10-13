import type { AutomatonDatabase } from '../../../types.js';
import { FactoryOptimization, optimizationRef } from '../../../product-factory/index.js';
import type { Intervention, SurfaceFactor, SurfaceAssessment, ProductSurface } from '../../../product-factory/index.js';
import { analyticsFixture } from './analytics-fixture.js';
export function optimizationFixture(db: AutomatonDatabase) {
    const x = analyticsFixture(db), o = x.f.opportunity('Optimization accounting', false), config = { enabled: true, allowPrivateExperiments: true, maxExperimentCostCents: 1000, maxExperimentBuilderHours: 10, maxExperimentComputeUnits: 100, maxExperimentDurationMs: 30000, minConfidence: .3 };
    const admission = () => ({ allowed: true, reason: 'Deterministic policy contract double' }), opt = new FactoryOptimization(x.f.os, { config, clock: x.f.now, admission });
    opt.initializeCapabilities();
    const marketIds = [x.f.evidence(o, 'buyer'), x.f.evidence(o, 'problem')];
    const zeroCosts = x.monetary.filter(m => !['grossRevenue', 'refunds', 'cash', 'committedCapital'].includes(m));
    x.ingest([x.event('grossRevenue', 10000), x.event('refunds', 0), ...zeroCosts.map(m => x.event(m, m === 'acquisitionCost' ? 1000 : 0))]);
    let r = x.analytics.report('report', x.scope()), snapshot = x.analytics.publish(r.key, 'snapshot', o);
    const ids = snapshot.body.metrics.profit.evidenceIds;
    x.f.os.health({ ...x.f.provenance, evidenceIds: ids, productId: x.product, factors: { support: 'healthy', reliability: 'healthy' }, incidents: [], status: 'healthy', errorBudgetRemaining: { value: null, unit: 'fraction', nature: 'UNKNOWN', evidenceIds: [], confidence: 0 } }, 'BUILDER');
    const opportunity = opt.identify('optimization', r.key, { evidenceIds: ids });
    x.f.os.record('metricDefinition', 'purchase', { name: 'Purchase', unit: 'fraction', kind: 'RESULT', formula: 'Distinct settled purchase / exposed customer; frozen before results', includes: ['purchase'], excludes: ['trial', 'synthetic'], changeReason: 'Canonical primary metric' }, 'JUDGE');
    function benchmark(surface: ProductSurface = 'ANDROID', key = 'market') {
        return opt.benchmark(key, { ...x.f.provenance, evidenceIds: marketIds, opportunityId: o, observations: [{ product: 'Public reference', outcome: 'successful', surface, pricing: x.f.range(100, 200), channels: ['marketplace'], onboarding: 'Example then main action', complaints: ['Missing offline workflow'], sourceRefs: ['fixture://public-reference'], evidenceIds: marketIds, capturedAt: x.f.now().toISOString(), expiresAt: '2027-01-01T00:00:00Z' }], interpretation: 'Public contract fixtures, not real market validation', copyingPermitted: false });
    }
    function factor(name: string, value = true, evidenceIds = marketIds): SurfaceFactor {
        return { name, value, evidenceIds, confidence: .9, rationale: 'Workflow/context evidence fixture' };
    }
    function alternative(surface: ProductSurface, cost: number, question = true): SurfaceAssessment {
        return { surface, customerValue: 'Material workflow value', distributionAdvantage: 'Reach appropriate qualified buyers', effortHours: x.f.range(cost, cost, 'hours'), validationCost: x.f.range(cost * 100), maintenanceCost: null, expectedContribution: null, riskKeys: [], reversibility: 'EASILY_REVERSIBLE', canTestCriticalQuestion: question, question: 'Do buyers understand and use the wedge?', evidenceIds: marketIds };
    }
    function surface(factors: SurfaceFactor[], alternatives: SurfaceAssessment[] = [], patch: Record<string, unknown> = {}) {
        if (!x.f.os.store.get('surfaceBenchmark', 'market'))
            benchmark();
        return opt.surface('surface', { ...x.f.provenance, evidenceIds: marketIds, productId: x.product, opportunityId: o, benchmarkKey: 'market', factors, alternatives, riskKeys: [], changeReason: 'Explicit initial surface reasoning', ...patch });
    }
    function intervention(key = 'a', patch: Partial<Intervention> = {}): Intervention {
        const body: Intervention = { ...x.f.provenance, evidenceIds: ids, opportunityKey: opportunity.key, productId: x.product, class: 'ACTIVATION', mechanism: 'Guide first value with representative examples ' + key, customerValue: 'Reach correct first useful outcome', uncertainty: 'Does onboarding friction prevent first value?', criticalAssumptionIds: [], informationValue: x.f.range(1, 2, 'uncertainty_reduction'), expectedContribution: x.f.range(1000, 2000), capitalCents: 100, builderHours: 1, computeUnits: 2, inferenceCents: 0, durationMs: 10000, downsideCents: 100, reversibility: 'EASILY_REVERSIBLE', riskKeys: [], dependencies: [], measurement: { canAnswer: true, reason: 'Execute representative journey and frozen canonical metric', metricDefinitions: [{ key: 'purchase', revision: 1 }], population: 'Qualified test customers', period: x.period, primaryMetric: 'purchase', guardrails: ['refund', 'retention'], stopConditions: ['Primary failure or negative guardrail'] }, execution: 'RESEARCH', autonomy: 'RECOMMEND_ONLY', ethicalFlags: [], ...patch };
        opt.intervention(key, body);
        return body;
    }
    return { ...x, opt, o, ids, marketIds, r, snapshot, opportunity, benchmark, factor, alternative, surface, intervention, options: { config, clock: x.f.now, admission } };
}
