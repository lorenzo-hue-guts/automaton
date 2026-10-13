import { requireWebRunnerApproval, runnerRuntime, validateRunnerProof, WebRunnerInterrupted, type WebRunnerJob, type WebRunnerProof } from './web-runner.js';
import { getTaskById } from '../state/database.js';
import { CompanyStore, canonical } from './company-store.js';
import { BuildStore, buildHash } from './build-store.js';
import { ProductBriefEngine } from './product-brief.js';
import { acceptanceProfile } from './surface-adapters.js';
import { validateBrowserProbe } from './surface-browser.js';
import type { FactoryOrchestrator } from './factory-orchestrator.js';
import type { AcceptanceProbe, ProductArchitecture, BrowserAcceptanceProvider, ProductSandboxSession, SandboxResult } from './model-build-types.js';
import type { SurfaceBinding, SurfaceAcceptanceReceipt, SurfaceAcceptancePlan, SurfaceEnvironment, SurfaceExecutionCapability, SurfaceExecutionCapabilityEvidence, SurfaceRef } from './surface-builder-types.js';
export const surfaceHash=(v:unknown)=>buildHash(canonical(v));
export const surfaceRef=(r:{key:string;revision:number;hash:string}):SurfaceRef=>({key:r.key,revision:r.revision,hash:r.hash});
export function validateSurfaceReceipt(r:SurfaceAcceptanceReceipt,plan:SurfaceAcceptancePlan):void {
 if(plan.runner&&r.status==='PASS'){if(!r.runnerProof||r.runnerProof.jobId!==r.runId)throw Error('Authenticated dedicated runner proof required');const result=validateRunnerProof(r.runnerProof,plan.runner,plan);let out:any;try{out=JSON.parse(result.stdout);}catch{throw Error('Structured runner evidence required');}if(typeof r.browserEngine!=='string'||!r.browserEngine.trim()||result.exitCode!==0||result.truncated||out.passed!==true||canonical(r.observations)!==canonical(out.observations)||canonical(r.findings)!==canonical(out.findings)||canonical(r.screenshots)!==canonical(out.screenshots)||r.browserEngine!==out.engine)throw Error('Runner evidence substitution rejected');}
 const sameBinding=plan.stage==='BUILD'?canonical(Object.fromEntries(Object.entries({...r.binding,artifactHash:plan.binding.artifactHash}).filter(([k])=>k!=='sourceHash')))===canonical(plan.binding):canonical(r.binding)===canonical(plan.binding);
 if(!sameBinding||r.plan.hash!==surfaceHash(plan)||!r.runId||!Number.isFinite(r.durationMs)||r.durationMs<0||r.computeUnits<0||!['PASS','FAIL','BLOCKED','INCOMPLETE'].includes(r.status))throw Error('Acceptance binding or resource mismatch');
 if(plan.environment&&canonical(r.environment)!==canonical(plan.environment))throw Error('Acceptance environment changed');
 if(plan.stage==='BUILD'&&r.binding.sourceHash!==plan.binding.artifactHash)throw Error('Build source binding changed');
 if(r.status==='PASS'&&(r.execution!=='real'||r.findings.some(f=>f.blocking)||!r.observations.length||r.observations.some(o=>!o.passed)||r.observations.some(o=>['MODEL_CLAIM','SCREENSHOT','VISUAL_MODEL_CRITIQUE'].includes(o.strength))))throw Error('Acceptance cannot self-certify or discard deterministic failure');
 if(r.status==='PASS'&&plan.probe.transport==='browser'&&['BROWSER_LAUNCH','BROWSER_NAVIGATION','BROWSER_INTERACTION','NETWORK_BEHAVIOR','CRASH_DETECTION'].some(c=>!r.observations.some(o=>o.capability===c&&o.passed)))throw Error('Mandatory browser dimensions missing');
 if(plan.probe.kind==='persistence'&&r.status==='PASS'&&(!r.persistenceLayer||r.persistenceLayer==='memory'||r.persistenceLayer==='none'))throw Error('Durable persistence evidence required');
 if(r.status==='PASS'&&plan.probe.browser&&r.screenshots.length<plan.probe.browser.steps.filter(s=>s.action==='SCREENSHOT').length*plan.viewports.length)throw Error('Mandatory screenshot evidence missing');
 for(const s of r.screenshots)if(buildHash(Buffer.from(s.base64,'base64'))!==s.sha256||s.base64.length>22000)throw Error('Screenshot artifact integrity/size mismatch');
}
export function deriveSurfaceExecutionCapability(surface:SurfaceBinding['surface'],capability:SurfaceExecutionCapability,receipts:SurfaceAcceptanceReceipt[],environment:SurfaceEnvironment):Omit<SurfaceExecutionCapabilityEvidence,'receiptRefs'> {
 const same=receipts.filter(r=>r.binding.surface===surface&&r.observations.some(o=>o.capability===capability));
 const toolchainHash=surfaceHash(environment.toolchain),current=same.filter(r=>r.environment.id===environment.id&&surfaceHash(r.environment.toolchain)===toolchainHash);
 if((surface==='IOS'&&environment.ios!=='AVAILABLE')||(surface==='MOBILE_CROSS_PLATFORM'&&environment.ios!=='AVAILABLE'))return {surface,capability,environmentId:environment.id,toolchainHash,status:'BLOCKED',state:'CURRENT',reason:'Authorized Apple tooling/platform-specific acceptance absent'};
 if(surface==='ANDROID'&&['MOBILE_LAUNCH','MOBILE_INTERACTION','PERSISTENCE','PERMISSIONS','CRASH_DETECTION','NETWORK_BEHAVIOR'].includes(capability)&&environment.androidRuntime!=='AVAILABLE')return {surface,capability,environmentId:environment.id,toolchainHash,status:'BLOCKED',state:'CURRENT',reason:'Verified Android emulator/device execution unavailable'};
 const base={surface,capability,environmentId:environment.id,toolchainHash};
 if(!current.length)return {...base,status:same.length?'BLOCKED':'NOT_IMPLEMENTED',state:same.length?'STALE':'CURRENT',reason:same.length?'Toolchain/environment changed; revalidation required':'No owned acceptance evidence'};
 const latest=current.at(-1)!,o=latest.observations.find(o=>o.capability===capability)!;
 if(latest.execution==='unavailable'||latest.status==='BLOCKED'&&!o.passed)return {...base,status:'BLOCKED',state:'CURRENT',reason:'Runtime/environment unavailable'};
 if(!o.passed){const representative=same.some(r=>r!==latest&&r.binding.productId===latest.binding.productId&&r.binding.artifactHash===latest.binding.artifactHash&&r.execution==='real'&&r.observations.some(x=>x.capability===capability&&x.passed));const unaffected=current.some(r=>r!==latest&&r.status==='PASS'&&r.execution==='real'&&r.observations.some(x=>x.capability===capability&&x.passed));return {...base,status:representative||!unaffected?'BLOCKED':'EXPERIMENTAL',state:representative?'REGRESSED':'CURRENT',reason:representative?'Representative deterministic acceptance regressed':'Product-specific failure does not erase unrelated valid evidence'};}
 const valid=current.filter(r=>r.execution==='real'&&r.status==='PASS'&&r.observations.some(o=>o.capability===capability&&o.passed&&!['MODEL_CLAIM','VISUAL_MODEL_CRITIQUE','SCREENSHOT'].includes(o.strength)));
 const independent=new Set(valid.map(r=>r.binding.productId+':'+r.binding.artifactHash));
 const apple=surface==='IOS'||surface==='MOBILE_CROSS_PLATFORM',appleReady=!apple||environment.ios==='AVAILABLE';
 return {...base,status:valid.length&&independent.size>=2&&appleReady?'SUPPORTED':'EXPERIMENTAL',state:'CURRENT',reason:'Capability-specific reproducible execution evidence; not arbitrary-product or market validation'};
}
/** Attached to existing model-build tasks. No worker, timer or independent execution queue. */
export class SurfaceAcceptance {
 readonly company:CompanyStore;
 constructor(readonly builds:BuildStore,readonly factory:FactoryOrchestrator,readonly environment:SurfaceEnvironment) {this.company=new CompanyStore(builds.db,builds.creatorAddress);if(environment.isolation!=='filesystem-and-network')throw Error('Isolated acceptance environment required');}
 private binding(taskId:string,architecture:ProductArchitecture,artifactHash:string):SurfaceBinding {
  const row=getTaskById(this.builds.db.raw,taskId),b=this.builds.binding(taskId),build=b?this.builds.build(b.buildId):undefined;
  if(!this.factory.resources.config.enabled||row?.status!=='running'||!build||row.factory?.productId!==build.productId||!this.factory.resources.leases(true).some(l=>l.taskId===taskId&&l.productId===build.productId&&Date.parse(l.expiresAt)>Date.now()))throw Error('Acceptance requires existing running task and owned resource lease');
  const brief=new ProductBriefEngine(this.builds,this.factory).requireApproved(build.briefId);
  const contract=brief.companyContract?this.company.get('contract',brief.companyContract.key,brief.companyContract.revision):undefined;
  const surface=contract?.body.surfaceDecision?this.company.get('productSurfaceDecision',contract.body.surfaceDecision.key,contract.body.surfaceDecision.revision):undefined;
  const selected=surface?.body.validationSurface??architecture.surface??(architecture.frontend==='HTTP JSON'?'API_SERVICE':'WEB_APP');
  if(architecture.surface&&architecture.surface!==selected)throw Error('No silent surface substitution');
  return {productId:build.productId,buildId:build.id,briefId:brief.id,contract:contract?surfaceRef(contract):null,surfaceDecision:surface?surfaceRef(surface):null,architectureRevision:architecture.revision,artifactHash,surface:selected};
 }
 prepareBuildPlan(taskId:string,architecture:ProductArchitecture,sourceHash:string):SurfaceRef {
  const binding=this.binding(taskId,architecture,sourceHash),profile=this.company.append('surfaceProfile',binding.surface+':1',acceptanceProfile(binding.surface));
  const probe:AcceptanceProbe={id:'compiled-artifact',featureIds:[],entry:'compiled-artifact',input:null,expected:null,kind:'integration'};
  const plan:SurfaceAcceptancePlan={environment:this.environment,stage:'BUILD',expectedArtifactPaths:architecture.compiledArtifacts,binding,profile:surfaceRef(profile),probe,viewports:[],timeoutMs:30000,maxScreenshots:0,maxEvidenceBytes:60000,mandatory:true,contractCriterionIds:[],createdBeforeExecution:true,cleanup:'EPHEMERAL_CONTEXT',externalOrigins:[]};
  return surfaceRef(this.company.append('surfacePlan',taskId+':build:'+sourceHash.slice(0,20),plan));
 }
 recordBuildStage(taskId:string,architecture:ProductArchitecture,artifactHash:string,planRef:SurfaceRef):void {
  const plan=this.company.get('surfacePlan',planRef.key,planRef.revision);if(!plan||plan.hash!==planRef.hash||plan.body.stage!=='BUILD')throw Error('Frozen pre-build plan required');
  const binding={...this.binding(taskId,architecture,artifactHash),sourceHash:plan.body.binding.artifactHash};
  const build=this.builds.build(binding.buildId)!,command=build.model?.attempts.at(-1)?.commands.find(c=>c.phase==='build'&&c.exitCode===0&&c.argv[1]==='/toolchain/android-build.cjs');
  let output:any;try{output=JSON.parse(command?.stdout??'');}catch{}
  const manifest=architecture.compiledArtifacts.map(path=>inspectArtifact(build.artifactRoot,path));
  if(!command||output?.compiled!==true||output?.packaged!==true||surfaceHash(manifest)!==artifactHash||canonical(plan.body.expectedArtifactPaths)!==canonical(architecture.compiledArtifacts))throw Error('Real exact Android compiler/package proof required');
  const key=planRef.key+':'+artifactHash.slice(0,12);
  const receipt:SurfaceAcceptanceReceipt={binding,plan:planRef,runId:key,status:'BLOCKED',execution:'real',environment:this.environment,adapterId:'offline-native-android',adapterVersion:'1',observations:['PROJECT_GENERATION','STATIC_VALIDATION','COMPILATION','PACKAGE'].map(capability=>({capability:capability as SurfaceExecutionCapability,passed:true,strength:'BUILD_RECEIPT',detail:'Executed isolated javac/d8/aapt2; inspected exact unsigned APK'})),findings:[{type:'MOBILE_RUNTIME_UNAVAILABLE',severity:'critical',strength:'STATIC_INSPECTION',message:'No verified emulator/device runner; product acceptance blocked',step:null,viewport:null,blocking:true}],screenshots:[],durationMs:command.durationMs,computeUnits:1,monetaryCostCents:null,firstValue:null,persistenceLayer:null,reproducibility:['Installed immutable offline SDK image; bounded fixed build entrypoint'],limitations:['Build/package evidence only; no emulator, interaction, signing or store acceptance']};
  validateSurfaceReceipt(receipt,plan.body);const saved=this.company.append('surfaceReceipt',key,receipt);
  for(const artifact of manifest)this.company.append('surfaceArtifact',key+':'+artifact.path,{binding,path:artifact.path,sha256:artifact.sha256,size:artifact.size,type:'APK',buildMode:'unsigned',signing:'NOT_CONFIGURED',storeReadiness:'NOT_IMPLEMENTED',receiptRef:surfaceRef(saved)});
  for(const o of receipt.observations)this.company.append('surfaceCapability',key+':'+o.capability,{...deriveSurfaceExecutionCapability(binding.surface,o.capability,[receipt],this.environment),receiptRefs:[surfaceRef(saved)]});
 }
 async browser(taskId:string,architecture:ProductArchitecture,artifactHash:string,probe:AcceptanceProbe,session:ProductSandboxSession,provider:BrowserAcceptanceProvider,timeoutMs:number,signal?:AbortSignal,live?:()=>void):Promise<SandboxResult> {
  validateBrowserProbe(probe);const binding=this.binding(taskId,architecture,artifactHash),brief=this.builds.brief(binding.briefId)!;
  if(!['WEB_APP','WEB_SAAS','PWA'].includes(binding.surface))throw Error('Browser evidence cannot certify native surface');
  if(canonical(brief.content.acceptanceProbes?.find(p=>p.id===probe.id))!==canonical(probe))throw Error('Exact approved brief criterion required');
  const profile=this.company.append('surfaceProfile',binding.surface+':1',acceptanceProfile(binding.surface));
  let plan:SurfaceAcceptancePlan={...(provider.dedicated?{runner:provider.dedicated.policy}:{}),environment:this.environment,binding,profile:surfaceRef(profile),probe,viewports:probe.browser!.viewports??[{name:'DESKTOP',width:1280,height:800}],timeoutMs:Math.ceil(timeoutMs),maxScreenshots:2,maxEvidenceBytes:60000,mandatory:true,contractCriterionIds:brief.content.validationCriteria.filter(c=>c.target===`acceptance:${probe.id}`).map(c=>c.id),createdBeforeExecution:true,cleanup:'EPHEMERAL_CONTEXT',externalOrigins:[]};
  if(plan.viewports.length<1||plan.viewports.length>3||plan.viewports.some(v=>v.width<240||v.width>1920||v.height<240||v.height>1200))throw Error('Bounded risk-based viewport matrix required');
  if(provider.dedicated){
   const pending=this.company.list('surfaceRun').filter(r=>r.body.runnerJob&&r.body.binding.productId===binding.productId&&r.body.status!=='COMPLETED');
   if(pending.length){
    if(pending.length!==1)throw Error('Unresolved dedicated jobs require reconciliation');
    const old=pending[0].body.runnerJob!;
    if(pending[0].body.taskId!==taskId||canonical(old.plan.binding)!==canonical(binding)||canonical(old.plan.probe)!==canonical(probe)||canonical(old.plan.runner)!==canonical(plan.runner)||canonical(old.plan.environment)!==canonical(plan.environment))throw Error('Unresolved runner job blocks duplicate/new artifact execution');
    plan=old.plan;
   }
  }
  // Timeout is a resource ceiling, not a success criterion; key includes the immutable plan.
  const key=taskId+':'+surfaceHash(plan).slice(0,24),p=this.company.append('surfacePlan',key,plan),existing=this.company.get('surfaceReceipt',key);
  if(existing){validateSurfaceReceipt(existing.body,plan);return {exitCode:existing.body.status==='PASS'?0:existing.body.status==='BLOCKED'?125:1,stdout:JSON.stringify({passed:existing.body.status==='PASS',receiptKey:key}),stderr:existing.body.status==='PASS'?'':'Persisted acceptance '+existing.body.status,durationMs:0};}
  const previous=this.company.get('surfaceRun',key);
  if(previous&&!provider.dedicated)throw Error('Interrupted acceptance requires existing bounded task retry/new attempt; no duplicate execution');
  this.company.append('surfaceEnvironment',this.environment.id+':'+surfaceHash(this.environment.toolchain).slice(0,12),this.environment);
  const authorize=()=>{
   live?.();
   this.binding(taskId,architecture,artifactHash);
   if(signal?.aborted)throw Error('Worker cancellation');
   if(provider.dedicated){const policy=provider.dedicated.policy;
    requireWebRunnerApproval(this.builds.db,this.builds.creatorAddress,binding.productId,policy);
   }
  };
  authorize();
  let job:WebRunnerJob|undefined=previous?.body.runnerJob;
  if(provider.dedicated&&!job){
   const build=this.builds.build(binding.buildId)!,attempt=build.model!.attempts.at(-1)!;
   const artifacts=architecture.compiledArtifacts.map(path=>{const data=Buffer.from(readArtifact(build.artifactRoot,`acceptance-artifacts/${attempt.index}/${path}`));return {path,sha256:buildHash(data),size:data.length,base64:data.toString('base64')};});
   const lease=this.factory.resources.leases(true).find(l=>l.taskId===taskId&&l.productId===binding.productId)!;
   job={id:key,creator:this.builds.creatorAddress,taskId,leaseId:lease.id,deadline:new Date(Math.min(Date.now()+plan.timeoutMs,Date.parse(lease.expiresAt))).toISOString(),plan,planRef:surfaceRef(p),briefHash:surfaceHash(brief.content),architectureHash:surfaceHash(architecture),runtime:runnerRuntime(architecture),artifacts};
  }
  // Persist before submission. A disconnect is resumed with STATUS, never a duplicate SUBMIT.
  if(!previous)this.company.append('surfaceRun',key,{plan:surfaceRef(p),binding,status:'RUNNING',taskId,attempt:this.builds.build(binding.buildId)!.model!.attempts.length,receiptKey:null,...(job?{runnerJob:job}:{})});
  const start=performance.now();let result:SandboxResult,runnerProof:WebRunnerProof|null=null;
  try{if(provider.dedicated){const remote=await provider.dedicated.execute({job:job!,resume:!!previous,signal,authorize});result=remote.result;runnerProof=remote.proof;}else result=provider.execution==='real'?await provider.run(session,architecture.runtime!.port,probe,plan.timeoutMs):{exitCode:125,stdout:'',stderr:'Browser runtime unavailable; synthetic acceptance forbidden',durationMs:0};}
  catch(e){if(e instanceof WebRunnerInterrupted||provider.dedicated){const run=this.company.get('surfaceRun',key)!;this.company.append('surfaceRun',key,{...run.body,status:'INTERRUPTED'},run.revision);throw new WebRunnerInterrupted();}result={exitCode:1,stdout:'',stderr:String(e).slice(0,1000),durationMs:performance.now()-start};}
  let output:any;try{output=JSON.parse(result.stdout);}catch{}
  const blocked=result.exitCode===125||/unavailable|No usable sandbox|SUID sandbox|startup failed/i.test(result.stderr)||output?.status==='BLOCKED';
  const status=blocked?'BLOCKED':result.truncated?'INCOMPLETE':result.exitCode===0&&output?.passed===true?'PASS':'FAIL';
  const observations=Array.isArray(output?.observations)?output.observations:[{capability:'BROWSER_INTERACTION' as const,passed:false,strength:'DETERMINISTIC_ASSERTION' as const,detail:result.stderr||'Structured receipt unavailable'}];
  const receipt:SurfaceAcceptanceReceipt={...(runnerProof?{runnerProof}:{}),browserEngine:output?.engine??null,semanticState:output?.semantic??[],binding,plan:surfaceRef(p),runId:key,status,execution:blocked?'unavailable':'real',environment:this.environment,adapterId:provider.dedicated?'dedicated-web-runner':'isolated-playwright',adapterVersion:'1',observations,findings:output?.findings??[{type:'BROWSER_UNAVAILABLE',severity:'critical',strength:'DETERMINISTIC_ASSERTION',message:result.stderr.slice(0,1000),step:null,viewport:null,blocking:true}],screenshots:output?.screenshots??[],durationMs:performance.now()-start,computeUnits:1,monetaryCostCents:null,firstValue:output?.firstValue??null,persistenceLayer:probe.kind==='persistence'?probe.browser!.persistenceLayer??null:null,reproducibility:['Exact approved probe and compiled artifact manifest','Ephemeral private browser context; no public ports'],limitations:['Technical acceptance, not observed human/customer/economic evidence','Automated accessibility is not full WCAG certification','Real model generalization not demonstrated by deterministic tests']};
  validateSurfaceReceipt(receipt,plan);this.builds.db.raw.transaction(()=>{const saved=this.company.append('surfaceReceipt',key,receipt);
  this.company.append('surfaceRun',key,{...this.company.get('surfaceRun',key)!.body,status:'COMPLETED',receiptKey:key},this.company.get('surfaceRun',key)!.revision);
  for(const o of observations){const derived=deriveSurfaceExecutionCapability(binding.surface,o.capability,[receipt],this.environment);this.company.append('surfaceCapability',key+':'+o.capability,{...derived,receiptRefs:[surfaceRef(saved)]});}
  }).immediate();
  return {...result,exitCode:status==='PASS'?0:status==='BLOCKED'?125:1,stdout:JSON.stringify({...output,passed:status==='PASS',receiptKey:key}),stderr:status==='PASS'?result.stderr:`${status==='BLOCKED'?'Browser runtime unavailable':status}: ${result.stderr||output?.findings?.map((f:any)=>f.message).join('; ')||'Declared acceptance failed'}`};
 }
}
export function assertSurfaceQuality(store:CompanyStore,builds:BuildStore,key:string,productId:string,contractKey:string,revision:number):void {
 const r=store.get('surfaceReceipt',key),p=r?store.get('surfacePlan',r.body.plan.key,r.body.plan.revision):undefined,b=r?builds.build(r.body.binding.buildId):undefined;
 if(!r||!p||!b||p.hash!==r.body.plan.hash||r.body.status!=='PASS'||r.body.binding.productId!==productId||r.body.binding.contract?.key!==contractKey||r.body.binding.contract.revision!==revision)throw Error('Exact browser acceptance receipt required');
 validateSurfaceReceipt(r.body,p.body);
 const a=b.model?.architectures.at(-1);if(!a||a.revision!==r.body.binding.architectureRevision)throw Error('Acceptance architecture changed');
 // Successful current compiled artifacts must match the acceptance digest exactly.
 const manifest=a.compiledArtifacts.map(path=>inspectArtifact(b.artifactRoot,path));
 if(surfaceHash(manifest)!==r.body.binding.artifactHash)throw Error('Old artifact receipt cannot validate new build');
 const latest=store.get('contract',contractKey),contract=store.get('contract',contractKey,revision);if(latest?.revision!==revision||contract?.hash!==r.body.binding.contract?.hash)throw Error('Acceptance Contract changed');if(r.body.binding.surfaceDecision){const sr=r.body.binding.surfaceDecision,current=store.get('productSurfaceDecision',sr.key);if(current?.revision!==sr.revision||current.hash!==sr.hash)throw Error('Acceptance surface decision changed');}
}
import { inspectArtifact, readArtifact } from './local-artifacts.js';
