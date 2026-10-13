import type { Intervention, OptimizationCapacity, OptimizationOpportunity, OptimizationOutcome } from './optimization-types.js';
import type { ExperimentAnalyticsResult } from './analytics-types.js';
/** Materially distinct product mechanisms; economic effects stay UNKNOWN until supplied with provenance. */
export function interventionMechanisms(kind: OptimizationOpportunity['class']): string[] {
    const domain: Partial<Record<OptimizationOpportunity['class'], string[]>> = { ACTIVATION: ['Guide first value with representative examples', 'Remove unnecessary workflow steps', 'Investigate activation failures with private journey probes'], TIME_TO_VALUE: ['Preconfigure a useful starting state', 'Simplify data import', 'Measure primary journey latency'], RETENTION: ['Repair observed reliability friction', 'Improve repeated workflow value', 'Research documented churn reasons'], CHURN: ['Investigate failed payments separately from voluntary churn', 'Repair missing integration', 'Test improved onboarding'], COST: ['Reduce wasteful inference using verified caching', 'Profile expensive requests and simplify compute', 'Evaluate a cheaper compatible dependency'], RELIABILITY: ['Repair the critical failure path', 'Roll back the responsible private change', 'Add failure recovery and error handling'], PRICING: ['Test value-aligned packaging privately', 'Research buyer willingness to pay', 'Compare one-time and recurring value'], PRODUCT_SURFACE: ['Prototype the critical device workflow', 'Validate demand with a cheaper surface', 'Research market consumption format'], NEW_PRODUCT: ['Research the highest-risk thesis', 'Prototype the narrow wedge', 'Compare feature or bundle with independent product'], ACQUISITION: ['Evaluate an alternative qualified distribution channel', 'Test message comprehension privately', 'Research channel saturation'] };
    return domain[kind] ?? ['Improve the measured primary user journey', 'Simplify the product scope to increase value', 'Research the highest-value uncertainty'];
}
export function ethicalIntervention(i: Intervention): boolean {
    return i.ethicalFlags.length === 0 && !/obstruct.*cancel|fake reviews|spam|deceptive|dark pattern|hide.*cost/i.test(i.mechanism + ' ' + i.customerValue);
}
export function selectValuableExperiment(candidates: {
    key: string;
    body: Intervention;
}[], capacity: OptimizationCapacity, confidence: number) {
    const rows = candidates.map(c => {
        const i = c.body;
        const reasons: string[] = [];
        if (!ethicalIntervention(i) || i.autonomy === 'PROHIBITED')
            reasons.push('Prohibited/unsafe customer treatment');
        if (!i.measurement.canAnswer || !i.measurement.reason.trim() || !i.uncertainty.trim() || !i.informationValue || i.informationValue.low <= 0)
            reasons.push('Cheap activity cannot answer the material uncertainty');
        if (i.confidence < confidence)
            reasons.push('Evidence/confidence insufficient');
        if (i.capitalCents > capacity.capitalCents || i.builderHours > capacity.builderHours || i.computeUnits > capacity.computeUnits || i.inferenceCents > capacity.inferenceCents || i.durationMs > capacity.durationMs)
            reasons.push('Scarce money/Builder/compute/inference/time capacity exceeded');
        return { ...c, eligible: !reasons.length, reason: reasons.join('; ') || 'Bounded meaningful experiment' };
    });
    const eligible = rows.filter(r => r.eligible).sort((a, b) => b.body.criticalAssumptionIds.length - a.body.criticalAssumptionIds.length || a.body.capitalCents - b.body.capitalCents || a.body.builderHours - b.body.builderHours || a.body.computeUnits - b.body.computeUnits || a.body.durationMs - b.body.durationMs || a.key.localeCompare(b.key));
    return { selected: eligible[0]?.key ?? null, rows: rows.map(r => ({ key: r.key, eligible: r.eligible, reason: r.reason })), reasons: eligible.length ? ['Critical uncertainty first; choose cheapest meaningful feasible experiment, preserving opportunity cost and uncertainty'] : ['HOLD: no acceptable meaningful experiment; doing nothing is valid'] };
}
export function guardedOptimizationOutcome(requested: OptimizationOutcome, result: ExperimentAnalyticsResult | null, observed: boolean, health: string | undefined): {
    outcome: OptimizationOutcome;
    reasons: string[];
} {
    if (!result)
        return { outcome: 'HOLD', reasons: ['Measurement result unavailable; generation/execution alone does not establish economic success'] };
    const guardrails = result.guardrails as {
        passed?: boolean;
    }[];
    if (guardrails.some(g => g.passed === false) || !['CANDIDATE_IMPROVEMENT'].includes(result.status))
        return { outcome: result.status === 'GUARDRAIL_FAILED' ? 'ROLL_BACK' : 'RETEST', reasons: ['Guardrails, sample size or primary outcome do not support unconditional adoption'] };
    if (!observed)
        return { outcome: 'RETEST', reasons: ['Synthetic/private evidence cannot establish real economic improvement'] };
    if (health === 'critical' || health === 'degraded')
        return { outcome: 'HOLD', reasons: ['Product Health blocks growth/adoption; PROTECT first'] };
    return { outcome: requested, reasons: ['Canonical measured experiment supports a governed recommendation; no execution authorization'] };
}
