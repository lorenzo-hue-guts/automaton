import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { createDatabase } from '../../state/database.js';
import { FactoryOptimization, FactoryOrchestrator, CompanyOperatingSystem, optimizationRef, resolveOptimizationConfig, assertCompanyBrief, OpportunityEngine, SCORE_WEIGHTS, PrivateOptimizationExecution } from '../../product-factory/index.js';
import type { AutomatonDatabase } from '../../types.js';
import { optimizationFixture } from './fixtures/optimization-fixture.js';
let db: AutomatonDatabase, dir: string, x: ReturnType<typeof optimizationFixture>;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimization-company-'));
    db = createDatabase(path.join(dir, 'state.db'));
    x = optimizationFixture(db);
});
afterEach(() => {
    if (db.raw.open)
        db.close();
    fs.rmSync(dir, { recursive: true, force: true });
});
it('four-product observed-port simulation connects bottlenecks, surfaces, experiments, scarce capital, review and Decision Memory without commercial execution', () => {
    const { f, analytics, opt } = x, A = x.product, B = f.product(), C = f.product(), D = f.product();
    // Observed verification contracts below use deterministic SDK doubles; no live customers or economics.
    f.setNow('2026-09-30T12:00:00Z');
    const target = f.target('owner', 100000, x.period.start, x.period.end);
    f.forecast('forecast', 20000, 40000, x.period.start, x.period.end);
    f.setNow('2026-10-08T12:00:00Z');
    const reports = [x.r], snapshots = [x.snapshot];
    for (const [p, gross, cost] of [[B, 1000, 100], [C, 6000, 200], [D, 20000, 21000]] as const) {
        x.ingest(x.monetary.map(m => x.event(m, m === 'grossRevenue' ? gross : m === 'acquisitionCost' ? cost : 0, { productId: p })), 'billing', p);
        const r = analytics.report(p, x.scope([p]));
        reports.push(r);
        snapshots.push(analytics.publish(p, 'snapshot:' + p, f.opportunity('Economic accounting', false)));
        f.os.health({ ...f.provenance, evidenceIds: [], productId: p, factors: { support: 'healthy', reliability: 'healthy' }, incidents: [], status: 'healthy', errorBudgetRemaining: { value: null, unit: 'fraction', nature: 'UNKNOWN', evidenceIds: [], confidence: 0 } }, 'BUILDER');
    }
    x.ingest(Array.from({ length: 20 }, (_, i) => x.event(undefined, 0, { eventName: 'signup', identifiers: { user: 'signup' + i }, occurredAt: '2026-10-02T12:00:00Z' })));
    x.ingest([x.event(undefined, 0, { eventName: 'activation', category: 'ACTIVATION', identifiers: { user: 'signup0' }, occurredAt: '2026-10-03T12:00:00Z' })]);
    const activationReport = analytics.report('activation-report', x.scope());
    analytics.funnelDefinition('journey', { productId: A, entity: 'user', steps: [{ name: 'signup', eventName: 'signup' }, { name: 'activation', eventName: 'activation' }], windowMs: 86400000 * 7, firstValueStep: 'activation', changeReason: 'Freeze the actual activation journey' });
    analytics.funnel('journey', 'journey', activationReport.key);
    const bottleneck = opt.identify('activation', activationReport.key, { funnelKey: 'journey', evidenceIds: x.ids });
    expect(bottleneck.body.class).toBe('ACTIVATION');
    x.benchmark();
    const mobile = opt.surface('mobile', { ...f.provenance, evidenceIds: x.marketIds, productId: B, opportunityId: x.o, benchmarkKey: 'market', factors: [x.factor('native_required')], alternatives: [x.alternative('MOBILE_CROSS_PLATFORM', 50), x.alternative('PWA', 5)], riskKeys: [], changeReason: 'Camera/offline workflow requires native long-term', rationale: 'Context determines surface, not current Builder' });
    expect(mobile.body.longTermSurface).toBe('MOBILE_CROSS_PLATFORM');
    expect(mobile.body.validationSurface).toBe('PWA');
    expect(mobile.body.capabilityStatus).toBe('NOT_IMPLEMENTED');
    const candidates = opt.mechanisms(bottleneck.key).map((mechanism, i) => {
        const k = 'intervention-' + i;
        x.intervention(k, { opportunityKey: bottleneck.key, mechanism, capitalCents: 50 * (i + 1), builderHours: 1 + i });
        return k;
    });
    const selection = opt.select('selected', bottleneck.key, candidates);
    expect(selection.body.selected?.key).toBe('intervention-0');
    analytics.experimentProtocol('frozen', { companyExperimentKey: selection.body.companyExperimentKey!, productId: A, entity: 'user', control: 'control', variant: 'variant', primaryEvent: 'purchase', guardrails: [{ eventName: 'refund', maxIncrease: 0 }, { eventName: 'retention', maxIncrease: 0 }], period: x.period, minSample: 4, changeReason: 'Frozen before outcomes' });
    const events = [];
    for (const arm of ['control', 'variant'])
        for (let i = 0; i < 20; i++) {
            const id = arm + i;
            events.push(x.event(undefined, 0, { eventName: 'experiment_exposure', category: 'EXPERIMENT', identifiers: { user: id }, properties: { variant: arm }, occurredAt: '2026-10-05T00:00:00Z' }));
            if (arm === 'variant' || i < 2)
                events.push(x.event(undefined, 0, { eventName: 'purchase', category: 'EXPERIMENT', identifiers: { user: id }, occurredAt: '2026-10-06T00:00:00Z' }));
        }
    x.ingest(events);
    const measured = analytics.report('measured', x.scope());
    const result = analytics.experiment('result', 'frozen', measured.key);
    expect(result.body.status).toBe('CANDIDATE_IMPROVEMENT');
    const decision = opt.outcome('adopt', 'selected', 'ADOPT', 'result', 'Contract-double improvement; causality and real market effect remain unproven');
    expect(decision.body.outcome).toBe('ADOPT');
    expect(decision.body.executionAuthorized).toBe(false);
    for (const [key, p, profit, hours, ids] of [['improve-A', A, 5000, 1, x.ids], ['native-B', B, 9000, 20, snapshots[1].body.metrics.profit.evidenceIds], ['loss-D', D, -1000, 1, snapshots[3].body.metrics.profit.evidenceIds]] as const)
        f.proposal(key, p, profit, 1000, hours, [...ids]);
    const capital = opt.capital('next-capital', ['native-B', 'loss-D', 'improve-A'], reports.map(r => r.key), 'owner');
    expect(capital.body.selected).toBe('improve-A');
    expect(capital.body.rows.find(r => r.key === 'loss-D')?.eligible).toBe(false);
    const allocation = opt.requestCapitalAllocation('improvement', capital.key);
    expect(allocation.body.status).toBe('proposed');
    expect(db.productFactory.get('approvals', allocation.body.approvalId)?.status).toBe('pending');
    expect(opt.portfolio('mature', C, 'HARVEST', 'Stable profitable mature product: protect value, redirect growth capital').outcome).toBe('HARVEST');
    expect(opt.portfolio('bad-growth', D, 'SCALE', 'Gross revenue cannot justify loss-making scale').outcome).toBe('HOLD');
    const portfolio = analytics.report('portfolio', x.scope([A, B, C, D]));
    const snapshot = analytics.publish(portfolio.key, 'portfolio-economics', f.opportunity('Portfolio accounting', false), { grossRevenue: target.body.metricDefinition });
    const review = f.os.review('weekly', { type: 'weekly', targetKey: 'owner', snapshotKey: snapshot.key, forecastKey: 'forecast', assessments: f.assessments(), stopDoing: ['Loss-making acquisition; pretend mobile support'], priorities: ['Fix measured activation; preserve mature product; research native capability'] });
    expect(review.body.targetOutcome).toBe('MISSED');
    expect(review.body.revenueGap?.low).toBe(60000);
    expect(f.os.store.get('target', 'owner')?.body.amountCents).toBe(100000);
    expect(f.os.store.get('mode', 'company')?.body.mode).toBe('RECOVERY');
    expect(f.factory.resources.config.operationalBudgetCents).toBe(10000);
    expect(db.getRecentTransactions(100)).toEqual([]);
    const report = { nature: 'DETERMINISTIC CONTRACT SIMULATION — NOT REAL MARKET VALIDATION', products: { A: { bottleneck: bottleneck.body.class, selected: selection.body.selected?.key }, B: { longTerm: mobile.body.longTermSurface, validation: mobile.body.validationSurface, capability: mobile.body.capabilityStatus }, C: { portfolio: 'HARVEST' }, D: { gross: reports[3].body.metrics.grossRevenue.value, contribution: reports[3].body.metrics.contribution.value, portfolio: 'HOLD' } }, experiment: decision.body.outcome, capital: capital.body.selected, ownerTarget: target.body.amountCents, targetOutcome: review.body.targetOutcome, gap: review.body.revenueGap, decisions: db.productFactory.list('decisions').length, transactions: 0 };
    fs.writeFileSync('/tmp/lot-6r-e2e-results.json', JSON.stringify(report, null, 2));
});
it('full SQLite close/reopen restores all optimization governance kinds and idempotent selection without migrations', () => {
    x.surface([x.factor('desktop_workflow')]);
    x.intervention('a');
    const selection = x.opt.select('selection', 'optimization', ['a']);
    x.opt.capital('capital', [], [x.r.key]);
    x.opt.scaleReadiness('scale', x.r.key);
    x.opt.outcome('unknown', 'selection', 'HOLD', null, 'No measured result');
    x.opt.monetization('price', { ...x.f.provenance, evidenceIds: x.marketIds, productId: x.product, format: 'ONE_TIME', reasonToPay: 'Important occasional workflow', recurringValue: null, price: x.f.range(100), purchaseTrust: 'HYPOTHESIS', trustEvidenceIds: [], storeEconomics: { platform: 'marketplace', fee: x.f.range(.1, .2, 'fraction'), paymentConstraints: ['Research platform rules'], reviewFriction: 'Unknown', refundMechanics: 'Research required', expiresAt: '2027-01-01T00:00:00Z', evidenceIds: x.marketIds } });
    x.opt.learning('surface-learning', { ...x.f.provenance, evidenceIds: x.marketIds, productId: x.product, sourceProductId: null, kind: 'surface', surface: 'WEB_APP', outcome: 'Device context suggests browser workflow; execution remains unproven', measurementRefs: [], nature: 'HYPOTHESIS', transferability: 'UNVERIFIED', decisionId: selection.body.decisionId });
    const hashes = x.f.os.store.list('productSurfaceDecision').map(r => r.hash);
    db.close();
    db = createDatabase(path.join(dir, 'state.db'));
    const factory = new FactoryOrchestrator(db, x.f.factory.resources.config, 'creator', () => ({ action: 'allow', reasonCode: 'DOUBLE', humanMessage: 'Fixture' }));
    const company = new CompanyOperatingSystem(factory, x.f.options), opt = new FactoryOptimization(company, x.options);
    expect(opt.select('selection', 'optimization', ['a']).hash).toBe(selection.hash);
    expect(company.store.list('productSurfaceDecision').map(r => r.hash)).toEqual(hashes);
    for (const k of ['optimizationOpportunity', 'optimizationIntervention', 'optimizationSelection', 'optimizationCapital', 'optimizationScaleReadiness', 'optimizationDecision', 'optimizationMonetization', 'optimizationLearning', 'surfaceBenchmark', 'builderSurfaceCapability'] as const)
        expect(company.store.list(k).length).toBeGreaterThan(0);
    expect(db.productFactory.list('experiments')).toHaveLength(1);
});
it('stale analytics cannot select even a previously attractive intervention', () => {
    x.intervention('a');
    x.f.setNow('2027-01-01T12:00:00Z');
    expect(x.opt.select('stale', 'optimization', ['a']).body.selected).toBeNull();
});
it('cross-product, empty protocols, invalid execution and fractional time limits are rejected', () => {
    const other = x.f.product();
    expect(() => x.intervention('wrong-product', { productId: other })).toThrow(/opportunity/);
    expect(() => x.intervention('bad-execution', { execution: 'BYPASS' as any })).toThrow(/protocol/);
    const b = x.intervention('base');
    expect(() => x.intervention('empty', { measurement: { ...b.measurement, metricDefinitions: [] } })).toThrow(/protocol/);
    expect(() => resolveOptimizationConfig({ maxExperimentDurationMs: 1.5 })).toThrow(/ceiling/);
});
it('intervention economic currency and finite confidence are checked', () => {
    expect(() => x.intervention('currency', { expectedContribution: x.f.range(1, 2, 'USD:cents') })).toThrow(/currency/);
    expect(() => x.intervention('nan', { confidence: NaN })).toThrow(/confidence/);
});
it('frozen experiment guardrails cannot be removed to manufacture adoption', () => {
    x.intervention('a');
    const s = x.opt.select('selection', 'optimization', ['a']);
    x.analytics.experimentProtocol('changed', { companyExperimentKey: s.body.companyExperimentKey!, productId: x.product, entity: 'user', control: 'c', variant: 'v', primaryEvent: 'purchase', guardrails: [], period: x.period, minSample: 4, changeReason: 'Claim a win by omitting guardrails' });
    x.analytics.experiment('changed', 'changed', x.r.key);
    expect(() => x.opt.outcome('invalid', 'selection', 'ADOPT', 'changed', 'Omitted guardrails')).toThrow(/Frozen/);
});
it('new unsupported mobile Contract reaches the existing Builder gate without silent Web replacement', () => {
    const o = x.f.opportunity(), p = x.product, ids = [x.f.evidence(o, 'money_flow'), x.f.evidence(o, 'buyer'), x.f.evidence(o, 'distribution')];
    x.f.business(o, ids);
    const oe = new OpportunityEngine(db, x.f.factory);
    oe.assess(o, { values: Object.fromEntries(Object.keys(SCORE_WEIGHTS).map(k => [k, 1])) as any, estimatedCostCents: 0, risk: 0, unverifiedHypotheses: [] });
    oe.decide(o, 'SELECT', 'Fresh market evidence selected');
    const c = x.f.contract(o, p, ids);
    const existing = x.f.os.store.get('contract', 'contract')!;
    x.opt.benchmark('mobile-contract', { ...x.f.provenance, evidenceIds: ids, opportunityId: o, observations: [{ product: 'Mobile reference', surface: 'ANDROID', outcome: 'unknown', pricing: null, channels: [], onboarding: 'Native workflow', complaints: [], sourceRefs: ['fixture://native'], evidenceIds: ids, capturedAt: x.f.now().toISOString(), expiresAt: '2027-01-01T00:00:00Z' }], interpretation: 'Context only', copyingPermitted: false });
    const s = x.opt.surface('mobile-contract', { ...x.f.provenance, evidenceIds: ids, productId: p, opportunityId: o, benchmarkKey: 'mobile-contract', factors: [x.factor('native_required', true, ids)], alternatives: [], riskKeys: [], changeReason: 'Camera workflow', rationale: 'Native required' });
    const revised = x.f.os.createContract('contract', { ...c, surfaceDecision: optimizationRef(s), changeReason: 'Explicit mobile' }, 'ENTREPRENEUR', existing.revision);
    expect(revised.body.surfaceDecision?.hash).toBe(s.hash);
    expect(s.body.validationCapabilityStatus).toBe('NOT_IMPLEMENTED');
    const council = x.f.os.council('mobile-council', { businessCaseKey: 'business', contractKey: 'contract', contractRevision: revised.revision, assessments: x.f.assessments(), claimKeys: [], reversibility: 'EASILY_REVERSIBLE', capitalCents: 1000 });
    const approved = x.f.os.approveContract('contract', revised.revision, council.id);
    const brief = x.f.os.contractBrief(approved.key, approved.revision);
    expect(() => assertCompanyBrief(db, brief)).toThrow(/surface.*NOT_IMPLEMENTED|no silent Web/);
});
it('private dispatcher never claims or fails another creator task', () => {
    const foreign = new FactoryOrchestrator(db, x.f.factory.resources.config, 'other-creator', () => ({ action: 'allow', reasonCode: 'DOUBLE', humanMessage: 'Fixture' }));
    const p = foreign.portfolio.create('Foreign owned product').id;
    const goal = foreign.createProductGoal(p, 'Foreign goal', 'Other owner');
    const task = foreign.planAction({ goalId: goal, title: 'Foreign experiment', description: 'No cross-owner dispatch', factory: { productId: p, factoryActionId: 'foreign-experiment', resourceClass: 'experiment', resourceUnits: 1, urgency: 50, requiresApproval: false, preemptible: true, criticalIncident: false, signals: { businessImpact: .1, evidenceConfidence: .1, strategicFit: .1, userImpact: .1, risk: .1 } } });
    db.raw.prepare("UPDATE task_graph SET agent_role='factory-optimization' WHERE id=?").run(task.id);
    expect(foreign.resources.assign(task.id, x.f.now()).allowed).toBe(true);
    let calls = 0;
    const execution = new PrivateOptimizationExecution(x.opt, { isolation: 'filesystem-and-network', open: async () => {
            throw Error('No sandbox execution expected');
        } } as any, '/tmp');
    execution.connectWorkers({ spawn: () => {
            calls++;
        } } as any);
    const cycle = x.f.factory.tick(x.f.now());
    expect(cycle.errors).toEqual([]);
    expect(calls).toBe(0);
    expect(db.raw.prepare('SELECT status FROM task_graph WHERE id=?').get(task.id)).toEqual({ status: 'assigned' });
});
it('channel comparison retains UNKNOWN customer quality, canonical scope and marginal return; capital report binding is never ambiguous', () => {
    const organic = x.analytics.report('organic', { ...x.scope(), dimensions: { channel: 'organic' } }), paid = x.analytics.report('paid', { ...x.scope(), dimensions: { channel: 'paid' } });
    const comparison = x.opt.channels('channels', [organic.key, paid.key]);
    expect(comparison.body.channelComparison?.rows).toHaveLength(2);
    expect(comparison.body.channelComparison?.rows.every(r => r.cac.value === null && !r.scaleCandidate)).toBe(true);
    expect(comparison.body.channelComparison?.executionAuthorized).toBe(false);
    expect(() => x.opt.channels('duplicate', [paid.key, paid.key])).toThrow(/scope/);
    x.f.proposal('proposal', x.product, 1000, 100, 1, x.ids);
    expect(() => x.opt.capital('ambiguous', ['proposal'], [organic.key, paid.key])).toThrow(/Ambiguous/);
});
it('capital comparisons reject period/currency mixing and stale commitment requests', () => {
    const previous = x.analytics.report('previous', { ...x.scope(), period: { start: '2026-09-24T00:00:00Z', end: '2026-10-01T00:00:00Z' } });
    expect(() => x.opt.capital('periods', [], [previous.key, x.r.key])).toThrow(/period/);
    x.f.proposal('p', x.product, 5000, 100, 1, x.ids);
    const capital = x.opt.capital('valid', ['p'], [x.r.key]);
    x.f.setNow('2027-01-01T12:00:00Z');
    expect(() => x.opt.requestCapitalAllocation('stale', capital.key)).toThrow(/stale/);
});
it('a bounded new-opportunity research option can beat existing improvement without claiming observed profitability', () => {
    const o = x.f.opportunity('New narrow opportunity', false), p = x.f.product(), ids = [x.f.evidence(o, 'money_flow'), x.f.evidence(o, 'buyer'), x.f.evidence(o, 'distribution')];
    const business = x.f.business(o, ids, 'new-case');
    x.f.os.record('businessCase', 'new-case', { ...business, experiments: [{ key: 'new-research', costCents: 100, builderHours: 1, uncertainty: 'Does the buyer switch for this narrow workflow?', informationValue: x.f.range(1000, 3000), reversibility: 'EASILY_REVERSIBLE' }] }, 'ENTREPRENEUR', 1);
    const proposal = x.f.proposal('new-research', p, 10000, 100, 1, ids);
    x.f.os.record('proposal', 'new-research', { ...proposal, opportunityId: o, action: 'RESEARCH' }, 'ENTREPRENEUR', 1);
    x.f.proposal('existing', x.product, 1000, 100, 1, x.ids);
    const result = x.opt.capital('options', ['existing', 'new-research'], [x.r.key]);
    expect(result.body.selected).toBe('new-research');
    expect(result.body.rows.find(r => r.key === 'new-research')?.basis).toBe('ESTIMATED_OPTION');
    expect(result.body.rows.find(r => r.key === 'new-research')?.confidence).toBe(.5);
    expect(x.opt.requestCapitalAllocation('option-capital', result.key).body.status).toBe('proposed');
    expect(db.getRecentTransactions(100)).toEqual([]);
});
it('an unreviewed new build cannot disguise missing observed costs as an investment option', () => {
    const o = x.f.opportunity('Unreviewed build', false), p = x.f.product(), ids = [x.f.evidence(o, 'money_flow')], proposal = x.f.proposal('build', p, 100000, 100, 1, ids);
    x.f.os.record('proposal', 'build', { ...proposal, opportunityId: o, action: 'BUILD' }, 'ENTREPRENEUR', 1);
    expect(x.opt.capital('build', ['build'], []).body.selected).toBeNull();
});
it('a new build may compete through an approved surface-aware Contract using explicit estimated economics; changed option inputs require review', () => {
    const { f, opt } = x, o = f.opportunity('New approved wedge'), p = f.product(), ids = [f.evidence(o, 'money_flow'), f.evidence(o, 'buyer'), f.evidence(o, 'distribution')];
    f.business(o, ids, 'new-case');
    f.contract(o, p, ids, 'new-contract', 'new-case');
    opt.benchmark('new-format', { ...f.provenance, evidenceIds: ids, opportunityId: o, observations: [{ product: 'Reference workflow', surface: 'WEB_APP', outcome: 'unknown', pricing: null, channels: ['partnership'], onboarding: 'First useful workflow', complaints: [], sourceRefs: ['fixture://reference'], evidenceIds: ids, capturedAt: f.now().toISOString(), expiresAt: '2027-01-01T00:00:00Z' }], interpretation: 'Public contract fixture, not demonstrated market fit', copyingPermitted: false });
    opt.surface('new-surface', { ...f.provenance, evidenceIds: ids, productId: p, opportunityId: o, benchmarkKey: 'new-format', factors: [x.factor('desktop_workflow', true, ids)], alternatives: [], riskKeys: [], changeReason: 'Desktop workflow wedge' });
    const draft = opt.attachContract('new-contract', 'new-surface');
    const council = f.os.council('new-build-council', { businessCaseKey: 'new-case', contractKey: 'new-contract', contractRevision: draft.revision, assessments: f.assessments(), claimKeys: [], reversibility: 'EASILY_REVERSIBLE', capitalCents: 1000 });
    f.os.approveContract('new-contract', draft.revision, council.id);
    const proposal = f.proposal('new-build', p, 10000, 1000, 1, ids);
    f.os.record('proposal', 'new-build', { ...proposal, opportunityId: o, action: 'BUILD' }, 'ENTREPRENEUR', 1);
    const capital = opt.capital('new-build', ['new-build'], []);
    expect(capital.body.selected).toBe('new-build');
    expect(capital.body.rows[0].basis).toBe('ESTIMATED_OPTION');
    expect(f.os.store.list('economicSnapshot').some(s => s.body.productId === p)).toBe(false);
    const business = f.os.store.get('businessCase', 'new-case')!;
    f.os.record('businessCase', 'new-case', { ...business.body, servingCost: f.range(500000) }, 'ENTREPRENEUR', business.revision);
    expect(() => opt.requestCapitalAllocation('changed', capital.key)).toThrow(/inputs changed/);
    expect(db.getRecentTransactions(100)).toEqual([]);
});
it('declared inference/time and customer value remain visible; inference cannot exceed operating capital', () => {
    const proposal = x.f.proposal('compute', x.product, 10000, 100, 1, x.ids);
    x.f.os.record('proposal', 'compute', { ...proposal, optimization: { interventionRef: null, reportRefs: [optimizationRef(x.r)], inferenceCents: 101, durationMs: 1000, customerValue: 'Faster useful result' } }, 'ENTREPRENEUR', 1);
    const c = x.opt.capital('compute', ['compute'], [x.r.key]);
    expect(c.body.selected).toBeNull();
    expect(c.body.rows[0]).toMatchObject({ inferenceCents: 101, durationMs: 1000, customerValue: 'Faster useful result' });
});
