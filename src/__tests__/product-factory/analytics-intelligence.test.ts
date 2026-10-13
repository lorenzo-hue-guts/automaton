import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {beforeEach,afterEach,it,expect} from 'vitest';
import {createDatabase} from '../../state/database.js';import type {AutomatonDatabase} from '../../types.js';
import {FactoryAnalytics,FactoryAnalyticsHarness,ReadOnlyAnalyticsProvider,diagnose,detectAnomaly,analyzeExperiment,analyzeUnits,canonical,analyticsCollectionTool} from '../../product-factory/index.js';
import type {AnalyticsReport,AnalyticsObservation,ExperimentAnalyticsProtocol} from '../../product-factory/index.js';
import {analyticsFixture} from './fixtures/analytics-fixture.js';
let db:AutomatonDatabase,dir:string,x:ReturnType<typeof analyticsFixture>;
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'analytics-intelligence-'));db=createDatabase(path.join(dir,'db'));x=analyticsFixture(db);});
afterEach(()=>{if(db.raw.open)db.close();fs.rmSync(dir,{recursive:true,force:true});});
function analyticsReport(){x.ingest([x.event('grossRevenue',1000),x.event('acquisitionCost',100)]);return x.analytics.report('current',x.scope()).body;}
function previous(r:AnalyticsReport){return structuredClone({...r,scope:{...r.scope,period:{start:'2026-09-24T00:00:00.000Z',end:'2026-10-01T00:00:00.000Z'}}});}
it('N/W/X — higher gross but falling contribution reveals cost deterioration; conversion driver is descriptive, not causal',()=>{
  const current=analyticsReport(),p=previous(current);p.metrics.grossRevenue.value=500;p.metrics.contribution.value=450;p.metrics.contributionMargin.value=.9;current.metrics.grossRevenue.value=1000;current.metrics.contribution.value=100;current.metrics.contributionMargin.value=.1;current.metrics.acquisitionCost.value=800;
  const d=diagnose(current,p);expect(d.explanations.some(e=>e.driver==='acquisitionCost')).toBe(true);expect(d.explanations.every(e=>e.causal===false)).toBe(true);
  current.metrics.grossRevenue.value=200;current.metrics.firstValue.value=.1;p.metrics.firstValue.value=.8;expect(diagnose(current,p).explanations.some(e=>e.driver==='firstValue')).toBe(true);
});
it('M — conversion improvement with negative retention/refund guardrail is not an unconditional win; protocol immutable',()=>{
  const r=analyticsReport(),protocol:ExperimentAnalyticsProtocol={companyExperimentKey:'company-exp',productId:x.product,entity:'user',control:'control',variant:'variant',primaryEvent:'purchase',guardrails:[{eventName:'cancel',maxIncrease:.05}],period:x.period,minSample:4,changeReason:'Frozen conversion plus churn guardrail'};
  const events:AnalyticsObservation[]=[],native:any[]=[];
  for(const arm of ['control','variant'])for(let i=0;i<10;i++){
    const id=`${arm}-${i}`;for(const name of ['experiment_exposure',...(arm==='variant'||i<3?['purchase']:[]),...(arm==='variant'?['cancel']:[])]){const input=x.event(undefined,0,{eventName:name,category:'EXPERIMENT',identifiers:{user:id},properties:{variant:arm}});native.push(input);events.push(x.analytics.observations.normalize(x.options.providers[0],input,x.f.now()));}
  }
  const result=analyzeExperiment(protocol,events,r);expect(result.difference).toBeGreaterThan(0);expect(result.status).toBe('GUARDRAIL_FAILED');expect(result.causal).toBe(false);
  x.f.os.experiment('company-exp',{productId:x.product,statement:'Hypothesis',success:'Conversion improves without churn',failure:'Guardrail worsens',stop:'Limit reached',metricDefinitions:[],evidenceIds:[]});x.analytics.experimentProtocol('protocol',protocol);x.ingest(native);x.analytics.report('experiment-report',x.scope());const persisted=x.analytics.experiment('experiment-result','protocol','experiment-report');expect(persisted.body.status).toBe('GUARDRAIL_FAILED');expect(x.f.os.store.get('analyticsExperiment','experiment-result')?.hash).toBe(persisted.hash);expect(()=>x.analytics.experimentProtocol('protocol',{...protocol,primaryEvent:'signup'})).toThrow(/frozen/);
});
it('O — good historical return does not hide negative recent marginal return',()=>{
  const early='2026-10-02T12:00:00Z',late='2026-10-07T12:00:00Z';x.ingest([x.event('grossRevenue',1000,{occurredAt:early}),x.event('acquisitionCost',100,{occurredAt:early}),x.event('grossRevenue',1200,{occurredAt:late}),x.event('acquisitionCost',2000,{occurredAt:late})]);const r=x.analytics.report('r',x.scope());x.analytics.attribution('a',{productId:x.product,entity:'customer',model:'UNKNOWN',windowMs:86400000,reliable:false,changeReason:'Unknown'});const u=x.analytics.units('u','a',r.key);expect(u.body.marginal.historicalContributionPerCost).toBeGreaterThan(0);expect(u.body.marginal.recentContributionPerCost).toBeLessThan(0);expect(u.body.marginal.saturationCandidate).toBe(true);
});
it('Q — provider outage isolates product, other provider continues; existing reservation releases through ResourceManager',async()=>{
  const second=x.f.product(),bad=new ReadOnlyAnalyticsProvider(x.source('outage'),{read:async()=>{throw Error('Do not log secret sk-external');},normalize:v=>v as any,verify:()=>({verified:true,receiptRef:'test'}),verifyCoverage:()=>true});
  const good=x.provider(x.source('other'),{events:[x.event('grossRevenue',700,{productId:second})],cursor:'page1',coverage:[{productId:second,period:x.period,metrics:x.coverageMetrics,complete:true}]});
  const a=new FactoryAnalytics(x.f.os,{...x.options,providers:[bad,good]}),t=a.planCollection('outage',x.product,'first'),u=a.planCollection('other',second,'first');
  expect(x.f.factory.resources.assign(t.id,x.f.now()).allowed).toBe(true);expect(x.f.factory.resources.assign(u.id,x.f.now()).allowed).toBe(true);
  const results=await Promise.all([a.collect('outage',t.id),a.collect('other',u.id)]);expect(results.map(r=>r.body.status)).toEqual(['unavailable','healthy']);
  expect(a.report('bad',x.scope()).body.metrics.grossRevenue.value).toBeNull();expect(a.report('good',x.scope([second])).body.metrics.grossRevenue.value).toBe(700);
  expect(JSON.stringify(x.f.os.store.list('analyticsProvider'))).not.toContain('sk-external');x.f.factory.resources.fail(t.id,'Read-only outage',false);expect(x.f.factory.resources.leases(true).some(l=>l.taskId===u.id)).toBe(true);
});
it('timeout/lease/isolation — connector requires own active reservation and timeout state is durable',async()=>{
  const p=new ReadOnlyAnalyticsProvider(x.source('timeout'),{read:async()=>new Promise(()=>{}),normalize:v=>v as any,verify:()=>({verified:true,receiptRef:'test'}),verifyCoverage:()=>true});const a=new FactoryAnalytics(x.f.os,{...x.options,providers:[p],config:{enabled:true,providerTimeoutMs:10}});const t=a.planCollection('timeout',x.product,'timeout');expect(x.f.factory.resources.assign(t.id,x.f.now()).allowed).toBe(true);const result=await a.collect('timeout',t.id);expect(result.body.status).toBe('unavailable');await expect(a.collect('billing',t.id)).rejects.toThrow();expect(new FactoryAnalyticsHarness().id).toBe('factory-analytics');expect(analyticsCollectionTool(a).riskLevel).toBe('caution');
});
it('T — observed poor behavior contradicts model praise through the existing Confidence Ledger',()=>{
  const o=x.f.opportunity('Evidence hierarchy',false),model=x.f.evidence(o,'economics',0),real=x.f.evidence(o,'economics',3,'refutes');x.f.os.record('claim','performance',{productId:x.product,statement:'Performance excellent',evidenceIds:[model,real],assumptionIds:[],rationale:'Compare sources',confidence:1},'JUDGE');const evaluation=x.f.os.evidence.evaluate('performance');expect(evaluation.confidence).toBe(0);expect(evaluation.contradictions).toContain(real);
});
it('tiny noisy anomalies do not cause Crisis; repeated authoritative series can produce material candidate',()=>{
  const current=analyticsReport();current.metrics.grossRevenue.value=100;current.quality.sampleSize=1;
  const hist=[0,1,2].map(i=>({...previous(current),scope:{...current.scope,period:{start:new Date(Date.UTC(2026,8,3+7*i)).toISOString(),end:new Date(Date.UTC(2026,8,10+7*i)).toISOString()}},metrics:{...current.metrics,grossRevenue:{...current.metrics.grossRevenue,value:1000}}}));
  const a=detectAnomaly(current,hist,'grossRevenue',x.analytics.config);expect(a?.severity).toBe('candidate');expect(a?.confidence).toBeLessThan(.7);
  current.quality.sampleSize=100;const first=detectAnomaly(current,hist,'grossRevenue',x.analytics.config);expect(first?.consecutive).toBe(1);expect(first?.severity).toBe('candidate');
});
it('observed health errors cannot be cancelled by good revenue or synthetic self-grading',()=>{
  x.ingest([x.event('grossRevenue',50000),...Array.from({length:10},(_,i)=>x.event(undefined,0,{category:'RELIABILITY',eventName:'request',properties:{error:i<8}}))]);x.analytics.report('r',x.scope());const health=x.analytics.health('r');expect(health.body.status).toBe('critical');expect(health.body.factors.analyticsReliability).toBe('critical');
});
it('published analytics Evidence has source lineage and confidence bounded by input data quality',()=>{
  analyticsReport();const o=x.f.opportunity('Economic observations',false),s=x.analytics.publish('current','snapshot',o);const id=s.body.metrics.grossRevenue.evidenceIds[0],e=x.f.os.evidence.require(id);expect(e.company?.origin).toBe('observed');expect(e.provenance.excerpt).toContain('eventHashes');expect(s.body.metrics.grossRevenue.confidence).toBeLessThanOrEqual(x.f.os.store.get('analyticsReport','current')!.body.quality.confidence);expect(x.analytics.publish('current','snapshot',o).hash).toBe(s.hash);
});
it('valid CAC and contribution payback require explicit first purchases, spend and attribution, not signup intent',()=>{
 const customer='new-customer';x.ingest([x.event(undefined,0,{eventName:'touch',category:'ACQUISITION',identifiers:{customer},occurredAt:'2026-10-01T12:00:00Z',properties:{channel:'partner'}}),x.event('grossRevenue',1000,{identifiers:{customer},occurredAt:'2026-10-02T12:00:00Z'}),x.event('acquisitionCost',100)]);const r=x.analytics.report('r',x.scope());x.analytics.attribution('a',{productId:x.product,entity:'customer',model:'FIRST_TOUCH',windowMs:7*86400000,reliable:true,changeReason:'Verified direct partner attribution'});const u=x.analytics.units('u','a',r.key);expect(u.body.cac.value).toBe(100);expect(u.body.payback.value).toBeGreaterThan(0);expect(u.body.payback.nature).toBe('ESTIMATE');const enriched=x.analytics.enrich(r.key,{unitsKey:u.key});expect(enriched.body.metrics.ltv.value).toBeNull();expect(enriched.body.metrics.observedValueToDate.value).toBe(900);
});
it('synthetic or stale healthy telemetry cannot erase observed critical Product Health',()=>{
 x.ingest([x.event(undefined,0,{category:'RELIABILITY',eventName:'error',properties:{error:true}})]);x.analytics.report('observed',x.scope());expect(x.analytics.health('observed').body.status).toBe('critical');x.ingest([x.event(undefined,0,{category:'RELIABILITY',eventName:'healthy',properties:{error:false}})],'synthetic');x.analytics.report('synthetic',x.scope([x.product],'SYNTHETIC'));expect(x.analytics.health('synthetic').body.status).toBe('critical');
});

it('persistent robust anomaly signals require history/confidence; one spike remains only a candidate',()=>{
 const current=analyticsReport();current.quality.sampleSize=100;current.metrics.grossRevenue.value=100;
 const history=[0,1,2,3].map(i=>{const r=previous(current);r.scope.period={start:new Date(Date.UTC(2026,8,3+7*i)).toISOString(),end:new Date(Date.UTC(2026,8,10+7*i)).toISOString()};r.metrics.grossRevenue.value=i===3?100:1000;return r;});
 const a=detectAnomaly(current,history,'grossRevenue',x.analytics.config);expect(a?.consecutive).toBe(2);expect(a?.severity).toBe('critical');expect(a?.causal).toBe(false);
});
it('atomic metric evidence never inherits financial confidence or payment level for a tiny usage sample',()=>{
 x.ingest([x.event('grossRevenue',1000),x.event(undefined,0,{eventName:'signup'}),x.event(undefined,0,{eventName:'activate',category:'ACTIVATION'})]);const r=x.analytics.report('r',x.scope());x.analytics.funnelDefinition('f',{productId:x.product,entity:'user',steps:[{name:'signup',eventName:'signup'},{name:'activate',eventName:'activate'}],windowMs:1000,firstValueStep:'activate',changeReason:'Tiny usage sample'});const f=x.analytics.funnel('f-result','f',r.key);x.analytics.enrich(r.key,{funnelKey:f.key});const snapshot=x.analytics.publish(r.key,'atomic',x.f.opportunity('Atomic evidence',false)),money=x.f.os.evidence.require(snapshot.body.metrics.grossRevenue.evidenceIds[0]),usage=x.f.os.evidence.require(snapshot.body.unitEconomics.conversion.evidenceIds[0]);expect(usage.provenance.reliability).toBeLessThan(money.provenance.reliability);expect(usage.company?.level).toBe(3);expect(money.company?.level).toBe(4);expect(Object.keys(usage.company!.measurements!)).toEqual(['conversion']);expect(usage.provenance.reliability).toBe(snapshot.body.unitEconomics.conversion.confidence);
});
