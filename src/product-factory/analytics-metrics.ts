import { ECONOMIC_METRICS,deriveEconomics,unknownMetric } from './company-economics.js';
import { canonical,CompanyStore } from './company-store.js';
import { buildHash } from './build-store.js';
import type { EconomicMetric,EconomicSnapshot,MetricValue } from './company-types.js';
import type { AnalyticsConfig,AnalyticsObservation,AnalyticsScope,AnalyticsSource,AnalyticsCoverage,AnalyticsDataQuality,AnalyticsMetric,AnalyticsReport } from './analytics-types.js';
export const unknownAnalytics=(unit:string,reason:string):AnalyticsMetric=>({...unknownMetric(unit,reason),eventIds:[],sourceIds:[]});
export function analyticsValue(value:number|null,unit:string,events:AnalyticsObservation[],quality:AnalyticsDataQuality,reason?:string):AnalyticsMetric {
  if(value===null)return unknownAnalytics(unit,reason??'Insufficient evidence');
  const nature=events.some(e=>e.nature==='SYNTHETIC')?'SYNTHETIC':events.length>0&&events.every(e=>e.nature==='OBSERVED'&&e.verification==='VERIFIED')?'CALCULATED_FROM_OBSERVED_DATA':'ESTIMATE';
  return {value,unit,nature,confidence:Math.min(quality.confidence,...events.map(e=>e.confidence)),evidenceIds:[],eventIds:events.map(e=>e.id).sort(),sourceIds:[...new Set(events.map(e=>e.providerId))].sort(),...(reason?{reason}:{})};
}
export function dataQuality(events:AnalyticsObservation[],coverages:AnalyticsCoverage[],sources:AnalyticsSource[],config:AnalyticsConfig,now:Date):AnalyticsDataQuality {
  const complete=coverages.length>0&&coverages.every(c=>c.complete),stale=coverages.length===0||coverages.some(c=>now.getTime()-Date.parse(c.receivedAt)>config.freshnessMs);
  const trusted=coverages.every(c=>c.nature!=='OBSERVED'||c.verified)&&events.every(e=>e.nature!=='OBSERVED'||e.verification==='VERIFIED');
  const late=events.some(e=>Date.parse(e.receivedAt)-Date.parse(e.occurredAt)>config.freshnessMs);
  const warnings=[...(!complete?['Incomplete source coverage; absent events do not establish zero']:[]),...(stale?['Stale/missing provider data']:[]),...(late?['Late arrivals assigned to their true occurrence period']:[]),...(events.length<config.minSample?['Small sample; conclusions have limited confidence']:[])];
  return {checks:{COMPLETENESS:{status:complete?'PASS':'FAIL',reason:complete?'Declared complete windows':'Missing or rejected coverage'},FRESHNESS:{status:stale?'FAIL':'PASS',reason:stale?'Outside freshness expectation':'Current coverage'},UNIQUENESS:{status:'PASS',reason:'Persistent provider/event identity enforced before aggregation'},VALIDITY:{status:'PASS',reason:'Canonical schema validated; invalid inputs quarantined'},CONSISTENCY:{status:'PASS',reason:'Currency, nature and scope separated; reconciliation follows'},TIMELINESS:{status:late?'WARN':'PASS',reason:late?'Late events remain in occurred_at periods':'Arrival within expected delay'},SOURCE_TRUST:{status:trusted?'PASS':'FAIL',reason:'Connector verification and lineage, never API origin alone'}},confidence:Math.min(...sources.map(s=>s.reliability),1)*(complete?1:.4)*(stale?.25:1)*(trusted?1:.25),warnings,sampleSize:events.length,stale};
}
export function buildAnalyticsReport(store:CompanyStore,scope:AnalyticsScope,events:AnalyticsObservation[],history:AnalyticsObservation[],config:AnalyticsConfig,now:Date):AnalyticsReport {
  const sources=store.list('analyticsSource').map(s=>s.body),coverageRecords=store.list('analyticsCoverage').filter(r=>{const c=r.body;return scope.productIds.includes(c.productId)&&c.nature===scope.nature&&Date.parse(c.period.start)<=Date.parse(scope.period.start)&&Date.parse(c.period.end)>=Date.parse(scope.period.end);}),coverage=coverageRecords.map(r=>r.body);
  const quality=dataQuality(events,coverage,sources.filter(s=>coverage.some(c=>c.providerId===s.id)),config,now),metrics:Record<string,AnalyticsMetric>={},reconciliation:AnalyticsReport['reconciliation']=[];
  const unit=`${scope.currency}:cents`;
  const accepts=(s:AnalyticsSource)=>s.nature===scope.nature;
  function covered(productId:string,metric:string,authority=false):AnalyticsSource|null {
    const candidates=sources.filter(s=>accepts(s)&&(metric!=='mrr'||['PAYMENTS_BILLING','MARKETPLACE'].includes(s.type))&&(authority?s.authoritativeMetrics.includes(metric as EconomicMetric):s.coverageMetrics.includes(metric))&&coverage.some(c=>c.providerId===s.id&&c.productId===productId&&c.complete&&c.metrics.includes(metric)&&(scope.nature!=='OBSERVED'||c.verified)));
    return candidates.length===1?candidates[0]:null; // Multiple systems of record require explicit reconciliation, never sum blindly.
  }
  function knownMetric(metric:string,authority=false):boolean{return scope.productIds.every(p=>!!covered(p,metric,authority));}
  function selected(metric:string,authority=false):AnalyticsObservation[]{return events.filter(e=>covered(e.productId,metric,authority)?.id===e.providerId);}
  for(const metric of ECONOMIC_METRICS) {
    if(['netRevenue','contribution','profit'].includes(metric))continue;
    const financial=selected(metric,true).filter(e=>e.economicMetric===metric&&e.currency===scope.currency);
    if(events.some(e=>e.economicMetric===metric&&e.currency!==scope.currency))quality.warnings.push(`Currency conflict excluded for ${metric}`);
    const conflict=events.some(e=>e.economicMetric===metric&&e.currency!==scope.currency&&covered(e.productId,metric,true)?.id===e.providerId);
    let value=knownMetric(metric,true)&&!conflict?financial.reduce((sum,e)=>sum+(e.amountCents??0),0):null;
    if(['cash','committedCapital'].includes(metric)&&value!==null)value=scope.productIds.every(p=>financial.some(e=>e.productId===p))?scope.productIds.reduce((sum,p)=>sum+financial.filter(e=>e.productId===p).at(-1)!.amountCents!,0):null;
    if(value!==null&&!Number.isSafeInteger(value))value=null;
    metrics[metric]=analyticsValue(value,unit,financial,quality, value===null?'Missing/ambiguous authoritative coverage':undefined);
    // Complete verified zero has coverage lineage, not an inference from an empty dataset.
    if(value!==null&&financial.length===0){metrics[metric].nature=scope.nature==='OBSERVED'?'CALCULATED_FROM_OBSERVED_DATA':scope.nature==='SYNTHETIC'?'SYNTHETIC':'ESTIMATE';metrics[metric].sourceIds=scope.productIds.map(p=>covered(p,metric,true)!.id);}
    for(const s of sources.filter(s=>accepts(s)&&!s.authoritativeMetrics.includes(metric))) {
      const reported=events.filter(e=>e.providerId===s.id&&e.economicMetric===metric&&e.currency===scope.currency).reduce((sum,e)=>sum+(e.amountCents??0),0);
      if(reported&&reported!==value)reconciliation.push({metric,authoritative:value,reported,sourceId:s.id,reason:'Economic system of record wins; tracker report is not averaged or counted again'});
    }
  }
  const monetary=Object.fromEntries(ECONOMIC_METRICS.map(k=>[k,metrics[k]??unknownMetric(unit)])) as unknown as EconomicSnapshot['metrics'];
  const economics=deriveEconomics({productId:scope.productIds.length===1?scope.productIds[0]:null,start:scope.period.start,end:scope.period.end,currency:scope.currency,costBucketsDisjoint:true,metrics:monetary,unitEconomics:{},revenueQuality:{}});
  for(const k of ['netRevenue','contribution','profit'] as const)metrics[k]={...economics.metrics[k],eventIds:[...new Set(Object.values(metrics).flatMap(m=>m.eventIds))].sort(),sourceIds:[...new Set(Object.values(metrics).flatMap(m=>m.sourceIds))].sort()};
  const payments=selected('grossRevenue',true).filter(e=>e.economicMetric==='grossRevenue'&&e.currency===scope.currency&&e.paymentStatus==='settled');
  const customers=new Set(payments.map(e=>e.identifiers.customer).filter((x):x is string=>!!x));
  const customerComplete=knownMetric('grossRevenue',true)&&payments.every(e=>!!e.identifiers.customer);
  const newCustomerKnown=knownMetric('newPayingCustomers')&&payments.every(p=>typeof p.properties.firstPurchase==='boolean'&&!!p.identifiers.customer);
  metrics.newPayingCustomers=analyticsValue(newCustomerKnown?new Set(payments.filter(p=>p.properties.firstPurchase===true).map(p=>p.identifiers.customer)).size:null,'customers',payments,quality,'Distinct verified first-purchase customers; unknown without explicit lifecycle coverage');
  metrics.revenuePerTransaction=analyticsValue(metrics.grossRevenue.value!==null&&payments.length?metrics.grossRevenue.value/payments.length:null,unit,payments,quality);
  metrics.arpa=analyticsValue(customerComplete&&customers.size&&metrics.grossRevenue.value!==null?metrics.grossRevenue.value/customers.size:null,unit,payments,quality,'Per paying customer, not interchangeable with users/accounts');
  metrics.refundRate=analyticsValue(metrics.refunds.value!==null&&metrics.grossRevenue.value!==null&&metrics.grossRevenue.value>0?metrics.refunds.value/metrics.grossRevenue.value:null,'fraction',events.filter(e=>e.economicMetric==='refunds'||e.economicMetric==='grossRevenue'),quality);
  metrics.contributionMargin=analyticsValue(metrics.contribution.value!==null&&metrics.netRevenue.value!==null&&metrics.netRevenue.value>0?metrics.contribution.value/metrics.netRevenue.value:null,'fraction',events,quality);
  const byCustomer=new Map<string,number>();for(const e of payments)if(e.identifiers.customer)byCustomer.set(e.identifiers.customer,(byCustomer.get(e.identifiers.customer)??0)+(e.amountCents??0));
  metrics.revenueConcentration=analyticsValue(customerComplete&&metrics.grossRevenue.value!>0?Math.max(0,...byCustomer.values())/metrics.grossRevenue.value!:null,'fraction',payments,quality,'Largest paying-customer share');
  for(const key of ['expansion','contraction'] as const)metrics[`${key}Revenue`]=analyticsValue(knownMetric('grossRevenue',true)?payments.filter(e=>e.properties[key]===true).reduce((sum,e)=>sum+(e.amountCents??0),0):null,unit,payments,quality);
  // Subscription state is a recurring commitment metric, never a claim of cash collected.
  const subscriptions=history.filter(e=>e.category==='SUBSCRIPTION'&&e.identifiers.subscription&&covered(e.productId,'mrr',false)?.id===e.providerId);
  const states=new Map<string,AnalyticsObservation>();for(const e of subscriptions)states.set(e.identifiers.subscription!,e);
  const active=[...states.values()].filter(e=>e.eventName==='subscription_active'&&e.paymentStatus==='settled'&&e.currency===scope.currency);
  const ambiguousSubscriptionState=subscriptions.some((e,i)=>subscriptions.slice(0,i).some(p=>p.identifiers.subscription===e.identifiers.subscription&&p.occurredAt===e.occurredAt&&p.eventName!==e.eventName));
  const validMRR=!ambiguousSubscriptionState&&knownMetric('mrr')&&active.every(e=>typeof e.properties.intervalMonths==='number'&&typeof e.properties.recurringAmountCents==='number');
  const recurring=active.reduce((sum,e)=>sum+Number(e.properties.recurringAmountCents)/Number(e.properties.intervalMonths),0);
  metrics.mrr=analyticsValue(validMRR?recurring:null,unit,subscriptions,quality,'Monthly normalized active paid subscriptions, not one-time/trial/invoice revenue');
  metrics.arr=analyticsValue(validMRR?recurring*12:null,unit,subscriptions,quality,'12 × MRR; run-rate, not collected annual revenue');
  const initialStates=new Map<string,AnalyticsObservation>();for(const e of subscriptions.filter(e=>Date.parse(e.occurredAt)<Date.parse(scope.period.start)))initialStates.set(e.identifiers.subscription!,e);
  const initiallyPaid=[...initialStates.values()].filter(e=>e.eventName==='subscription_active'&&e.paymentStatus==='settled'&&e.currency===scope.currency);
  const base=initiallyPaid.reduce((sum,e)=>sum+(Number(e.properties.recurringAmountCents)/Number(e.properties.intervalMonths)||0),0);
  const retained=initiallyPaid.reduce((sum,e)=>{const final=states.get(e.identifiers.subscription!);return sum+(final?.eventName==='subscription_active'&&final.paymentStatus==='settled'&&final.currency===scope.currency?Number(final.properties.recurringAmountCents)/Number(final.properties.intervalMonths):0);},0);
  const grossRetained=initiallyPaid.reduce((sum,e)=>{const final=states.get(e.identifiers.subscription!);return sum+(final?.eventName==='subscription_active'&&final.paymentStatus==='settled'?Math.min(Number(e.properties.recurringAmountCents)/Number(e.properties.intervalMonths),Number(final.properties.recurringAmountCents)/Number(final.properties.intervalMonths)):0);},0);
  metrics.netRevenueRetention=analyticsValue(validMRR&&base>0?retained/base:null,'fraction',subscriptions,quality,'Opening paid recurring population only; new subscriptions excluded');
  metrics.grossRevenueRetention=analyticsValue(validMRR&&base>0?grossRetained/base:null,'fraction',subscriptions,quality,'Opening recurring revenue excludes expansion');
  const openingCustomers=new Set(initiallyPaid.map(e=>e.identifiers.customer).filter((id):id is string=>!!id)),remainingCustomers=new Set(active.map(e=>e.identifiers.customer));
  metrics.customerChurn=analyticsValue(validMRR&&openingCustomers.size&&initiallyPaid.every(e=>!!e.identifiers.customer)?[...openingCustomers].filter(id=>!remainingCustomers.has(id)).length/openingCustomers.size:null,'fraction',subscriptions,quality,'Opening distinct paying customers, not subscription count or app users');
  metrics.activePayingCustomers=analyticsValue(knownMetric('mrr')&&active.every(e=>e.identifiers.customer)?new Set(active.map(e=>e.identifiers.customer)).size:null,'customers',subscriptions,quality);
  const cancelled=events.filter(e=>e.category==='CHURN'&&e.eventName==='customer_lost'&&e.identifiers.customer&&(e.sourceType==='PAYMENTS_BILLING'||e.sourceType==='MARKETPLACE'));
  metrics.lostCustomers=analyticsValue(knownMetric('lostCustomers')?new Set(cancelled.map(e=>e.identifiers.customer)).size:null,'customers',cancelled,quality);
  for(const reason of ['voluntary','payment_failed'])metrics[`${reason}Churn`]=analyticsValue(knownMetric('lostCustomers')?new Set(cancelled.filter(e=>e.properties.churnReason===reason).map(e=>e.identifiers.customer)).size:null,'customers',cancelled,quality,'Explicit source reason only; cancellation time does not infer cause');
  const usage=events.filter(e=>e.category==='PRODUCT_USAGE'||e.category==='ACTIVATION'||e.category==='VALUE');
  for(const [name,category] of [['activation','ACTIVATION'],['firstValue','VALUE']] as const){const population=new Set(usage.map(e=>e.identifiers.user).filter(Boolean));const successes=new Set(usage.filter(e=>e.category===category).map(e=>e.identifiers.user).filter(Boolean));metrics[name]=analyticsValue(knownMetric(name)&&population.size?successes.size/population.size:null,'fraction',usage,quality);metrics[name].denominator={entity:'user',count:population.size,definition:'Distinct users with product usage in the same bounded period'};}
  if(reconciliation.length){quality.checks.CONSISTENCY={status:'WARN',reason:'Cross-provider discrepancies preserved'};quality.confidence*=.8;quality.warnings.push('Billing/tracker discrepancy');for(const m of Object.values(metrics))m.confidence=Math.min(m.confidence,quality.confidence);}
  const definitions:Record<string,number>={};
  for(const [name,m] of Object.entries(metrics)) {
    const key=`analytics:${name}`,existing=store.get('metricDefinition',key);
    if(existing&&(existing.body.unit!==m.unit||existing.body.formula!==definitionFormula(name)))throw Error('Metric implementation unavailable for changed definition revision');
    const definition=existing??store.append('metricDefinition',key,{name,unit:m.unit,kind:'RESULT',formula:definitionFormula(name),includes:['verified canonical events','explicit complete coverage'],excludes:['duplicate/replayed events','incompatible currency/nature','unpaid trial'],changeReason:'Lot 5R canonical definition v1'});
    definitions[key]=definition.revision;m.definition={key,revision:definition.revision};
  }
  const all=[...new Map([...events,...subscriptions].map(e=>[e.id,e])).values()];
  return {scope,asOf:now.toISOString(),calculationVersion:1,calculationConfig:{...config},coverageRefs:coverageRecords.map(r=>({key:r.key,revision:r.revision,hash:r.hash})),definitionVersions:definitions,inputHash:buildHash(canonical({events:all.map(e=>[e.id,e.provenance.payloadHash]).sort(),coverage,definitions,config,calculationVersion:1})),eventIds:all.map(e=>e.id).sort(),eventHashes:all.map(e=>e.provenance.payloadHash).sort(),coverageMetrics:[...new Set(coverage.flatMap(c=>c.metrics))].filter(m=>scope.productIds.every(p=>coverage.some(c=>c.productId===p&&c.complete&&c.metrics.includes(m)))).sort(),quality,economics:{...economics,metrics:Object.fromEntries(ECONOMIC_METRICS.map(k=>[k,metrics[k]])) as unknown as EconomicSnapshot['metrics']},metrics,reconciliation};
}
function definitionFormula(name:string):string {
  return ({netRevenue:'grossRevenue - refunds',contribution:'netRevenue - paymentFees - acquisitionCost - modelCost - hostingCost - variableCost - supportCost',profit:'contribution - operatingCost',mrr:'Sum latest active settled subscription recurringAmountCents / intervalMonths',arr:'12 * MRR (run-rate)',newPayingCustomers:'Distinct customer IDs with settled payments in period',contributionMargin:'contribution / netRevenue',arpa:'grossRevenue / distinct settled paying customers'} as Record<string,string>)[name]??`Bounded canonical ${name}; exact scope/lineage retained in AnalyticsReport`;
}
