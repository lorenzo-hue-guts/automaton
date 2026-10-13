import type { TaskGraphRow } from "../state/database.js";
import type { AllocationExplanation } from "./scheduling-types.js";

/** Pure scoring: bounded business terms plus an unbounded age bonus for eligible work. */
export function explainAllocation(task: TaskGraphRow, now: Date, dependenciesSatisfied: boolean, ageBonusPerHour = 10): AllocationExplanation {
  if (!task.factory) throw new Error("Not a Factory task");
  const f = task.factory;
  const ageHours = Math.max(0, (now.getTime() - Date.parse(task.createdAt)) / 3_600_000);
  const deadlineHours = f.deadline ? (Date.parse(f.deadline) - now.getTime()) / 3_600_000 : Infinity;
  const components = {
    businessImpact: 100 * f.signals.businessImpact,
    urgency: 2 * f.urgency,
    evidenceConfidence: 50 * f.signals.evidenceConfidence,
    strategicFit: 40 * f.signals.strategicFit,
    userImpact: 60 * f.signals.userImpact,
    estimatedCost: -Math.min(100, task.estimatedCostCents / 10),
    risk: -100 * f.signals.risk,
    dependencies: dependenciesSatisfied ? 20 : -1000,
    ageBonus: ageHours * ageBonusPerHour,
    deadline: f.deadline ? Math.max(0, Math.min(100, 100 - deadlineHours)) : 0,
  };
  return { taskId: task.id, score: Object.values(components).reduce((sum, value) => sum + value, 0), components, dependenciesSatisfied, criticalIncident: f.criticalIncident };
}
export function compareAllocations(a: AllocationExplanation, b: AllocationExplanation): number {
  return Number(b.criticalIncident) - Number(a.criticalIncident) || b.score - a.score || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
}
