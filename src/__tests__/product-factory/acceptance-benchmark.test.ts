import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, afterAll, expect, it, vi } from "vitest";
import { createDatabase, getTaskById } from "../../state/database.js";
import { taskRowToTaskNode } from "../../orchestration/task-graph.js";
import { LocalWorkerPool } from "../../orchestration/local-worker.js";
import { HarnessRegistry } from "../../agent/harness-registry.js";
import { createDefaultRules } from "../../agent/policy-rules/index.js";
import { PolicyEngine } from "../../agent/policy-engine.js";
import { SpendTracker } from "../../agent/spend-tracker.js";
import { BuildEngine, FactoryOrchestrator, OpportunityEngine, EvidenceEngine, ProductFactory, SCORE_WEIGHTS, createFactoryPolicyAdmission, resolveProductFactoryConfig } from "../../product-factory/index.js";
import { DockerProductSandbox, FixtureProductReferenceProvider, collectReferenceInsights, hasHardcodedSecret, WorkerInferenceProductBuildModel } from "../../product-factory/index.js";
import { UNKNOWN_BRIEFS, type BenchmarkBrief } from "./fixtures/acceptance-contracts.js";
import { ContractInferenceDouble } from "./fixtures/contract-inference-double.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";
import { configuredProductBuildModel, ModelBuildResume, SandboxChromiumAcceptance, briefErrors } from "../../product-factory/index.js";
import type { ProductBuildModel, ModelBuildRequest, ModelBuildResponse, ModelBuildLimits } from "../../product-factory/index.js";
import type { ProductBriefContent, BuildRecord, ScoreCriterion } from "../../product-factory/index.js";
import type { AutomatonDatabase, PolicyRule, ToolContext } from "../../types.js";
import { createTestConfig, createTestIdentity, MockConwayClient, MockInferenceClient } from "../mocks.js";

const now = new Date("2026-10-07T12:00:00Z");
const creator = "creator";
function config(buildSlots = 2) { return resolveProductFactoryConfig({ enabled: true, maxActiveProducts: 20, operationalBudgetCents: 100, resources: { globalConcurrency: 6, perProductConcurrency: 3, buildSlots, monitoringSlots: 2, researchSlots: 2, computeUnits: 8, criticalReservedSlots: 1, perProductBudgetCents: 50 } }); }
let directory: string, filename: string;
let db: AutomatonDatabase, factory: FactoryOrchestrator, engine: BuildEngine, policy: PolicyEngine, pool: LocalWorkerPool;
let inference: { chat: ReturnType<typeof vi.fn> };
let counter: number;
const image = execFileSync("docker", ["image", "inspect", "automaton-product-builder:local", "--format", "{{.Id}}"], { encoding: "utf8" }).trim();
const references = [new FixtureProductReferenceProvider("public-fixture", [{ kind: "onboarding", summary: "Start with an example dataset, then guide the user through the main action.", confidence: 0.8, sourceRef: "fixture://public/docs", capturedAt: now.toISOString(), sourceType: "public_docs" }])];
let double: ContractInferenceDouble;
let model: ProductBuildModel;
const limits = (patch: Partial<ModelBuildLimits> = {}): ModelBuildLimits => ({ maxIterations: 4,maxRepeatedFailures:2,maxCostCents:0,maxModelCostPerCallCents:0,maxDurationMs:180_000,maxCommandMs:10_000,maxComputeUnits:200,...patch });
function benchmarkPlan(benchmark:BenchmarkBrief,patch:Partial<ModelBuildLimits>={}) {
  const b=engine.briefs.requestReview(engine.briefs.create(selected(),benchmark.content).id);approve(b.approvalId!);
  return engine.planner.plan(b.id,{limits:limits(patch)});
}

const context = (): ToolContext => ({ identity: createTestIdentity(), config: createTestConfig(), db, conway: new MockConwayClient(), inference: new MockInferenceClient() });
function initialize(rules: PolicyRule[] = createDefaultRules(), limits = config()) {
  policy = new PolicyEngine(db.raw, rules);
  factory = new FactoryOrchestrator(db, limits, creator, createFactoryPolicyAdmission(policy, (task) => ({
    tool: { name: "factory_admission", description: "Local assignment", parameters: {}, category: "memory", riskLevel: "safe", execute: async () => "unused" }, args: { taskId: task.id }, context: context(), turnContext: { inputSource: "system", turnToolCallCount: 0, sessionSpend: new SpendTracker(db.raw) },
  })));
  engine = new BuildEngine(db, factory, path.join(directory, "artifacts"), undefined, { model: model, sandbox: new DockerProductSandbox(image), references: references });
  const registry = new HarnessRegistry(); engine.registerHarness(registry);
  inference = { chat: vi.fn(async (params:any) => createWorkerInferenceBridge(double).chat(params)) };
  pool = new LocalWorkerPool({ db: db.raw, inference, conway: context().conway, harnessRegistry: registry, identity: createTestIdentity(), config: createTestConfig(), tools: [], toolContext: context(), policyEngine: policy, spendTracker: new SpendTracker(db.raw), factoryHooks: engine.workerHooks(), allowedEditRoot: directory });
}
function selected(): string {
  const opportunityEngine = new OpportunityEngine(db, factory), evidence = new EvidenceEngine(db, creator, true);
  const n = ++counter, o = opportunityEngine.create(`Fixture ${n}`, `Unique category${n} workflow`);
  for (const criterion of Object.keys(SCORE_WEIGHTS) as ScoreCriterion[]) evidence.ingest("fixture", { opportunityId: o.id, sourceType: "forum", sourceRef: `fixture://${n}/${criterion}`, independenceKey: "source", capturedAt: now.toISOString(), summary: `Observed ${criterion}`, excerpt: `Evidence for ${criterion}`, reliability: 1, tags: [], relation: "supports", kind: "observation", criterion });
  opportunityEngine.assess(o.id, { values: Object.fromEntries(Object.keys(SCORE_WEIGHTS).map((k) => [k, 1])) as Record<ScoreCriterion, number>, estimatedCostCents: 0, risk: 0, unverifiedHypotheses: [] });
  expect(opportunityEngine.decide(o.id, "SELECT", "Local candidate only").action).toBe("SELECT");
  return o.id;
}
function approve(id: string, decision: "approved" | "rejected" = "approved") { new ProductFactory(db, config(), creator).decideApproval(id, decision); }
function approvePrivate(build: BuildRecord) {
  const task = getTaskById(db.raw, build.tasks.find((t) => t.step === "private_deployment")!.taskId)!;
  approve(task.factory!.approvalId!);
}
async function wave() {
  factory.tick(now);
  const assigned = db.raw.prepare("SELECT id FROM task_graph WHERE status = 'assigned' AND agent_role IN ('factory-local-build','factory-model-build')").all() as { id: string }[];
  for (const { id } of assigned) pool.spawn(taskRowToTaskNode(getTaskById(db.raw, id)!));
  await pool.waitForIdle();
  return assigned.length;
}
async function finish(build: BuildRecord, deployment = true) {
  if (deployment) approvePrivate(build);
  for (let i = 0; i < 20; i++) if (!await wave()) break;
  return engine.store.build(build.id)!;
}
beforeEach(() => {
  vi.setSystemTime(now); directory = fs.mkdtempSync(path.join(os.tmpdir(), "factory-build-")); filename = path.join(directory, "state.db");
  db = createDatabase(filename); counter = 0; double = new ContractInferenceDouble(); model = configuredProductBuildModel({client:createWorkerInferenceBridge(double),maxCostPerCallCents:0,creditsToCents:1}); initialize();
});
afterEach(async () => { await pool.shutdown(); if (db.raw.open) db.close(); fs.rmSync(directory, { recursive: true, force: true }); vi.useRealTimers(); });


const results: Record<string,unknown>[]=[];
afterAll(()=>{if(results.length)fs.writeFileSync('/tmp/lot4c-benchmark-results.json',JSON.stringify({inferenceSource:"deterministic-contract-double",externalModelValidated:false,benchmarks:results},null,2));});

it.each(UNKNOWN_BRIEFS)("private HTTP acceptance: $contract.label", async benchmark=>{
  double.fault=benchmark.repair;
  const build=await finish(benchmarkPlan(benchmark));
  const last=build.model!.attempts.at(-1)!;
  const http=last.acceptance?.filter(e=>e.transport==="http")??[];
  results.push({brief:benchmark.contract.label,applicationType:benchmark.contract.shape,generatedStructure:JSON.parse(db.getKV(`product-factory:model-files:${build.id}`)??"[]"),mainJourney:benchmark.journey,build:last.checks.find(c=>c.id==="model:build")?.passed??false,runtime:last.checks.find(c=>c.id==="model:run")?.passed??false,http:http.length===benchmark.content.acceptanceProbes!.filter(p=>p.transport==="http").length&&http.every(e=>e.passed),browser:benchmark.contract.ui?"UNAVAILABLE — isolated image lacks Chromium":"N/A",persistence:benchmark.contract.persistence?http.filter(e=>benchmark.content.acceptanceProbes!.find(p=>p.id===e.probeId)?.kind==="persistence").every(e=>e.passed):"N/A — stateless",acceptance:build.model?.status==="PASS",repairRequired:benchmark.repair,iterations:build.model?.attempts.length,trackedCostCents:build.model?.costCents,computeUnits:build.model?.computeUnits,elapsedMs:build.model?.elapsedMs,finalStatus:build.model?.status,buildId:build.id,briefId:build.briefId,architectureRevision:build.model?.architectures.at(-1)?.revision,externalInference:false,reason:build.model?.lastError??null});
  expect(build.model?.adapterKind).toBe("production");
  expect(double.calls[0].phase).toBe("architecture");
  expect(double.calls[0].brief).toEqual(benchmark.content);
  expect(http.length).toBe(benchmark.content.acceptanceProbes!.filter(p=>p.transport==="http").length);
  expect(http.every(e=>e.passed)).toBe(true);
  expect(http.every(e=>e.briefId===build.briefId&&e.contractHash.length===64&&e.execution==="real")).toBe(true);
  if (benchmark.contract.ui) {
    expect(build.model?.status,JSON.stringify(build.model?.attempts)).toBe("BLOCKED");
    expect(last.acceptance?.find(e=>e.transport==="browser")).toMatchObject({passed:false,execution:"unavailable"});
    expect(engine.validator.validate(build.id).passed).toBe(false);
    expect(factory.portfolio.get(build.productId)?.portfolioState).not.toBe("launch_ready");
  } else {
    expect(build.model?.status,JSON.stringify(build.model?.attempts)).toBe("PASS");
    expect(engine.validator.validate(build.id,true).passed).toBe(true);
  }
  if(benchmark.repair!=="none") {
    expect(build.model?.attempts).toHaveLength(2);
    expect(last.phases).toContain("DIAGNOSE");
    expect(last.diagnosis).toContain("Observed:");
    expect(last.repairPlan).toContain("Retain approved contract");
  }
  expect(factory.resources.leases(true)).toEqual([]);
  expect(db.getRecentTransactions(100)).toEqual([]);
},180_000);

it("uses unseen contract changes rather than product-name dispatch",async()=>{
  const benchmark=structuredClone(UNKNOWN_BRIEFS[4]);
  benchmark.contract.label="new-length-precision";
  benchmark.contract.routes[0].statements.at(-1).return.object.value={op:"*",args:[{read:"input.value"},42]};
  benchmark.content.applicationContract=benchmark.contract as any;
  benchmark.content.acceptanceProbes![0].expected={ready:true,service:benchmark.contract.label};
  for(const p of benchmark.content.acceptanceProbes!.filter(p=>p.http?.status===200&&p.http.path==="/convert"))p.expected={value:(p.input as any).value*42,unit:(p.input as any).to};
  const build=await finish(benchmarkPlan(benchmark));
  expect(build.model?.status,JSON.stringify(build.model?.attempts)).toBe("PASS");
  expect(fs.readFileSync(path.join(build.artifactRoot,"domain/convert.ts"),"utf8")).toContain("input.value * 42");
},120_000);

it("distinguishes an unavailable model from deterministic or production adapters",async()=>{
  model=configuredProductBuildModel({maxCostPerCallCents:0});initialize();
  const build=await finish(benchmarkPlan(UNKNOWN_BRIEFS[4]));
  expect(build.model?.status).toBe("BLOCKED");expect(build.model?.adapterKind).toBe("unavailable");
  expect(double.calls).toHaveLength(0);expect(build.model?.lastError).toContain("No configured inference");
});

it("requires exact human approval to continue after budget exhaustion, without repeating architecture",async()=>{
  double.costCredits=1;
  model=configuredProductBuildModel({client:createWorkerInferenceBridge(double),maxCostPerCallCents:1,creditsToCents:1});
  const c=config();c.resources.inferenceBudgetCents=10;initialize([],c);
  const original=await finish(benchmarkPlan(UNKNOWN_BRIEFS[4],{maxCostCents:1,maxModelCostPerCallCents:1}));
  expect(original.model?.costCents).toBe(1);expect(double.calls).toHaveLength(1);
  const resumption=new ModelBuildResume(engine.store,factory);
  const approvalId=resumption.request(original.id,limits({maxCostCents:3,maxModelCostPerCallCents:1}));
  expect(()=>resumption.apply(original.id,approvalId)).toThrow("Exact human resume approval");approve(approvalId);
  const saved=engine.store.build(original.id)!;
  const mutated=structuredClone(saved);mutated.model!.resumeRequests![0].limits.maxCostCents=100;engine.store.saveBuild(mutated);
  expect(()=>resumption.apply(original.id,approvalId)).toThrow("Exact human resume approval");engine.store.saveBuild(saved);
  resumption.apply(original.id,approvalId);resumption.apply(original.id,approvalId);
  const resumedTask=getTaskById(db.raw,original.tasks.find(t=>t.step==="model_build")!.taskId)!;
  expect(factory.resources.decision(resumedTask,now),JSON.stringify(factory.resources.decision(resumedTask,now))).toMatchObject({allowed:true});
  const resumed=await finish(engine.store.build(original.id)!,false);
  expect(resumed.model?.status,JSON.stringify(resumed.model?.attempts)).toBe("PASS");
  expect(double.calls.filter(c=>c.phase==="architecture")).toHaveLength(1);
  expect(resumed.model?.costCents).toBe(2);
  expect(resumed.tasks.map(t=>t.taskId)).toEqual(original.tasks.map(t=>t.taskId));
  expect(factory.resources.leases(true)).toEqual([]);
},120_000);

it("reloads interrupted in-flight actions with persistent identity and no foreign reservation",async()=>{
  const build=benchmarkPlan(UNKNOWN_BRIEFS[4]);approvePrivate(build);await wave();
  factory.tick(now);
  const task=getTaskById(db.raw,build.tasks.find(t=>t.step==="model_build")!.taskId)!;
  expect(task.status).toBe("assigned");factory.resources.start(task.id);
  const session=await new DockerProductSandbox(image).open(build.id);
  const state=engine.store.build(build.id)!;state.model!.sandboxId=session.id;
  state.model!.attempts.push({index:1,phases:["IMPLEMENT"],changes:[],commands:[],checks:[],errors:[],costCents:0,computeUnits:0,durationMs:0,nextReason:""});engine.store.saveBuild(state);
  await pool.shutdown();db.close();db=createDatabase(filename);initialize();
  factory.resources.requeue(task.id,"Interrupted worker recovery");
  const resumed=await finish(engine.store.build(build.id)!,false);
  expect(resumed.model?.status,JSON.stringify(resumed.model?.attempts)).toBe("PASS");
  expect(resumed.model?.attempts[0].interrupted).toBe(true);
  expect(double.calls.filter(c=>c.phase==="architecture")).toHaveLength(1);
  expect(factory.resources.leases(true)).toEqual([]);
},120_000);

it("rejects forbidden paths and dependencies before they can affect the host",async()=>{
  double.fault="path";double.failures=10;
  const build=await finish(benchmarkPlan(UNKNOWN_BRIEFS[4],{maxIterations:1}));
  expect(build.model?.status).not.toBe("PASS");expect(build.model?.attempts[0].changes).toEqual([]);
  expect(fs.existsSync(path.join(build.artifactRoot,"../constitution.md"))).toBe(false);
  double.fault="dependency";
  const second=await finish(benchmarkPlan(UNKNOWN_BRIEFS[4]));
  expect(second.model?.lastError).toContain("Dependency not approved");
},120_000);

it("rejects HTTP destinations outside private loopback and invalid browser contracts",()=>{
  const content=structuredClone(UNKNOWN_BRIEFS[4].content);content.acceptanceProbes![0].http!.path="https://example.com";
  expect(briefErrors(content)).toContain("Invalid private HTTP probe");
});

it("covers the browser adapter contract deterministically without claiming browser execution",async()=>{
  const exec=vi.fn(async(..._args:any[])=>({exitCode:0,stdout:JSON.stringify({passed:true,observations:[{action:"click",passed:true}]}),stderr:"",durationMs:1}));
  const probe=UNKNOWN_BRIEFS[1].content.acceptanceProbes!.find(p=>p.transport==="browser")!;
  const result=await new SandboxChromiumAcceptance().run({id:"contract-double",exec,write:async()=>{},read:async()=>"",close:async()=>{}},8080,probe,1000);
  expect(JSON.parse(result.stdout).passed).toBe(true);
  expect(exec.mock.calls[0][0][2]).not.toContain("--no-sandbox");
},10_000);

it("does not execute a build against another product's reservation",async()=>{
  const a=benchmarkPlan(UNKNOWN_BRIEFS[4]),b=benchmarkPlan(UNKNOWN_BRIEFS[2]);
  const task=getTaskById(db.raw,a.tasks.find(t=>t.step==="architecture")!.taskId)!;
  db.raw.prepare("UPDATE task_graph SET product_id=? WHERE id=?").run(b.productId,task.id);
  factory.resources.assign(task.id,now);pool.spawn(taskRowToTaskNode(getTaskById(db.raw,task.id)!));await pool.waitForIdle();
  expect(double.calls).toHaveLength(0);
  expect(factory.resources.leases(true).find(r=>r.taskId===task.id)?.productId).toBe(b.productId);
  factory.resources.cancel(task.id);
  expect(engine.store.build(a.id)?.model?.architectures).toEqual([]);
});

it("HTTP tool policy denial prevents the first acceptance request",async()=>{
  initialize([{id:"deny-http",description:"Deny HTTP probes",priority:1,appliesTo:{by:"all"},evaluate:r=>r.tool.name==="factory_model_http"?{rule:"deny-http",action:"deny",reasonCode:"DENIED",humanMessage:"Private request denied"}:null}]);
  const build=await finish(benchmarkPlan(UNKNOWN_BRIEFS[4]));
  expect(build.model?.status).toBe("BLOCKED");expect(build.model?.attempts[0].acceptance??[]).toEqual([]);
  expect(factory.resources.leases(true)).toEqual([]);
},120_000);

it("retains Docker network-none and cannot access host secrets or an external endpoint",async()=>{
  const id="01234567890123456789012345",session=await new DockerProductSandbox(image).open(id);
  try {
    const script="const fs=require('fs'),http=require('http');for(const p of ['/workspace/automaton/constitution.md','/home/agent/.automaton/wallet.json']){if(fs.existsSync(p))process.exit(3)};if(Object.keys(process.env).some(k=>/API_KEY|SECRET|WALLET/.test(k)))process.exit(4);const req=http.get('http://1.1.1.1:80/',()=>process.exit(5));req.setTimeout(500,()=>req.destroy(Error('blocked')));req.on('error',()=>process.stdout.write('isolated'));";
    const result=await session.exec(["node","-e",script],2000);expect(result.exitCode).toBe(0);expect(result.stdout).toBe("isolated");
    const inspect=JSON.parse(execFileSync("docker",["inspect",session.id],{encoding:"utf8"}))[0];
    expect(inspect.HostConfig.NetworkMode).toBe("none");expect(inspect.HostConfig.PortBindings).toEqual({});expect(inspect.Mounts).toEqual([]);expect(inspect.HostConfig.ReadonlyRootfs).toBe(true);
  }finally{await session.close();}
},10000);

it("runs different private HTTP products concurrently on the same isolated port",async()=>{
  const a=benchmarkPlan(UNKNOWN_BRIEFS[0]),b=benchmarkPlan(UNKNOWN_BRIEFS[4]);approvePrivate(a);approvePrivate(b);
  for(let i=0;i<5;i++)await wave();
  for(const id of [a.id,b.id])expect(engine.store.build(id)?.model?.status,JSON.stringify(engine.store.build(id)?.model?.attempts)).toBe("PASS");
  expect(fs.readFileSync(path.join(a.artifactRoot,"dist/server.js"),"utf8")).not.toEqual(fs.readFileSync(path.join(b.artifactRoot,"dist/server.js"),"utf8"));
  expect(factory.resources.leases(true)).toEqual([]);
},180_000);
