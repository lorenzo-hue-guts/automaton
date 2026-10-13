import { assertSurfaceQuality } from './surface-acceptance.js';
import type { AutomatonDatabase } from '../types.js';
import type { TaskGraphRow } from '../state/database.js';
import { BuildStore,buildHash } from './build-store.js';
import { CompanyStore,canonical } from './company-store.js';
import type { ProductBrief } from './build-types.js';
import { qualityResult } from './company-governance.js';
export function assertCompanyBrief(db:AutomatonDatabase,brief:ProductBrief):void {
  if(!brief.companyContract){const company=new CompanyStore(db,brief.creatorAddress).get('company','operating-model');if(company?.body.config.enabled&&Date.parse(brief.createdAt)>=Date.parse(company.createdAt))throw Error('New company-managed build requires Product Contract and greenlight');return;}
  const store=new CompanyStore(db,brief.creatorAddress),ref=brief.companyContract;
  const contract=store.get('contract',ref.key,ref.revision),latest=store.get('contract',ref.key);
  if(!contract||contract.hash!==ref.hash||latest?.revision!==ref.revision||contract.body.productId!==brief.productId||contract.body.opportunityId!==brief.opportunityId||contract.body.status!=='approved')throw Error('Exact current approved Product Contract required');
  if(contract.body.surfaceDecision){
    const sr=contract.body.surfaceDecision,s=store.get('productSurfaceDecision',sr.key,sr.revision);
    if(!s||s.hash!==sr.hash||s.body.productId!==brief.productId||store.get('productSurfaceDecision',sr.key)?.revision!==sr.revision)throw Error('Exact current Product Surface decision required');
    const validation=s.body.validationSurface,cap=store.get('builderSurfaceCapability',validation);
    const compiler=cap?.body.acceptanceEvidence?.COMPILATION;
    const nativeBuildOnly=validation==='ANDROID'&&contract.body.constraints.includes('PRIVATE_BUILD_ONLY')&&!!compiler&&['SUPPORTED','EXPERIMENTAL'].includes(compiler.status)&&compiler.receiptRefs.some(ref=>{const r=store.get('surfaceReceipt',ref.key,ref.revision);return r?.hash===ref.hash&&r.body.binding.surface==='ANDROID'&&r.body.execution==='real'&&r.body.observations.some(o=>o.capability==='COMPILATION'&&o.passed&&o.strength==='BUILD_RECEIPT');});
    if((!['API_SERVICE','WEB_APP','WEB_SAAS'].includes(validation)||!cap||['NOT_IMPLEMENTED','BLOCKED'].includes(cap.body.status))&&!nativeBuildOnly)throw Error('Selected validation surface Builder capability NOT_IMPLEMENTED / BLOCKED; no silent Web substitution');
  }
  const decision=db.productFactory.get('decisions',ref.decisionId);
  if(contract.body.evidenceIds.some(id=>{const e=db.productFactory.getAtomicEvidence(id);return e?.company&&Date.parse(e.company.expiresAt)<=Date.now();}))throw Error('Product Contract economic evidence expired');
  const inputs=decision?.company?.inputs as {evidenceSnapshotHash?:string}|null;
  if(inputs?.evidenceSnapshotHash!==companyEvidenceDigest(db,brief.opportunityId))throw Error('Company greenlight evidence changed; new council review required');
  const assumptions=decision?.company?.assumptionIds??[];
  if(assumptions.some(id=>{const a=store.get('assumption',id);return !a||a.body.status!=='valid'||Date.parse(a.body.expiresAt)<=Date.now()||decision?.company?.versions[`assumption:${id}`]!==a.revision;}))throw Error('Product Contract assumptions changed/stale');
  if(decision?.outcome!=='GREENLIGHT'||decision.productId!==brief.productId||decision.company?.versions[`contract:${ref.key}`]!==ref.revision)throw Error('Company greenlight required');
}
export function assertCompanyQuality(db:AutomatonDatabase,brief:ProductBrief):void {
  if(!brief.companyContract)return;
  assertCompanyBrief(db,brief);
  const store=new CompanyStore(db,brief.creatorAddress),ref=brief.companyContract,contract=store.get('contract',ref.key,ref.revision)!;
  const quality=store.get('quality',`${ref.key}:${ref.revision}`);
  if(!quality||quality.body.contractRevision!==ref.revision||!qualityResult(contract.body,quality.body).passed)throw Error('Mandatory Product Contract quality gates not verified');
  for(const gate of contract.body.gates.filter(g=>g.required&&g.requiresBrowser)){const evidence=quality.body.gates.find(g=>g.gate===gate.gate)?.acceptance;if(!evidence?.surfaceReceiptKey)throw Error('Mandatory exact browser receipt missing');assertSurfaceQuality(store,new BuildStore(db,brief.creatorAddress),evidence.surfaceReceiptKey,brief.productId!,ref.key,ref.revision);}
  const health=store.get('health',brief.productId!);
  if(health&&['critical','degraded'].includes(health.body.status))throw Error('Product Health blocks release');
}
/** Additional company caps, never a substitute for ResourceManager or policy. */
export function companyResourceBlock(db:AutomatonDatabase,creatorAddress:string,task:TaskGraphRow):string|null {
  const store=new CompanyStore(db,creatorAddress),company=store.get('company','operating-model');
  const productId=task.factory!.productId;
  if(!company?.body.config.enabled)return db.getKV(`product-factory:company-product:${productId}`)?'Company OS disabled for managed product':null;
  const overlay=store.get('portfolio',productId),mode=store.get('mode',productId)??store.get('mode','company');
  if(['KILL','ARCHIVE','HOLD'].includes(overlay?.body.state??''))return 'Company product economic state blocks work';
  if(mode?.body.mode==='CRISIS'&&!task.factory!.criticalIncident&&task.factory!.resourceClass==='build')return 'Crisis prioritizes PROTECT over ordinary build';
  const ref=db.getKV(`product-factory:company-product:${productId}`);
  if(!ref)return null; // Existing Lots retain their behavior.
  if(task.factory!.criticalIncident)return null; // Existing emergency resource reserves/policy still apply.
  const allocations=store.list('allocation').filter(a=>a.body.productId===productId&&a.body.status==='committed');
  if(!allocations.length)return 'Company capital approval/allocation required';
  const a=allocations.at(-1)!.body;
  const proposal=store.get('proposal',a.proposalKey,a.proposalRevision);
  if(proposal?.body.assumptionIds.some(id=>{const assumption=store.get('assumption',id)?.body;return !assumption||assumption.status!=='valid'||Date.parse(assumption.expiresAt)<=Date.now();}))return 'Company allocation assumptions invalid/stale';
  const approval=db.productFactory.get('approvals',a.approvalId);
  if(approval?.status!=='approved'||approval.decidedBy!==creatorAddress)return 'Company capital creator approval required';
  const usage=companyProductUsage(db,creatorAddress,productId);
  const active=db.raw.prepare("SELECT COALESCE(SUM(operational_cost_cents),0) AS cost FROM factory_resource_reservations WHERE product_id=? AND managed=1 AND status='reserved'").get(productId) as {cost:number};
  if(usage.cost-a.baselineCostCents+active.cost+(['assigned','running'].includes(task.status)?0:task.estimatedCostCents)>a.capitalCents)return 'Company allocated capital cap';
  if(usage.duration-a.baselineDurationMs+(['assigned','running'].includes(task.status)?0:task.timeoutMs)>a.builderHours*3600000&&task.factory!.resourceClass==='build')return 'Company allocated Builder-time cap';
  if(usage.compute-a.baselineComputeUnits+task.factory!.resourceUnits>a.computeUnits)return 'Company allocated compute cap';
  return null;
}

export function companyProductUsage(db:AutomatonDatabase,creatorAddress:string,productId:string):{cost:number;duration:number;compute:number} {
  const row=db.raw.prepare('SELECT COALESCE(SUM(actual_cost_cents),0) AS cost FROM task_graph WHERE product_id=?').get(productId) as {cost:number};
  const bs=new BuildStore(db,creatorAddress),buildId=db.getKV(`product-factory:product-build:${productId}`),build=buildId?bs.build(buildId):undefined;
  const ordinary=db.raw.prepare("SELECT id,result FROM task_graph WHERE product_id=?").all(productId) as {id:string;result:string|null}[];
  const privateOutcomes=new CompanyStore(db,creatorAddress).list('optimizationPrivateOutcome').filter(o=>o.body.productId===productId);
  const duration=privateOutcomes.reduce((sum,o)=>sum+o.body.durationMs,0)+ordinary.filter(t=>!bs.binding(t.id)&&!privateOutcomes.some(o=>o.body.taskId===t.id)).reduce((sum,t)=>sum+(t.result?(JSON.parse(t.result).duration??0):0),0)+Math.max(build?.model?.elapsedMs??0,build?.attempts.reduce((sum,t)=>sum+t.durationMs,0)??0);
  const privateCompute=privateOutcomes.reduce((sum,o)=>sum+o.body.computeUnits,0);
  const compute=privateCompute+(build?.model?.computeUnits??0)+(build?.attempts.filter(t=>!build.tasks.some(b=>b.taskId===t.taskId&&['architecture','model_build','reference_research'].includes(b.step))).reduce((sum,t)=>sum+t.computeUnits,0)??0);
  return {cost:row.cost,duration,compute};
}

export function companyChargeBlock(db:AutomatonDatabase,creatorAddress:string,productId:string,cents:number):string|null {
  const s=new CompanyStore(db,creatorAddress);
  if(!db.getKV(`product-factory:company-product:${productId}`))return null;
  if(!s.get('company','operating-model')?.body.config.enabled)return 'Company OS disabled for managed product';
  const a=s.list('allocation').find(a=>a.body.productId===productId&&a.body.status==='committed')?.body;
  if(!a||companyProductUsage(db,creatorAddress,productId).cost-a.baselineCostCents+cents>a.capitalCents)return 'Company allocated inference capital exhausted';
  return null;
}

export function companyEvidenceDigest(db:AutomatonDatabase,opportunityId:string):string {
  return buildHash(canonical(db.productFactory.listAtomicEvidence(opportunityId).filter(e=>e.company).map(e=>({id:e.id,company:e.company!,relation:e.provenance.relation}))));
}
