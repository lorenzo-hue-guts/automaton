import { validateSignal } from "./evidence-engine.js";
import { SCORE_WEIGHTS, type AtomicEvidence, type OpportunityAssessment, type OpportunityClassification, type OpportunityScore, type ScoreCriterion } from "./discovery-types.js";

export function classifyOpportunity(score: number): OpportunityClassification {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("Score must be between 0 and 100");
  return score < 55 ? "archive_reject" : score < 70 ? "research" : score < 80 ? "prototype_validation_candidate" : "mvp_candidate";
}
export function validateAssessment(assessment: OpportunityAssessment): void {
  for (const criterion of Object.keys(SCORE_WEIGHTS) as ScoreCriterion[]) {
    const value = assessment.values?.[criterion];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid assessment: ${criterion}`);
  }
  if (!Number.isSafeInteger(assessment.estimatedCostCents) || assessment.estimatedCostCents < 0 || !Number.isFinite(assessment.risk) || assessment.risk < 0 || assessment.risk > 1 || !Array.isArray(assessment.unverifiedHypotheses) || assessment.unverifiedHypotheses.some((h) => typeof h !== "string" || !h.trim())) throw new Error("Invalid opportunity assessment");
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;
/** Pure, bounded and order independent. Syndicated observations never multiply support. */
export function scoreOpportunity(assessment: OpportunityAssessment, evidence: readonly AtomicEvidence[]): OpportunityScore {
  validateAssessment(assessment);
  for (const e of evidence) {
    validateSignal(e.provenance);
    if (e.provenance.trust !== "untrusted-external-data" || e.opportunityId !== e.provenance.opportunityId || (evidence[0] && e.opportunityId !== evidence[0].opportunityId)) throw new Error("Invalid or mixed evidence");
  }
  const sorted = [...evidence].sort((a, b) => a.id.localeCompare(b.id));
  const breakdown = {} as OpportunityScore["breakdown"];
  const hypotheses = new Set(assessment.unverifiedHypotheses);
  let confidence = 0;
  for (const criterion of Object.keys(SCORE_WEIGHTS) as ScoreCriterion[]) {
    const relevant = sorted.filter((e) => e.provenance.criterion === criterion);
    const groups = new Map<string, { supports: number; refutes: number }>();
    for (const e of relevant) {
      const p = e.provenance;
      if (p.kind === "hypothesis") { hypotheses.add(p.summary); continue; }
      const reliability = p.reliability * (p.kind === "inference" ? 0.5 : 1);
      const group = groups.get(p.independenceKey) ?? { supports: 0, refutes: 0 };
      group[p.relation] = Math.max(group[p.relation], reliability);
      groups.set(p.independenceKey, group);
    }
    const supports = [...groups.values()].reduce((sum, g) => sum + g.supports, 0);
    const refutes = [...groups.values()].reduce((sum, g) => sum + g.refutes, 0);
    const factor = supports + refutes > 0 ? supports / (supports + refutes) : 0;
    const weight = SCORE_WEIGHTS[criterion];
    breakdown[criterion] = { weight, assessedValue: assessment.values[criterion], evidenceFactor: round(factor), points: round(weight * assessment.values[criterion] * factor), evidenceIds: relevant.map((e) => e.id) };
    // One reliable observation yields 50% certainty; independent corroboration saturates at two.
    confidence += weight * Math.min(1, (supports + refutes) / 2) * factor * factor / 100;
    if (supports === 0) hypotheses.add(`Unverified: ${criterion}`);
  }
  const usable = sorted.filter((e) => e.provenance.kind !== "hypothesis" && e.provenance.reliability > 0);
  const independent = new Map<string, number>();
  for (const e of usable) independent.set(e.provenance.independenceKey, Math.max(independent.get(e.provenance.independenceKey) ?? 0, e.provenance.reliability));
  const total = round(Object.values(breakdown).reduce((sum, b) => sum + b.points, 0));
  return { valid: usable.length > 0, breakdown, total, confidence: round(confidence), classification: classifyOpportunity(total), evidenceIds: sorted.map((e) => e.id), evidenceQuality: independent.size ? round([...independent.values()].reduce((a, b) => a + b, 0) / independent.size) : 0, evidenceDiversity: new Set(usable.map((e) => e.provenance.sourceType)).size, unverifiedHypotheses: [...hypotheses].sort() };
}
