import type { AnalyticsBatch,AnalyticsInput,AnalyticsProvider,AnalyticsSource } from './analytics-types.js';
/** Production connector port. Inject an authorized read-only SDK/transport and receipt verifier. */
export class ReadOnlyAnalyticsProvider implements AnalyticsProvider {
  constructor(readonly source:AnalyticsSource,private readonly ports:{read:(cursor:string|null,signal:AbortSignal)=>Promise<AnalyticsBatch>;normalize:(raw:unknown)=>AnalyticsInput;verify:(raw:unknown,input:AnalyticsInput)=>{verified:boolean;receiptRef:string};verifyCoverage:(batch:AnalyticsBatch)=>boolean}) {if(source.mode!=='read-only')throw Error('Read-only source required');}
  collect({cursor,signal}:{cursor:string|null;signal:AbortSignal}){return this.ports.read(cursor,signal);}
  normalize(raw:unknown){return this.ports.normalize(raw);}
  verify(raw:unknown,input:AnalyticsInput){return this.ports.verify(raw,input);}
  verifyCoverage(batch:AnalyticsBatch){return this.ports.verifyCoverage(batch);}
}
/** Offline fixtures can NEVER declare observed purchase/user behavior. */
export class SyntheticAnalyticsProvider implements AnalyticsProvider {
  readonly source:AnalyticsSource;
  constructor(source:Omit<AnalyticsSource,'mode'|'nature'>,private readonly batches:AnalyticsBatch[]){this.source={...source,mode:'fixture',nature:'SYNTHETIC'};}
  async collect({cursor,signal}:{cursor:string|null;signal:AbortSignal}) {if(signal.aborted)throw Error('Aborted');return structuredClone(this.batches[Number(cursor??0)]??{events:[],cursor:null,coverage:[]});}
  normalize(raw:unknown){return structuredClone(raw) as AnalyticsInput;}
}
