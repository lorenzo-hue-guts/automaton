import type { CompanyOperatingSystem } from './company-os.js';
import { CompanyEvidence } from './company-evidence.js';
import type { CompanyEvidenceProvider } from './company-evidence.js';
import { canonical } from './company-store.js';
import { buildHash } from './build-store.js';
import { AnalyticsObservations } from './analytics-observations.js';
import { resolveAnalyticsConfig } from './analytics-config.js';
import { buildAnalyticsReport,unknownAnalytics } from './analytics-metrics.js';
import { analyzeFunnel,analyzeCohorts,analyzeUnits,analyzeExperiment } from './analytics-journeys.js';
import { diagnose,detectAnomaly,comparable } from './analytics-intelligence.js';
import { ECONOMIC_METRICS,unknownMetric } from './company-economics.js';
import type { CompanyKind,CompanyEntityMap,MetricValue,Forecast } from './company-types.js';
import type { AnalyticsProvider,AnalyticsConfig,AnalyticsBatch,AnalyticsScope,AnalyticsSource,FunnelDefinition,CohortDefinition,AttributionDefinition,ExperimentAnalyticsProtocol,AnalyticsReport } from './analytics-types.js';
import { getTaskById } from '../state/database.js';
import type { PolicyEngine } from '../agent/policy-engine.js';
import type { ToolContext,AutomatonTool } from '../types.js';
import { SpendTracker } from '../agent/spend-tracker.js';
export type AnalyticsAdmission=(source:AnalyticsSource)=>{allowed:boolean;reason:string};
export function createAnalyticsPolicyAdmission(policy:PolicyEngine,context:()=>ToolContext):AnalyticsAdmission {
  return source=>{const ctx=context(),decision=policy.evaluate({tool:{name:'factory_analytics_read',description:'Read-only analytics connector; no commercial mutation',category:source.mode==='fixture'?'memory':'registry',riskLevel:source.mode==='fixture'?'safe':'caution',parameters:{},execute:async()=>''},args:{sourceId:source.id,sourceType:source.type,readOnly:true},context:ctx,turnContext:{inputSource:'system',turnToolCallCount:0,sessionSpend:new SpendTracker(ctx.db.raw)}});policy.logDecision(decision);return {allowed:decision.action==='allow',reason:decision.reasonCode};};
}
/** Analytics is an on-demand domain service, never a scheduler or commercial executor. */
export class FactoryAnalytics {
  readonly observations:AnalyticsObservations;readonly config:AnalyticsConfig;
  private readonly providers=new Map<string,AnalyticsProvider>();
  private readonly clock:()=>Date;private readonly admission:AnalyticsAdmission;
  constructor(readonly company:CompanyOperatingSystem,options:{providers:AnalyticsProvider[];pseudonymKey:string;config?:unknown;clock?:()=>Date;admission?:AnalyticsAdmission}) {
    this.config=resolveAnalyticsConfig(options.config??company.factory.resources.config.analytics);this.clock=options.clock??(()=>new Date());this.admission=options.admission??(()=>({allowed:false,reason:'Analytics policy admission unavailable'}));
    this.observations=new AnalyticsObservations(company.store,options.pseudonymKey);
    for(const p of options.providers){const s=p.source;if(!/^[a-zA-Z0-9_.-]{1,80}$/.test(s.id)||/^(?:sk-|Bearer)|secret|password|credential/i.test(s.id)||!['fixture','read-only'].includes(s.mode)||!['MODEL','SYNTHETIC','PUBLIC','OBSERVED'].includes(s.nature)||!['PAYMENTS_BILLING','PRODUCT_ANALYTICS','WEB_ANALYTICS','MARKETPLACE','ADVERTISING','CRM_SALES','SUPPORT','INFRASTRUCTURE_COST'].includes(s.type)||!Number.isFinite(s.reliability)||s.reliability<0||s.reliability>1||this.providers.has(s.id)||s.authoritativeMetrics.some(m=>!ECONOMIC_METRICS.includes(m)||['netRevenue','contribution','profit'].includes(m))||s.mode==='fixture'&&s.nature!=='SYNTHETIC')throw Error('Invalid analytics source descriptor');
      if(Object.keys(s).some(k=>!['id','type','mode','nature','reliability','authoritativeMetrics','coverageMetrics'].includes(k)))throw Error('Unexpected/sensitive source configuration');
      if(s.authoritativeMetrics.some(m=>['grossRevenue','refunds'].includes(m))&&!['PAYMENTS_BILLING','MARKETPLACE'].includes(s.type))throw Error('Commerce authority requires billing/marketplace system of record');
      const old=company.store.get('analyticsSource',s.id);if(old&&canonical(old.body)!==canonical(s))throw Error('Source identity/trust change requires new source ID');this.providers.set(s.id,p);
      if(this.config.enabled&&company.config.enabled&&company.factory.resources.config.enabled)company.store.append('analyticsSource',s.id,s);
    }
  }
  private enabled():void {if(!this.config.enabled||!this.company.config.enabled||!this.company.factory.resources.config.enabled||this.company.store.get('company','operating-model')?.body.config.enabled!==true)throw Error('Analytics/Company/Product Factory disabled');}
  private append<K extends CompanyKind>(kind:K,key:string,body:CompanyEntityMap[K]){return this.company.store.append(kind,key,body,this.company.store.get(kind,key)?.revision??0,this.clock());}
  private source(id:string):AnalyticsProvider{const p=this.providers.get(id);if(!p)throw Error('Unknown analytics provider');return p;}
  /** Local ingestion of a verified connector batch. Native payloads are never logged/stored. */
  ingest(id:string,batch:AnalyticsBatch) {
    this.enabled();const p=this.source(id),now=this.clock();if(!this.admission(p.source).allowed)throw Error('Analytics policy denied');
    if(!batch||!Array.isArray(batch.events)||batch.events.length>this.config.maxBatchEvents||!Array.isArray(batch.coverage)||typeof batch.cursor!=='string'&&batch.cursor!==null)throw Error('Invalid/bounded analytics batch');
    // Cursors may contain secrets in native APIs. Only short opaque tokens are accepted.
    if(batch.cursor&&(!/^(?:page\d{1,12}|\d{1,12}|history)$/.test(batch.cursor)||/secret|bearer|sk-/i.test(batch.cursor)))throw Error('Unsafe provider cursor');
    return this.company.store.db.raw.transaction(()=>{
      let accepted=0,duplicates=0,rejected=0;
      for(const raw of batch.events) {
        try {const e=this.observations.normalize(p,raw,now),result=this.observations.insert(e);result.duplicate?duplicates++:accepted++;}
        catch {rejected++;const digest=this.observations.pseudonym(safeDigest(raw));this.append('analyticsQuarantine',`${id}:${digest}`,{providerId:id,digest,at:now.toISOString(),reason:'Canonical schema/verification/replay/privacy validation rejected'});}
      }
      for(const c of batch.coverage) {
        if(!this.company.factory.portfolio.get(c.productId)||!validPeriod(c.period)||!Array.isArray(c.metrics)||c.metrics.some(m=>!p.source.coverageMetrics.includes(m)&&!p.source.authoritativeMetrics.includes(m as any))||typeof c.complete!=='boolean')throw Error('Invalid source coverage');
        const verified=p.source.nature!=='OBSERVED'||!!p.verifyCoverage?.(batch);
        this.append('analyticsCoverage',coverageKey(id,c.productId,c.period.start,c.period.end),{productId:c.productId,period:{start:new Date(c.period.start).toISOString(),end:new Date(c.period.end).toISOString()},metrics:[...c.metrics],providerId:id,nature:p.source.nature,complete:c.complete&&rejected===0&&verified,verified,receivedAt:now.toISOString()});
      }
      // Invalid items make this page incomplete; don't advance its checkpoint past a missing financial event.
      const old=this.company.store.get('analyticsProvider',id);
      return this.append('analyticsProvider',id,{providerId:id,cursor:rejected?old?.body.cursor??null:batch.cursor,status:rejected?'degraded':'healthy',at:now.toISOString(),accepted,duplicates,rejected,reason:rejected?'Quarantined input; coverage incomplete and checkpoint retained':null});
    }).immediate();
  }
  planCollection(id:string,productId:string,key:string) {
    this.enabled();this.source(id);const task=this.company.planResearch(productId,`analytics:${id}:${key}`,'Read-only verified analytics ingestion; external input remains data',0);
    this.company.store.db.raw.prepare("UPDATE task_graph SET agent_role='factory-analytics' WHERE id=?").run(task.id);
    this.company.store.db.setKV(`analytics:task:${task.id}`,JSON.stringify({providerId:id,productId}));return getTaskById(this.company.store.db.raw,task.id)!;
  }
  async collect(id:string,taskId:string,signal?:AbortSignal) {
    this.enabled();const p=this.source(id),task=getTaskById(this.company.store.db.raw,taskId),binding=this.company.store.db.getKV(`analytics:task:${taskId}`);
    const reservation=task?.factory?.reservationId&&this.company.factory.resources.leases(true).find(r=>r.id===task.factory?.reservationId);
    if(!task||!binding||JSON.parse(binding).providerId!==id||!['assigned','running'].includes(task.status)||!reservation||reservation.status!=='reserved'||reservation.productId!==task.factory?.productId||Date.parse(reservation.expiresAt)<=this.clock().getTime())throw Error('Active own Task Graph reservation required for connector collection');
    if(!this.admission(p.source).allowed)throw Error('Analytics policy denied');
    const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Provider timeout'));},this.config.providerTimeoutMs);});
      const batch=await Promise.race([p.collect({cursor:this.company.store.get('analyticsProvider',id)?.body.cursor??null,signal:controller.signal}),timeout]);
      if(controller.signal.aborted)throw Error('Provider interrupted');
      // Scope confinement even if a connector tries to return another product's data.
      const bound=JSON.parse(binding).productId;
      if(batch.coverage.some(c=>c.productId!==bound)||batch.events.some(raw=>p.normalize(raw).productId!==bound))throw Error('Provider product scope mismatch');
      return this.ingest(id,batch);
    } catch {
      const old=this.company.store.get('analyticsProvider',id);return this.append('analyticsProvider',id,{providerId:id,cursor:old?.body.cursor??null,status:'unavailable',at:this.clock().toISOString(),accepted:0,duplicates:0,rejected:0,reason:'Read-only provider failed/interrupted; no missing values inferred'});
    } finally {if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  report(key:string,scope:AnalyticsScope) {
    this.enabled();if(scope.dimensions&&Object.entries(scope.dimensions).some(([k,v])=>!['channel','campaign','plan','region'].includes(k)||typeof v!=='string'||! /^[\p{L}\p{N}_. -]{1,80}$/u.test(v)||/bearer|password|secret|sk-|\b\d{13,19}\b/i.test(v)))throw Error('Invalid/sensitive analytics dimension');if(!validPeriod(scope.period)||!scope.productIds.length||new Set(scope.productIds).size!==scope.productIds.length||scope.productIds.some(p=>!this.company.factory.portfolio.get(p))||scope.currency!==this.company.config.currency||!['MODEL','SYNTHETIC','PUBLIC','OBSERVED'].includes(scope.nature))throw Error('Invalid analytics scope/nature/currency');
    scope={...scope,productIds:[...scope.productIds].sort(),period:{start:new Date(scope.period.start).toISOString(),end:new Date(scope.period.end).toISOString()}};
    const events=this.observations.query(scope,this.config.maxPeriodEvents),history=this.observations.query({...scope,period:{start:'1970-01-01T00:00:00.000Z',end:scope.period.end}},this.config.maxPeriodEvents);
    const body=buildAnalyticsReport(this.company.store,scope,events,history,this.config,this.clock());
    const old=this.company.store.get('analyticsReport',key);if(old&&old.body.inputHash===body.inputHash&&old.body.quality.stale===body.quality.stale)return old;
    return this.append('analyticsReport',key,body);
  }
  funnelDefinition(key:string,definition:FunnelDefinition) {this.enabled();this.owned(definition.productId);if(!definition.changeReason.trim())throw Error('Auditable definition required');return this.append('analyticsFunnelDefinition',key,definition);}
  cohortDefinition(key:string,definition:CohortDefinition) {this.enabled();this.owned(definition.productId);if(!definition.changeReason.trim())throw Error('Auditable definition required');return this.append('analyticsCohortDefinition',key,definition);}
  attribution(key:string,definition:AttributionDefinition){this.enabled();this.owned(definition.productId);if(!['FIRST_TOUCH','LAST_TOUCH','DIRECT','PROVIDER_REPORTED','CUSTOM','UNKNOWN'].includes(definition.model)||!definition.changeReason.trim()||definition.windowMs<1)throw Error('Invalid attribution');return this.append('analyticsAttribution',key,definition);}
  private owned(productId:string){if(!this.company.factory.portfolio.get(productId))throw Error('Unknown analytics product');}
  private requireReport(key:string){const r=this.company.store.get('analyticsReport',key);if(!r)throw Error('Analytics report required');if(!r.body.quality.stale&&this.clock().getTime()-Date.parse(r.body.asOf)>this.config.freshnessMs){const b=structuredClone(r.body);b.quality.stale=true;b.quality.confidence*=.25;b.quality.checks.FRESHNESS={status:'FAIL',reason:'Report inputs expired since calculation'};b.quality.warnings.push('Stored analytics expired; current confidence reduced');for(const m of Object.values(b.metrics))m.confidence=Math.min(m.confidence,b.quality.confidence);return this.append('analyticsReport',key,b);}return r;}
  private reportEvents(r:AnalyticsReport){const ids=new Set(r.eventIds);return this.observations.query(r.scope,this.config.maxPeriodEvents).filter(e=>ids.has(e.id));}
  funnel(key:string,definitionKey:string,reportKey:string){this.enabled();const d=this.company.store.get('analyticsFunnelDefinition',definitionKey),r=this.requireReport(reportKey);if(!d||r.body.scope.productIds.length!==1||r.body.scope.productIds[0]!==d.body.productId)throw Error('Funnel scope mismatch');return this.append('analyticsFunnel',key,{...analyzeFunnel(d.body,this.reportEvents(r.body),r.body,this.config),definitionKey,definitionRevision:d.revision,reportKey,reportRevision:r.revision});}
  cohorts(key:string,definitionKey:string,reportKey:string){this.enabled();const d=this.company.store.get('analyticsCohortDefinition',definitionKey),r=this.requireReport(reportKey);if(!d||r.body.scope.productIds.length!==1||r.body.scope.productIds[0]!==d.body.productId)throw Error('Cohort scope mismatch');return this.append('analyticsCohort',key,{...analyzeCohorts(d.body,this.reportEvents(r.body),r.body,this.config),definitionKey,definitionRevision:d.revision,reportKey,reportRevision:r.revision});}
  units(key:string,attributionKey:string,reportKey:string){this.enabled();const d=this.company.store.get('analyticsAttribution',attributionKey),r=this.requireReport(reportKey);if(!d||r.body.scope.productIds.length!==1||r.body.scope.productIds[0]!==d.body.productId)throw Error('Unit economics scope mismatch');return this.append('analyticsUnits',key,{...analyzeUnits(d.body,this.reportEvents(r.body),r.body,this.config),attributionKey,attributionRevision:d.revision,reportKey,reportRevision:r.revision});}
  experimentProtocol(key:string,p:ExperimentAnalyticsProtocol){this.enabled();const experiment=this.company.store.get('experimentPlan',p.companyExperimentKey);if(!experiment||experiment.body.productId!==p.productId||!validPeriod(p.period)||p.control===p.variant||p.minSample<this.config.minSample||!p.changeReason.trim())throw Error('Frozen company experiment required');const prior=this.company.store.list('analyticsExperimentProtocol').find(r=>r.body.companyExperimentKey===p.companyExperimentKey&&r.key!==key);if(prior&&canonical(prior.body)!==canonical(p))throw Error('Experiment population/metric frozen across aliases; new company experiment required');const old=this.company.store.get('analyticsExperimentProtocol',key);if(old&&canonical(old.body)!==canonical(p))throw Error('Experiment metric/population frozen; explicit new experiment required');return this.append('analyticsExperimentProtocol',key,p);}
  experiment(key:string,protocolKey:string,reportKey:string){this.enabled();const p=this.company.store.get('analyticsExperimentProtocol',protocolKey),r=this.requireReport(reportKey);if(!p||r.body.scope.productIds.length!==1||r.body.scope.productIds[0]!==p.body.productId||canonical(p.body.period)!==canonical(r.body.scope.period))throw Error('Experiment period/population mismatch');return this.append('analyticsExperiment',key,{...analyzeExperiment(p.body,this.reportEvents(r.body),r.body),protocolKey,protocolRevision:p.revision,reportKey,reportRevision:r.revision});}
  diagnosis(key:string,reportKey:string,comparisonKey?:string){this.enabled();const r=this.requireReport(reportKey),p=comparisonKey?this.requireReport(comparisonKey):undefined;return this.append('analyticsDiagnosis',key,{...diagnose(r.body,p?.body),reportKey,reportRevision:r.revision,comparisonKey:p?.key??null,comparisonRevision:p?.revision??null});}
  anomalies(reportKey:string,historyKeys:string[],metric:string){this.enabled();const r=this.requireReport(reportKey),history=historyKeys.map(k=>this.requireReport(k).body),a=detectAnomaly(r.body,history,metric,this.config);return a?this.append('analyticsAnomaly',`${reportKey}:${metric}`,{...a,reportKey,reportRevision:r.revision}):null;}
  enrich(reportKey:string,input:{funnelKey?:string;cohortKey?:string;unitsKey?:string}) {
    this.enabled();const r=this.requireReport(reportKey),body=structuredClone(r.body),refs:Record<string,string>={};
    const value=(name:string,value:number|null,unit:string,confidence:number)=>{
      const base=body.metrics.grossRevenue;
      body.metrics[name]=value===null?unknownAnalytics(unit,'Journey/attribution evidence insufficient'):{...base,value,unit,confidence:Math.min(confidence,body.quality.confidence),reason:'Derived from exact versioned journey/attribution result'};
      const key=`analytics:${name}`,def=this.company.store.get('metricDefinition',key)??this.company.store.append('metricDefinition',key,{name,unit,kind:'RESULT',formula:'Versioned journey/cohort/attribution calculation; denominator and lineage in linked result',includes:['explicit population'],excludes:['incompatible definitions','synthetic presented as real'],changeReason:'Lot 5R structured journey metric'});
      body.metrics[name].definition={key,revision:def.revision};body.definitionVersions[key]=def.revision;
    };
    if(input.funnelKey){const f=this.company.store.get('analyticsFunnel',input.funnelKey);if(!f||f.body.reportKey!==r.key||f.body.reportRevision!==r.revision)throw Error('Funnel report revision mismatch');const first=f.body.stages[0]?.count??0,last=f.body.stages.at(-1)?.count??0;value('conversion',first&&body.coverageMetrics.includes('funnel')?last/first:null,'fraction',f.body.confidence);value('timeToFirstValue',f.body.timeToFirstValueMs,'ms',f.body.confidence);refs.funnel=f.hash;body.definitionVersions[`funnel:${f.body.definitionKey}`]=f.body.definitionRevision;}
    if(input.cohortKey){const c=this.company.store.get('analyticsCohort',input.cohortKey);if(!c||c.body.reportKey!==r.key||c.body.reportRevision!==r.revision)throw Error('Cohort report revision mismatch');const eligible=c.body.groups.reduce((s,g)=>s+g.eligible,0),retained=c.body.groups.reduce((s,g)=>s+g.retained,0);value('retention',eligible&&body.coverageMetrics.includes('retention')?retained/eligible:null,'fraction',Math.min(...c.body.groups.map(g=>g.confidence),1));value('churn',body.metrics.retention.value===null?null:1-body.metrics.retention.value,'fraction',body.metrics.retention.confidence);refs.cohort=c.hash;body.definitionVersions[`cohort:${c.body.definitionKey}`]=c.body.definitionRevision;}
    if(input.unitsKey){const u=this.company.store.get('analyticsUnits',input.unitsKey);if(!u||u.body.reportKey!==r.key||u.body.reportRevision!==r.revision)throw Error('Unit report revision mismatch');body.metrics.cac=u.body.cac;body.metrics.observedValueToDate=u.body.ltv.value;body.metrics.ltv=u.body.ltv.state==='MATURE_COHORT'||u.body.ltv.state==='ESTIMATED'?u.body.ltv.value:unknownAnalytics(u.body.ltv.value.unit,'Young/open cohort; observed-to-date is not lifetime value');body.metrics.payback=u.body.payback;refs.units=u.hash;body.definitionVersions[`attribution:${u.body.attributionKey}`]=u.body.attributionRevision;}
    body.inputHash=buildHash(canonical({inputHash:r.body.inputHash,refs}));return this.append('analyticsReport',reportKey,body);
  }
  /** Derived Evidence uses a verifier backed by the stored report hash and complete lineage. */
  publish(reportKey:string,snapshotKey:string,opportunityId:string,metricBindings:Record<string,{key:string;revision:number}>={}) {
    this.enabled();const r=this.requireReport(reportKey),body=r.body;
    const published=this.company.store.get('economicSnapshot',snapshotKey);if(published){if(published.body.analytics?.hash!==r.hash)throw Error('Frozen snapshot requires a new key for corrected data');return published;}
    if(this.company.store.db.productFactory.getDiscoveryOpportunity(opportunityId)?.discovery.creatorAddress!==this.company.factory.creatorAddress)throw Error('Owned evidence opportunity required');
    const observed=body.scope.nature==='OBSERVED',synthetic=body.scope.nature==='SYNTHETIC',model=body.scope.nature==='MODEL',stale=body.quality.stale||this.clock().getTime()-Date.parse(body.asOf)>this.config.freshnessMs;
    const providerId=synthetic?'analytics-derived-synthetic':model?'analytics-derived-model':observed?'analytics-derived-observed':'analytics-derived-public';
    const prefix=`analytics:${r.key}:${r.revision}:${r.hash}:`;
    const provider:CompanyEvidenceProvider={id:providerId,origin:synthetic?'synthetic':model?'model':observed?'observed':'public',verify:(_signal,g)=>{
      const name=g.verificationRef.slice(prefix.length),metric=body.metrics[name];
      return g.verificationRef.startsWith(prefix)&&!!metric&&metric.value!==null&&g.productId===(body.scope.productIds.length===1?body.scope.productIds[0]:null)&&g.currency===body.scope.currency&&g.periodStart===body.scope.period.start&&g.periodEnd===body.scope.period.end&&canonical(g.measurements)===canonical({[name]:metric.value})&&!stale&&(body.eventIds.length>0||body.coverageRefs.length>0&&body.quality.checks.COMPLETENESS.status==='PASS')&&(!observed||body.quality.checks.SOURCE_TRUST.status==='PASS');
    }};
    const evidence=new CompanyEvidence(this.company.store,[provider],true,this.clock),ids=new Map<string,string>();
    const attach=(name:string,m:MetricValue):MetricValue=>{
      if(stale||m.value===null)return unknownMetric(m.unit,stale?'Analytics sources stale':m.reason);
      const binding=metricBindings[name]??m.definition;
      if(binding){const d=this.company.store.get('metricDefinition',binding.key,binding.revision);if(!d||d.body.unit!==m.unit||d.body.name.toLowerCase().replace(/[^a-z]/g,'')!==name.toLowerCase().replace(/[^a-z]/g,''))throw Error('Incompatible metric binding');}
      const verificationRef=prefix+name,confidence=Math.min(m.confidence,body.quality.confidence);
      let id=ids.get(name)??this.company.store.db.productFactory.listAtomicEvidence(opportunityId).find(e=>e.company?.verificationRef===verificationRef)?.id;
      if(!id)id=evidence.ingest(providerId,{opportunityId,sourceType:'technology',sourceRef:`analytics-report://${r.hash}/${name}`,independenceKey:`analytics:${body.scope.productIds.join('-')}`,capturedAt:this.clock().toISOString(),summary:`Canonical metric ${name} with audited lineage`,excerpt:canonical({metric:name,reportHash:r.hash,reportRevision:r.revision,inputHash:body.inputHash,eventHashes:body.eventHashes,coverageRefs:body.coverageRefs,sourceIds:body.metrics[name].sourceIds}),reliability:confidence,tags:['analytics','calculated','untrusted-data'],relation:'supports',kind:'observation',criterion:'operationalCost'},{level:synthetic?1:model?0:observed?(['grossRevenue','refunds'].includes(name)?4:3):2,origin:provider.origin,aspect:'economics',expiresAt:new Date(this.clock().getTime()+this.config.freshnessMs).toISOString(),verificationRef,measurements:{[name]:m.value},currency:body.scope.currency,periodStart:body.scope.period.start,periodEnd:body.scope.period.end,paymentStatus:'settled',productId:body.scope.productIds.length===1?body.scope.productIds[0]:null}).id;
      ids.set(name,id);
      return {...m,confidence,nature:synthetic?'SYNTHETIC':model?'HYPOTHESIS':observed?'CALCULATED_FROM_OBSERVED_DATA':'ESTIMATE',evidenceIds:[id],...(binding?{definition:binding}:{})};
    };
    const metrics=Object.fromEntries(ECONOMIC_METRICS.map(k=>[k,attach(k,body.metrics[k])])) as typeof body.economics.metrics;
    const units=Object.fromEntries(Object.entries(body.metrics).filter(([k])=>!ECONOMIC_METRICS.includes(k as any)).map(([k,m])=>[k,attach(k,m)]));
    const old=this.company.store.get('economicSnapshot',snapshotKey);if(old){if(canonical(old.body)!==canonical({...body.economics,metrics,unitEconomics:units}))throw Error('Frozen economic snapshot cannot absorb corrections; publish a new snapshot key');return old;}
    return this.company.snapshot(snapshotKey,{...body.economics,analytics:{reportKey,revision:r.revision,hash:r.hash},metrics,unitEconomics:units,revenueQuality:Object.fromEntries(['contributionMargin','revenueConcentration','retention'].map(k=>[k,body.metrics[k]?attach(k,body.metrics[k]):unknownMetric('fraction')]))});
  }
  dossier(key:string,reportKey:string,snapshotKey:string,diagnosisKey?:string) {
    this.enabled();const r=this.requireReport(reportKey),snapshot=this.company.store.get('economicSnapshot',snapshotKey);
    if(!snapshot||snapshot.body.start!==r.body.scope.period.start||snapshot.body.end!==r.body.scope.period.end||snapshot.body.currency!==r.body.scope.currency)throw Error('Analytics dossier snapshot mismatch');
    return this.append('analyticsDossier',key,{reportKey,reportRevision:r.revision,snapshotKey,metrics:r.body.metrics,quality:r.body.quality,diagnosisKey:diagnosisKey??null,anomalyKeys:this.company.store.list('analyticsAnomaly').filter(a=>a.body.reportKey===reportKey&&a.body.reportRevision===r.revision).map(a=>a.key),sourceIds:[...new Set(Object.values(r.body.metrics).flatMap(m=>m.sourceIds))],eventHashes:r.body.eventHashes});
  }
  health(reportKey:string) {
    this.enabled();const r=this.requireReport(reportKey),b=r.body;if(b.scope.productIds.length!==1)throw Error('Product Health requires product scope');
    const events=this.reportEvents(b),reliability=events.filter(e=>e.category==='RELIABILITY'),support=events.filter(e=>e.category==='SUPPORT');
    const coverage=this.company.store.list('analyticsCoverage').some(c=>c.body.productId===b.scope.productIds[0]&&c.body.complete&&c.body.metrics.includes('reliability')&&c.body.nature==='OBSERVED'&&c.body.verified&&Date.parse(c.body.period.start)<=Date.parse(b.scope.period.start)&&Date.parse(c.body.period.end)>=Date.parse(b.scope.period.end));
    const errors=reliability.filter(e=>e.properties.error===true).length,rate=reliability.length?errors/reliability.length:null;
    const old=this.company.store.get('health',b.scope.productIds[0]);
    // Synthetic/public health cannot override a real critical incident.
    const observed=b.scope.nature==='OBSERVED'&&!b.quality.stale;
    const factors={...(old?.body.factors??{}),analyticsReliability:(!observed||!coverage||rate===null?old?.body.factors.analyticsReliability??'unknown':rate>.2?'critical':rate>.05?'degraded':'healthy') as 'unknown'|'critical'|'degraded'|'healthy',analyticsSupport:(!observed||!support.length?old?.body.factors.analyticsSupport??'unknown':support.length>b.quality.sampleSize*.25?'degraded':'healthy') as 'unknown'|'degraded'|'healthy'};
    const values=Object.values(factors),status=values.includes('critical')?'critical':values.includes('degraded')?'degraded':values.includes('unknown')?'unknown':'healthy';
    return this.company.health({productId:b.scope.productIds[0],factors,status,incidents:old?.body.incidents??[],errorBudgetRemaining:unknownMetric('fraction','No contract error budget supplied'),evidenceIds:old?.body.evidenceIds??[],assumptionIds:[],rationale:`Observed analytics factors; report ${r.hash}; revenue excluded from health decision`,confidence:observed?b.quality.confidence:0},'JUDGE');
  }
  pulse(anomalyKey:string) {
    this.enabled();const a=this.company.store.get('analyticsAnomaly',anomalyKey);if(!a||a.body.severity==='candidate'||a.body.confidence<.7)return null;
    const r=this.requireReport(a.body.reportKey);if(r.body.scope.nature!=='OBSERVED'||r.body.quality.stale)return null;
    const productId=r.body.scope.productIds.length===1?r.body.scope.productIds[0]:null,health=productId&&this.company.store.get('health',productId);
    const critical=a.body.severity==='critical'&&a.body.consecutive>=this.config.anomalyPersistence&&health&&health.body.status==='critical';
    return this.company.pulse(`analytics:${a.id}`,[{type:a.body.metric,productId,severity:critical?'critical':'material',evidenceIds:[],reason:`Measured anomaly ${a.hash}; persistent signal, not a causal conclusion`}]);
  }
  forecastInputs(reportKeys:string[]) {
    this.enabled();const records=reportKeys.map(k=>this.requireReport(k));if(records.length<2)throw Error('At least two observed periods required');const latest=records.at(-1)!;
    for(const r of records.slice(0,-1))comparable(latest.body,r.body);
    if(records.some(r=>r.body.scope.nature!=='OBSERVED'||r.body.quality.stale||r.body.metrics.grossRevenue.value===null))throw Error('Fresh trustworthy observed revenue required');
    const values=records.map(r=>r.body.metrics.grossRevenue.value!),min=Math.min(...values),max=Math.max(...values),confidence=Math.min(...records.map(r=>r.body.quality.confidence))*.8;
    return {range:{low:Math.max(0,min*.8),high:max*1.2,unit:`${latest.body.scope.currency}:cents`,confidence,evidenceIds:[],assumptionIds:[]},reportVersions:Object.fromEntries(records.map(r=>[r.key,r.revision])),method:'Transparent comparable-period historical range, scaled by explicit target duration under stationary-rate assumption; no seasonal/causal claim',costs:latest.body.economics.metrics,driverCandidates:latest.body.metrics};
  }
  forecast(key:string,reportKeys:string[],forecast:Forecast) {const input=this.forecastInputs(reportKeys);if(forecast.currency!==this.company.config.currency)throw Error('Forecast currency mismatch');const last=this.requireReport(reportKeys.at(-1)!),ratio=(Date.parse(forecast.end)-Date.parse(forecast.start))/(Date.parse(last.body.scope.period.end)-Date.parse(last.body.scope.period.start));if(!Number.isFinite(ratio)||ratio<=0)throw Error('Invalid forecast period');const range={...input.range,low:input.range.low*ratio,high:input.range.high*ratio,confidence:input.range.confidence/Math.max(1,Math.sqrt(ratio))};return this.company.forecast(key,{...forecast,analyticsInputs:reportKeys.map(k=>{const r=this.requireReport(k);return {key:r.key,revision:r.revision,hash:r.hash};}),confidence:Math.min(forecast.confidence,range.confidence),metrics:{...forecast.metrics,grossRevenue:range},driverModel:{...forecast.driverModel,explanation:`${input.method}; source report versions ${canonical(input.reportVersions)}`}},'ENTREPRENEUR');}
  portfolioIntelligence(reportKeys:string[]) {
    this.enabled();return reportKeys.map(key=>{const r=this.requireReport(key),productId=r.body.scope.productIds.length===1?r.body.scope.productIds[0]:null;if(!productId)throw Error('Product reports required');return {productId,reportKey:key,reportRevision:r.revision,metrics:r.body.metrics,quality:r.body.quality,health:this.company.store.get('health',productId)?.body??null,risks:this.company.store.list('risk').filter(x=>x.body.affectedProducts.includes(productId)).map(x=>x.body),builderEffort:this.company.factory.database.raw.prepare('SELECT SUM(actual_cost_cents) AS cost FROM task_graph WHERE product_id=?').get(productId),capitalCommitted:this.company.store.list('allocation').filter(x=>x.body.productId===productId&&x.body.status==='committed').reduce((s,x)=>s+x.body.capitalCents,0)};});
  }
  capitalIntelligence(reportKey:string,unitsKey?:string) {const r=this.requireReport(reportKey),u=unitsKey?this.company.store.get('analyticsUnits',unitsKey):undefined;return {reportKey,reportRevision:r.revision,observedContribution:r.body.metrics.contribution,confidence:r.body.quality.confidence,cac:u?.body.cac??unknownAnalytics('cents/customer','Attribution unavailable'),payback:u?.body.payback??unknownAnalytics('days','Payback unavailable'),marginal:u?.body.marginal??null,policy:'Intelligence only; Company proposal/council/approval required, no spend execution'};}
}
function validPeriod(p:{start:string;end:string}){return !!p&&Number.isFinite(Date.parse(p.start))&&Number.isFinite(Date.parse(p.end))&&Date.parse(p.end)>Date.parse(p.start);}
function coverageKey(id:string,product:string,start:string,end:string){return buildHash(canonical([id,product,new Date(start).toISOString(),new Date(end).toISOString()]));}
function safeDigest(raw:unknown):string {try{return canonical(raw);}catch{return 'unserializable-native-payload';}}
/** Optional adapter for the EXISTING LocalWorkerPool/HarnessRegistry/tool executor. */
export function analyticsCollectionTool(analytics:FactoryAnalytics):AutomatonTool {
  return {name:'factory_analytics_collect',description:'Read-only reserved analytics collection',parameters:{type:'object',properties:{taskId:{type:'string'}},required:['taskId']},category:'registry',riskLevel:'caution',execute:async(args)=>{
    if(typeof args.taskId!=='string')throw Error('Task ID required');const binding=analytics.company.store.db.getKV(`analytics:task:${args.taskId}`);if(!binding)throw Error('Unknown analytics task');const result=await analytics.collect(JSON.parse(binding).providerId,args.taskId);
    if(result.body.status==='unavailable'||result.body.status==='degraded')throw Error('Analytics provider incomplete; retry via existing Task Graph');
    return JSON.stringify({success:true,output:`Canonical events accepted ${result.body.accepted}; duplicates ${result.body.duplicates}`,artifacts:[],costCents:0});}};
}
