import { createPublicKey, sign, verify, randomUUID, type KeyObject } from 'node:crypto';
import https from 'node:https';
import { trustedBrowserProgramSource, validateBrowserProbe } from './surface-browser.js';
import { canonical } from './company-store.js';
import { buildHash } from './build-store.js';
import type { BrowserAcceptanceProvider, ProductArchitecture, SandboxResult } from './model-build-types.js';
import type { SurfaceAcceptancePlan, SurfaceEnvironment, SurfaceRef } from './surface-builder-types.js';

/** Public deployment pin. Credentials are deliberately excluded from plans and receipts. */
export interface WebRunnerPolicy {
 version:1; runnerId:string; creatorAddress:string; endpoint:string; publicKey:string; approvalId:string;
 environment:SurfaceEnvironment; capabilities:string[]; imageDigest:string; securityProfileHash:string;
 isolation:'PER_JOB'; nonRoot:true; chromiumSandbox:true; privileged:false;
 publicPorts:false; sensitiveMounts:false; orchestratorSecrets:false; egress:'DENY';
 maxJobMs:number; maxArtifactBytes:number; maxResponseBytes:number;
}
export interface SignedMessage<T> { version:1; payload:T; signature:string }
export interface WebRunnerJob {
 id:string; creator:string; taskId:string; leaseId:string; deadline:string;
 plan:SurfaceAcceptancePlan; planRef:SurfaceRef; briefHash:string; architectureHash:string;
 runtime:{entry:string;port:number}; artifacts:{path:string;sha256:string;size:number;base64:string}[];
}
export interface RunnerRequest { runnerId:string; nonce:string; issuedAt:string; operation:'IDENTITY'|'SUBMIT'|'STATUS'|'CANCEL'; jobId:string; jobHash:string; job:WebRunnerJob|null }
export interface RunnerReply {
 runnerId:string; nonce:string; jobId:string; jobHash:string;
 environmentHash:string; securityProfileHash:string; imageDigest:string; planHash:string; bindingHash:string; briefHash:string;
 state:'READY'|'RUNNING'|'COMPLETED'|'CANCELLED'; evidence:'REAL'|'SIMULATED';
 sandboxActive:boolean; nonRoot:boolean; cleanedUp:boolean; result:SandboxResult|null;
}
export interface WebRunnerProof { policyHash:string; jobId:string; jobHash:string; response:SignedMessage<RunnerReply> }
export interface RunnerTransport {
 /** A fixture must NEVER claim real transport execution. */
 readonly execution:'real'|'simulated';
 exchange(message:SignedMessage<RunnerRequest>,signal:AbortSignal):Promise<SignedMessage<RunnerReply>>;
}
export interface WebRunnerContext { job:WebRunnerJob; resume:boolean; signal?:AbortSignal; authorize:()=>void }
export interface DedicatedWebBackend { policy:WebRunnerPolicy; execute(context:WebRunnerContext):Promise<{result:SandboxResult;proof:WebRunnerProof|null}> }
export class WebRunnerInterrupted extends Error { constructor(){super('Dedicated runner connection interrupted; query the same job before retrying');} }
const digest=(v:unknown)=>buildHash(canonical(v));
const bytes=(v:unknown)=>Buffer.from('automaton-web-runner/v1\n'+canonical(v));
export function signRunnerMessage<T>(payload:T,key:KeyObject):SignedMessage<T> {
 if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 runner key required');
 return {version:1,payload,signature:sign(null,bytes(payload),key).toString('base64')};
}
export function verifyRunnerMessage<T>(message:SignedMessage<T>,publicKey:string):T {
 try {const key=createPublicKey(publicKey);if(message.version!==1||key.asymmetricKeyType!=='ed25519'||!verify(null,bytes(message.payload),key,Buffer.from(message.signature,'base64')))throw Error();return message.payload;}
 catch {throw Error('Runner authentication/integrity rejected');}
}
export function validateRunnerPolicy(p:WebRunnerPolicy):void {
 const u=new URL(p.endpoint),parts=u.hostname.split('.').map(Number);
 const privateIP=parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(parts[0]===10||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168);
 if(p.version!==1||!p.creatorAddress||!p.runnerId||!p.approvalId||u.protocol!=='https:'||!privateIP||u.username||u.password||u.search||u.hash||u.pathname!=='/v1/acceptance'||!/^sha256:[a-f0-9]{64}$/.test(p.imageDigest)||!/^[a-f0-9]{64}$/.test(p.securityProfileHash))throw Error('Incomplete/private runner configuration required');
 if(p.isolation!=='PER_JOB'||p.nonRoot!==true||p.chromiumSandbox!==true||p.privileged!==false||p.publicPorts!==false||p.sensitiveMounts!==false||p.orchestratorSecrets!==false||p.egress!=='DENY'||p.environment.isolation!=='filesystem-and-network'||p.environment.browser!=='AVAILABLE')throw Error('Unsafe runner configuration rejected');
 for(const [n,max] of [[p.maxJobMs,120000],[p.maxArtifactBytes,200000],[p.maxResponseBytes,100000]] as const)if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('Bounded runner resources required');
 if(p.environment.toolchain.image!==p.imageDigest||['node','chromium','playwright'].some(k=>typeof p.environment.toolchain[k]!=='string'||!p.environment.toolchain[k].trim()))throw Error('Pinned browser toolchain required');
 if(!Array.isArray(p.capabilities)||['BROWSER_LAUNCH','BROWSER_NAVIGATION','BROWSER_INTERACTION','NETWORK_BEHAVIOR','CRASH_DETECTION'].some(c=>!p.capabilities.includes(c)))throw Error('Runner interaction capabilities required');
 if(createPublicKey(p.publicKey).asymmetricKeyType!=='ed25519')throw Error('Pinned Ed25519 runner identity required');
}
export const runnerApprovalAction=(p:WebRunnerPolicy)=>'web-runner:v1:'+digest(p);
/** Existing creator approvals, not a new authorization system. */
export function requireWebRunnerApproval(db:import('../types.js').AutomatonDatabase,creator:string,productId:string,p:WebRunnerPolicy):void {
 validateRunnerPolicy(p);if(p.creatorAddress!==creator)throw Error('Runner creator mismatch');
 const approved=db.raw.prepare(`SELECT a.id FROM factory_approvals a JOIN factory_products p ON p.id=a.product_id WHERE a.id=? AND a.product_id=? AND a.factory_action_id=? AND a.action='resource_reservation' AND a.status='approved' AND a.decided_by=p.creator_address AND p.creator_address=?`).get(p.approvalId,productId,runnerApprovalAction(p),creator);
 if(!approved)throw Error('Dedicated runner requires exact existing creator approval');
}
export function validateRunnerJob(job:WebRunnerJob,p:WebRunnerPolicy,now=Date.now()):void {
 validateRunnerPolicy(p);validateBrowserProbe(job.plan.probe);
 if(job.plan.createdBeforeExecution!==true||job.plan.mandatory!==true||job.plan.cleanup!=='EPHEMERAL_CONTEXT'||job.plan.probe.transport!=='browser'||job.plan.viewports.length<1||job.plan.viewports.length>3||job.plan.viewports.some(v=>!Number.isSafeInteger(v.width)||!Number.isSafeInteger(v.height)||v.width<240||v.width>1920||v.height<240||v.height>1200)||job.plan.maxScreenshots<0||job.plan.maxScreenshots>2||job.plan.maxEvidenceBytes<1||job.plan.maxEvidenceBytes>60000||job.plan.timeoutMs<1||job.plan.timeoutMs>p.maxJobMs)throw Error('Frozen bounded acceptance plan required');
 if(job.creator!==p.creatorAddress||!job.id||!job.creator||!job.taskId||!job.leaseId||!Number.isFinite(Date.parse(job.deadline))||Date.parse(job.deadline)<=now||Date.parse(job.deadline)-now>p.maxJobMs||job.planRef.hash!==digest(job.plan)||digest(job.plan.runner)!==digest(p)||digest(job.plan.environment)!==digest(p.environment)||!['WEB_APP','WEB_SAAS','PWA'].includes(job.plan.binding.surface)||!job.plan.binding.contract||!job.plan.binding.surfaceDecision||!job.plan.binding.briefId||job.plan.externalOrigins.length||!/^([a-f0-9]{64})$/.test(job.briefHash)||!/^([a-f0-9]{64})$/.test(job.architectureHash))throw Error('Exact authorized Web job binding required');
 if(!Number.isInteger(job.runtime.port)||job.runtime.port<1024||job.runtime.port>65535||!job.artifacts.length||job.artifacts.length>32)throw Error('Bounded private runtime required');
 let total=0;const names=new Set<string>();
 for(const f of job.artifacts){if(!/^[a-zA-Z0-9_./-]+$/.test(f.path)||f.path.startsWith('/')||f.path.split('/').some(x=>!x||x==='..'||x==='.')||names.has(f.path))throw Error('Artifact path rejected');names.add(f.path);const data=Buffer.from(f.base64,'base64');if(data.toString('base64')!==f.base64||data.length!==f.size||buildHash(data)!==f.sha256)throw Error('Artifact integrity rejected');total+=f.size;}
 if(total>p.maxArtifactBytes||!names.has(job.runtime.entry)||!job.runtime.entry.endsWith('.js')||digest(job.artifacts.map(({path,sha256,size})=>({path,sha256,size})))!==job.plan.binding.artifactHash)throw Error('Artifact manifest/runtime mismatch');
}
export function validateRunnerRequest(message:SignedMessage<RunnerRequest>,clientKey:string,p:WebRunnerPolicy,now=Date.now()):RunnerRequest {
 const r=verifyRunnerMessage(message,clientKey);validateRunnerPolicy(p);
 if(r.runnerId!==p.runnerId||!r.nonce||!Number.isFinite(Date.parse(r.issuedAt))||Math.abs(now-Date.parse(r.issuedAt))>30000||!['IDENTITY','SUBMIT','STATUS','CANCEL'].includes(r.operation)||!r.jobId||!/^[a-f0-9]{64}$/.test(r.jobHash))throw Error('Runner request freshness/identity rejected');
 if(r.operation==='SUBMIT'){if(!r.job||r.job.id!==r.jobId||digest(r.job)!==r.jobHash)throw Error('Runner submission mismatch');validateRunnerJob(r.job,p,now);}else if(r.job!==null)throw Error('Unexpected submission payload');
 return r;
}
function reply(message:SignedMessage<RunnerReply>,request:RunnerRequest,p:WebRunnerPolicy):RunnerReply {
 const r=verifyRunnerMessage(message,p.publicKey);
 if(r.runnerId!==p.runnerId||r.nonce!==request.nonce||r.jobId!==request.jobId||r.jobHash!==request.jobHash||r.environmentHash!==digest(p.environment)||r.securityProfileHash!==p.securityProfileHash||r.imageDigest!==p.imageDigest||r.sandboxActive!==true||r.nonRoot!==true||!['READY','RUNNING','COMPLETED','CANCELLED'].includes(r.state)||!['REAL','SIMULATED'].includes(r.evidence))throw Error('Runner identity/environment/job attestation rejected');
 return r;
}
export function validateRunnerProof(proof:WebRunnerProof,p:WebRunnerPolicy,plan?:SurfaceAcceptancePlan):SandboxResult {
 validateRunnerPolicy(p);const r=verifyRunnerMessage(proof.response,p.publicKey);
 reply(proof.response,{runnerId:p.runnerId,nonce:r.nonce,issuedAt:'',operation:'STATUS',jobId:proof.jobId,jobHash:proof.jobHash,job:null},p);
 if(proof.policyHash!==digest(p)||r.state!=='COMPLETED'||r.evidence!=='REAL'||r.cleanedUp!==true||!r.result||!Number.isSafeInteger(r.result.exitCode)||!Number.isFinite(r.result.durationMs)||r.result.durationMs<0||r.result.durationMs>p.maxJobMs||typeof r.result.stdout!=='string'||typeof r.result.stderr!=='string'||Buffer.byteLength(canonical(r.result))>p.maxResponseBytes)throw Error('Real completed cleaned runner proof required');
 if(plan&&(r.result.durationMs>plan.timeoutMs||r.planHash!==digest(plan)||r.bindingHash!==digest(plan.binding)||!/^[a-f0-9]{64}$/.test(r.briefHash)))throw Error('Runner proof plan/binding rejected');
 return r.result;
}
/** Direct private TLS, no proxy, DNS lookup, redirect or unbounded response. */
export class PrivateHttpsRunnerTransport implements RunnerTransport {
 readonly execution='real' as const;
 constructor(private readonly policy:WebRunnerPolicy,private readonly ca:string){validateRunnerPolicy(policy);if(!ca.trim())throw Error('Explicit runner TLS CA required');}
 exchange(message:SignedMessage<RunnerRequest>,signal:AbortSignal):Promise<SignedMessage<RunnerReply>> {
  const data=canonical(message);return new Promise((resolve,reject)=>{
   const req=https.request(this.policy.endpoint,{method:'POST',ca:this.ca,rejectUnauthorized:true,agent:false,signal,headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{
    let size=0;const chunks:Buffer[]=[];
    res.on('data',(b:Buffer)=>{size+=b.length;if(size>this.policy.maxResponseBytes)req.destroy(new Error('Bounded runner response exceeded'));else chunks.push(b);});
    res.on('end',()=>{try{if(res.statusCode!==200)throw Error();resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch{reject(new WebRunnerInterrupted());}});
    res.on('error',()=>reject(new WebRunnerInterrupted()));
   });req.setTimeout(5000,()=>req.destroy());req.on('error',()=>reject(new WebRunnerInterrupted()));req.end(data);
  });
 }
}
function freeze(value:unknown):void {if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}}
/** Runs inside the existing leased worker operation, never an independent queue. */
export class DedicatedWebRunner implements BrowserAcceptanceProvider, DedicatedWebBackend {
 readonly execution='real' as const;readonly dedicated=this;
 readonly policy:WebRunnerPolicy;
 constructor(policy:WebRunnerPolicy,private readonly transport:RunnerTransport,private readonly signingKey:KeyObject){validateRunnerPolicy(policy);this.policy=JSON.parse(canonical(policy));freeze(this.policy);}
 async run():Promise<SandboxResult>{return {exitCode:125,stdout:'',stderr:'Dedicated runner requires frozen authorized job; no host fallback',durationMs:0};}
 async execute(c:WebRunnerContext):Promise<{result:SandboxResult;proof:WebRunnerProof|null}> {
  validateRunnerJob(c.job,this.policy);const jobHash=digest(c.job),deadline=Date.parse(c.job.deadline);
  const signal=AbortSignal.any([c.signal??new AbortController().signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))]);
  const exchange=async(operation:RunnerRequest['operation'],abort=signal)=>{
   if(operation!=='CANCEL')c.authorize();const request:RunnerRequest={runnerId:this.policy.runnerId,nonce:randomUUID(),issuedAt:new Date().toISOString(),operation,jobId:c.job.id,jobHash,job:operation==='SUBMIT'?c.job:null};
   const message=await this.transport.exchange(signRunnerMessage(request,this.signingKey),abort);return {message,value:reply(message,request,this.policy)};
  };
  try {
   const identity=await exchange('IDENTITY');if(identity.value.state!=='READY')throw Error('Runner identity not ready');let response=await exchange(c.resume?'STATUS':'SUBMIT');
   while(response.value.state==='RUNNING'){await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},50);const abort=()=>{clearTimeout(timer);reject(new WebRunnerInterrupted());};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});response=await exchange('STATUS');}
   if(response.value.planHash!==c.job.planRef.hash||response.value.bindingHash!==digest(c.job.plan.binding)||response.value.briefHash!==c.job.briefHash)throw Error('Runner returned another product/plan');
   c.authorize();if(signal.aborted||Date.now()>=deadline)throw new WebRunnerInterrupted();
   if(response.value.cleanedUp!==true||!['COMPLETED','CANCELLED'].includes(response.value.state))throw new WebRunnerInterrupted();
   if(this.transport.execution==='simulated'||response.value.evidence==='SIMULATED'||response.value.state==='CANCELLED')return {result:{exitCode:125,stdout:'',stderr:'Real runner unavailable; simulated/cancelled evidence cannot promote capability',durationMs:0},proof:null};
   const proof:WebRunnerProof={policyHash:digest(this.policy),jobId:c.job.id,jobHash,response:response.message};return {result:validateRunnerProof(proof,this.policy,c.job.plan),proof};
  }catch(error){
   if(signal.aborted){try{await exchange('CANCEL',AbortSignal.timeout(2000));}catch{/* Keep interrupted job durable; never claim cleanup without acknowledgement. */}}
   if(error instanceof WebRunnerInterrupted||signal.aborted)throw new WebRunnerInterrupted();
   throw Error('Dedicated runner security validation rejected');
  }
 }
}

export function runnerRuntime(architecture:ProductArchitecture):WebRunnerJob['runtime'] {
 const a=architecture.commands.run;if(!architecture.runtime||a.length!==2||a[0]!=='node'||!architecture.compiledArtifacts.includes(a[1]))throw Error('Dedicated runner supports only exact compiled Node HTTP entrypoints');
 return {entry:a[1],port:architecture.runtime.port};
}

/** Prepared execution only. The receiver MUST establish its authorized per-job boundary first. */
export function prepareRunnerBrowser(job:WebRunnerJob,p:WebRunnerPolicy):{argv:string[];stdin:string} {
 validateRunnerJob(job,p);
 return {argv:['node','-e',trustedBrowserProgramSource()],stdin:canonical({...job.plan,port:job.runtime.port})};
}
