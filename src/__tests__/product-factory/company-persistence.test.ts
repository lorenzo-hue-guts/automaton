import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {afterEach,beforeEach,it,expect} from 'vitest';
import {createDatabase} from '../../state/database.js';
import * as schema from '../../state/schema.js';
import {CompanyOperatingSystem,CompanyStore,resolveCompanyConfig,DEFAULT_COMPANY_CONFIG,canonical,unknownMetric,assertCompanyBrief,assertCompanyQuality,ProductFactory,BuildEngine,OpportunityEngine,SCORE_WEIGHTS} from '../../product-factory/index.js';
import type {AutomatonDatabase} from '../../types.js';
import type {OwnerTarget,ProductBrief,QualityAssessment} from '../../product-factory/index.js';
import {companyFixture} from './fixtures/company-fixture.js';
let dir:string,db:AutomatonDatabase,f:ReturnType<typeof companyFixture>;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'company-persistence-'));db=createDatabase(path.join(dir,'state.db'));f=companyFixture(db);});
afterEach(()=>{if(db.raw.open)db.close();fs.rmSync(dir,{recursive:true,force:true});});
function selectAgain(o:string){const oe=new OpportunityEngine(db,f.factory);oe.assess(o,{values:Object.fromEntries(Object.keys(SCORE_WEIGHTS).map(k=>[k,1])) as any,estimatedCostCents:0,risk:0,unverifiedHypotheses:[]});oe.decide(o,'SELECT','Fresh company evidence reviewed');}
function greenlight(){const o=f.opportunity(),p=f.product(),ids=[f.evidence(o,'money_flow'),f.evidence(o,'buyer'),f.evidence(o,'distribution')];f.business(o,ids);selectAgain(o);f.contract(o,p,ids);const d=f.os.council('council',{businessCaseKey:'business',contractKey:'contract',contractRevision:1,assessments:f.assessments(),claimKeys:[],reversibility:'EASILY_REVERSIBLE',capitalCents:1000});const c=f.os.approveContract('contract',1,d.id);return {o,p,ids,d,c};}

it('V15 upgrades a genuine V14 WAL database, preserving old evidence, decisions, ownership and approvals',()=>{
  const filename=path.join(dir,'v14.db'),old=new Database(filename);
  for(const sql of [schema.CREATE_TABLES,schema.MIGRATION_V2,schema.MIGRATION_V3,schema.MIGRATION_V4,schema.MIGRATION_V4_ALTER,schema.MIGRATION_V4_ALTER2,schema.MIGRATION_V4_ALTER_INBOX_STATUS,schema.MIGRATION_V4_ALTER_INBOX_RETRY,schema.MIGRATION_V4_ALTER_INBOX_MAX_RETRIES,schema.MIGRATION_V5,schema.MIGRATION_V6,schema.MIGRATION_V7,schema.MIGRATION_V8,schema.MIGRATION_V9,schema.MIGRATION_V9_ALTER_CHILDREN_ROLE,schema.MIGRATION_V10,schema.MIGRATION_V11,schema.MIGRATION_V12,schema.MIGRATION_V13,schema.MIGRATION_V14])old.exec(sql);
  old.prepare('INSERT INTO schema_version(version) VALUES(14)').run();
  old.exec("INSERT INTO factory_products(id,created_at,creator_address,name,stage,revenue_cents) VALUES('legacy-product','2026-01-01','creator','Legacy','draft',42); INSERT INTO factory_decisions(id,created_at,product_id,rationale,evidence_ids,outcome) VALUES('legacy-decision','2026-01-01','legacy-product','Historical','[]','hold'); INSERT INTO kv(key,value) VALUES('existing','preserve');");old.close();
  const migrated=createDatabase(filename);
  try{expect(migrated.productFactory.get('decisions','legacy-decision')?.rationale).toBe('Historical');expect(migrated.productFactory.get('products','legacy-product')?.revenueCents).toBe(42);expect(migrated.getKV('existing')).toBe('preserve');expect(migrated.raw.pragma('foreign_key_check')).toEqual([]);expect(migrated.raw.pragma('journal_mode',{simple:true})).toBe('wal');expect(migrated.raw.prepare('SELECT COUNT(*) n FROM schema_version WHERE version=15').get()).toEqual({n:1});}finally{migrated.close();}
  const again=createDatabase(filename);expect(again.raw.prepare('SELECT COUNT(*) n FROM schema_version WHERE version=15').get()).toEqual({n:1});again.close();
});
it('V15 DDL conflict rolls back evidence alteration and preserves the old Decision constraint',()=>{
  const raw=new Database(':memory:');raw.exec('CREATE TABLE factory_evidence(id TEXT); CREATE TABLE company_records(id TEXT); CREATE TABLE factory_decisions(id TEXT,created_at TEXT,product_id TEXT,opportunity_id TEXT,rationale TEXT,evidence_ids TEXT,outcome TEXT);');
  expect(()=>raw.transaction(()=>raw.exec(schema.MIGRATION_V15))()).toThrow();
  expect((raw.pragma('table_info(factory_evidence)') as {name:string}[]).some(c=>c.name==='company_metadata')).toBe(false);raw.close();
});
it('targets are configurable creator data, respect Europe/Paris DST and remain independently frozen',()=>{
  const input=JSON.parse(fs.readFileSync(path.join(process.cwd(),'docs/examples/company-owner-targets.initial.json'),'utf8'));
  const c=resolveCompanyConfig({...input,enabled:true});expect(c.initialOwnerTargets.map(t=>t.amountCents)).toEqual([30000,70000,110000,150000,200000,250000]);expect((Date.parse(c.initialOwnerTargets[1].periodEnd)-Date.parse(c.initialOwnerTargets[1].periodStart))/3600000).toBe(169);
  expect(()=>new CompanyOperatingSystem(f.factory,{...f.options,config:c})).toThrow('explicit creator');
  const fresh=createDatabase(path.join(dir,'initial.db'));try{const configured=companyFixture(fresh,c as unknown as Record<string,unknown>);expect(configured.os.store.list('target')).toHaveLength(6);}finally{fresh.close();}
},10000);
it('company defaults are disabled and unsafe config/numbers are rejected',()=>{
  expect(resolveCompanyConfig().enabled).toBe(false);expect(resolveCompanyConfig().initialOwnerTargets).toEqual([]);
  expect(()=>resolveCompanyConfig({enabled:true,maxCapitalCents:-1})).toThrow();expect(()=>resolveCompanyConfig({allowPublicLaunch:true})).toThrow();expect(()=>canonical({x:NaN})).toThrow();
});
it('immutable company history and company decisions cannot be SQL updated/deleted/replaced',()=>{
  const t=f.target(),d=f.os.decide('company-policy','HOLD','No safe investment yet',{evidenceIds:[]});
  expect(()=>db.raw.prepare('UPDATE company_records SET content=? WHERE id=?').run('{}',t.id)).toThrow('immutable');expect(()=>db.raw.prepare('DELETE FROM company_records WHERE id=?').run(t.id)).toThrow('immutable');
  expect(()=>db.raw.prepare('UPDATE factory_decisions SET outcome=? WHERE id=?').run('SUCCESS',d.id)).toThrow('immutable');expect(()=>db.raw.prepare('DELETE FROM factory_decisions WHERE id=?').run(d.id)).toThrow('immutable');
});
it('synthetic/model data cannot be relabeled as real payment, and evidence history cannot be mutated',()=>{
  const o=f.opportunity();const e=f.evidence(o,'buyer',1),source=f.os.evidence.require(e);
  expect(()=>f.os.evidence.ingest('synthetic',source.provenance,{level:4,origin:'synthetic',aspect:'economics',expiresAt:'2027-01-01',verificationRef:'fake'})).toThrow('masquerade');
  expect(()=>db.raw.prepare('UPDATE factory_evidence SET content=? WHERE id=?').run('real purchase',e)).toThrow('immutable');
  expect(()=>db.raw.prepare('DELETE FROM factory_evidence WHERE id=?').run(e)).toThrow('immutable');
});
it('freshness and assumption revisions invalidate confidence until explicitly revalidated',()=>{
  const o=f.opportunity(),e=f.evidence(o,'buyer',3);
  f.os.record('assumption','api',{...f.provenance,statement:'API cost remains bounded',status:'valid',expiresAt:'2027-01-01',affectedProductIds:[],expected:f.range(1,10)},'ENTREPRENEUR');
  f.os.record('claim','claim',{...f.provenance,evidenceIds:[e],assumptionIds:['api'],statement:'Viable',productId:null},'JUDGE');const original=f.os.evidence.evaluate('claim');
  f.os.record('assumption','api',{...f.os.store.get('assumption','api')!.body,expected:f.range(100,200)},'ENTREPRENEUR',1);
  const changed=f.os.evidence.evaluate('claim');expect(changed.stale).toBe(true);expect(changed.confidence).toBeLessThan(original.confidence);expect(f.os.evidence.evaluate('claim').stale).toBe(true);
  f.setNow('2028-01-01T00:00:00Z');expect(f.os.evidence.evaluate('claim').confidence).toBe(0);
});
it('contract binds exact business intent to Brief/Builder; approval waits are idempotent and do not bypass human review',()=>{
  const {p,c,d}=greenlight();expect(f.os.approveContract('contract',1,d.id).id).toBe(c.id);
  const brief=f.os.contractBrief('contract',c.revision);expect(f.os.contractBrief('contract',c.revision).id).toBe(brief.id);expect(brief.content.companyContext).toBeDefined();
  const engine=new BuildEngine(db,f.factory,path.join(dir,'artifacts'));expect(()=>engine.planner.plan(brief.id)).toThrow('Human');
  new ProductFactory(db,f.factory.resources.config,'creator').decideApproval(brief.approvalId!,'approved');const build=engine.planner.plan(brief.id);expect(build.productId).toBe(p);
  expect(()=>assertCompanyQuality(db,brief)).toThrow('quality gates');expect(engine.publicLaunch.check(p,brief.approvalId!).allowed).toBe(false);
  f.os.createContract('contract',{...c.body,status:'draft',changeReason:'Changed desired outcome before re-review'},'ENTREPRENEUR',c.revision);expect(()=>assertCompanyBrief(db,brief)).toThrow('current');
});
it('record types, configuration, intelligence, contract and confidence all reload without duplicate logical events',()=>{
  const {p,c}=greenlight();f.target();const e=f.evidence(f.opportunity(),'risk');
  f.os.record('claim','confidence',{...f.provenance,evidenceIds:[e],statement:'Risk hypothesis',productId:p},'JUDGE');f.os.evidence.evaluate('confidence');
  f.os.record('risk','platform',{...f.provenance,evidenceIds:[e],type:'COMPETITIVE_RESPONSE',likelihood:f.range(.1,.4,'probability'),impact:'material',affectedProducts:[p],mitigation:'Narrow workflow',owner:'ENTREPRENEUR',status:'open'},'ENTREPRENEUR');
  f.os.record('dependency','api',{...f.provenance,productId:p,kind:'api',name:'Future provider',riskKeys:['platform'],assumptionKeys:[],backupExpectation:'Portable data',recoveryExpectation:'Document restore',privacy:{minimization:'Only needed records',accessControl:'Product scoped',retention:'Defined duration',deletion:'On request',sensitiveLogging:'Redacted',secretSeparation:true,productIsolation:true}},'BUILDER');
  const before=db.raw.prepare('SELECT COUNT(*) n FROM company_records').get();db.close();db=createDatabase(path.join(dir,'state.db'));
  const factory=companyFixture(db).factory;const reload=new CompanyOperatingSystem(factory,{...f.options});expect(reload.store.get('target','week1')?.body.amountCents).toBe(30000);expect(reload.store.get('contract','contract')?.hash).toBe(c.hash);expect(reload.store.get('risk','platform')?.body.impact).toBe('material');expect(reload.store.get('dependency','api')).toBeDefined();expect(db.raw.prepare('SELECT COUNT(*) n FROM company_records').get()).toEqual(before);
});
it('future target changes are explicit versions; historical metric meaning and changed-input idempotency are protected',()=>{
  const t=f.target();const next=f.os.ownerTarget('week1',{...t.body,amountCents:40000,changeReason:'Creator explicitly increases future objective'},'CREATOR',1);expect(next.revision).toBe(2);expect(f.os.store.get('target','week1',1)?.body.amountCents).toBe(30000);
  f.setNow('2026-10-20T00:00:00Z');expect(()=>f.os.ownerTarget('backdate',{...t.body,periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-09-08T00:00:00Z'},'CREATOR')).toThrow('before');
});
it('UNKNOWN and synthetic results cannot establish target attainment; wrong-period actual is rejected',()=>{
  f.target();f.setNow('2026-10-20T00:00:00Z');const s=f.snapshot('synthetic',100000,0,null,undefined,undefined,true);
  const r=f.os.review('synthetic-review',{type:'weekly',targetKey:'week1',snapshotKey:s.key,assessments:f.assessments(),stopDoing:[],priorities:[]});expect(r.body.targetOutcome).toBe('SYNTHETIC');expect(f.os.store.get('mode','company')).toBeUndefined();
  const wrong=structuredClone(s.body);wrong.metrics.grossRevenue.nature='FACT';expect(()=>f.os.snapshot('fraud',wrong)).toThrow('Synthetic');
  const moved=structuredClone(f.snapshot('observed',1000,0).body);moved.start='2026-10-01T00:00:00Z';expect(()=>f.os.snapshot('moved',moved)).toThrow('period');
});
it('unpaid trials, negative costs, alternate product scope and metric name collisions cannot manufacture economics',()=>{
  f.setNow('2026-10-20T00:00:00Z');const s=f.snapshot('real',10000,1000),bad=structuredClone(s.body);bad.metrics.acquisitionCost.value=-1000;expect(()=>f.os.snapshot('negative',bad)).toThrow('nonnegative');
  const override=structuredClone(s.body);override.unitEconomics.profit={...s.body.metrics.grossRevenue,value:999999};expect(()=>f.os.snapshot('override',override)).toThrow('overwrite');
  const other=structuredClone(s.body);other.productId=f.product();expect(()=>f.os.snapshot('other',other)).toThrow('actual');
  const o=f.opportunity('Unpaid',false),e=f.evidence(o,'economics',4,'supports',{currency:'EUR',periodStart:s.body.start,periodEnd:s.body.end,productId:null,paymentStatus:'unpaid_trial',measurements:{grossRevenue:10000}});
  const unpaid=structuredClone(s.body);unpaid.metrics.grossRevenue.evidenceIds=[e];expect(()=>f.os.snapshot('unpaid',unpaid)).toThrow('actual');
});
it('company config is creator-controlled; disabling it cannot bypass caps for an existing company product',()=>{
  const {p}=greenlight();const task=f.os.planResearch(p,'managed','Company managed research');
  expect(()=>f.os.configure({...f.os.config,enabled:false},'JUDGE')).toThrow('creator');f.os.configure({...f.os.config,enabled:false},'CREATOR');
  expect(()=>f.os.planResearch(p,'bypass','No')).toThrow('reload');expect(f.factory.resources.assign(task.id,f.now()).reason).toContain('disabled');
});
it('review/forecast/scorecard/portfolio/risk/intelligence and capability learning share persistent versioned evidence state',()=>{
  const p=f.product(),o=f.opportunity(),e=f.evidence(o,'buyer',1),proof=f.evidence(o,'buyer',3);
  f.os.record('competitor','competitor',{...f.provenance,evidenceIds:[e],competitor:'Public fixture',segment:'Vertical',targetCustomer:'Budget owner',pricing:f.range(100,200),packaging:['License'],capabilities:['Workflow'],positioning:'Narrow workflow',strengths:['Existing paid market'],weaknesses:['Missing integration'],reviews:[{classification:'SWITCHING_TRIGGER',evidenceIds:[e],economicRelevance:'critical',rationale:'Cancellation statement stronger than dislike of icon'}],observedAt:f.now().toISOString(),expiresAt:'2027-01-01',switchingComplaints:['Addressable missing integration']},'ENTREPRENEUR');
  f.os.record('pattern','first-value',{...f.provenance,evidenceIds:[e],category:'onboarding',principle:'Start with an example and guide the first useful result',referenceHashes:['fixture-hash'],sourceRefs:['fixture://reference'],license:null,expiresAt:'2027-01-01',copyingPermitted:false},'ENTREPRENEUR');
  f.os.record('benchmark','product',{productId:p,metrics:{firstValue:unknownMetric('minutes')},evidenceIds:[e]},'JUDGE');
  f.os.record('capabilityLearning','builder',{nature:'SYNTHETIC',capability:'Builder',market:'Vertical',outcome:'Synthetic exercise only',benchmarkKeys:['product'],evidenceIds:[e],confidence:.2},'ENTREPRENEUR');
  expect(()=>f.os.record('capabilityLearning','belief',{nature:'FACT',capability:'Builder',market:'Any',outcome:'Improved because agent says so',benchmarkKeys:[],evidenceIds:[],confidence:1},'ENTREPRENEUR')).toThrow('evidence');
  f.os.record('growthLearning','channel',{productId:p,channel:'partnership',audience:'Qualified accounts',message:'Honest value',offer:'Demonstration',creativePattern:'Explain first value',metrics:{cac:unknownMetric('EUR:cents')},evidenceIds:[e],confidence:.2},'GROWTH');
  f.os.record('externalChange','vendor',{dependencyKeys:[],description:'Fixture vendor change',evidenceIds:[e],observedAt:f.now().toISOString()},'ENTREPRENEUR');
  const d=f.os.decide('memory','HOLD','Wait for evidence',{productId:p,evidenceIds:[e],expectedOutcome:'Valuable learning',alternatives:['Research','Do not spend']});
  f.os.record('decisionOutcome','memory',{decisionId:d.id,actual:unknownMetric('contribution'),hindsight:'Outcome remains unknown',evidenceIds:[e]},'ENTREPRENEUR');
  f.os.record('rollback','offer',{decisionId:d.id,action:'offer',previousVersion:'v1',stopConditions:['Negative contribution'],execution:'disabled',approvalId:null},'ENTREPRENEUR');
  const hashes=Object.fromEntries(['competitor','pattern','benchmark','capabilityLearning','growthLearning','externalChange','decisionOutcome','rollback'].map(k=>[k,f.os.store.list(k as any).map(r=>r.hash)]));
  db.close();db=createDatabase(path.join(dir,'state.db'));const store=new CompanyStore(db,'creator');
  for(const [kind,values] of Object.entries(hashes))expect(store.list(kind as any).map(r=>r.hash)).toEqual(values);
});
it('critical assumptions flag affected products/decisions for review; valid replacement does not rewrite old reasoning',()=>{
  const p=f.product();f.os.record('assumption','supplier',{...f.provenance,statement:'Supplier remains available',status:'valid',expiresAt:'2027-01-01',affectedProductIds:[p],expected:null},'ENTREPRENEUR');
  const decision=f.os.decide('supplier-decision','HOLD','Depends on supplier',{productId:p,evidenceIds:[],assumptionIds:['supplier']});
  f.os.record('assumption','supplier',{...f.os.store.get('assumption','supplier')!.body,status:'false'},'ENTREPRENEUR',1);
  const impact=f.os.assumptionImpact('supplier-changed');expect(impact.body.reviewRequired).toBe(true);expect(impact.body.affectedProducts).toContain(p);expect(impact.body.affectedDecisionIds).toContain(decision.id);expect(decision.company?.versions['assumption:supplier']).toBe(1);
});
it('enabled Company OS requires a contract for new builds; historical briefs remain compatible',()=>{
  const o=f.opportunity(),base={version:1 as const,id:'legacy-brief',creatorAddress:'creator',opportunityId:o,selectionDecisionId:'legacy',evidenceIds:[],sourceScore:db.productFactory.getDiscoveryOpportunity(o)!.discovery.score!,content:{},productId:null,approvalId:null,createdAt:'2026-10-02T00:00:00Z'} as unknown as ProductBrief;
  expect(()=>assertCompanyBrief(db,base)).toThrow('Product Contract');expect(()=>assertCompanyBrief(db,{...base,createdAt:'2026-09-01T00:00:00Z'})).not.toThrow();
});
it('new contradictory evidence invalidates a historical greenlight before approval/build; history remains intact',()=>{
  const o=f.opportunity(),p=f.product(),ids=[f.evidence(o,'money_flow'),f.evidence(o,'buyer'),f.evidence(o,'distribution')];f.business(o,ids);selectAgain(o);f.contract(o,p,ids);
  const d=f.os.council('original-greenlight',{businessCaseKey:'business',contractKey:'contract',contractRevision:1,assessments:f.assessments(),claimKeys:[],reversibility:'EASILY_REVERSIBLE',capitalCents:1000});
  expect(d.outcome).toBe('GREENLIGHT');const refute=f.evidence(o,'buyer',3,'refutes');expect(()=>f.os.approveContract('contract',1,d.id)).toThrow('evidence changed');
  const next=f.os.council('contradiction-review',{businessCaseKey:'business',contractKey:'contract',contractRevision:1,assessments:f.assessments(),claimKeys:[],reversibility:'EASILY_REVERSIBLE',capitalCents:1000});expect(next.outcome).not.toBe('GREENLIGHT');expect(next.company?.contradictions).toContain(refute);expect(db.productFactory.get('decisions',d.id)?.outcome).toBe('GREENLIGHT');
});
