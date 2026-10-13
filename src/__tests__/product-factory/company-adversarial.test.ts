import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {createDatabase,getTaskById} from '../../state/database.js';
import {CompanyOperatingSystem,CompanyStore,ProductFactory,BuildEngine,accessibleRevenue,compareCapital,forecastCalibration,revenueGap,runway,unknownMetric,qualityResult,resolveCompanyConfig,resolveProductFactoryConfig,createCompanyPolicyAdmission,assertCompanyQuality,companyResourceBlock} from '../../product-factory/index.js';
import type {AutomatonDatabase} from '../../types.js';
import type {EconomicSnapshot,MetricValue,ProductContract,CompanyEntityMap} from '../../product-factory/index.js';
import {companyFixture} from './fixtures/company-fixture.js';
import {PolicyEngine} from '../../agent/policy-engine.js';
import {createTestConfig,createTestIdentity,MockConwayClient,MockInferenceClient} from '../mocks.js';
let db:AutomatonDatabase,dir:string,f:ReturnType<typeof companyFixture>;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'company-r-'));db=createDatabase(path.join(dir,'state.db'));f=companyFixture(db);});
afterEach(()=>{if(db.raw.open)db.close();fs.rmSync(dir,{recursive:true,force:true});});
function readyCase() {const o=f.opportunity(),ids=[f.evidence(o,'money_flow'),f.evidence(o,'buyer'),f.evidence(o,'distribution')],p=f.product();f.business(o,ids);const c=f.contract(o,p,ids);return {o,ids,p,c};}
function council(block?:'GROWTH'|'BUILDER') {return f.os.council('council',{businessCaseKey:'business',contractKey:'contract',contractRevision:1,assessments:f.assessments(block),claimKeys:[],reversibility:'EASILY_REVERSIBLE',capitalCents:1000});}
const metric=(value:number):MetricValue=>({value,unit:'EUR:cents',nature:'ESTIMATE',evidenceIds:[],confidence:.8});

it('A/B — high revenue can destroy contribution; smaller profitable revenue is economically stronger',()=>{
  f.setNow('2026-10-20T00:00:00Z');const a=f.snapshot('high',200000,195000),b=f.snapshot('small',10000,0);
  expect(a.body.metrics.contribution.value).toBe(5000);expect(b.body.metrics.contribution.value).toBe(10000);
  expect(f.snapshot('destroyed',200000,210000).body.metrics.profit.value).toBe(-10000);
});
it('C — material miss remains missed, target unchanged, Recovery persists without unsafe execution',()=>{
  const t=f.target();f.setNow('2026-10-20T00:00:00Z');f.snapshot('actual',5000,1000);
  const r=f.os.review('week1',{type:'weekly',targetKey:'week1',snapshotKey:'actual',assessments:f.assessments(),stopDoing:['Low-return busywork'],priorities:['Diagnose conversion']});
  expect(r.body.targetOutcome).toBe('MISSED');expect(f.os.store.get('target','week1')?.hash).toBe(t.hash);expect(f.os.store.get('mode','company')?.body.mode).toBe('RECOVERY');
  expect(()=>f.os.ownerTarget('week1',{...t.body,amountCents:5000},'CREATOR',1)).toThrow('Historical');
  expect(()=>f.os.ownerTarget('week1',{...t.body,amountCents:5000},'JUDGE',1)).toThrow('creator');
});
it('D — exceeded target calls for repeatability, does not stop; higher stretch does not replace owner target',()=>{
  const target=f.target();f.setNow('2026-10-20T00:00:00Z');f.snapshot('actual',40000,1000);
  const r=f.os.review('exceeded',{type:'weekly',targetKey:'week1',snapshotKey:'actual',assessments:f.assessments(),stopDoing:[],priorities:['Evaluate marginal contribution']});
  expect(r.body.targetOutcome).toBe('EXCEEDED');expect(r.body.repeatability).toContain('repeatability');
  const e=f.evidence(f.opportunity(),'retention',5);f.os.stretch('ambition','week1',50000,[e],'Renewal mechanism and bounded marginal return');
  expect(f.os.store.get('stretch','ambition')?.body.amountCents).toBe(50000);expect(f.os.store.get('target','week1')?.hash).toBe(target.hash);
});
it('E — complaint-only opportunity cannot greenlight full build',()=>{
  const o=f.opportunity(),ids=[f.evidence(o,'problem',1)],p=f.product();f.business(o,ids);f.contract(o,p,ids);
  expect(council().outcome).toBe('RESEARCH_MORE');
});
it('F — paid replacement thesis is considered but not automatically approved',()=>{
  const {o,ids}=readyCase();f.os.record('marketThesis','market',{...f.provenance,evidenceIds:ids,opportunityId:o,buyer:f.os.store.get('businessCase','business')!.body.buyer,moneyFlowEvidenceIds:[ids[0]],purchaseTriggers:['Vendor removed feature'],switchability:{factors:{switchingCost:f.range(100,500)},rationale:'Migration and acquisition remain uncertain',evidenceIds:ids},replacement:{thesis:'Paid but poorly served workflow',evidenceIds:ids,uncertainties:['Actual switching intent']},competitiveResponse:{canCopy:true,canBundle:false,canRestrictAccess:false,risk:'material',rationale:'Possible response',evidenceIds:ids},defensibility:[{kind:'workflow_depth',hypothesis:'Value through accumulated history',evidenceIds:ids}]},'ENTREPRENEUR');
  expect(f.os.store.get('marketThesis','market')?.body.replacement.uncertainties).toHaveLength(1);
  expect(council('GROWTH').outcome).toBe('HOLD');
});
it('G — distribution challenge materially blocks an otherwise feasible product',()=>{readyCase();expect(council('GROWTH').outcome).toBe('HOLD');});
it('H/P — real behavior outranks synthetic praise; contradiction remains visible and reduces confidence',()=>{
  const o=f.opportunity(),praise=f.evidence(o,'buyer',1),refute=f.evidence(o,'buyer',3,'refutes');
  f.os.record('claim','demand',{...f.provenance,evidenceIds:[praise,refute],statement:'Buyers value the product',productId:null},'JUDGE');
  const evaluation=f.os.evidence.evaluate('demand');expect(evaluation.confidence).toBe(0);expect(evaluation.contradictions).toContain(refute);
  const ids=[f.evidence(o,'money_flow'),f.evidence(o,'distribution')],p=f.product();f.business(o,[praise,...ids]);f.contract(o,p,[praise,...ids]);
  const d=council();expect(d.outcome).not.toBe('GREENLIGHT');expect(d.company?.contradictions).toContain(refute);
});
it('I — compile/HTTP success cannot replace a failed mandatory UX/value gate',()=>{
  const {p,c}=readyCase();const assessment={productId:p,contractKey:'contract',contractRevision:1,gates:[{gate:'FUNCTIONAL' as const,status:'PASS' as const,evidenceIds:[],rationale:'Hypothetical compile pass'},{gate:'UX' as const,status:'FAIL' as const,evidenceIds:[],rationale:'Main journey unclear'}]};
  expect(qualityResult(c,assessment).passed).toBe(false);expect(()=>f.os.quality('contract:1',assessment,'BUILDER')).toThrow('self-certify');
  const missingBrowser={...assessment,gates:[{gate:'UX' as const,status:'BLOCKED' as const,evidenceIds:[],rationale:'Browser unavailable'}]};
  f.os.quality('contract:1',missingBrowser,'BUILDER');expect(qualityResult(c,missingBrowser).passed).toBe(false);
});
it('J/W — customer growth and historical average do not justify poor marginal scaling economics',()=>{
  const p=f.product(),proposal=f.proposal('scale',p,10000,1000);proposal.action='SCALE';proposal.marginalContribution=f.range(-500,-100);proposal.historicalSpendCents=100000;
  f.os.record('proposal','scale',proposal,'ENTREPRENEUR',1);
  const result=f.os.capitalComparisons(['scale'])[0];expect(result.eligible).toBe(false);expect(result.conservativeExpectedProfit).toBeLessThan(0);
});
it('K — observed profitable healthy stable product can HARVEST instead of KILL',()=>{
  const p=f.product();f.setNow('2026-10-20T00:00:00Z');const s=f.snapshot('stable',10000,1000,p);
  f.os.health({...f.provenance,productId:p,status:'healthy',factors:{reliability:'healthy',retention:'healthy',support:'healthy'},incidents:[],errorBudgetRemaining:metric(90)},'BUILDER');
  const d=f.os.decide('harvest','HARVEST','Stable profitable low-growth product; maintain reliability',{productId:p,evidenceIds:s.body.metrics.profit.evidenceIds});
  f.os.portfolioState(p,{...f.provenance,productId:p,state:'HARVEST',decisionId:d.id,capitalIntensity:'minimal',monitoring:'normal',reviewCadence:'monthly',relationships:[]});
  expect(f.os.store.get('portfolio',p)?.body.state).toBe('HARVEST');expect(f.factory.portfolio.get(p)?.portfolioState).not.toBe('killed');
});
it('L/V — existing product improvement can outrank new product; sunk spending does not create merit',()=>{
  const old=f.product(),fresh=f.product();f.proposal('improve',old,10000,1000,2);const weak=f.proposal('new',fresh,2000,1000,8);weak.historicalSpendCents=10000000;f.os.record('proposal','new',weak,'ENTREPRENEUR',1);
  const results=f.os.capitalComparisons(['new','improve']);expect(results[0].key).toBe('improve');expect(results[0].returnOnBuilderHour).toBeGreaterThan(results[1].returnOnBuilderHour!);
  const o=f.opportunity();f.os.record('shadow','alternative',{...f.provenance,opportunityId:o,proposalKey:'improve',status:'available',reevaluationConditions:['Fresh evidence'],representation:'feature',alternatives:['bundle','independent_product']},'ENTREPRENEUR');expect(f.os.store.list('shadow')).toHaveLength(1);
});
it('M — limited capital, pending approvals and repeated allocation remain bounded/idempotent',()=>{
  const a=f.product(),b=f.product();f.proposal('a',a,5000,6000);f.proposal('b',b,5000,6000);
  const da=f.os.decide('alloc-a','ALLOCATE','Bounded capital',{productId:a,evidenceIds:[]}),dbb=f.os.decide('alloc-b','ALLOCATE','Bounded capital',{productId:b,evidenceIds:[]});
  const request=f.os.requestAllocation('a','a',da.id);expect(f.os.requestAllocation('a','a',da.id).id).toBe(request.id);
  expect(()=>f.os.commitAllocation('a')).toThrow('creator');expect(()=>f.os.requestAllocation('b','b',dbb.id)).toThrow('capital');
  new ProductFactory(db,f.factory.resources.config,'creator').decideApproval(request.body.approvalId,'approved');const committed=f.os.commitAllocation('a');expect(f.os.commitAllocation('a').id).toBe(committed.id);
});
it('N — consecutive material misses trigger strategic review instead of repeating the failed plan',()=>{
  const periods=[['2026-10-12T00:00:00Z','2026-10-19T00:00:00Z'],['2026-10-19T00:00:00Z','2026-10-26T00:00:00Z'],['2026-10-26T00:00:00Z','2026-11-02T00:00:00Z']];
  periods.forEach(([s,e],i)=>f.target(`week${i}`,30000,s,e));
  periods.forEach(([s,e],i)=>{f.setNow(new Date(Date.parse(e)+86400000).toISOString());f.snapshot(`a${i}`,5000,1000,null,s,e);f.os.review(`r${i}`,{type:'weekly',targetKey:`week${i}`,snapshotKey:`a${i}`,assessments:f.assessments(),stopDoing:['Failed plan'],priorities:['Compare market and portfolio alternatives']});});
  expect(f.os.store.get('mode','company')?.body.consecutiveMisses).toBe(3);expect(f.os.store.get('mode','company')?.body.strategicReviewRequired).toBe(true);
});
it('O — critical incident prioritizes PROTECT; ordinary builds remain policy/resource bounded',()=>{
  const p=f.product();f.os.pulse('outage',[{type:'product_unavailable',productId:p,severity:'critical',evidenceIds:[],reason:'Synthetic incident simulation'}]);
  const task=f.os.planResearch(p,'safe','Local research continues');
  const row={...task,factory:{...task.factory!,resourceClass:'build' as const}};
  expect(f.os.store.get('mode',p)?.body.mode).toBe('CRISIS');expect(companyResourceBlock(db,'creator',row)).toContain('PROTECT');expect(companyResourceBlock(db,'creator',task)).toBe(null);
});
it('Q — repeated forecast optimism lowers later confidence; honestly wide ranges are not penalized',()=>{
  f.forecast('f1',100000,150000);f.setNow('2026-10-20T00:00:00Z');f.snapshot('a1',10000,0);f.os.forecastActual('out1','f1','a1');
  f.forecast('f2',100000,150000);f.os.forecastActual('out2','f2','a1');f.forecast('f3',100000,150000);
  expect(f.os.store.get('forecast','f3')!.body.confidence).toBeLessThan(f.os.store.get('forecast','f1')!.body.confidence);
  expect(forecastCalibration([{direction:'in_range',inRange:true}]).confidenceFactor).toBe(1);
});
it('R — feature/bundle/replacement alternatives and cannibalization remain explicit',()=>{
  const p=f.product(),other=f.product();const d=f.os.decide('hold','HOLD','Compare cannibalization versus complementary bundle',{productId:p,evidenceIds:[],alternatives:['feature','bundle','separate_product','replacement']});
  f.os.portfolioState(p,{...f.provenance,productId:p,state:'HOLD',decisionId:d.id,capitalIntensity:'validation',monitoring:'normal',reviewCadence:'weekly',relationships:[{productId:other,type:'cannibalization',evidenceIds:[],rationale:'May replace current revenue with a better outcome'}]});expect(f.os.store.get('portfolio',p)?.body.relationships[0].type).toBe('cannibalization');
});
it('S — fatal platform absorption risk blocks greenlight',()=>{
  readyCase();const b=f.os.store.get('businessCase','business')!;f.os.record('businessCase','business',{...b.body,preMortem:[{risk:'Platform bundles core value',severity:'fatal',evidenceIds:b.body.evidenceIds,mitigation:'No viable differentiation'}]},'ENTREPRENEUR',1);
  const c=f.os.store.get('contract','contract')!;f.os.createContract('contract',{...c.body,businessCaseRevision:2,changeReason:'New platform risk'},'ENTREPRENEUR',1);
  expect(f.os.council('c',{businessCaseKey:'business',contractKey:'contract',contractRevision:2,assessments:f.assessments(),claimKeys:[],reversibility:'EFFECTIVELY_IRREVERSIBLE',capitalCents:1000}).outcome).toBe('REJECT');
});
it('T — policy denial wins over revenue pressure and remains audited',()=>{
  const denied=new CompanyOperatingSystem(f.factory,{...f.options,admission:()=>({allowed:false,reason:'Existing policy denies this action'})});
  const d=denied.decide('unsafe','SCALE','Target pressure',{evidenceIds:[],inputs:{pressure:true}});expect(d.outcome).toBe('HOLD');expect(d.company?.policy.allowed).toBe(false);
  const policy=new PolicyEngine(db.raw,[{id:'deny',priority:1,description:'Test denial',appliesTo:{by:'all'},evaluate:()=>({rule:'deny',action:'deny',reasonCode:'DENIED',humanMessage:'No unsafe action'})}]);
  const adapter=createCompanyPolicyAdmission(policy,()=>({db,identity:createTestIdentity(),config:createTestConfig(),inference:new MockInferenceClient(),conway:new MockConwayClient()}));expect(adapter({action:'SCALE',productId:null,capitalCents:100,externalExecution:false}).allowed).toBe(false);
});
it('U — missing attributable costs remain UNKNOWN, never zero or fabricated profit',()=>{
  f.setNow('2026-10-20T00:00:00Z');const original=f.snapshot('base',100000,1000);const input=structuredClone(original.body);input.metrics.hostingCost=unknownMetric('EUR:cents');
  const s=f.os.snapshot('unknown',input);expect(s.body.metrics.contribution.value).toBeNull();expect(s.body.metrics.profit.nature).toBe('UNKNOWN');
  expect(runway(metric(1000),unknownMetric('EUR:cents'),metric(0),100).value).toBeNull();expect(revenueGap(30000,null)).toBeNull();
});
it('X — creator-owned product revenue never replenishes Automaton budget',()=>{
  const p=f.product();db.raw.prepare('UPDATE factory_products SET revenue_cents=100000000 WHERE id=?').run(p);
  const before=f.factory.resources.config.operationalBudgetCents;f.proposal('too-large',p,500000,10001);expect(f.os.capitalComparisons(['too-large'])[0].eligible).toBe(false);expect(f.factory.resources.config.operationalBudgetCents).toBe(before);
  expect(()=>db.raw.prepare('UPDATE factory_products SET creator_address=? WHERE id=?').run('thief',p)).toThrow('immutable');
});
it('critical Product Health blocks scale/build allocation, and crisis protection outranks larger ordinary return',()=>{
  const p=f.product(),other=f.product(),a=f.proposal('protect',p,5000,1000),b=f.proposal('ordinary',other,20000,1000);f.os.record('proposal','protect',{...a,action:'PROTECT'},'ENTREPRENEUR',1);f.os.record('proposal','ordinary',{...b,action:'FIX'},'ENTREPRENEUR',1);
  f.os.pulse('critical',[{type:'security',productId:p,severity:'critical',evidenceIds:[],reason:'Deterministic critical incident'}]);
  const rankings=f.os.capitalComparisons(['ordinary','protect']);expect(rankings.every(r=>r.eligible)).toBe(true);expect(rankings[0].key).toBe('protect');
  f.os.health({...f.provenance,productId:p,status:'critical',factors:{security:'critical'},incidents:['Security'],errorBudgetRemaining:unknownMetric('fraction')},'BUILDER');
  f.os.record('proposal','protect',{...a,action:'SCALE'},'ENTREPRENEUR',2);expect(f.os.capitalComparisons(['protect'])[0].eligible).toBe(false);
});
