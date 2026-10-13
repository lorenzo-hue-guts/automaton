import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {createDatabase,getTaskById} from '../../state/database.js';
import {CompanyOperatingSystem,CompanyStore,ProductFactory,OpportunityEngine,SCORE_WEIGHTS,companyChargeBlock,companyResourceBlock,unknownMetric} from '../../product-factory/index.js';
import type {AutomatonDatabase} from '../../types.js';
import {companyFixture} from './fixtures/company-fixture.js';
let db:AutomatonDatabase,dir:string,f:ReturnType<typeof companyFixture>;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'company-e2e-'));db=createDatabase(path.join(dir,'state.db'));f=companyFixture(db);});
afterEach(()=>{if(db.raw.open)db.close();fs.rmSync(dir,{recursive:true,force:true});});

it('R29 — auditable company pipeline compares replacement, bad margin/distribution, existing fix, limited capital, target gap, forecast and recovery',()=>{
  f.target();const existing=f.product(),research=f.os.planResearch(existing,'observe','Synthetic research observations; no external tools');
  const assignment=f.factory.resources.assign(research.id,f.now());expect(assignment.allowed).toBe(true);expect(f.factory.resources.leases(true)[0].resourceClass).toBe('research');
  f.factory.resources.complete(research.id,{success:true,output:'Contract-compatible economic fixtures collected',artifacts:[],costCents:0,duration:100});
  f.os.health({...f.provenance,productId:existing,status:'degraded',factors:{ux:'degraded',security:'healthy',reliability:'healthy'},incidents:['Onboarding issue'],errorBudgetRemaining:unknownMetric('fraction')},'BUILDER');
  const opportunities=[] as {o:string;p:string;ids:string[];decisionId:string;outcome:string}[];
  for(const kind of ['replacement','bad-distribution','poor-margin','platform-threat']) {
    const o=f.opportunity(kind),ids=[f.evidence(o,'money_flow'),f.evidence(o,'buyer'),f.evidence(o,'distribution')],p=f.product();
    const b=f.business(o,ids,`business:${kind}`);
    if(kind==='poor-margin')f.os.record('businessCase',`business:${kind}`,{...b,servingCost:f.range(2000,3000)},'ENTREPRENEUR',1);
    if(kind==='platform-threat')f.os.record('businessCase',`business:${kind}`,{...b,preMortem:[{risk:'Dominant platform absorption',severity:'fatal',evidenceIds:ids,mitigation:'No clear durable wedge'}]},'ENTREPRENEUR',1);
    f.contract(o,p,ids,`contract:${kind}`,`business:${kind}`);
    const d=f.os.council(`council:${kind}`,{businessCaseKey:`business:${kind}`,contractKey:`contract:${kind}`,contractRevision:1,assessments:f.assessments(kind==='bad-distribution'?'GROWTH':undefined),claimKeys:[],reversibility:'EASILY_REVERSIBLE',capitalCents:1000});
    opportunities.push({o,p,ids,decisionId:d.id,outcome:d.outcome});
  }
  expect(opportunities.map(o=>o.outcome)).toEqual(['GREENLIGHT','HOLD','REJECT','REJECT']);
  const contradiction=f.evidence(opportunities[0].o,'buyer',3,'refutes');
  f.os.record('claim','replacement-demand',{...f.provenance,evidenceIds:[...opportunities[0].ids,contradiction],statement:'Buyers will switch',productId:opportunities[0].p},'JUDGE');
  expect(f.os.evidence.evaluate('replacement-demand').contradictions).toContain(contradiction);
  f.proposal('existing-fix',existing,9000,1000,2);f.proposal('replacement-build',opportunities[0].p,4000,3000,8,opportunities[0].ids);
  f.os.record('shadow','replacement',{...f.provenance,evidenceIds:opportunities[0].ids,opportunityId:opportunities[0].o,proposalKey:'replacement-build',status:'held',reevaluationConditions:['Observed buyer contradiction resolved'],representation:'complementary_product',alternatives:['feature','bundle','independent_product']},'ENTREPRENEUR');
  expect(f.os.portfolioAlternatives()[0].key).toBe('existing-fix');
  const decision=f.os.decide('prioritize-fix','FIX','Existing-product activation improvement beats new product on Builder opportunity cost',{productId:existing,evidenceIds:[],alternatives:['replacement-build'],versions:{'proposal:existing-fix':1},expectedOutcome:'Higher durable contribution and customer value'});
  const request=f.os.requestAllocation('fix-capital','existing-fix',decision.id);expect(()=>f.os.commitAllocation('fix-capital')).toThrow('creator');
  new ProductFactory(db,f.factory.resources.config,'creator').decideApproval(request.body.approvalId,'approved');f.os.commitAllocation('fix-capital');
  const fix=f.os.planResearch(existing,'fix-research','Investigate onboarding before implementation');expect(f.factory.resources.assign(fix.id,f.now()).allowed).toBe(true);f.factory.resources.complete(fix.id,{success:true,output:'Frozen experiment proposal',costCents:0,duration:100,artifacts:[]});
  f.forecast('portfolio-forecast',10000,15000);const gap=30000-15000;expect(gap).toBe(15000); // Actual API range is asserted in review below.
  f.setNow('2026-10-20T00:00:00Z');f.snapshot('portfolio-actual',8000,10000);
  const review=f.os.review('week1',{type:'weekly',targetKey:'week1',snapshotKey:'portfolio-actual',forecastKey:'portfolio-forecast',assessments:f.assessments(),stopDoing:['New product creation without qualified distribution'],priorities:['Fix onboarding','Resolve replacement buyer uncertainty','Reallocate safely']});
  expect(review.body.revenueGap).toMatchObject({low:15000,high:20000});expect(review.body.targetOutcome).toBe('MISSED');expect(review.body.dossier.facts.profit.value).toBe(-2000);
  f.os.forecastActual('forecast-outcome','portfolio-forecast','portfolio-actual');
  f.os.scorecard('company-scorecard','portfolio-actual','week1','portfolio-forecast');
  const outcomes={simulation:true,realEconomicSuccessDemonstrated:false,opportunities,chosenCapitalProposal:'existing-fix',targetOutcome:review.body.targetOutcome,revenueGap:review.body.revenueGap,recovery:f.os.store.get('mode','company')?.body.mode,forecastError:f.os.store.get('forecastOutcome','forecast-outcome')?.body.error,scorecardKey:'company-scorecard'};
  fs.writeFileSync('/tmp/lot-r-e2e-results.json',JSON.stringify(outcomes,null,2));
  db.close();db=createDatabase(path.join(dir,'state.db'));const reload=new CompanyStore(db,'creator');expect(reload.get('review','week1')?.hash).toBe(review.hash);expect(reload.get('allocation','fix-capital')?.body.status).toBe('committed');expect(reload.get('mode','company')?.body.mode).toBe('RECOVERY');expect(reload.get('scorecard','company-scorecard')?.body.metrics.customers.nature).toBe('UNKNOWN');
});
it('company capital restrictions coexist with real ResourceManager reservations; another product can continue during approval waiting',()=>{
  const a=f.product(),b=f.product();f.proposal('a',a,5000,1000);const d=f.os.decide('a-cap','ALLOCATE','Explicit allocation',{productId:a,evidenceIds:[]});const request=f.os.requestAllocation('a','a',d.id);
  const waiting=f.os.planResearch(a,'wait','Local research'),unrelated=f.os.planResearch(b,'other','Independent research');
  expect(f.factory.resources.assign(waiting.id,f.now()).reason).toContain('approval');expect(f.factory.resources.assign(unrelated.id,f.now()).allowed).toBe(true);f.factory.resources.complete(unrelated.id,{success:true,output:'Independent',costCents:0,duration:0,artifacts:[]});
  new ProductFactory(db,f.factory.resources.config,'creator').decideApproval(request.body.approvalId,'approved');f.os.commitAllocation('a');expect(f.factory.resources.assign(waiting.id,f.now()).allowed).toBe(true);
  expect(companyChargeBlock(db,'creator',a,1001)).toContain('exhausted');f.factory.resources.cancel(waiting.id);expect(f.factory.resources.leases(true)).toEqual([]);
});
it('frozen experiment, Voice of Customer and cautious causal learning reuse existing hypotheses/experiments/feedback/learnings',()=>{
  const p=f.product();f.target();const experiment=f.os.experiment('value',{productId:p,statement:'Users obtain first value',success:'Observed completed journey',failure:'Users abandon',stop:'Budget reached',metricDefinitions:[{key:'gross',revision:1}],evidenceIds:[]});
  expect(f.os.experiment('value',{productId:p,statement:'Users obtain first value',success:'Observed completed journey',failure:'Users abandon',stop:'Budget reached',metricDefinitions:[{key:'gross',revision:1}],evidenceIds:[]}).id).toBe(experiment.id);
  expect(()=>f.os.experiment('value',{productId:p,statement:'Different',success:'Agent claims success',failure:'Ignore',stop:'Never',metricDefinitions:[],evidenceIds:[]})).toThrow('frozen');
  const v={...f.provenance,productId:p,type:'cancellation' as const,journeyStage:'Departure',content:'Occasional need, not necessarily bad product',churnCause:'seasonal' as const};f.os.voice('cancel',v);f.os.voice('cancel',v);expect(db.productFactory.list('feedback')).toHaveLength(1);
  const causal={...f.provenance,productId:p,intervention:'Onboarding changed',exposedPopulation:'Test cohort',expectedEffect:f.range(.1,.2,'fraction'),observedEffect:unknownMetric('activation'),externalFactors:['Seasonality','Another campaign'],method:'observational' as const,causalClaim:'uncertain' as const,changeRefs:['deployment:fixture']};f.os.learning('onboarding',causal,experiment.body.experimentId);expect(db.productFactory.list('learnings')).toHaveLength(1);expect(()=>f.os.record('causal','false-cause',{...causal,causalClaim:'supported'},'JUDGE')).toThrow('causation');
});
it('graveyard retains rejection conditions and avoids rediscovering the same opportunity without context',()=>{
  const o=f.opportunity();const d=f.os.rejectOpportunity('api-too-expensive',o,[],'API cost prevents viability',['API cost decreases']);expect(f.os.store.get('graveyard','api-too-expensive')?.body.reevaluationConditions).toEqual(['API cost decreases']);expect(db.productFactory.get('opportunities',o)?.status).toBe('rejected');expect(d.company?.alternatives).toContain('API cost decreases');
});
it('Judge dossier and monthly board review preserve uncertainty; daily pulse needs no four-function meeting',()=>{
  f.target();f.setNow('2026-10-20T00:00:00Z');f.snapshot('month',10000,1000);
  const review=f.os.review('board',{type:'monthly',targetKey:'week1',snapshotKey:'month',assessments:f.assessments(),stopDoing:['Inference theater'],priorities:['Compare active and shadow portfolio']});expect(review.body.boardQuestion).toContain('started today');expect(review.body.targetOutcome).toBe('UNKNOWN');
  const pulse=f.os.pulse('quiet',[]);expect(pulse.body.decisionId).toBeNull();expect(f.os.pulse('quiet',[]).id).toBe(pulse.id);
});
