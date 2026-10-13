import type { AutomatonDatabase } from '../../../types.js';
import { FactoryAnalytics,ReadOnlyAnalyticsProvider,ECONOMIC_METRICS,SyntheticAnalyticsProvider } from '../../../product-factory/index.js';
import type { AnalyticsInput,AnalyticsBatch,AnalyticsProvider,AnalyticsSource,EconomicMetric } from '../../../product-factory/index.js';
import { companyFixture } from './company-fixture.js';
export function analyticsFixture(db:AutomatonDatabase) {
  const f=companyFixture(db);f.setNow('2026-10-08T12:00:00Z');
  const period={start:'2026-10-01T00:00:00.000Z',end:'2026-10-08T00:00:00.000Z'};
  const monetary=ECONOMIC_METRICS.filter(m=>!['netRevenue','contribution','profit'].includes(m));
  const coverageMetrics=[...monetary,'mrr','newPayingCustomers','lostCustomers','activation','firstValue','reliability','retention','funnel','attribution','experiment'];
  const source=(id:string,authority:EconomicMetric[]=monetary,type:AnalyticsSource['type']='PAYMENTS_BILLING'):AnalyticsSource=>({id,type,mode:'read-only',nature:'OBSERVED',reliability:.95,authoritativeMetrics:authority,coverageMetrics});
  // Contract-compatible deterministic SDK/receipt doubles, NOT a real payment provider.
  function provider(s:AnalyticsSource,batch?:AnalyticsBatch):AnalyticsProvider{return new ReadOnlyAnalyticsProvider(s,{read:async()=>structuredClone(batch??{events:[],cursor:null,coverage:[]}),normalize:raw=>raw as AnalyticsInput,verify:(_raw,i)=>({verified:i.eventName!=='unverified',receiptRef:`test-receipt:${i.eventId??i.eventName}`}),verifyCoverage:()=>true});}
  const billing=provider(source('billing')),tracker=provider(source('tracker',[],'PRODUCT_ANALYTICS'));
  const synthetic=new SyntheticAnalyticsProvider({id:'synthetic',type:'PAYMENTS_BILLING',reliability:1,authoritativeMetrics:monetary,coverageMetrics},[]);
  const options={providers:[billing,tracker,synthetic],pseudonymKey:'deterministic-test-pseudonym-key-32-bytes',config:{enabled:true,freshnessMs:86400000,minSample:4},clock:f.now,admission:()=>({allowed:true,reason:'Deterministic test policy contract'})};
  const analytics=new FactoryAnalytics(f.os,options);let sequence=0;
  const product=f.product();
  function event(metric?:EconomicMetric,amount=0,patch:Partial<AnalyticsInput>={}):AnalyticsInput{return {eventId:`event-${++sequence}`,productId:product,eventName:metric==='grossRevenue'?'payment':metric==='refunds'?'refund':metric?'cost':'signup',category:metric==='grossRevenue'||metric==='refunds'?'COMMERCE':metric?'COST':'PRODUCT_USAGE',occurredAt:'2026-10-07T12:00:00Z',...(metric?{economicMetric:metric,amountCents:amount,currency:'EUR',paymentStatus:'settled' as const}:{}),identifiers:{customer:'customer-1',user:'user-1'},properties:{firstPurchase:true},...patch};}
  function batch(events:unknown[],productId=product,metrics=coverageMetrics):AnalyticsBatch{return {events,cursor:'page1',coverage:[{productId,period,metrics,complete:true}]};}
  function ingest(events:unknown[],id='billing',productId=product,metrics=coverageMetrics){return analytics.ingest(id,batch(events,productId,metrics));}
  const scope=(productIds=[product],nature:'OBSERVED'|'SYNTHETIC'='OBSERVED')=>({productIds,period,currency:'EUR',nature});
  return {f,analytics,options,source,provider,product,event,batch,ingest,scope,period,monetary,coverageMetrics};
}
