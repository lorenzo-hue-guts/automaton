import type { OptimizationConfig } from './optimization-types.js';
export const DEFAULT_OPTIMIZATION_CONFIG: Readonly<OptimizationConfig> = Object.freeze({ enabled: false, allowPrivateExperiments: false, maxCandidates: 12, maxExperimentCostCents: 0, maxExperimentBuilderHours: 1, maxExperimentComputeUnits: 8, maxExperimentInferenceCents: 0, maxExperimentDurationMs: 30000, minConfidence: .5 });
export function resolveOptimizationConfig(input: unknown = {}): OptimizationConfig {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw Error('Invalid optimization configuration');
    const out = { ...DEFAULT_OPTIMIZATION_CONFIG };
    for (const [k, v] of Object.entries(input)) {
        if (!Object.hasOwn(out, k))
            throw Error('Unknown optimization setting');
        if (k === 'enabled' || k === 'allowPrivateExperiments') {
            if (typeof v !== 'boolean')
                throw Error('Invalid optimization flag');
            (out as unknown as Record<string, unknown>)[k] = v;
        }
        else {
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0)
                throw Error('Invalid optimization limit');
            (out as unknown as Record<string, unknown>)[k] = v;
        }
    }
    if (!Number.isInteger(out.maxCandidates) || out.maxCandidates < 1 || out.maxCandidates > 50 || !Number.isSafeInteger(out.maxExperimentCostCents) || !Number.isSafeInteger(out.maxExperimentInferenceCents) || !Number.isSafeInteger(out.maxExperimentComputeUnits) || !Number.isSafeInteger(out.maxExperimentDurationMs) || out.maxExperimentDurationMs < 1 || out.maxExperimentDurationMs > 60000 || out.minConfidence > 1)
        throw Error('Optimization ceiling exceeded');
    return out;
}
