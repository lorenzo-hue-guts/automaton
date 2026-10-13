import { WebRunnerInterrupted } from './web-runner.js';
import { AndroidSurfaceAdapter } from './surface-adapters.js';
import { SurfaceAcceptance, surfaceHash } from './surface-acceptance.js';
import type { SurfaceEnvironment } from './surface-builder-types.js';
import { companyChargeBlock,companyResourceBlock } from './company-guards.js';
import { isDeepStrictEqual } from "node:util";
import type { AutomatonTool } from "../types.js";
import type { HarnessContext } from "../agent/harness-types.js";
import { executeTool } from "../agent/tools.js";
import type { TaskNode, TaskResult } from "../orchestration/task-graph.js";
import { getTaskById } from "../state/database.js";
import { isProtectedFile } from "../self-mod/code.js";
import { isSensitiveFile } from "../agent/policy-rules/path-protection.js";
import { BuildStore, buildHash } from "./build-store.js";
import { receiptHash } from "./build-validator.js";
import { ProductBriefEngine } from "./product-brief.js";
import type { FactoryOrchestrator } from "./factory-orchestrator.js";
import { inspectArtifact, readArtifact, writeArtifact } from "./local-artifacts.js";
import { collectReferenceInsights } from "./reference-research.js";
import type { BuildCheck, BuildArtifact, BuildReceipt } from "./build-types.js";
import { ModelBuildFailure, type ApprovedPackage, type ModelBuildRequest, type ProductArchitecture, type ProductBuildModel, type ProductReferenceProvider, type ProductSandboxProvider, type ProductSandboxSession, type VerificationAttempt } from "./model-build-types.js";
import { privateHttp, privateReadiness, httpAcceptancePassed, privateRoute } from "./application-acceptance.js";
import { SandboxChromiumAcceptance } from "./browser-acceptance.js";
import type { BrowserAcceptanceProvider, AcceptanceEvidence } from "./model-build-types.js";
import { ulid } from "ulid";

export interface ModelBuilderServices { model: ProductBuildModel; sandbox: ProductSandboxProvider; references?: readonly ProductReferenceProvider[]; approvedPackages?: readonly ApprovedPackage[]; browser?: BrowserAcceptanceProvider; surfaceEnvironment?: SurfaceEnvironment }
export function hasHardcodedSecret(content: string): boolean { return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[a-zA-Z0-9]{16,}|(?:api[_-]?key|password|secret[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i.test(content); }
// package.json here belongs to the confined product workspace, never Automaton's manifest.
function validFile(path: string): void { if (!/^[\w./-]+$/.test(path) || path.startsWith("/") || path.split("/").some((p) => p === ".." || p === "node_modules") || (path !== "package.json" && isProtectedFile(path)) || isSensitiveFile(path) || path.endsWith(".node")) throw new Error("Forbidden generated file"); }
export function validateProductArchitecture(a: ProductArchitecture, approved: readonly ApprovedPackage[], insightIds: string[]): void {
  if(a.surface&&!['ANDROID','API_SERVICE','WEB_APP','WEB_SAAS','PWA'].includes(a.surface))throw Error('Surface execution BLOCKED: no verified adapter for '+a.surface);
  if(a.surface==='ANDROID')new AndroidSurfaceAdapter().validateArchitecture(a);
  for (const key of ["stack", "components", "dataModel", "api", "instrumentation", "tests", "deploymentRequirements", "compiledArtifacts", "referenceInsightIds"] as const) if (!Array.isArray(a[key]) || a[key].length > 100 || a[key].some((s) => typeof s !== "string" || !s.trim() || s.length > 5000)) throw new Error(`Invalid architecture ${key}`);
  if (!a.stack.length || !a.components.length || !a.tests.length || !a.compiledArtifacts.length || a.payments !== "mock-only" || ![a.frontend, a.backend, a.auth].every((s) => typeof s === "string" && s.trim())) throw new Error("Incomplete architecture");
  if (a.referenceInsightIds.some((id) => !insightIds.includes(id))) throw new Error("Unknown reference insight");
  if (!Array.isArray(a.dependencies) || a.dependencies.some((d) => !/^(?:@[a-z0-9_-]+\/)?[a-z0-9_-]+$/.test(d.name) || !approved.some((p) => p.name === d.name && p.version === d.version && ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(p.license)))) throw new Error("Dependency not approved");
  for (const argv of Object.values(a.commands ?? {})) if (!Array.isArray(argv) || argv.length < 2 || argv.length > 30 || argv[0] !== "node" || argv.some((v) => typeof v !== "string" || v.length > 2000 || v.includes("\0"))) throw new Error("Unsupported isolated command");
  for (const key of ["lint", "typecheck", "build", "test", "run"] as const) if (!a.commands?.[key]) throw new Error(`Missing command ${key}`);
  if (a.runtime && (a.runtime.kind !== "http" || !Number.isInteger(a.runtime.port) || a.runtime.port < 1024 || a.runtime.port > 65535 || !privateRoute(a.runtime.readinessPath))) throw new Error("Invalid isolated HTTP runtime");
  for (const p of a.compiledArtifacts) validFile(p);
}
/** Tool implementation attached to LocalWorkerPool's model harness; owns no worker/timer/queue. */
export class ModelBuilder {
  constructor(private readonly store: BuildStore, private readonly factory: FactoryOrchestrator, private readonly services: ModelBuilderServices) {}
  async run(task: TaskNode, context: HarnessContext): Promise<TaskResult> {
    if(this.services.surfaceEnvironment?.toolchain.image&&this.services.sandbox.imageDigest!==this.services.surfaceEnvironment.toolchain.image)throw Error("Acceptance environment/image identity mismatch");
    const binding = this.store.binding(task.id)!, build = this.store.build(binding.buildId)!, state = build.model!;
    const brief = new ProductBriefEngine(this.store, this.factory).requireApproved(build.briefId);
    const started = performance.now(), artifacts: BuildArtifact[] = [], checks: BuildCheck[] = [];
    let session: ProductSandboxSession | undefined, toolCount = 0;
    state.adapterKind = this.services.model.adapterKind ?? "unspecified";
    const persist = () => { this.store.saveBuild(build); };
    const live = () => {
      const row = getTaskById(this.store.db.raw, task.id), lease = this.factory.resources.leases(true).find((r) => r.taskId === task.id);
      if (context.abortSignal.aborted || row?.status !== "running" || !lease || lease.productId !== build.productId || row.factory?.productId !== build.productId || Date.parse(lease.expiresAt) <= Date.now() || !this.factory.portfolio.canReceiveWork(build.productId)) throw new Error("Model build assignment cancelled/expired");
      const companyBlock=companyResourceBlock(this.store.db,this.factory.creatorAddress,row);
      if(companyBlock)throw new Error(companyBlock);
      new ProductBriefEngine(this.store, this.factory).requireApproved(build.briefId);
      if (state.elapsedMs + performance.now() - started >= state.limits.maxDurationMs || state.computeUnits >= state.limits.maxComputeUnits) throw new Error("Time or compute limit reached");
    };
    const tool = async <T>(name: string, args: Record<string, unknown>, action: () => Promise<T>): Promise<T> => {
      live();
      const definition: AutomatonTool = { name, description: "Bounded private model build operation", parameters: {}, riskLevel: "caution", category: "vm", execute: async () => JSON.stringify(await action()) };
      const result = await executeTool(name, { buildId: build.id, taskId: task.id, ...args }, [definition], context.toolContext!, context.policyEngine!, { inputSource: context.inputSource ?? "system", turnToolCallCount: toolCount++, sessionSpend: context.spendTracker! });
      if (result.error) { if (result.error.startsWith("Policy denied:") || result.error.startsWith("Unknown tool:")) state.status = "BLOCKED"; throw new Error(result.error.slice(0, 4000)); }
      return JSON.parse(result.result) as T;
    };
    const charge = (cents: number, reserveEnvelope = false) => {
      const row = getTaskById(this.store.db.raw, task.id)!;
      if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(row.actualCostCents + cents) || row.actualCostCents + cents < 0) throw new Error("Invalid model charge");
      this.store.db.raw.transaction(() => {
        if (reserveEnvelope) {
          const companyBlock=companyChargeBlock(this.store.db,this.factory.creatorAddress,build.productId,cents);
          if(companyBlock)throw new Error(companyBlock);
          const spent = this.store.db.raw.prepare("SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id IS NOT NULL AND (resource_class = 'inference' OR agent_role = 'factory-model-build')").get() as { cents: number };
          const reserved = this.store.db.raw.prepare("SELECT COALESCE(SUM(r.operational_cost_cents),0) AS cents FROM factory_resource_reservations r JOIN task_graph t ON t.id = r.task_id WHERE r.managed = 1 AND r.status = 'reserved' AND r.resource_class = 'inference' AND t.status IN ('assigned','running')").get() as { cents: number };
          if (spent.cents + reserved.cents + cents > this.factory.resources.config.resources.inferenceBudgetCents) throw new Error("Inference budget reached");
        }
        state.costCents += cents;
        this.store.db.raw.prepare("UPDATE task_graph SET actual_cost_cents = actual_cost_cents + ? WHERE id = ?").run(cents, task.id);
        persist();
      }).immediate();
    };
    const files = (): Record<string, string> => {
      const manifest = this.store.db.getKV(`product-factory:model-files:${build.id}`);
      const names = manifest ? JSON.parse(manifest) as string[] : [];
      return Object.fromEntries(names.map((name) => [name, readArtifact(build.artifactRoot, name)]));
    };
    const model = async (phase: ModelBuildRequest["phase"], previous?: VerificationAttempt) => {
      const bound = this.services.model.maxCostPerCallCents;
      if (!Number.isSafeInteger(bound) || bound < 0 || bound > state.limits.maxModelCostPerCallCents || state.costCents + bound > state.limits.maxCostCents || bound > task.metadata.estimatedCostCents) throw new Error("Model cost envelope reached");
      return tool("factory_model_generate", { phase, maxCostCents: bound }, async () => {
        charge(bound, true); // Reserve/report the full envelope before a potentially charged call.
        state.computeUnits++; persist();
        let response;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        let abort: (()=>void) | undefined;
        try { response = await Promise.race([this.services.model.generate({ phase, brief: brief.content, evidence: brief.evidenceIds.map((id) => this.store.db.productFactory.getAtomicEvidence(id)), insights: state.insights, architecture: state.architectures.at(-1), previous, files: files(), constraints: { runtime: "Isolated offline Node.js/TypeScript. node /toolchain/typescript/lib/tsc.js available; no shell, network or native binaries. Acceptance probes are immutable.", approvedDependencies: (this.services.approvedPackages ?? []).map(({name,version}) => ({name,version})) } }), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Model time limit reached")), Math.max(1, state.limits.maxDurationMs - state.elapsedMs - (performance.now() - started))); }), new Promise<never>((_,reject)=>{abort=()=>reject(new Error("Worker interrupted; unresolved model charge retained"));context.abortSignal.addEventListener("abort",abort,{once:true});})]); }
        catch (error) { if (error instanceof ModelBuildFailure && Number.isSafeInteger(error.costCents) && error.costCents >= 0) charge(error.costCents - bound); if (error instanceof ModelBuildFailure && error.kind === "invalid_output") throw new Error("Invalid model artifact; request a complete repaired response"); if (error instanceof ModelBuildFailure && error.kind === "unavailable") { state.status = "BLOCKED"; throw new Error(error.message); } throw new Error("Model request failed or time limit reached; unresolved charge retains its envelope"); } finally { if (deadline) clearTimeout(deadline); if(abort)context.abortSignal.removeEventListener("abort",abort); }
        if (!Number.isSafeInteger(response.costCents) || response.costCents < 0) throw new Error("Missing actual model cost");
        charge(response.costCents - bound);
        (state.inferenceCalls ??= []).push({phase,costCents:response.costCents,inference:response.inference}); persist();
        if (response.costCents > bound || state.costCents > state.limits.maxCostCents) throw new Error("Model exceeded its cost envelope");
        return response;
      });
    };
    try {
      if (binding.step === "reference_research") {
        const result = await tool("factory_reference_research", {}, () => collectReferenceInsights(brief.content.problem, this.services.references ?? []));
        state.insights = result.insights;
        this.store.audit("references.collected", { buildId: build.id, failures: result.failedProviders.join(",") }); persist();
      } else if (binding.step === "architecture") {
        const response = await model("architecture");
        if (!response.architecture) throw new Error("Model did not produce an architecture");
        validateProductArchitecture(response.architecture, this.services.approvedPackages ?? [], state.insights.map((i) => i.contentHash));
        const architecture = { ...response.architecture, revision: state.architectures.length + 1 };
        state.architectures.push(architecture);
        artifacts.push(await tool("factory_model_write", { path: `architecture-${architecture.revision}.json` }, async () => writeArtifact(build.artifactRoot, `architecture-${architecture.revision}.json`, JSON.stringify(architecture)))); persist();
      } else {
        if (this.services.sandbox.isolation !== "filesystem-and-network") throw new Error("Isolated execution provider required");
        session = await tool("factory_model_sandbox", {}, async () => { session = await this.services.sandbox.open(build.id, state.sandboxId); return { id: session.id }; }).then(() => session!);
        state.sandboxId = session!.id; persist();
        while (state.attempts.length < state.limits.maxIterations) {
          live();
          const unfinished = state.attempts.at(-1);
          if (unfinished && !unfinished.nextReason) { unfinished.interrupted = true; unfinished.errors.push("Worker interrupted before acknowledgement"); unfinished.nextReason = "Revalidate from persisted sources in a fresh owned sandbox"; }
          const attempt: VerificationAttempt = { index: state.attempts.length + 1, phases: state.attempts.length ? ["OBSERVE", "DIAGNOSE", "PLAN_FIX", "FIX", "IMPLEMENT"] : ["PLAN", "IMPLEMENT"], changes: [], commands: [], checks: [], errors: [], costCents: 0, computeUnits: 0, durationMs: 0, nextReason: "" };
          const attemptStart = performance.now(), startCost = state.costCents, startCompute = state.computeUnits;
          state.attempts.push(attempt); state.status = "IMPLEMENT"; persist();
          let failure: string | undefined;
          try {
            const response = await model(state.repeatCount >= state.limits.maxRepeatedFailures ? "replan" : attempt.index === 1 ? "implement" : state.attempts.at(-2)?.checks.some(c => !c.passed) ? "acceptance_remediation" : "fix", state.attempts.at(-2));
            attempt.diagnosis = response.diagnosis?.slice(0, 4000);
            attempt.repairPlan = response.repairPlan;
            if (response.disposition === "approval_required") {
              const approvalId = ulid();
              await tool("factory_model_approval", {}, async () => {
                this.store.db.productFactory.insert("approvals", { id: approvalId, productId: build.productId, factoryActionId: `model-replan:${build.id}:${attempt.index}`, action: "prototype", status: "pending", requestedBy: this.factory.creatorAddress, decidedBy: null, decidedAt: null, createdAt: new Date().toISOString() }); return true;
              });
              state.status = "BLOCKED"; attempt.nextReason = `Human intervention required: ${approvalId}`; throw new Error("Model requested human intervention");
            }
            if (response.architecture) {
              validateProductArchitecture(response.architecture, this.services.approvedPackages ?? [], state.insights.map((i) => i.contentHash));
              const revision = { ...response.architecture, revision: state.architectures.length + 1 }; state.architectures.push(revision);
              artifacts.push(await tool("factory_model_write", { path: `architecture-${revision.revision}.json` }, async () => writeArtifact(build.artifactRoot, `architecture-${revision.revision}.json`, JSON.stringify(revision))));
              state.repeatCount = 0;
            }
            if (!response.files?.length || response.files.length > 100 || response.files.some((f) => typeof f.content !== "string" || f.content.length > 100_000)) throw new Error("Model must produce bounded source modifications");
            if (attempt.index > 1) {
              await session!.close();
              await tool("factory_model_sandbox", { reset: true }, async () => { session = await this.services.sandbox.open(build.id); return { id: session.id }; });
            }
            const currentFiles = files();
            for (const file of response.files) {
              validFile(file.path); if (hasHardcodedSecret(file.content)) throw new Error("Hardcoded secret detected");
              // Reference use is semantic only; reject verbatim reference text in generated assets/code.
              if (state.insights.some((i) => i.summary.length >= 40 && file.content.includes(i.summary))) throw new Error("Protected/reference text copied verbatim");
              const artifact = await tool("factory_model_write", { path: file.path }, async () => {writeArtifact(build.artifactRoot, `source-revisions/${attempt.index}/${file.path}`, file.content);return writeArtifact(build.artifactRoot, file.path, file.content);});
              attempt.changes.push({ path: file.path, sha256: artifact.sha256 }); currentFiles[file.path] = file.content;
            }
            const architecture = state.architectures.at(-1)!;
            if (currentFiles["package.json"]) {
              const pkg = JSON.parse(currentFiles["package.json"]);
              const declared = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
              if (Object.entries(declared).some(([name, version]) => !architecture.dependencies.some((d) => d.name === name && d.version === version))) throw new Error("Manifest dependency not approved");
            }
            this.store.db.setKV(`product-factory:model-files:${build.id}`, JSON.stringify(Object.keys(currentFiles).sort()));
            await tool("factory_model_sandbox_write", {}, async () => { await session!.write(Object.entries(currentFiles).map(([path, content]) => ({ path, content }))); return true; });
            if (architecture.dependencies.length) await tool("factory_model_install", { dependencies: architecture.dependencies }, async () => {
              for (const dependency of architecture.dependencies) {
                const pkg = this.services.approvedPackages!.find((p) => p.name === dependency.name && p.version === dependency.version)!;
                for (const file of pkg.files) { validFile(file.path); if (buildHash(file.content) !== file.sha256) throw new Error("Approved package integrity mismatch"); }
                await session!.write(pkg.files.map((f) => ({ path: `node_modules/${pkg.name}/${f.path}`, content: f.content })));
              }
              return true;
            });
            const command = async (phase: string, argv: string[], input?: string) => {
              live();
              const result = await tool("factory_model_exec", { phase, argv }, () => session!.exec(argv, Math.min(state.limits.maxCommandMs, state.limits.maxDurationMs - state.elapsedMs - (performance.now() - started)), input));
              state.computeUnits++; attempt.commands.push({ phase, argv, ...result }); persist();
              if (result.exitCode !== 0) throw new Error(`${phase} command failed (${result.exitCode}): ${result.stderr.slice(0, 1000)}`);
              return result;
            };
            attempt.phases.push("BUILD"); state.status = "BUILD";
            const nativePlan=architecture.surface==='ANDROID'&&this.services.surfaceEnvironment?await tool('factory_model_acceptance',{phase:'pre-build-plan'},async()=>new SurfaceAcceptance(this.store,this.factory,this.services.surfaceEnvironment!).prepareBuildPlan(task.id,architecture,surfaceHash(attempt.changes))):undefined;
            await command("lint", architecture.commands.lint); await command("typecheck", architecture.commands.typecheck); await command("build", architecture.commands.build);
            attempt.checks.push({ id: "model:typecheck", passed: true, detail: "Executed lint/typecheck" }, { id: "model:build", passed: true, detail: "Executed build" });
            if(architecture.surface==='ANDROID'){
              if(this.services.surfaceEnvironment?.androidBuild!=='AVAILABLE'){state.status='BLOCKED';throw Error('Android build environment not independently provisioned');}
              const manifest: BuildArtifact[]=[];
              for(const name of architecture.compiledArtifacts){
                const encoded=await tool('factory_model_read',{path:name},()=>session!.exec(['node','-e',"const fs=require('fs');process.stdout.write(fs.readFileSync(JSON.parse(fs.readFileSync(0,'utf8'))).toString('base64'))"],state.limits.maxCommandMs,JSON.stringify(name)));
                if(encoded.exitCode||encoded.truncated)throw Error('Android artifact read failed or exceeded bound');
                const bytes=Buffer.from(encoded.stdout,'base64');if(!name.endsWith('.apk')||bytes.subarray(0,2).toString()!=='PK')throw Error('Expected real APK ZIP artifact');
                const a=await tool('factory_model_write',{path:name},async()=>writeArtifact(build.artifactRoot,name,bytes));artifacts.push(a);manifest.push(a);
              }
              await tool('factory_model_acceptance',{phase:'android-build-evidence'},async()=>{new SurfaceAcceptance(this.store,this.factory,this.services.surfaceEnvironment!).recordBuildStage(task.id,architecture,surfaceHash(manifest),nativePlan!);return true;});
              state.status='BLOCKED';throw Error('BLOCKED_BY_ENVIRONMENT: Android emulator/device runtime and interaction unavailable; build/package evidence preserved');
            }
            attempt.phases.push("RUN"); state.status = "RUN";
            if (architecture.runtime) {
              if (!session!.startRuntime || !session!.stopRuntime) throw new Error("HTTP runtime provider unavailable");
              const started = await tool("factory_model_runtime_start", { argv: architecture.commands.run }, () => session!.startRuntime!(architecture.commands.run, state.limits.maxCommandMs));
              attempt.commands.push({phase:"runtime-start",argv:architecture.commands.run,...started}); state.computeUnits++;
              if (started.exitCode) throw new Error("Private runtime startup failed");
              const ready = await tool("factory_model_http", {phase:"readiness",port:architecture.runtime.port,path:architecture.runtime.readinessPath}, () => privateReadiness(session!,architecture.runtime!.port,architecture.runtime!.readinessPath,state.limits.maxCommandMs));
              attempt.commands.push({phase:"readiness",argv:["node","private-readiness"],...ready}); state.computeUnits++;
              if (ready.exitCode || ready.truncated) throw new Error(`Runtime readiness failed: ${ready.stderr}`);
            } else await command("run", architecture.commands.run);
            attempt.checks.push({ id: "model:run", passed: true, detail: architecture.runtime ? "Live private HTTP readiness verified" : "Application process started and exited successfully" });
            attempt.phases.push("TEST"); state.status = "TEST"; await command("test", architecture.commands.test);
            for (const probe of brief.content.acceptanceProbes!) {
              live();
              const transport = probe.transport ?? "cli";
              let result, passed = false;
              const timeout = Math.max(1,Math.min(state.limits.maxCommandMs,state.limits.maxDurationMs-state.elapsedMs-(performance.now()-started)));
              if (transport === "http") {
                if (!architecture.runtime) throw new Error("HTTP acceptance requires a declared HTTP runtime");
                if (probe.http?.restartBefore) {
                  await tool("factory_model_runtime_restart", {probeId:probe.id},async()=>{await session!.stopRuntime!();return session!.startRuntime!(architecture.commands.run,timeout);});
                  const ready=await tool("factory_model_http",{phase:"restart-readiness"},()=>privateReadiness(session!,architecture.runtime!.port,architecture.runtime!.readinessPath,timeout));
                  if (ready.exitCode) throw new Error("Restart readiness failed");
                }
                result = await tool("factory_model_http",{probeId:probe.id,path:probe.http!.path},()=>privateHttp(session!,architecture.runtime!.port,probe,timeout));
                passed = httpAcceptancePassed(probe,result);
              } else if (transport === "browser") {
                const browser:import("./model-build-types.js").BrowserAcceptanceProvider=this.services.browser ?? new SandboxChromiumAcceptance();
                if (!architecture.runtime || browser.execution !== "real") { state.status="BLOCKED"; throw new Error("Real isolated browser acceptance unavailable; simulated evidence cannot satisfy acceptance"); }
                const manifest: BuildArtifact[] = [];
                for (const path of architecture.compiledArtifacts) { const content=await tool("factory_model_read",{path},()=>session!.read(path));manifest.push({path,sha256:buildHash(content),size:Buffer.byteLength(content)});await tool("factory_model_write",{path:`acceptance-artifacts/${attempt.index}/${path}`},async()=>writeArtifact(build.artifactRoot,`acceptance-artifacts/${attempt.index}/${path}`,content)); }
                const environment=this.services.surfaceEnvironment??{id:"configured-isolated-image",os:"unknown",toolchain:{image:this.services.sandbox.imageDigest??"unknown-provider-image"},isolation:"filesystem-and-network" as const,browser:"NOT_IMPLEMENTED" as const,androidBuild:"NOT_IMPLEMENTED" as const,androidRuntime:"NOT_IMPLEMENTED" as const,ios:"NOT_IMPLEMENTED" as const,reasons:["Environment must be independently provisioned; no inferred browser availability"],observedAt:new Date().toISOString()};
                const acceptance=new SurfaceAcceptance(this.store,this.factory,browser.dedicated?.policy.environment??environment);
                result=await tool("factory_model_browser",{probeId:probe.id},()=>acceptance.browser(task.id,architecture,surfaceHash(manifest),probe,session!,browser,timeout,context.abortSignal,live));
                let outcome;try{outcome=JSON.parse(result.stdout)}catch{}
                passed=!result.exitCode&&!result.truncated&&outcome?.passed===true;
                if (!passed && /unavailable|startup failed/.test(result.stderr)) state.status="BLOCKED";
              } else {
                result = await tool("factory_model_acceptance", { probeId: probe.id, entry: probe.entry }, () => session!.exec(["node", probe.entry],timeout,JSON.stringify(probe.input)));
                let observed;try{observed=JSON.parse(result.stdout)}catch{}
                passed=!result.truncated&&result.exitCode === (probe.expectedExitCode ?? 0) && isDeepStrictEqual(observed,probe.expected);
              }
              state.computeUnits++; attempt.commands.push({ phase: `acceptance:${probe.id}`, argv: transport === "cli" ? ["node",probe.entry] : ["node",`private-${transport}`], ...result });
              let observed: AcceptanceEvidence["observed"];try{observed=JSON.parse(result.stdout)}catch{observed={stdout:result.stdout,stderr:result.stderr}}
              (attempt.acceptance ??= []).push({probeId:probe.id,briefId:brief.id,contractHash:buildHash(JSON.stringify(probe)),architectureRevision:architecture.revision,transport,execution:/unavailable|startup failed/.test(result.stderr)?"unavailable":"real",passed,observed,reason:passed?"Approved acceptance verified":result.stderr||"Observed response differs from approved criterion"});
              attempt.checks.push({ id: `acceptance:${probe.id}`, passed, detail: `Creator-defined ${transport}/${probe.kind} execution probe` }); persist();
              if (!passed) throw new Error(`Acceptance failed: ${probe.id}: ${result.stderr.slice(0,2000)}`);
            }
            for (const feature of brief.content.mvpFeatures) if (!brief.content.acceptanceProbes!.some((p) => p.featureIds.includes(feature.id))) throw new Error("MVP feature has no acceptance evidence");
            if (!brief.content.acceptanceProbes!.some((p) => p.kind === "startup") || !brief.content.acceptanceProbes!.some((p) => p.kind === "integration") || !brief.content.acceptanceProbes!.some((p) => p.kind === "error") || !brief.content.acceptanceProbes!.some((p) => p.kind === "metric")) throw new Error("Startup/integration/error/instrumentation probes required");
            attempt.phases.push("INSPECT", "RETEST");
            const before = new Map<string, string>();
            for (const name of architecture.compiledArtifacts) before.set(name, buildHash(await tool("factory_model_read", { path: name }, () => session!.read(name))));
            await command("reproducible-build", architecture.commands.build);
            for (const name of architecture.compiledArtifacts) {
              const compiled = await tool("factory_model_read", { path: name }, () => session!.read(name));
              if (buildHash(compiled) !== before.get(name)) throw new Error("Build is not reproducible");
              if (hasHardcodedSecret(compiled)) throw new Error("Secret found in compiled artifact");
              artifacts.push(await tool("factory_model_write", { path: name }, async () => writeArtifact(build.artifactRoot, name, compiled)));
            }
            attempt.checks.push({ id: "model:integration", passed: true, detail: "Creator probes passed" }, { id: "model:reproducible", passed: true, detail: "Compiled byte hashes match repeated build" }, { id: "security:no-secrets", passed: true, detail: "Source and compiled secret scan" });
            for (const criterion of brief.content.validationCriteria) if (!attempt.checks.some((c) => c.id === criterion.target && c.passed) && !artifacts.some((a) => criterion.target === `artifact:${a.path}`)) throw new Error(`Unverified brief criterion: ${criterion.id}`);
            checks.push(...attempt.checks); attempt.phases.push("PASS"); state.status = "PASS"; attempt.nextReason = "All execution and acceptance proofs passed";
          } catch (error) {
            failure = error instanceof Error ? error.message : "Verification failed";
            if(error instanceof WebRunnerInterrupted||/Dedicated runner connection interrupted/.test(failure))state.status="BLOCKED";
            attempt.errors.push(failure);
            const fingerprint = buildHash(failure.replace(/\b\d+\b/g, "#"));
            state.repeatCount = state.lastFailure === fingerprint ? state.repeatCount + 1 : 1; state.lastFailure = fingerprint;
            attempt.nextReason ||= state.repeatCount >= state.limits.maxRepeatedFailures ? "Repeated failure; architecture/dependency replan required" : "Inspect errors and modify implementation";
            if (state.status !== "BLOCKED") state.status = state.repeatCount >= state.limits.maxRepeatedFailures ? "NEEDS_REPLAN" : "FIX";
          } finally {
            attempt.costCents = state.costCents - startCost; attempt.computeUnits = state.computeUnits - startCompute; attempt.durationMs = performance.now() - attemptStart; persist();
          }
          if (state.status === "PASS") break;
          if (state.status === "BLOCKED" || /cost|budget|limit|secret|Dependency|Manifest dependency/i.test(failure ?? "")) throw new Error(failure);
          if (state.repeatCount >= state.limits.maxRepeatedFailures && state.attempts.length >= state.limits.maxIterations) throw new Error("Repeated failures require replanning");
        }
        if (state.status !== "PASS") { state.status = "NEEDS_REPLAN"; throw new Error("Iteration limit reached"); }
        for (const name of Object.keys(files())) artifacts.push(inspectArtifact(build.artifactRoot, name));
      }
      live();
      const body: Omit<BuildReceipt, "hash"> = { taskId: task.id, step: binding.step, attempt: task.metadata.retryCount, artifacts, checks, computeUnits: task.factory!.resourceUnits, costCents: 0, durationMs: performance.now() - started };
      const receipt = { ...body, hash: receiptHash(body) }; build.receipts[task.id] = receipt; if (build.status === "planned") build.status = "building"; persist();
      return { success: true, output: "Model step verified through execution proofs", artifacts: artifacts.map((a) => a.path), costCents: 0, duration: body.durationMs, factoryReceipt: { buildId: build.id, step: binding.step, hash: receipt.hash } };
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "Model verification failed";
      if(/Surface execution BLOCKED|runtime unavailable|sandbox.*unavailable/i.test(state.lastError))state.status="BLOCKED";
      if (!["BLOCKED", "NEEDS_REPLAN"].includes(state.status)) state.status = "FAILED";
      persist(); return { success: false, output: `Model build ${state.status}; see durable verification attempts`, artifacts: [], costCents: 0, duration: performance.now() - started };
    } finally {
      if (session) await session.close();
      state.elapsedMs += performance.now() - started; delete state.sandboxId; persist();
    }
  }
}
