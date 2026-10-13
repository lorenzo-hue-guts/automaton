import type { BuilderSurfaceCapability, MarketFormatBenchmark, ProductSurface, SurfaceFactor, SurfaceAssessment } from './optimization-types.js';
import { PRODUCT_SURFACES, SURFACE_CAPABILITIES } from './optimization-types.js';
export const MOBILE_ACCEPTANCE_CONTRACT = Object.freeze({ version: 1, surfaces: ['MOBILE_CROSS_PLATFORM', 'ANDROID', 'IOS'] as const, required: SURFACE_CAPABILITIES.filter(c => !['deployment', 'storeSubmission'].includes(c)), execution: 'Real emulator/device journeys, including navigation, persistence, invalid input, permissions, crashes and network isolation; compilation alone is insufficient', storeSubmission: 'Never implied by signing/artifact readiness; separate creator approval and policy required', recommendedPath: 'Add a narrow verified mobile harness to existing LocalWorkerPool and immutable SDK sandbox images; Android emulator/device first, iOS on an authorized macOS/Xcode runner. Reuse Task Graph, resource leases, Contract probes and policy; do not introduce another worker engine.' });
/** Defaults describe executable interfaces, not evidence of production mobile/UI capability. */
export function initialSurfaceCapability(surface: ProductSurface, at: string): BuilderSurfaceCapability {
    const partial = ['WEB_APP', 'WEB_SAAS', 'API_SERVICE'].includes(surface);
    return { surface, status: partial ? 'PARTIALLY_SUPPORTED' : 'NOT_IMPLEMENTED', capabilities: Object.fromEntries(SURFACE_CAPABILITIES.map(c => [c, { status: partial && ['generation', 'compilation', 'automatedTesting', 'runtime', 'persistence', 'networkBehavior', 'packaging'].includes(c) ? 'EXPERIMENTAL' : 'NOT_IMPLEMENTED', proof: null }])) as BuilderSurfaceCapability['capabilities'], limitations: partial ? ['Node/TypeScript and private HTTP execution demonstrated with contract-compatible deterministic models; no arbitrary real-model generation or real browser acceptance demonstrated', 'UI, authentication, payments and public deployment are not universally verified'] : ['No verified execution acceptance for this surface'], verifiedAt: at, changeReason: 'Conservative registry initialized from Lots 4B/4C demonstrated scope' };
}
/** Explainable contextual rules, not a universal numerical surface score. */
export function reasonAboutSurface(factors: SurfaceFactor[], benchmark: MarketFormatBenchmark, alternatives: SurfaceAssessment[]): {
    longTerm: ProductSurface;
    validation: ProductSurface;
    reasons: string[];
    hypotheses: string[];
} {
    const known = (name: string) => factors.some(f => f.name === name && f.value === true && f.confidence >= .5 && f.evidenceIds.length > 0);
    const reasons: string[] = [], hypotheses: string[] = [];
    let longTerm: ProductSurface = 'UNDECIDED';
    if (known('native_required')) {
        longTerm = 'MOBILE_CROSS_PLATFORM';
        reasons.push('Verified workflow requires native device/offline/background behavior; competitor prevalence does not override requirements');
    }
    else if (known('api_workflow')) {
        longTerm = 'API_SERVICE';
        reasons.push('Integration/service workflow favors an API interface');
    }
    else if (known('browser_embedded')) {
        longTerm = 'BROWSER_EXTENSION';
        reasons.push('Value occurs inside an existing browser workflow');
    }
    else if (known('desktop_native')) {
        longTerm = 'DESKTOP';
        reasons.push('Desktop/offline/native workflow is material');
    }
    else if (known('mobile_sessions') && known('push_value')) {
        longTerm = 'MOBILE_CROSS_PLATFORM';
        reasons.push('Repeated mobile sessions and notification value supported');
    }
    else if (known('mobile_sessions') && known('web_distribution')) {
        longTerm = 'PWA';
        reasons.push('Mobile access and web distribution; store dependence not required');
    }
    else if (known('desktop_workflow') || known('web_distribution') || known('collaboration')) {
        longTerm = 'WEB_APP';
        reasons.push('Browser access/desktop collaboration supported; monetization remains a separate decision');
    }
    else {
        reasons.push('User workflow/context evidence insufficient to determine surface');
        hypotheses.push('Research device/context and main workflow before committing');
    }
    const counts = Object.fromEntries(PRODUCT_SURFACES.map(s => [s, benchmark.observations.filter(o => o.surface === s).length]));
    reasons.push(`Competitor format observations: ${JSON.stringify(counts)}; prevalence is evidence, not a command`);
    const nativeAlternative = alternatives.find(a => a.surface === longTerm), cheaper = alternatives.filter(a => a.surface !== 'MULTI_SURFACE' && a.surface !== 'UNDECIDED' && a.canTestCriticalQuestion && a.evidenceIds.length && a.validationCost.low >= 0 && (!nativeAlternative || a.validationCost.high < nativeAlternative.validationCost.low)).sort((a, b) => a.validationCost.high - b.validationCost.high || a.effortHours.high - b.effortHours.high || a.surface.localeCompare(b.surface));
    const validation = longTerm === 'UNDECIDED' ? 'UNDECIDED' : cheaper[0]?.surface ?? longTerm;
    if (validation !== longTerm)
        reasons.push(`${validation} can test the declared critical question more cheaply; preserve ${longTerm} as long-term surface`);
    return { longTerm, validation, reasons, hypotheses };
}
export function validateSurface(s: unknown): asserts s is ProductSurface {
    if (!PRODUCT_SURFACES.includes(s as ProductSurface))
        throw Error('Unknown product surface');
}
