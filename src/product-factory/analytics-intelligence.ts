import type { AnalyticsConfig,AnalyticsReport,AnalyticsDiagnosis,AnalyticsAnomaly } from './analytics-types.js';
export function comparable(a:AnalyticsReport,b:AnalyticsReport):void {
  const duration=(r:AnalyticsReport)=>Date.parse(r.scope.period.end)-Date.parse(r.scope.period.start);
  if(a.scope.currency!==b.scope.currency||a.scope.nature!==b.scope.nature||JSON.stringify(a.scope.productIds)!==JSON.stringify(b.scope.productIds)||JSON.stringify(a.scope.dimensions??{})!==JSON.stringify(b.scope.dimensions??{})||duration(a)!==duration(b)||JSON.stringify(a.definitionVersions)!==JSON.stringify(b.definitionVersions)||Date.parse(b.scope.period.end)>Date.parse(a.scope.period.start))throw Error('Incompatible analytics periods/currency/definitions/populations');
}
export function diagnose(current:AnalyticsReport,previous?:AnalyticsReport):Omit<AnalyticsDiagnosis,'reportKey'|'reportRevision'|'comparisonKey'|'comparisonRevision'> {
  if(previous)comparable(current,previous);
  const names=['grossRevenue','netRevenue','contribution','profit','contributionMargin','activation','firstValue','newPayingCustomers','arpa','acquisitionCost','modelCost','hostingCost','supportCost','refundRate'];
  const facts=names.map(metric=>{const c=current.metrics[metric]?.value??null,p=previous?.metrics[metric]?.value??null;return {metric,current:c,previous:p,change:c!==null&&p!==null?c-p:null};});
  const explanations:AnalyticsDiagnosis['explanations']=[];
  const fact=(k:string)=>facts.find(f=>f.metric===k)!;
  if(fact('grossRevenue').change!<0)for(const driver of ['activation','firstValue','newPayingCustomers','arpa'])if(fact(driver).change!<0)explanations.push({driver,reason:'Measured driver deteriorated alongside revenue; investigate funnel/population changes, not proven causality',confidence:current.quality.confidence,causal:false});
  if(fact('contributionMargin').change!<0||fact('grossRevenue').change!>0&&fact('contribution').change!<0)for(const driver of ['acquisitionCost','modelCost','hostingCost','supportCost','refundRate'])if(fact(driver).change!>0)explanations.push({driver,reason:'Attributable cost/refund increase coincides with contribution/margin deterioration',confidence:current.quality.confidence,causal:false});
  if(!previous)explanations.push({driver:'comparison',reason:'No comparable previous period; change diagnosis unavailable',confidence:0,causal:false});
  return {facts,explanations,contradictions:current.reconciliation.map(r=>`${r.sourceId}: ${r.metric} differs from system of record`),missingEvidence:[...facts.filter(f=>f.current===null).map(f=>f.metric),...current.quality.warnings],eventIds:current.eventIds};
}
export function detectAnomaly(current:AnalyticsReport,history:AnalyticsReport[],metric:string,config:AnalyticsConfig):Omit<AnalyticsAnomaly,'reportKey'|'reportRevision'>|null {
  const value=current.metrics[metric]?.value;if(value===null||value===undefined||current.quality.stale)return null;
  const valid=history.filter(r=>{try{comparable(current,r);return r.metrics[metric]?.value!==null&&!r.quality.stale;}catch{return false;}}).sort((a,b)=>a.scope.period.start.localeCompare(b.scope.period.start));
  if(valid.length<config.anomalyMinHistory)return null;
  const values=valid.map(r=>r.metrics[metric].value!);const median=(a:number[])=>{const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;};const baseline=median(values);
  if(baseline<=0)return null;
  const relativeChange=(value-baseline)/baseline,dispersion=median(values.map(v=>Math.abs(v-baseline)))*1.4826;
  if(Math.abs(relativeChange)<.3||Math.abs(value-baseline)<3*dispersion)return null;
  let consecutive=1;for(const r of [...valid].reverse()){const delta=(r.metrics[metric].value!-baseline)/baseline;if(Math.sign(delta)===Math.sign(relativeChange)&&Math.abs(delta)>=.3)consecutive++;else break;}
  const confidence=Math.min(current.quality.confidence,...valid.map(r=>r.quality.confidence))*Math.min(1,current.quality.sampleSize/config.minSample);
  return {metric,value,baseline,relativeChange,confidence,historySamples:valid.length,consecutive,severity:confidence<.7||consecutive<config.anomalyPersistence?'candidate':Math.abs(relativeChange)>.6?'critical':'material',causal:false};
}
