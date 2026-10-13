import type { AutomatonDatabase } from '../types.js';
import { EvidenceEngine } from './evidence-engine.js';
import type { DiscoverySignal, AtomicEvidence } from './discovery-types.js';
import type { Claim, ConfidenceEvaluation, EvidenceGovernance, EvidenceLevel, EvidenceOrigin } from './company-types.js';
import { CompanyStore,canonical } from './company-store.js';
export interface CompanyEvidenceProvider { id:string; origin:EvidenceOrigin; /** Trusted connector verification, not generated/external content. */ verify?(signal:DiscoverySignal,governance:EvidenceGovernance):boolean }
export class CompanyEvidence {
  private readonly providers:Map<string,CompanyEvidenceProvider>;
  constructor(readonly store:CompanyStore,providers:readonly CompanyEvidenceProvider[],private readonly enabled:boolean,private readonly clock:()=>Date=()=>new Date()) {this.providers=new Map(providers.map(p=>[p.id,p]));if(this.providers.size!==providers.length)throw Error('Duplicate evidence provider');}
  ingest(providerId:string,signal:DiscoverySignal,g:EvidenceGovernance):AtomicEvidence {
    if(!this.enabled)throw Error('Company OS disabled');
    const provider=this.providers.get(providerId);
    if(!provider||provider.origin!==g.origin||!Number.isInteger(g.level)||g.level<0||g.level>5||!Number.isFinite(Date.parse(g.expiresAt))||Date.parse(g.expiresAt)<=Date.parse(signal.capturedAt)||!g.verificationRef?.trim()||!['problem','money_flow','buyer','distribution','retention','economics','quality','risk'].includes(g.aspect))throw Error('Invalid evidence governance/provider');
    if(g.origin==='model'&&g.level!==0||g.origin==='synthetic'&&g.level!==1||g.origin==='public'&&g.level!==2||g.origin==='observed'&&g.level<3)throw Error('Synthetic/model evidence cannot masquerade as economic behavior');
    if(['public','observed'].includes(g.origin)&&(!provider.verify||!provider.verify(signal,g)))throw Error('Trusted evidence verification required');
    if(g.productId&&this.store.db.productFactory.get('products',g.productId)?.creatorAddress!==this.store.creatorAddress)throw Error('Foreign evidence product scope');
    if(g.measurements&&Object.values(g.measurements).some(v=>!Number.isFinite(v)))throw Error('Invalid evidence measurements');
    if(g.currency&&!/^[A-Z]{3}$/.test(g.currency))throw Error('Invalid evidence currency');
    return this.store.db.raw.transaction(()=>{
      const result=new EvidenceEngine(this.store.db,this.store.creatorAddress,true).ingest(providerId,signal);
      const old=this.store.db.productFactory.get('evidence',result.evidence.id)?.company;
      if(old&&JSON.stringify(old)!==JSON.stringify(g))throw Error('Duplicate evidence cannot change economic classification');
      if(!old)this.store.db.raw.prepare('UPDATE factory_evidence SET company_metadata=? WHERE id=?').run(JSON.stringify(g),result.evidence.id);
      return this.store.db.productFactory.getAtomicEvidence(result.evidence.id)!;
    }).immediate();
  }
  require(id:string):AtomicEvidence {
    const e=this.store.db.productFactory.getAtomicEvidence(id),o=e&&this.store.db.productFactory.getDiscoveryOpportunity(e.opportunityId);
    if(!e||o?.discovery.creatorAddress!==this.store.creatorAddress)throw Error('Unknown/foreign evidence');return e;
  }
  effectiveLevel(e:AtomicEvidence,now:Date):EvidenceLevel|null {return e.company&&Date.parse(e.company.expiresAt)>now.getTime()&&Date.parse(e.provenance.capturedAt)<=now.getTime()?e.company.level:null;}
  evaluate(key:string,now=this.clock()):ConfidenceEvaluation {
    const record=this.store.get('claim',key);if(!record)throw Error('Unknown claim');
    const claim:Claim=record.body,ev=claim.evidenceIds.map(id=>this.require(id));
    const fresh=ev.filter(e=>this.effectiveLevel(e,now)!==null);
    const dominant=fresh.length?Math.max(...fresh.map(e=>e.company!.level)):-1;
    // Independent sources only. Highest evidence tier dominates opinions/synthetic praise.
    const independent=new Map<string,AtomicEvidence>();for(const e of fresh.filter(e=>e.company!.level===dominant)){const previous=independent.get(e.provenance.independenceKey);if(!previous||e.provenance.reliability>previous.provenance.reliability)independent.set(e.provenance.independenceKey,e);}
    const relevant=[...independent.values()],support=relevant.filter(e=>e.provenance.relation==='supports').reduce((a,e)=>a+e.provenance.reliability,0),refute=relevant.filter(e=>e.provenance.relation==='refutes').reduce((a,e)=>a+e.provenance.reliability,0);
    const assumptions=Object.fromEntries(claim.assumptionIds.map(id=>[id,this.store.get('assumption',id)?.revision??0]));
    const previous=this.store.get('confidence',key),changed=JSON.stringify(claim.assumptionVersions??{})!==JSON.stringify(assumptions);
    const invalid=claim.assumptionIds.some(id=>{const a=this.store.get('assumption',id)?.body;return !a||a.status!=='valid'||Date.parse(a.expiresAt)<=now.getTime();});
    const stale=invalid||changed||fresh.length<ev.length;
    const confidence=Math.max(0,Math.min(1,support/(support+refute+1)*(dominant+1)/6*(stale?0.5:1)));
    const result:ConfidenceEvaluation={claimKey:key,claimRevision:record.revision,evaluatedAt:now.toISOString(),confidence,stale,supportingIds:ev.filter(e=>e.provenance.relation==='supports').map(e=>e.id),refutingIds:ev.filter(e=>e.provenance.relation==='refutes').map(e=>e.id),contradictions:ev.filter(e=>e.provenance.relation==='refutes').map(e=>e.id),assumptionVersions:assumptions,explanation:[`Dominant fresh evidence level ${dominant}; ${relevant.length} independent sources`,'Confidence is a heuristic, not scientific certainty',...(stale?['Evidence/assumptions expired, changed or invalid']:[])]};
    if(previous&&canonical({...previous.body,evaluatedAt:''})===canonical({...result,evaluatedAt:''}))return previous.body;
    this.store.append('confidence',key,result,previous?.revision??0,now);return result;
  }
}
