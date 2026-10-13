import { ModelBuildHarness } from "./model-build-harness.js";
import { ModelBuilder, type ModelBuilderServices } from "./model-builder.js";
import path from "node:path";
import vm from "node:vm";
import { ulid } from "ulid";
import type { AutomatonDatabase, AutomatonTool } from "../types.js";
import type { HarnessRegistry } from "../agent/harness-registry.js";
import type { AgentHarness, HarnessContext } from "../agent/harness-types.js";
import type { LocalWorkerPool, FactoryWorkerHooks } from "../orchestration/local-worker.js";
import { taskRowToTaskNode } from "../orchestration/task-graph.js";
import type { TaskNode, TaskResult } from "../orchestration/task-graph.js";
import { getTaskById } from "../state/database.js";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import { BuildStore } from "./build-store.js";
import { ProductBriefEngine } from "./product-brief.js";
import { BuildPlanner } from "./build-planner.js";
import { BuildValidator, PublicLaunchGate, receiptHash } from "./build-validator.js";
import { FactoryBuildHarness } from "./factory-build-harness.js";
import { SyntheticPrivateDeploymentProvider } from "./private-deployment.js";
import { readArtifact, writeArtifact } from "./local-artifacts.js";
import type { BuildCheck, BuildArtifact, BuildReceipt, BuildRecord, BuildTaskBinding } from "./build-types.js";

const featureSource = (title: string) => `function(input){return {feature:${JSON.stringify(title)},input:String(input)};}`;
const bundleSource = (titles: string[]) => `module.exports={features:[${titles.map(featureSource).join(",")}],metrics:{request_count:0},run:function(index,input){this.metrics.request_count++;return this.features[index](input);}};`;
/** Build adapter on LocalWorkerPool. Fixture and bounded model harnesses share the existing execution path. */
export class BuildEngine {
  readonly store: BuildStore;
  readonly briefs: ProductBriefEngine;
  readonly planner: BuildPlanner;
  readonly validator: BuildValidator;
  readonly publicLaunch: PublicLaunchGate;
  private readonly started = new Map<string, number>();
  constructor(private readonly db: AutomatonDatabase, readonly factory: FactoryOrchestrator, readonly allowedRoot: string,
    private readonly deploymentProvider = new SyntheticPrivateDeploymentProvider(), private readonly modelServices?: ModelBuilderServices) {
    if (Object.getPrototypeOf(deploymentProvider) !== SyntheticPrivateDeploymentProvider.prototype) throw new Error("Only the synthetic private deployment provider is enabled");
    this.store = new BuildStore(db, factory.creatorAddress);
    this.briefs = new ProductBriefEngine(this.store, factory);
    this.planner = new BuildPlanner(this.briefs, factory, allowedRoot);
    this.validator = new BuildValidator(this.store, factory, allowedRoot);
    this.publicLaunch = new PublicLaunchGate(this.store, factory);
  }
  registerHarness(registry: HarnessRegistry): void { registry.register("factory-local-build", FactoryBuildHarness); registry.register("factory-model-build", ModelBuildHarness); }
  connectWorkers(pool: LocalWorkerPool): () => void {
    return this.factory.registerLocalDispatcher(() => this.dispatchAssigned(pool));
  }
  dispatchAssigned(pool: LocalWorkerPool): number {
    if (!this.factory.resources.config.enabled || ["PAUSED", "FAILED"].includes(this.factory.state)) return 0;
    const rows = this.db.raw.prepare("SELECT id FROM task_graph WHERE status = 'assigned' AND agent_role IN ('factory-local-build','factory-model-build') ORDER BY id").all() as { id: string }[];
    let spawned = 0;
    for (const row of rows) {
      if (!this.store.binding(row.id)) continue;
      const task = taskRowToTaskNode(getTaskById(this.db.raw, row.id)!);
      try { pool.spawn(task); spawned++; }
      catch { this.fail(task, "Worker dispatch failed", 0); }
    }
    return spawned;
  }
  workerHooks(): FactoryWorkerHooks {
    return { before: (task, context, harness) => this.before(task, context, harness), complete: (task, result) => this.complete(task, result), fail: (task, error, cost) => this.fail(task, error, cost) };
  }
  private current(taskId: string): { build: BuildRecord; binding: BuildTaskBinding } {
    const binding = this.store.binding(taskId), build = binding ? this.store.build(binding.buildId) : undefined;
    if (!binding || !build || !build.tasks.some((t) => t.taskId === taskId && t.step === binding.step)) throw new Error("Unknown owned build action");
    const task=getTaskById(this.db.raw,taskId);
    const action=`build:${build.id}:${binding.step}${binding.featureIndex===undefined?"":`:${binding.featureIndex}`}`;
    if (task?.factory?.productId!==build.productId || task.factory.factoryActionId!==action) throw new Error("Build action product/reservation ownership mismatch");
    if (build.artifactRoot !== path.join(path.resolve(this.allowedRoot), build.id)) throw new Error("Build root changed or escapes allowed workspace");
    return { build, binding };
  }
  private before(task: TaskNode, context: HarnessContext, harness: AgentHarness): void {
    if (!this.factory.resources.config.enabled || context.db !== this.db.raw || !(harness instanceof FactoryBuildHarness || harness instanceof ModelBuildHarness) || !context.policyEngine || !context.toolContext || !context.spendTracker) throw new Error("Factory execution fails closed without its local harness and policy");
    const { build, binding } = this.current(task.id);
    if (binding.step !== "rollback") this.briefs.requireApproved(build.briefId);
    if (!this.factory.portfolio.canReceiveWork(build.productId)) throw new Error("Product cannot execute work");
    if (context.abortSignal.aborted) throw new Error("Worker aborted");
    this.factory.resources.start(task.id);
    this.started.set(task.id, Date.now());
    if (harness instanceof ModelBuildHarness) {
      if (!build.model || !this.modelServices) throw new Error("Model builder services unavailable");
      context.factoryModelRun = () => new ModelBuilder(this.store, this.factory, this.modelServices!).run(task, context);
      context.allowedEditRoot = build.artifactRoot;
      return;
    }
    context.budget.maxCostCents = task.metadata.estimatedCostCents;
    context.allowedEditRoot = build.artifactRoot;
    context.inference = { chat: async () => { throw new Error("External inference disabled for local Factory build"); } };
    const tool: AutomatonTool = { name: "factory_build_step", description: "Approved local fixture build, validation or private metadata operation", parameters: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] }, category: "vm", riskLevel: "caution",
      execute: async (args) => {
        if (args.taskId !== task.id || context.abortSignal.aborted) throw new Error("Wrong or aborted worker action");
        return JSON.stringify(this.perform(task.id));
      } };
    context.toolCatalog = [tool];
  }
  private perform(taskId: string): TaskResult {
    return this.db.raw.transaction(() => {
      const { build, binding } = this.current(taskId), task = getTaskById(this.db.raw, taskId)!;
      const lease = this.factory.resources.leases(true).find((r) => r.taskId === taskId);
      if (task.status !== "running" || !lease || Date.parse(lease.expiresAt) <= Date.now()) throw new Error("Build action lacks a live resource lease");
      const brief = binding.step === "rollback" ? this.store.brief(build.briefId)! : this.briefs.requireApproved(build.briefId), titles = brief.content.mvpFeatures.map((f) => f.title);
      const artifacts: BuildArtifact[] = [], checks: BuildCheck[] = [];
      const write = (name: string, content: string) => artifacts.push(writeArtifact(build.artifactRoot, name, content));
      const check = (id: string, passed: boolean, detail: string) => { checks.push({ id, passed, detail }); if (!passed) throw new Error(`Local check failed: ${id}`); };
      const expectedBundle = bundleSource(titles);
      switch (binding.step) {
        case "architecture": write("architecture.json", JSON.stringify({ architecture: brief.content.architecture, briefId: brief.id, publicLaunch: false })); break;
        case "setup": write("package.json", JSON.stringify({ name: `private-${build.id.toLowerCase()}`, private: true, dependencies: {} })); break;
        case "implementation": write(`feature-${binding.featureIndex}.cjs`, `module.exports=${featureSource(titles[binding.featureIndex!])};`); break;
        case "tests": {
          const index = binding.featureIndex!, expected = `module.exports=${featureSource(titles[index])};`;
          check(`source:${index}`, readArtifact(build.artifactRoot, `feature-${index}.cjs`) === expected, "Generated source matches trusted local template");
          // Execute only regenerated known code, never filesystem/external code. VM is not a security boundary.
          const sandbox = { module: { exports: undefined as unknown } };
          vm.runInNewContext(expected, sandbox, { timeout: 100 });
          const output = (sandbox.module.exports as (input: string) => { feature: string; input: string })("smoke");
          check(`feature:${index}`, output.feature === titles[index] && output.input === "smoke", "Deterministic generated feature smoke test");
          write(`tests-${index}.json`, JSON.stringify(checks)); break;
        }
        case "packaging":
          titles.forEach((title, i) => { if (readArtifact(build.artifactRoot, `feature-${i}.cjs`) !== `module.exports=${featureSource(title)};`) throw new Error("Source changed since tests"); });
          write("bundle.cjs", expectedBundle); break;
        case "security":
          check("security:no-network", readArtifact(build.artifactRoot, "bundle.cjs") === expectedBundle && JSON.parse(readArtifact(build.artifactRoot, "package.json")).private === true, "Trusted template has no transport, shell, credentials or public listener");
          write("security.json", JSON.stringify(checks)); break;
        case "instrumentation": {
          if (readArtifact(build.artifactRoot, "bundle.cjs") !== expectedBundle) throw new Error("Untrusted bundle");
          const sandbox = { module: { exports: undefined as unknown } };
          vm.runInNewContext(expectedBundle, sandbox, { timeout: 100 });
          const generated = sandbox.module.exports as { run: (i: number, input: string) => unknown; metrics: { request_count: number } };
          generated.run(0, "smoke");
          check("metric:request_count", generated.metrics.request_count === 1, "Request counter increments on a real local invocation");
          write("instrumentation.json", JSON.stringify(checks)); break;
        }
        case "validation": {
          const validation = this.validator.validate(build.id);
          if (!validation.passed) throw new Error(validation.errors.join("; "));
          build.validation = validation; build.status = "validated"; break;
        }
        case "private_deployment": {
          const validation = this.validator.validate(build.id, true);
          if (!validation.passed) throw new Error("Private deployment requires completed validation");
          const existing = build.deploymentId ? this.store.deployment(build.deploymentId) : undefined;
          const deployment = existing?.status === "active" ? existing : this.deploymentProvider.deploy(build, validation);
          if (deployment.buildDigest !== validation.artifactDigest) throw new Error("Deployment build digest mismatch");
          this.store.saveDeployment(deployment); build.deploymentId = deployment.id; build.status = "private_deployed";
          this.store.audit("deployment.private", { buildId: build.id, deploymentId: deployment.id, productId: build.productId }); break;
        }
        case "rollback": {
          const deployment = build.deploymentId ? this.store.deployment(build.deploymentId) : undefined;
          if (!deployment) throw new Error("No private deployment to roll back");
          this.store.saveDeployment(this.deploymentProvider.rollback(deployment)); build.status = "rolled_back";
          this.db.setKV(`product-factory:launch-readiness:${build.productId}`, "revoked");
          this.factory.portfolio.setState(build.productId, "validation", "Private deployment rolled back");
          this.store.audit("deployment.rolled_back", { buildId: build.id, deploymentId: deployment.id }); break;
        }
      }
      const body: Omit<BuildReceipt, "hash"> = { taskId, step: binding.step, attempt: task.retryCount, artifacts, checks, computeUnits: lease.units, costCents: 0, durationMs: Math.max(0, Date.now() - (this.started.get(taskId) ?? Date.now())) };
      const receipt = { ...body, hash: receiptHash(body) };
      build.receipts[taskId] = receipt;
      if (build.status === "planned") build.status = "building";
      this.store.saveBuild(build);
      return { success: true, output: "Verified local build step completed", artifacts: artifacts.map((a) => a.path), costCents: 0, duration: body.durationMs, factoryReceipt: { buildId: build.id, step: binding.step, hash: receipt.hash } };
    }).immediate();
  }
  private complete(task: TaskNode, result: TaskResult): void {
    this.db.raw.transaction(() => {
      const { build, binding } = this.current(task.id), receipt = build.receipts[task.id];
      const lease = this.factory.resources.leases(true).find((r) => r.taskId === task.id);
      if (!lease || Date.parse(lease.expiresAt) <= Date.now()) throw new Error("Worker acknowledgement requires an unexpired lease");
      if (!result.success || !receipt || result.factoryReceipt?.hash !== receipt.hash || result.factoryReceipt.buildId !== build.id || result.costCents !== receipt.costCents) throw new Error("Agent assertion is not a trusted build receipt");
      this.factory.resources.complete(task.id, result);
      build.attempts.push({ taskId: task.id, attempt: receipt.attempt, success: true, costCents: result.costCents, computeUnits: receipt.computeUnits, durationMs: receipt.durationMs });
      this.store.saveBuild(build); this.store.audit("build.task_completed", { buildId: build.id, taskId: task.id });
      if (binding.step === "validation") this.factory.portfolio.setState(build.productId, "validation", "Required local build, tests, artifacts, security and instrumentation verified");
      if (binding.step === "private_deployment") this.validator.promote(build.id);
    }).immediate();
    this.started.delete(task.id);
  }
  private fail(task: TaskNode, _error: string, costCents: number): void {
    const row = getTaskById(this.db.raw, task.id);
    // Cancellation, replan and timeout can already have acknowledged/released this attempt.
    if (!row || !["assigned", "running"].includes(row.status) || !this.factory.resources.leases(true).some((r) => r.taskId === task.id)) { this.started.delete(task.id); return; }
    this.db.raw.transaction(() => {
      const { build } = this.current(task.id);
      this.factory.resources.fail(task.id, "Local Factory build action failed", !build.model || !["FAILED", "BLOCKED", "NEEDS_REPLAN"].includes(build.model.status), costCents);
      delete build.receipts[task.id];
      build.attempts.push({ taskId: task.id, attempt: row.retryCount, success: false, costCents, computeUnits: row.factory!.resourceUnits, durationMs: Math.max(0, Date.now() - (this.started.get(task.id) ?? Date.now())) });
      if (getTaskById(this.db.raw, task.id)?.status === "failed") build.status = "failed";
      this.store.saveBuild(build); this.store.audit("build.task_failed", { buildId: build.id, taskId: task.id });
    }).immediate();
    this.started.delete(task.id);
  }
  requestRollback(buildId: string): { taskId: string; approvalId: string } {
    if (!this.factory.resources.config.enabled) throw new Error("Product Factory is disabled");
    return this.db.raw.transaction(() => {
      const build = this.store.build(buildId);
      if (!build?.deploymentId || !this.store.deployment(build.deploymentId)) throw new Error("Private deployment required");
      const existing = build.tasks.find((t) => t.step === "rollback");
      if (existing) return { taskId: existing.taskId, approvalId: getTaskById(this.db.raw, existing.taskId)!.factory!.approvalId! };
      const factoryActionId = `build:${buildId}:rollback`, approvalId = ulid();
      this.db.productFactory.insert("approvals", { id: approvalId, productId: build.productId, factoryActionId, action: "resource_reservation", status: "pending", requestedBy: this.factory.creatorAddress, decidedBy: null, decidedAt: null, createdAt: new Date().toISOString() });
      const goalId = this.factory.createProductGoal(build.productId, "Private rollback", "Revoke synthetic private deployment metadata");
      const task = this.factory.planAction({ goalId, title: "Private rollback", description: "No network or public actions", estimatedCostCents: 0, factory: { productId: build.productId, factoryActionId, resourceClass: "monitoring", requiresApproval: true, approvalId, preemptible: false, criticalIncident: false, resourceUnits: 1, urgency: 60, signals: { businessImpact: 0.5, evidenceConfidence: 1, strategicFit: 0.5, userImpact: 0.5, risk: 0 } } });
      this.db.raw.prepare("UPDATE task_graph SET agent_role = 'factory-local-build' WHERE id = ?").run(task.id);
      build.tasks.push({ taskId: task.id, step: "rollback" }); this.store.bind(task.id, { buildId, step: "rollback" }); this.store.saveBuild(build);
      return { taskId: task.id, approvalId };
    }).immediate();
  }
}
