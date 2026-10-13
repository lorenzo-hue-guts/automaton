import type { AnalyticsConfig,AnalyticsObservation,AnalyticsReport,AttributionDefinition,CohortDefinition,CohortResult,ExperimentAnalyticsProtocol,ExperimentAnalyticsResult,FunnelDefinition,FunnelResult,UnitEconomicsResult } from './analytics-types.js';
import { analyticsValue,unknownAnalytics } from './analytics-metrics.js';
const median=(values:number[]):number|null=>{if(!values.length)return null;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};
export function analyzeFunnel(def:FunnelDefinition,events:AnalyticsObservation[],report:AnalyticsReport,config:AnalyticsConfig):Omit<FunnelResult,'definitionKey'|'definitionRevision'|'reportKey'|'reportRevision'> {
  if(!def.steps.length||new Set(def.steps.map(s=>s.name)).size!==def.steps.length||!def.steps.every(s=>s.name&&s.eventName)||!Number.isSafeInteger(def.windowMs)||def.windowMs<1)throw Error('Invalid funnel definition');
  const populations=new Map<string,AnalyticsObservation[]>();for(const e of events.filter(e=>e.productId===def.productId)) {const id=e.identifiers[def.entity];if(id)populations.set(id,[...(populations.get(id)??[]),e]);}
  const counts=def.steps.map(()=>0),times=def.steps.map(()=>[] as number[]),firstValues:number[]=[];
  for(const journey of populations.values()) {
    journey.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id));let start=0,previous=-Infinity,lastIndex=-1;
    for(let stage=0;stage<def.steps.length;stage++) {
      const at=journey.findIndex((e,index)=>index>lastIndex&&e.eventName===def.steps[stage].eventName&&Date.parse(e.occurredAt)>=previous&&(stage===0||Date.parse(e.occurredAt)-start<=def.windowMs));
      if(at<0)break;const time=Date.parse(journey[at].occurredAt);if(!stage)start=time;else times[stage].push(time-previous);
      if(def.steps[stage].name===def.firstValueStep)firstValues.push(time-start);
      counts[stage]++;previous=time;lastIndex=at;
    }
  }
  const stages=def.steps.map((s,i)=>({name:s.name,count:counts[i],conversion:i&&counts[i-1]?counts[i]/counts[i-1]:i?null:counts[0]?1:null,dropOff:i&&counts[i-1]?1-counts[i]/counts[i-1]:null,medianTimeMs:median(times[i])}));
  const small=counts[0]<config.minSample;
  return {entity:def.entity,stages,timeToFirstValueMs:median(firstValues),sampleSize:counts[0],confidence:report.quality.confidence*Math.min(1,counts[0]/config.minSample),warnings:[...report.quality.warnings,...(small?['Tiny funnel sample']:[])],eventIds:events.filter(e=>e.productId===def.productId).map(e=>e.id),bottlenecks:stages.filter((s,i)=>i>0&&s.dropOff!==null&&s.dropOff>.5&&counts[i-1]>=config.minSample).map(s=>({stage:s.name,reason:'More than half of the measured preceding-stage population drops off; candidate, not causal attribution',causal:false}))};
}
export function analyzeCohorts(def:CohortDefinition,events:AnalyticsObservation[],report:AnalyticsReport,config:AnalyticsConfig):Omit<CohortResult,'definitionKey'|'definitionRevision'|'reportKey'|'reportRevision'> {
  if(!def.entryEvent||!def.returnEvents.length||def.observationWindowMs<1||!Number.isSafeInteger(def.observationWindowMs))throw Error('Invalid cohort definition');
  const end=Date.parse(report.scope.period.end),grouped=new Map<string,Map<string,AnalyticsObservation>>();
  for(const e of events.filter(e=>e.productId===def.productId&&e.eventName===def.entryEvent)) {
    const id=e.identifiers[def.entity];if(!id)continue;
    if(['paid_subscription','repeat_purchase'].includes(def.kind)&&(e.paymentStatus!=='settled'||e.category!=='COMMERCE'||e.sourceType!=='PAYMENTS_BILLING'&&e.sourceType!=='MARKETPLACE'))continue;
    const key=def.groupBy==='entry_day'?e.occurredAt.slice(0,10):String(e.properties[def.groupBy]??'UNKNOWN');
    const group=grouped.get(key)??new Map<string,AnalyticsObservation>();if(!group.has(id))group.set(id,e);grouped.set(key,group);
  }
  const groups=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([key,members])=>{
    let eligible=0,retained=0,activated=0;const ids=new Set(members.keys());
    for(const [id,entry] of members) {
      const at=Date.parse(entry.occurredAt),following=events.filter(e=>e.productId===def.productId&&e.identifiers[def.entity]===id&&Date.parse(e.occurredAt)>at);
      if(at+def.observationWindowMs>end)continue;eligible++;
      // Return at the defined horizon, not two adjacent app opens.
      if(following.some(e=>def.returnEvents.includes(e.eventName)&&Date.parse(e.occurredAt)>=at+def.observationWindowMs&&(['paid_subscription','repeat_purchase'].includes(def.kind)?e.paymentStatus==='settled'&&(e.sourceType==='PAYMENTS_BILLING'||e.sourceType==='MARKETPLACE'):true)))retained++;
      if(following.some(e=>e.category==='ACTIVATION'))activated++;
    }
    const money=events.filter(e=>e.productId===def.productId&&e.identifiers[def.entity]&&ids.has(e.identifiers[def.entity]!)&&e.economicMetric==='grossRevenue'&&e.paymentStatus==='settled'&&e.currency===report.scope.currency&&report.metrics.grossRevenue.eventIds.includes(e.id));
    const revenue=money.reduce((sum,e)=>sum+(e.amountCents??0),0),financial=report.metrics.grossRevenue.value!==null;
    // Cost attribution by cohort is not silently guessed from a portfolio average.
    return {key,members:members.size,eligible,retained,retention:eligible?retained/eligible:null,activation:eligible?activated/eligible:null,revenueCents:financial?revenue:null,contributionCents:null,confidence:report.quality.confidence*Math.min(1,eligible/config.minSample),warnings:[...(eligible<members.size?['Young/right-censored cohort']:[]),...(eligible<config.minSample?['Tiny cohort; retention conclusion low confidence']:[]),'Cohort contribution UNKNOWN without attributable cost allocation']};
  });
  return {groups,eventIds:events.filter(e=>e.productId===def.productId).map(e=>e.id)};
}
export function analyzeUnits(def:AttributionDefinition,events:AnalyticsObservation[],report:AnalyticsReport,config:AnalyticsConfig):Omit<UnitEconomicsResult,'reportKey'|'reportRevision'|'attributionKey'|'attributionRevision'> {
  const warnings:string[]=[],q=report.quality,payments=events.filter(e=>e.productId===def.productId&&e.economicMetric==='grossRevenue'&&e.paymentStatus==='settled'&&e.properties.firstPurchase===true&&report.metrics.grossRevenue.eventIds.includes(e.id));
  const spend=report.metrics.acquisitionCost,customers=new Map<string,AnalyticsObservation>();
  for(const p of payments)if(p.identifiers[def.entity]&&!customers.has(p.identifiers[def.entity]!))customers.set(p.identifiers[def.entity]!,p);
  let ambiguous=false;const attributed:string[]=[];
  for(const [id,payment] of customers){
    const touches=events.filter(e=>e.productId===def.productId&&e.category==='ACQUISITION'&&e.identifiers[def.entity]===id&&Date.parse(e.occurredAt)<=Date.parse(payment.occurredAt)&&Date.parse(payment.occurredAt)-Date.parse(e.occurredAt)<=def.windowMs);
    const channels=new Set(touches.map(e=>e.properties.channel).filter(Boolean));
    if(!touches.length||def.model==='DIRECT'&&channels.size!==1||def.model==='PROVIDER_REPORTED'&&typeof payment.properties.channel!=='string')ambiguous=true;
    const touch=def.model==='FIRST_TOUCH'?touches[0]:touches.at(-1);if(touch)attributed.push(touch.id);
  }
  const allowed=report.coverageMetrics.includes('attribution')&&def.reliable&&def.model!=='UNKNOWN'&&def.model!=='CUSTOM'&&!ambiguous&&customers.size>0&&payments.every(p=>!!p.identifiers[def.entity])&&spend.value!==null&&!q.stale&&q.checks.COMPLETENESS.status==='PASS';
  const cac=allowed?analyticsValue(spend.value!/customers.size,`${report.scope.currency}:cents/customer`,events,q):unknownAnalytics(`${report.scope.currency}:cents/customer`,'Spend/customer/attribution coverage insufficient');
  cac.denominator={entity:def.entity,count:customers.size,definition:`New settled paying ${def.entity}s; ${def.model} (descriptive, not causal)`};
  if(!allowed)warnings.push('CAC UNKNOWN without reliable spend and attribution');
  const mature=false; // No connector currently certifies completed customer lifetime; never infer maturity from age alone.
  const contribution=report.metrics.contribution;
  const ltv=customers.size&&contribution.value!==null?analyticsValue(contribution.value/customers.size,`${report.scope.currency}:cents/customer`,events,q):unknownAnalytics('cents/customer','Contribution/customer data unavailable');
  const state:UnitEconomicsResult['ltv']['state']=!customers.size||contribution.value===null?'INSUFFICIENT_DATA':mature?'MATURE_COHORT':'OBSERVED_TO_DATE';
  if(!mature)warnings.push('Observed-to-date value is not known lifetime value; young population');
  const durationDays=(Date.parse(report.scope.period.end)-Date.parse(report.scope.period.start))/86400000;
  const perCustomerDay=contribution.value!==null&&customers.size?contribution.value/customers.size/durationDays:null;
  const payback=cac.value!==null&&perCustomerDay!==null&&perCustomerDay>0?analyticsValue(cac.value/perCustomerDay,'days',events,q,'Estimated contribution-rate payback; not a promise'):unknownAnalytics('days','Positive attributable contribution/CAC unknown');
  if(payback.value!==null)payback.nature=report.scope.nature==='SYNTHETIC'?'SYNTHETIC':'ESTIMATE';
  const middle=(Date.parse(report.scope.period.start)+Date.parse(report.scope.period.end))/2;
  function ratio(recent:boolean):number|null {
    const authoritativeIds=new Set(Object.values(report.metrics).flatMap(m=>m.eventIds));
    const subset=events.filter(e=>(Date.parse(e.occurredAt)>=middle)===recent&&authoritativeIds.has(e.id)&&!!e.economicMetric&&report.metrics[e.economicMetric]?.eventIds.includes(e.id)),revenue=subset.filter(e=>e.economicMetric==='grossRevenue').reduce((s,e)=>s+(e.amountCents??0),0),cost=subset.filter(e=>e.economicMetric==='acquisitionCost').reduce((s,e)=>s+(e.amountCents??0),0);
    // Only a cost-complete contribution picture permits a marginal-return claim.
    if(contribution.value===null||!cost)return null;
    const other=subset.filter(e=>e.economicMetric&&['refunds','paymentFees','modelCost','hostingCost','variableCost','supportCost'].includes(e.economicMetric)).reduce((s,e)=>s+(e.amountCents??0),0);
    return (revenue-cost-other)/cost;
  }
  const historical=ratio(false),recent=ratio(true);
  return {cac,ltv:{state,value:ltv,assumptions:['Lifetime not inferred from signup age; no extrapolation without explicit model']},payback,marginal:{historicalContributionPerCost:historical,recentContributionPerCost:recent,saturationCandidate:historical!==null&&recent!==null&&recent<historical*.5},warnings};
}
export function analyzeExperiment(protocol:ExperimentAnalyticsProtocol,events:AnalyticsObservation[],report:AnalyticsReport):Omit<ExperimentAnalyticsResult,'protocolKey'|'protocolRevision'|'reportKey'|'reportRevision'> {
  const arms=[protocol.control,protocol.variant],members=arms.map(()=>new Set<string>()),converted=arms.map(()=>new Set<string>()),guards=protocol.guardrails.map(g=>({eventName:g.eventName,control:0,variant:0,passed:true}));
  const assignments=new Map<string,string>();
  for(const e of events.filter(e=>e.productId===protocol.productId&&e.eventName==='experiment_exposure')) {const id=e.identifiers[protocol.entity],arm=String(e.properties.variant);if(!id||!arms.includes(arm))continue;if(assignments.has(id)&&assignments.get(id)!==arm)throw Error('Experiment population crossed arms');assignments.set(id,arm);members[arms.indexOf(arm)].add(id);}
  for(const e of events.filter(e=>e.productId===protocol.productId)){const id=e.identifiers[protocol.entity],arm=id&&assignments.get(id);if(!id||!arm)continue;const index=arms.indexOf(arm);const exposed=events.find(x=>x.eventName==='experiment_exposure'&&x.identifiers[protocol.entity]===id);if(!exposed||Date.parse(e.occurredAt)<Date.parse(exposed.occurredAt))continue;if(e.eventName===protocol.primaryEvent)converted[index].add(id);for(const g of guards)if(e.eventName===g.eventName)g[index===0?'control':'variant']++;}
  const [a,b]=members.map(s=>s.size),ra=a?converted[0].size/a:null,rb=b?converted[1].size/b:null;
  for(let i=0;i<guards.length;i++){const g=guards[i],base=a?g.control/a:0,rate=b?g.variant/b:0;g.passed=rate<=base+protocol.guardrails[i].maxIncrease;}
  const enough=report.coverageMetrics.includes('experiment')&&a>=protocol.minSample&&b>=protocol.minSample,delta=ra!==null&&rb!==null?rb-ra:null;
  const se=ra!==null&&rb!==null?Math.sqrt(ra*(1-ra)/Math.max(1,a)+rb*(1-rb)/Math.max(1,b)):Infinity;
  const confidence=report.quality.confidence*Math.min(1,Math.min(a,b)/protocol.minSample);
  return {control:{exposed:a,converted:converted[0].size},variant:{exposed:b,converted:converted[1].size},difference:delta,confidence,guardrails:guards,status:guards.some(g=>!g.passed)?'GUARDRAIL_FAILED':enough&&delta!==null&&delta>Math.max(.01,2*se)&&!report.quality.stale?'CANDIDATE_IMPROVEMENT':'INCONCLUSIVE',nature:report.scope.nature,eventIds:events.map(e=>e.id),causal:false};
}
