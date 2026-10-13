import { sanitizeToolResult } from "../agent/injection-defense.js";
import { buildHash } from "./build-store.js";
import type { ProductReferenceInsight, ProductReferenceProvider, ReferenceObservation } from "./model-build-types.js";
export class FixtureProductReferenceProvider implements ProductReferenceProvider {
  readonly mode = "fixture" as const;
  constructor(readonly id: string, private readonly observations: readonly ReferenceObservation[]) {}
  async collect(): Promise<readonly ReferenceObservation[]> { return structuredClone(this.observations); }
}
export async function collectReferenceInsights(problem: string, providers: readonly ProductReferenceProvider[]): Promise<{ insights: ProductReferenceInsight[]; failedProviders: string[] }> {
  const kinds = ["common_pattern", "expected_feature", "differentiator", "strength", "weakness", "recurring_complaint", "onboarding", "pricing", "improvement", "anti_pattern"];
  const results = await Promise.allSettled(providers.map(async (provider) => {
    if (provider.mode !== "fixture" || !provider.id.trim()) throw new Error("Only fixture references enabled");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let observations: readonly ReferenceObservation[];
    try { observations = await Promise.race([provider.collect(problem), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Reference source timeout")), 5000); })]); }
    finally { if (deadline) clearTimeout(deadline); }
    if (observations.length > 100) throw new Error("Reference batch limit");
    return observations.map((o): ProductReferenceInsight => {
      if (!kinds.includes(o.kind) || !o.sourceRef?.trim() || !Number.isFinite(Date.parse(o.capturedAt)) || !o.summary?.trim() || o.summary.length > 10_000 || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1 || !["public_page", "public_review", "public_docs", "open_source"].includes(o.sourceType)) throw new Error("Invalid reference provenance");
      if (o.sourceType === "open_source" && !["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(o.license ?? "")) throw new Error("Unreviewed reference license");
      return { ...o, summary: sanitizeToolResult(o.summary, 10_000), providerId: provider.id, contentHash: buildHash(o.summary), trust: "untrusted-external-data" };
    });
  }));
  const insights = new Map<string, ProductReferenceInsight>(), failedProviders: string[] = [];
  results.forEach((result, i) => { if (result.status === "rejected") failedProviders.push(providers[i].id); else for (const insight of result.value) insights.set(`${insight.sourceRef}:${insight.kind}:${insight.contentHash}`, insight); });
  return { insights: [...insights.values()].sort((a, b) => a.contentHash.localeCompare(b.contentHash)), failedProviders };
}
