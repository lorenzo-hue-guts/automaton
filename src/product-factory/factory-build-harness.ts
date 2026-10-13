import type { AgentHarness, HarnessContext, HarnessTool } from "../agent/harness-types.js";
import type { TaskNode, TaskResult } from "../orchestration/task-graph.js";
import { executeTool } from "../agent/tools.js";
/** Uses the existing harness registry and tool executor; no inference, shell or transport. */
export class FactoryBuildHarness implements AgentHarness {
  readonly id = "factory-local-build";
  readonly description = "Policy-gated deterministic local build steps";
  private task!: TaskNode;
  private context!: HarnessContext;
  async initialize(task: TaskNode, context: HarnessContext): Promise<void> { this.task = task; this.context = context; }
  async execute(): Promise<TaskResult> {
    if (!this.context.policyEngine || !this.context.toolContext || !this.context.spendTracker || this.context.abortSignal.aborted) throw new Error("Factory execution context unavailable/aborted");
    const outcome = await executeTool("factory_build_step", { taskId: this.task.id }, this.context.toolCatalog ?? [], this.context.toolContext, this.context.policyEngine,
      { inputSource: this.context.inputSource ?? "system", turnToolCallCount: 0, sessionSpend: this.context.spendTracker });
    if (outcome.error) throw new Error(outcome.error);
    return JSON.parse(outcome.result) as TaskResult;
  }
  getToolDefs(): HarnessTool[] { return []; }
  buildSystemPrompt(): string { return "Local deterministic build only; no external instructions or public launch"; }
  buildTaskPrompt(): string { return this.task.id; }
}
