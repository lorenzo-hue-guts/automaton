import { SURFACE_ACCEPTANCE_KINDS } from './surface-builder-types.js';
import { OPTIMIZATION_KINDS } from './optimization-types.js';
import { ulid } from 'ulid';
import { buildHash } from './build-store.js';
import { insertEvent } from '../state/database.js';
import { estimateTokens } from '../memory/event-stream.js';
import type { AutomatonDatabase } from '../types.js';
import type { CompanyEntityMap, CompanyKind, CompanyRecord } from './company-types.js';
const KINDS=new Set<CompanyKind>([...SURFACE_ACCEPTANCE_KINDS,...OPTIMIZATION_KINDS,'assumptionImpact','company','assumption','claim','confidence','competitor','marketThesis','pattern','businessCase','contract','quality','health','gtm','voice','economicSnapshot','proposal','allocation','target','stretch','forecast','forecastOutcome','metricDefinition','review','mode','portfolio','shadow','graveyard','risk','dependency','causal','scorecard','decisionOutcome','benchmark','capabilityLearning','growthLearning','externalChange','rollback','pulse','experimentPlan']);
const ANALYTICS_KINDS=new Set<CompanyKind>(['analyticsSource','analyticsCoverage','analyticsProvider','analyticsQuarantine','analyticsReport','analyticsFunnelDefinition','analyticsFunnel','analyticsCohortDefinition','analyticsCohort','analyticsAttribution','analyticsUnits','analyticsExperimentProtocol','analyticsExperiment','analyticsDiagnosis','analyticsAnomaly','analyticsDossier']);
export function canonical(value:unknown):string {
  function check(v:unknown):unknown {
    if(v===null||typeof v==='boolean'||typeof v==='string')return v;
    if(typeof v==='number'&&Number.isFinite(v))return v;
    if(Array.isArray(v))return v.map(check);
    if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype)return Object.fromEntries(Object.keys(v).sort().map(k=>[k,check((v as Record<string,unknown>)[k])]));
    throw Error('Company records must be finite plain JSON');
  }
  const s=JSON.stringify(check(value));if(s.length>500_000)throw Error('Company record size limit');return s;
}
/** Typed versioned records on the existing DB. Writes are append-only and transactional. */
export class CompanyStore {
  constructor(readonly db:AutomatonDatabase,readonly creatorAddress:string) {if(!creatorAddress.trim())throw Error('Creator required');}
  get<K extends CompanyKind>(kind:K,key:string,revision?:number):CompanyRecord<K>|undefined {
    if(!KINDS.has(kind)&&!ANALYTICS_KINDS.has(kind))throw Error('Unknown company record kind');
    const row=this.db.raw.prepare(`SELECT * FROM company_records WHERE creator_address=? AND kind=? AND record_key=? ${revision===undefined?'ORDER BY revision DESC LIMIT 1':'AND revision=?'}`).get(...[this.creatorAddress,kind,key,...(revision===undefined?[]:[revision])]) as Record<string,unknown>|undefined;
    if(!row)return undefined;
    if(buildHash(row.content as string)!==row.content_hash)throw Error('Company record integrity failure');
    return {id:row.id as string,key,kind,revision:row.revision as number,creatorAddress:this.creatorAddress,createdAt:row.created_at as string,hash:row.content_hash as string,body:JSON.parse(row.content as string)};
  }
  list<K extends CompanyKind>(kind:K):CompanyRecord<K>[] {
    if(!KINDS.has(kind)&&!ANALYTICS_KINDS.has(kind))throw Error('Unknown company record kind');
    const rows=this.db.raw.prepare('SELECT record_key,MAX(revision) AS revision FROM company_records WHERE creator_address=? AND kind=? GROUP BY record_key ORDER BY record_key').all(this.creatorAddress,kind) as {record_key:string;revision:number}[];
    return rows.map(r=>this.get(kind,r.record_key,r.revision)!);
  }
  append<K extends CompanyKind>(kind:K,key:string,body:CompanyEntityMap[K],expectedRevision=0,at=new Date()):CompanyRecord<K> {
    if((!KINDS.has(kind)&&!ANALYTICS_KINDS.has(kind))||!key.trim()||key.length>200||!Number.isFinite(at.getTime()))throw Error('Invalid company identity/time');
    const content=canonical(body);
    return this.db.raw.transaction(()=>{
      const old=this.get(kind,key);
      // Repeat of the same logical operation is idempotent. Different input is not silently substituted.
      if(old&&canonical(old.body)===content)return old;
      if(old&&['surfaceReceipt','surfacePlan','surfaceProfile','surfaceArtifact','surfaceCapability'].includes(kind))throw Error('Historical surface evidence/plan immutable; create a new identity/version');
      if((old?.revision??0)!==expectedRevision)throw Error('Company revision conflict');
      const record={id:ulid(),key,kind,revision:expectedRevision+1,creatorAddress:this.creatorAddress,createdAt:at.toISOString(),hash:buildHash(content),body:structuredClone(body)};
      this.db.raw.prepare('INSERT INTO company_records(creator_address,kind,record_key,revision,id,created_at,content,content_hash) VALUES(?,?,?,?,?,?,?,?)').run(this.creatorAddress,kind,key,record.revision,record.id,record.createdAt,content,record.hash);
      const audit=JSON.stringify({kind,key,revision:record.revision,hash:record.hash});
      insertEvent(this.db.raw,{type:'company_record',agentAddress:this.creatorAddress,content:audit,tokenCount:estimateTokens(audit)});
      return record;
    }).immediate();
  }
}
