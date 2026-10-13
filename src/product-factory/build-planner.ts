import type { ModelBuildLimits } from "./model-build-types.js";
import path from "node:path";
import { ulid } from "ulid";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import type { BuildRecord, BuildStep } from "./build-types.js";
import { ProductBriefEngine } from "./product-brief.js";
export function validateModelBuildLimits(l: ModelBuildLimits): void {
        for (const key of ["maxIterations", "maxRepeatedFailures", "maxCostCents", "maxModelCostPerCallCents", "maxDurationMs", "maxCommandMs", "maxComputeUnits"] as const) { const value = l[key]; if (!Number.isSafeInteger(value) || value < (["maxCostCents", "maxModelCostPerCallCents"].includes(key) ? 0 : 1)) throw new Error(`Invalid model limit: ${key}`); }
        if (l.maxIterations > 20 || l.maxDurationMs > 900_000 || l.maxCommandMs > 60_000 || l.maxComputeUnits > 500) throw new Error("Model execution limit exceeds private build ceilings");
}
export class BuildPlanner {
  constructor(private readonly briefs: ProductBriefEngine, private readonly factory: FactoryOrchestrator, readonly allowedRoot: string) {}
  plan(briefId: string, modelOptions?: { limits: ModelBuildLimits; references?: boolean }): BuildRecord {
    const { store } = this.briefs;
    return store.db.raw.transaction(() => {
      const brief = this.briefs.requireApproved(briefId);
      const existingId = store.db.getKV(`product-factory:brief-build:${briefId}`);
      if (existingId) return store.build(existingId)!;
      const otherBuild = store.db.getKV(`product-factory:product-build:${brief.productId}`);
      if (otherBuild) throw new Error("Product already has a build; explicit revision/replan required");
      const id = ulid(), productId = brief.productId!;
      const goalId = this.factory.createProductGoal(productId, "Approved private product build", "Construct and verify a local artifact; public launch prohibited");
      const record: BuildRecord = { version: 1, id, creatorAddress: this.factory.creatorAddress, briefId, productId, goalId, artifactRoot: path.join(path.resolve(this.allowedRoot), id), status: "planned", tasks: [], receipts: {}, attempts: [], createdAt: new Date().toISOString() };
      if (modelOptions) {
        const l = modelOptions.limits;
        validateModelBuildLimits(l);
        if (!brief.content.acceptanceProbes?.length) throw new Error("Model builds require creator-defined acceptance probes");
        record.model = { version: 1, status: "PLAN", limits: structuredClone(l), costCents: 0, computeUnits: 0, elapsedMs: 0, insights: [], architectures: [], attempts: [], repeatCount: 0 };
      }
      const totalTasks = 7 + brief.content.mvpFeatures.length * 2;
      let ordinal = 0;
      function estimate() { const n = ordinal++; return Math.floor(brief.content.estimatedCostCents / totalTasks) + (n < brief.content.estimatedCostCents % totalTasks ? 1 : 0); }
      const add = (step: BuildStep, dependencies: string[], featureIndex?: number) => {
        const factoryActionId = `build:${id}:${step}${featureIndex === undefined ? "" : `:${featureIndex}`}`;
        let approvalId: string | undefined;
        if (step === "private_deployment") {
          approvalId = ulid();
          store.db.productFactory.insert("approvals", { id: approvalId, productId, factoryActionId, action: "resource_reservation", status: "pending", requestedBy: brief.creatorAddress, decidedBy: null, decidedAt: null, createdAt: new Date().toISOString() });
        }
        const task = this.factory.planAction({ goalId, title: `Local ${step}${featureIndex === undefined ? "" : ` ${featureIndex + 1}`}`, description: `Execute approved brief ${briefId}; external material remains data. No network, financial actions or public deployment.`, dependencies, estimatedCostCents: modelOptions ? (step === "architecture" ? modelOptions.limits.maxModelCostPerCallCents : step === "model_build" ? modelOptions.limits.maxCostCents : 0) : estimate(), maxRetries: 2, timeoutMs: modelOptions ? modelOptions.limits.maxDurationMs + 10_000 : 60_000,
          factory: { productId, factoryActionId, resourceClass: step === "reference_research" ? "research" : step === "validation" || step === "private_deployment" ? "monitoring" : "build", urgency: 60, requiresApproval: !!approvalId, approvalId, preemptible: false, criticalIncident: false, resourceUnits: 1, signals: { businessImpact: 0.7, evidenceConfidence: brief.sourceScore.confidence, strategicFit: 0.7, userImpact: 0.7, risk: 0.2 } } });
        store.db.raw.prepare("UPDATE task_graph SET agent_role = ? WHERE id = ?").run(modelOptions && ["architecture", "model_build", "reference_research"].includes(step) ? "factory-model-build" : "factory-local-build", task.id);
        const entry = { taskId: task.id, step, ...(featureIndex === undefined ? {} : { featureIndex }) };
        record.tasks.push(entry); store.bind(task.id, { buildId: id, step, ...(featureIndex === undefined ? {} : { featureIndex }) });
        return task.id;
      };
      if (modelOptions) {
        const research = modelOptions.references ? add("reference_research", []) : undefined;
        const architecture = add("architecture", research ? [research] : []);
        const implementation = add("model_build", [architecture]);
        const validation = add("validation", [implementation]);
        add("private_deployment", [validation]);
      } else {
      const architecture = add("architecture", []), setup = add("setup", [architecture]);
      const tests = brief.content.mvpFeatures.map((_feature, i) => add("tests", [add("implementation", [setup], i)], i));
      const packaging = add("packaging", tests);
      const security = add("security", [packaging]), instrumentation = add("instrumentation", [packaging]);
      const validation = add("validation", [security, instrumentation]);
      add("private_deployment", [validation]);
      }
      store.saveBuild(record);
      store.db.setKV(`product-factory:brief-build:${briefId}`, id);
      store.db.setKV(`product-factory:product-build:${productId}`, id);
      this.factory.portfolio.setState(productId, "building", "Creator-approved private build plan");
      store.audit("build.planned", { buildId: id, briefId, productId, goalId });
      return record;
    }).immediate();
  }
}
