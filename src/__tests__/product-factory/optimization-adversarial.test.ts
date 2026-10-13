import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { createDatabase } from '../../state/database.js';
import { FactoryOptimization, initialSurfaceCapability, guardedOptimizationOutcome, selectValuableExperiment, resolveOptimizationConfig, MOBILE_ACCEPTANCE_CONTRACT } from '../../product-factory/index.js';
import type { AutomatonDatabase } from '../../types.js';
import { optimizationFixture } from './fixtures/optimization-fixture.js';
let db: AutomatonDatabase, dir: string, x: ReturnType<typeof optimizationFixture>;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimization-'));
    db = createDatabase(path.join(dir, 'state.db'));
    x = optimizationFixture(db);
});
afterEach(() => {
    if (db.raw.open)
        db.close();
    fs.rmSync(dir, { recursive: true, force: true });
});
it('A/Q/X — mobile market evidence persists without inventing Android or device/browser capability', () => {
    const s = x.surface([x.factor('native_required')]);
    expect(s.body.longTermSurface).toBe('MOBILE_CROSS_PLATFORM');
    expect(s.body.capabilityStatus).toBe('NOT_IMPLEMENTED');
    const c = initialSurfaceCapability('ANDROID', x.f.now().toISOString());
    c.capabilities.compilation = { status: 'SUPPORTED', proof: { buildId: 'fake', execution: 'real', surface: 'ANDROID' } };
    expect(() => x.opt.capability(c)).toThrow(/mobile|acceptance/);
    expect(MOBILE_ACCEPTANCE_CONTRACT.required).toContain('interaction');
});
it('B — web prevalence does not override evidenced native workflow', () => {
    x.benchmark('WEB_APP');
    expect(x.surface([x.factor('native_required')]).body.longTermSurface).toBe('MOBILE_CROSS_PLATFORM');
});
it('C — native long term and cheaper PWA validation remain separate truths', () => {
    const s = x.surface([x.factor('native_required')], [x.alternative('MOBILE_CROSS_PLATFORM', 50), x.alternative('PWA', 5)]);
    expect(s.body.longTermSurface).toBe('MOBILE_CROSS_PLATFORM');
    expect(s.body.validationSurface).toBe('PWA');
    expect(s.body.validationCapabilityStatus).toBe('NOT_IMPLEMENTED');
});
it('D — MULTI_SURFACE requires incremental workflow/value evidence', () => {
    expect(() => x.surface([x.factor('desktop_workflow')], [], { preferred: 'MULTI_SURFACE', secondarySurfaces: ['ANDROID'] })).toThrow(/MULTI_SURFACE/);
});
it('E — platform subscription trust remains hypothesis without purchase behavior', () => {
    expect(() => x.opt.monetization('price', { ...x.f.provenance, evidenceIds: x.marketIds, productId: x.product, format: 'SUBSCRIPTION_MONTHLY', reasonToPay: 'Repeated value', recurringValue: 'Weekly workflow', price: x.f.range(100), purchaseTrust: 'EVIDENCE_SUPPORTED', trustEvidenceIds: x.marketIds, storeEconomics: null })).toThrow(/trust/);
});
it('F — measured activation bottleneck generates distinct product alternatives, not more traffic', () => {
    x.ingest(Array.from({ length: 10 }, (_, i) => x.event(undefined, 0, { eventName: 'signup', identifiers: { user: 'u' + i }, occurredAt: '2026-10-02T12:00:00Z' })));
    x.ingest([x.event(undefined, 0, { eventName: 'activate', category: 'ACTIVATION', identifiers: { user: 'u0' }, occurredAt: '2026-10-03T12:00:00Z' })]);
    x.analytics.report('funnel-report', x.scope());
    x.analytics.funnelDefinition('f', { productId: x.product, entity: 'user', steps: [{ name: 'signup', eventName: 'signup' }, { name: 'activation', eventName: 'activate' }], windowMs: 86400000 * 7, firstValueStep: 'activation', changeReason: 'Frozen funnel' });
    x.analytics.funnel('funnel', 'f', 'funnel-report');
    const o = x.opt.identify('activation', 'funnel-report', { funnelKey: 'funnel', evidenceIds: x.ids });
    expect(o.body.class).toBe('ACTIVATION');
    expect(x.opt.mechanisms(o.key)).toHaveLength(3);
    expect(x.opt.mechanisms(o.key).join(' ')).not.toMatch(/buy traffic/);
});
it('G/W — growing gross revenue with worse contribution does not authorize SCALE', () => {
    const early = x.r;
    x.ingest([x.event('grossRevenue', 1000), x.event('acquisitionCost', 20000)]);
    const later = x.analytics.report('later', x.scope());
    expect(x.opt.identify('cost', later.key, { evidenceIds: x.ids }).body.class).toBe('COST');
    expect(x.opt.scaleReadiness('scale', later.key).body.ready).toBe(false);
});
it('H — historical average cannot substitute for marginal evidence', () => {
    x.f.proposal('scale', x.product, 10000, 100, 1, x.ids);
    const p = x.f.os.store.get('proposal', 'scale')!;
    x.f.os.record('proposal', 'scale', { ...p.body, action: 'SCALE', marginalContribution: x.f.range(-100, -50) }, 'ENTREPRENEUR', p.revision);
    expect(x.opt.capital('capital', ['scale'], [x.r.key]).body.selected).toBeNull();
});
it('I — conversion improvement with failed retention guardrail is rolled back, not adopted', () => {
    const result = { protocolKey: 'p', protocolRevision: 1, reportKey: 'r', reportRevision: 1, control: { exposed: 100, converted: 10 }, variant: { exposed: 100, converted: 20 }, difference: .1, confidence: .9, guardrails: [{ eventName: 'churn', control: 1, variant: 20, passed: false }], status: 'GUARDRAIL_FAILED' as const, nature: 'OBSERVED' as const, eventIds: [], causal: false as const };
    expect(guardedOptimizationOutcome('ADOPT', result, true, 'healthy').outcome).toBe('ROLL_BACK');
});
it('J/P — unsafe target-closing or cancellation-friction intervention is ineligible', () => {
    x.f.target('target', 100000);
    x.intervention('bad', { ethicalFlags: ['CANCELLATION_FRICTION'], mechanism: 'Obstruct cancellation to manufacture retention' });
    expect(x.opt.select('selection', 'optimization', ['bad']).body.selected).toBeNull();
    expect(x.f.os.store.get('target', 'target')!.body.amountCents).toBe(100000);
});
it('K — improving an existing product can win on scarce Builder time', () => {
    x.f.proposal('improve', x.product, 5000, 100, 1, x.ids);
    x.f.proposal('new', x.product, 9000, 100, 10, x.ids);
    expect(x.opt.capital('allocation', ['new', 'improve'], [x.r.key]).body.selected).toBe('improve');
});
it('L — sunk cost does not protect a weak investment', () => {
    const p = x.f.proposal('weak', x.product, 10, 100, 1, x.ids);
    x.f.os.record('proposal', 'weak', { ...p, historicalSpendCents: 1000000 }, 'ENTREPRENEUR', 1);
    expect(x.opt.capital('capital', ['weak'], [x.r.key]).body.selected).toBeNull();
});
it('M — profitable healthy low-growth product may be HARVESTED', () => {
    expect(x.opt.portfolio('harvest', x.r.key, 'HARVEST', 'Protect stable value with minimal growth capital').outcome).toBe('HARVEST');
    expect(x.f.os.store.get('portfolio', x.product)?.body.state).toBe('HARVEST');
});
it('N — observed contradictory context dominates synthetic optimism', () => {
    const observed = x.f.evidence(x.o, 'problem', 3), synthetic = x.f.evidence(x.o, 'problem', 1);
    const s = x.surface([x.factor('native_required', true, [synthetic]), x.factor('native_required', false, [observed]), x.factor('desktop_workflow', true, [observed])]);
    expect(s.body.longTermSurface).toBe('WEB_APP');
});
it('O — destructive discount economics cannot appear as a successful growth allocation', () => {
    x.ingest([x.event('acquisitionCost', 15000)]);
    const r = x.analytics.report('loss', x.scope());
    x.f.proposal('discount', x.product, -1000, 100, 1, x.ids);
    expect(x.opt.capital('capital', ['discount'], [r.key]).body.selected).toBeNull();
});
it('R — restart/planning does not duplicate Company experiment or decision', () => {
    x.intervention('a');
    const s = x.opt.select('selection', 'optimization', ['a']);
    const fresh = new FactoryOptimization(x.f.os, x.options);
    expect(fresh.select('selection', 'optimization', ['a']).id).toBe(s.id);
    expect(db.productFactory.list('experiments')).toHaveLength(1);
    expect(fresh.company.store.get('optimizationSelection', 'selection')?.hash).toBe(s.hash);
});
it('S — cheap meaningless activity loses; HOLD is a valid best option', () => {
    x.intervention('cheap', { capitalCents: 0, measurement: { ...x.intervention('base').measurement, canAnswer: false, reason: 'Cannot answer the critical question' } });
    expect(x.opt.select('selection', 'optimization', ['cheap']).body.selected).toBeNull();
});
it('T — stronger context yields a versioned surface, history preserved', () => {
    const a = x.surface([x.factor('desktop_workflow')]), b = x.surface([x.factor('native_required')], [], { changeReason: 'Stronger native requirement arrived' });
    expect(b.revision).toBe(2);
    expect(x.f.os.store.get('productSurfaceDecision', 'surface', a.revision)?.body.longTermSurface).toBe('WEB_APP');
});
it('U — rising platform dependency risk lowers surface confidence', () => {
    const a = x.surface([x.factor('native_required')]);
    x.f.os.record('risk', 'platform', { ...x.f.provenance, evidenceIds: x.marketIds, type: 'EXTERNAL_DEPENDENCY', likelihood: null, impact: 'material', affectedProducts: [x.product], mitigation: 'Validate alternative platform', owner: 'ENTREPRENEUR', status: 'open' }, 'ENTREPRENEUR');
    const b = x.surface([x.factor('native_required')], [], { riskKeys: ['platform'], changeReason: 'Platform rule changed' });
    expect(b.body.confidence).toBeLessThan(a.body.confidence);
});
it('V — success on another product is not automatically transferable', () => {
    expect(() => x.opt.learning('transfer', { ...x.f.provenance, evidenceIds: x.ids, productId: x.product, sourceProductId: x.f.product(), kind: 'cross_product', surface: null, outcome: 'Worked elsewhere', measurementRefs: [], nature: 'CALCULATED_FROM_OBSERVED_DATA', transferability: 'UNVERIFIED', decisionId: '' })).toThrow(/hypothesis/);
});
it('default disablement and generic-record bypass fail closed', () => {
    expect(resolveOptimizationConfig().enabled).toBe(false);
    expect(() => new FactoryOptimization(x.f.os).initializeCapabilities()).toThrow(/disabled/);
    expect(() => x.f.os.record('optimizationIntervention', 'bypass', x.intervention('a'), 'ENTREPRENEUR')).toThrow(/guarded/);
});
it('approval recommendation cannot execute commercial actions, duplicate approval is avoided', () => {
    x.intervention('external', { execution: 'EXTERNAL_COMMERCIAL', autonomy: 'POLICY_APPROVED_AUTONOMOUS' });
    x.opt.select('selection', 'optimization', ['external']);
    const a = x.opt.requestExternalApproval('selection');
    expect(x.opt.requestExternalApproval('selection').id).toBe(a.id);
    expect(() => x.opt.planPrivate('selection', 'fake', [])).toThrow(/disabled|prohibited/);
    expect(db.getRecentTransactions(100)).toEqual([]);
});
it('selection respects all resource caps and deterministically chooses cheapest meaningful alternative', () => {
    x.intervention('expensive', { capitalCents: 900 });
    x.intervention('cheap', { capitalCents: 100 });
    x.intervention('tooMuchCompute', { computeUnits: 1000 });
    const a = x.opt.select('selection', 'optimization', ['expensive', 'tooMuchCompute', 'cheap']);
    expect(a.body.selected?.key).toBe('cheap');
    expect(a.body.alternatives.find(r => r.key === 'tooMuchCompute')?.eligible).toBe(false);
});
it('incompatible comparison periods are rejected and missing costs remain unknown', () => {
    expect(() => x.opt.identify('bad', x.r.key, { comparisonKey: x.analytics.report('other', { ...x.scope(), period: { start: '2026-09-01T00:00:00Z', end: '2026-09-03T00:00:00Z' } }).key })).toThrow(/period|duration|scope|comparison/);
});
