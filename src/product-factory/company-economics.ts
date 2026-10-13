import type { CapitalProposal, EconomicMetric, EconomicSnapshot, MetricValue, Range } from './company-types.js';
export const ECONOMIC_METRICS:EconomicMetric[]=['grossRevenue','refunds','netRevenue','paymentFees','acquisitionCost','modelCost','hostingCost','variableCost','supportCost','operatingCost','contribution','profit','cash','committedCapital'];
export const unknownMetric=(unit:string,reason='Data unavailable'):MetricValue=>({value:null,unit,nature:'UNKNOWN',evidenceIds:[],confidence:0,reason});
export function calculateMetric(inputs:MetricValue[],unit:string,operation:(values:number[])=>number):MetricValue {
  if(inputs.some(m=>m.value===null||m.nature==='UNKNOWN'))return unknownMetric(unit,'Required input unknown');
  const values=inputs.map(m=>m.value!);const value=operation(values);
  if(!Number.isFinite(value))return unknownMetric(unit,'Calculation undefined');
  const nature=inputs.some(m=>m.nature==='SYNTHETIC')?'SYNTHETIC':inputs.every(m=>['FACT','CALCULATED_FROM_OBSERVED_DATA'].includes(m.nature))?'CALCULATED_FROM_OBSERVED_DATA':'ESTIMATE';
  return {value,unit,nature,evidenceIds:[...new Set(inputs.flatMap(m=>m.evidenceIds))].sort(),confidence:Math.min(...inputs.map(m=>m.confidence))};
}
/** Attributable cost buckets must be disjoint; missing costs are not zero. */
export function deriveEconomics(input:EconomicSnapshot):EconomicSnapshot {
  const s=structuredClone(input),m=s.metrics,unit=`${s.currency}:cents`;
  m.netRevenue=calculateMetric([m.grossRevenue,m.refunds],unit,([gross,refunds])=>gross-refunds);
  m.contribution=calculateMetric([m.netRevenue,...(['paymentFees','acquisitionCost','modelCost','hostingCost','variableCost','supportCost'] as const).map(k=>m[k])],unit,([net,...costs])=>net-costs.reduce((a,b)=>a+b,0));
  m.profit=calculateMetric([m.contribution,m.operatingCost],unit,([c,o])=>c-o);
  for(const k of ['netRevenue','contribution','profit'] as const)if(input.metrics[k].definition)m[k].definition=input.metrics[k].definition;
  return s;
}
export function accessibleRevenue(customers:Range,penetration:Range,revenuePerCustomer:Range):Range {
  if(customers.low<0||penetration.low<0||penetration.high>1||revenuePerCustomer.low<0)throw Error('Invalid accessible revenue assumptions');
  return {low:customers.low*penetration.low*revenuePerCustomer.low,high:customers.high*penetration.high*revenuePerCustomer.high,unit:revenuePerCustomer.unit,confidence:Math.min(customers.confidence,penetration.confidence,revenuePerCustomer.confidence),assumptionIds:[...new Set([...customers.assumptionIds,...penetration.assumptionIds,...revenuePerCustomer.assumptionIds])],evidenceIds:[...new Set([...customers.evidenceIds,...penetration.evidenceIds,...revenuePerCustomer.evidenceIds])]};
}
export function revenueGap(target:number,forecast:Range|null):Range|null {return forecast?{...forecast,low:target-forecast.high,high:target-forecast.low}:null;}
export function runway(capital:MetricValue,burn:MetricValue,committed:MetricValue,safetyMargin:number):MetricValue {
  return calculateMetric([capital,burn,committed],'months',([c,b,k])=>b>0?Math.max(0,c-k-safetyMargin)/b:NaN);
}
export interface AllocationComparison {key:string;eligible:boolean;reason:string;conservativeExpectedProfit:number;returnOnCapital:number|null;returnOnBuilderHour:number|null;capitalCents:number;builderHours:number;computeUnits:number;downsideCents:number;confidence:number;priority:'PROTECT'|'ORDINARY';assumptions:string[];riskKeys:string[]}
/** Heuristic comparison preserves factors and uncertainty. Historical sunk cost is deliberately excluded. */
export function compareCapital(proposals:{key:string;body:CapitalProposal}[],capacity:{capitalCents:number;builderHours:number;computeUnits:number;crisis:boolean}):AllocationComparison[] {
  const rows=proposals.map(({key,body:p}):AllocationComparison=>{
    const marginal=p.marginalContribution??p.expectedProfit;
    const expected=marginal.low*p.successProbability.low*p.confidence-p.downsideCents;
    const feasible=p.capitalCents<=capacity.capitalCents&&p.builderHours<=capacity.builderHours&&p.computeUnits<=capacity.computeUnits;
    return {key,eligible:feasible&&expected>0,reason:!feasible?'Insufficient capital/Builder/compute':expected<=0?'Conservative marginal return not positive':'Compare marginal durable profit, opportunity cost and risk; estimates are not facts',conservativeExpectedProfit:expected,returnOnCapital:p.capitalCents?expected/p.capitalCents:null,returnOnBuilderHour:p.builderHours?expected/p.builderHours:null,capitalCents:p.capitalCents,builderHours:p.builderHours,computeUnits:p.computeUnits,downsideCents:p.downsideCents,confidence:p.confidence,priority:capacity.crisis&&p.action==='PROTECT'?'PROTECT':'ORDINARY',assumptions:p.assumptionIds,riskKeys:p.riskKeys};
  });
  return rows.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||Number(b.priority==='PROTECT')-Number(a.priority==='PROTECT')||b.conservativeExpectedProfit-a.conservativeExpectedProfit||(b.returnOnBuilderHour??Infinity)-(a.returnOnBuilderHour??Infinity)||a.key.localeCompare(b.key));
}
export function forecastCalibration(outcomes:{direction:string;inRange:boolean|null}[]):{confidenceFactor:number;optimistic:number;pessimistic:number;samples:number} {
  const known=outcomes.filter(o=>o.inRange!==null),optimistic=known.filter(o=>o.direction==='optimistic').length,pessimistic=known.filter(o=>o.direction==='pessimistic').length;
  return {confidenceFactor:known.length?Math.max(0.1,1-(optimistic+pessimistic)/(known.length+1)):1,optimistic,pessimistic,samples:known.length};
}
