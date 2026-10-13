import { ulid } from "ulid";
import { getTaskById } from "../state/database.js";
import { BuildStore,buildHash } from "./build-store.js";
import { ProductBriefEngine } from "./product-brief.js";
import { validateModelBuildLimits } from "./build-planner.js";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import type { ModelBuildLimits } from "./model-build-types.js";

/** Explicit human-approved continuation of the same graph; completed tasks are untouched. */
export class ModelBuildResume {
  constructor(private readonly store: BuildStore, private readonly factory: FactoryOrchestrator) {}
  request(buildId: string, limits: ModelBuildLimits): string {
    validateModelBuildLimits(limits);
    return this.store.db.raw.transaction(()=>{
      const build=this.store.build(buildId);
      if (!build?.model || build.status!=="failed") throw new Error("Failed owned model build required");
      new ProductBriefEngine(this.store,this.factory).requireApproved(build.briefId);
      const product=this.factory.portfolio.get(build.productId)!;
      if (["killed","archived"].includes(product.portfolioState) || product.stage==="archived") throw new Error("Terminal product cannot resume automatically");
      if (build.tasks.some(t=>["assigned","running"].includes(getTaskById(this.store.db.raw,t.taskId)?.status??""))) throw new Error("Active build cannot resume");
      if (limits.maxIterations<=build.model.attempts.length || limits.maxCostCents<build.model.costCents || limits.maxDurationMs<=build.model.elapsedMs || limits.maxComputeUnits<=build.model.computeUnits) throw new Error("Resume ceilings must cover persisted consumption");
      const taskIds=build.tasks.filter(t=>["failed","cancelled"].includes(getTaskById(this.store.db.raw,t.taskId)?.status??"")).map(t=>t.taskId);
      const requestHash=buildHash(JSON.stringify({limits,taskIds}));
      const approvalId=ulid();
      this.store.db.productFactory.insert("approvals",{id:approvalId,productId:build.productId,factoryActionId:`model-resume:${buildId}:${approvalId}:${requestHash}`,action:"resource_reservation",status:"pending",requestedBy:this.factory.creatorAddress,decidedBy:null,decidedAt:null,createdAt:new Date().toISOString()});
      (build.model.resumeRequests??=[]).push({approvalId,limits:structuredClone(limits),taskIds,requestHash,applied:false});
      this.store.saveBuild(build);this.store.audit("model.resume_requested",{buildId,approvalId,requestHash,limits:JSON.stringify(limits),taskIds:JSON.stringify(taskIds)});return approvalId;
    }).immediate();
  }
  apply(buildId: string, approvalId: string): void {
    this.store.db.raw.transaction(()=>{
      const build=this.store.build(buildId), request=build?.model?.resumeRequests?.find(r=>r.approvalId===approvalId);
      const approval=this.store.db.productFactory.get("approvals",approvalId);
      if (!build?.model || !request || approval?.status!=="approved" || approval.decidedBy!==this.factory.creatorAddress || approval.productId!==build.productId || request.requestHash!==buildHash(JSON.stringify({limits:request.limits,taskIds:request.taskIds})) || approval.factoryActionId!==`model-resume:${buildId}:${approvalId}:${request.requestHash}`) throw new Error("Exact human resume approval required");
      if (request.applied) return;
      new ProductBriefEngine(this.store,this.factory).requireApproved(build.briefId);
      const product=this.factory.portfolio.get(build.productId)!;
      if (["killed","archived"].includes(product.portfolioState) || product.stage==="archived") throw new Error("Terminal product cannot resume");
      if (build.tasks.some(t=>["assigned","running"].includes(getTaskById(this.store.db.raw,t.taskId)?.status??""))) throw new Error("Active build cannot resume");
      const failed=build.tasks.find(t=>["architecture","model_build"].includes(t.step)&&getTaskById(this.store.db.raw,t.taskId)?.status==="failed");
      if (!failed) throw new Error("No failed model action to resume");
      build.model.limits=structuredClone(request.limits);build.model.status="PLAN";build.status="building";request.applied=true;
      this.store.db.raw.prepare("UPDATE task_graph SET status='pending',assigned_to=NULL,started_at=NULL,completed_at=NULL,result=NULL,retry_count=retry_count+1,estimated_cost_cents=?,timeout_ms=? WHERE id=?").run(request.limits.maxCostCents-build.model.costCents,Math.ceil(request.limits.maxDurationMs-build.model.elapsedMs)+10000,failed.taskId);
      for(const id of request.taskIds.filter(id=>id!==failed.taskId)) {
        const task=getTaskById(this.store.db.raw,id);
        if (task?.factory?.productId!==build.productId || this.store.binding(id)?.buildId!==buildId) throw new Error("Foreign resume action");
        if(task.status==="cancelled") this.store.db.raw.prepare("UPDATE task_graph SET status='blocked',assigned_to=NULL,started_at=NULL,completed_at=NULL,result=NULL WHERE id=?").run(id);
      }
      this.store.db.raw.prepare("UPDATE goals SET status='active' WHERE id=?").run(build.goalId);
      this.factory.portfolio.setState(build.productId,"building","Exact human approval to resume private model build");
      this.store.saveBuild(build);this.store.audit("model.resumed",{buildId,approvalId,taskId:failed.taskId});
    }).immediate();
  }
}
