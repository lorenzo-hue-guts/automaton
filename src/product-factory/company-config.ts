import type { CompanyConfig, OwnerTarget } from './company-types.js';
export const DEFAULT_COMPANY_CONFIG:CompanyConfig = {enabled:false,currency:'EUR',timezone:'Europe/Paris',materialMissRatio:0.8,strategicMissCount:3,minGreenlightLevel:2,maxCapitalCents:0,maxBuilderHours:0,maxComputeUnits:0,forecastHorizons:[4,8,12],reviews:{weekly:true,monthly:true,dailyAnomaliesOnly:true},initialOwnerTargets:[],maxRisk:'material',allowStretch:false};
export function resolveCompanyConfig(raw:unknown=undefined):CompanyConfig {
  if(raw===undefined) return structuredClone(DEFAULT_COMPANY_CONFIG);
  if(!raw || typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid company config');
  for(const k of Object.keys(raw))if(!Object.hasOwn(DEFAULT_COMPANY_CONFIG,k))throw Error(`Unknown company setting: ${k}`);
  const c={...structuredClone(DEFAULT_COMPANY_CONFIG),...raw} as CompanyConfig;
  if(typeof c.enabled!=='boolean'||typeof c.allowStretch!=='boolean'||!/^[A-Z]{3}$/.test(c.currency))throw Error('Invalid company flags/currency');
  new Intl.DateTimeFormat('en',{timeZone:c.timezone});
  for(const n of [c.maxCapitalCents,c.maxBuilderHours,c.maxComputeUnits])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid company capital limits');
  if(!Number.isFinite(c.materialMissRatio)||c.materialMissRatio<=0||c.materialMissRatio>=1||!Number.isSafeInteger(c.strategicMissCount)||c.strategicMissCount<2||!Number.isInteger(c.minGreenlightLevel)||c.minGreenlightLevel<2||c.minGreenlightLevel>5||!['low','material'].includes(c.maxRisk))throw Error('Invalid company evidence/recovery policy');
  if(!Array.isArray(c.forecastHorizons)||!c.forecastHorizons.length||c.forecastHorizons.some(x=>![4,8,12].includes(x))||!c.reviews||typeof c.reviews.weekly!=='boolean'||typeof c.reviews.monthly!=='boolean'||c.reviews.dailyAnomaliesOnly!==true||!Array.isArray(c.initialOwnerTargets))throw Error('Invalid review/forecast config');
  for(const t of c.initialOwnerTargets)validateOwnerTarget(t,c.currency);
  return structuredClone(c);
}
export function validateOwnerTarget(t:OwnerTarget,currency:string):void {
  if(!/^\d{4}-\d{2}-\d{2}T/.test(t.periodStart)||!Number.isFinite(Date.parse(t.periodStart))||!Number.isFinite(Date.parse(t.periodEnd))||Date.parse(t.periodEnd)<=Date.parse(t.periodStart)||t.currency!==currency||!Number.isSafeInteger(t.amountCents)||t.amountCents<0||t.creatorAuthorized!==true||!['grossRevenue','netRevenue','profit'].includes(t.metric)||!t.changeReason?.trim()||!t.metricDefinition?.key||!Number.isSafeInteger(t.metricDefinition.revision)||t.metricDefinition.revision<1)throw Error('Invalid Owner Target');
  new Intl.DateTimeFormat('en',{timeZone:t.timezone});
}
