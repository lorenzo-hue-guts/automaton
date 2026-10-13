import type { AnalyticsConfig } from './analytics-types.js';
export const DEFAULT_ANALYTICS_CONFIG:Readonly<AnalyticsConfig> = Object.freeze({enabled:false,maxBatchEvents:1000,maxPeriodEvents:10000,providerTimeoutMs:10000,freshnessMs:86400000,retentionDays:90,minSample:20,anomalyMinHistory:3,anomalyPersistence:2});
export function resolveAnalyticsConfig(raw?:unknown):AnalyticsConfig {
  if(raw===undefined)return {...DEFAULT_ANALYTICS_CONFIG};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid analytics config');
  for(const key of Object.keys(raw))if(!Object.hasOwn(DEFAULT_ANALYTICS_CONFIG,key))throw Error('Unknown analytics setting');
  const c={...DEFAULT_ANALYTICS_CONFIG,...raw} as AnalyticsConfig;
  if(typeof c.enabled!=='boolean')throw Error('Invalid analytics flag');
  for(const [k,v] of Object.entries(c))if(k!=='enabled'&&(!Number.isSafeInteger(v)||Number(v)<1))throw Error('Invalid analytics limit');
  if(c.maxBatchEvents>10000||c.maxPeriodEvents>100000||c.providerTimeoutMs>60000)throw Error('Analytics bounds exceeded');
  return c;
}
