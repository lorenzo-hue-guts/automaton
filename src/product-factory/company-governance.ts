import type { BusinessCase, CompanyFunction, ConfidenceEvaluation, DomainAssessment, ProductContract, QualityAssessment, Range } from './company-types.js';
import type { CompanyStore } from './company-store.js';
import { buildHash } from './build-store.js';
export const DECISION_HIERARCHY=['CONSTITUTION','POLICY_SECURITY_CREATOR_CONSTRAINTS','OWNER_TARGETS_APPROVALS','COMPANY_OS','COMPANY_FUNCTIONS','SPECIALIZED_CAPABILITIES','EXECUTION'];
export interface CouncilInputs {businessCaseKey:string;contractKey:string;contractRevision:number;assessments:DomainAssessment[];claimKeys:string[];reversibility:'EASILY_REVERSIBLE'|'COSTLY_TO_REVERSE'|'EFFECTIVELY_IRREVERSIBLE';capitalCents:number}
export interface CouncilResult {outcome:'GREENLIGHT'|'EXPERIMENT'|'RESEARCH_MORE'|'REJECT'|'HOLD';reasons:string[];disagreements:string[];evidenceIds:string[]}
export function assessCouncil(b:BusinessCase,c:ProductContract,assessments:DomainAssessment[],claims:ConfidenceEvaluation[],strongEvidence:boolean,distributionEvidence:boolean,irreversible:boolean):CouncilResult {
  const reasons:string[]=[],disagreements=assessments.flatMap(a=>a.disagreements),evidenceIds=[...new Set([...b.evidenceIds,...c.evidenceIds,...assessments.flatMap(a=>a.evidenceIds),...claims.flatMap(a=>[...a.supportingIds,...a.refutingIds])])];
  const badEconomics=!!b.servingCost&&!!b.pricing.price&&b.servingCost.low>=b.pricing.price.high;
  const reject=badEconomics||b.preMortem.some(r=>r.severity==='fatal')||b.pricing.model==='do_not_build';
  const blockers=assessments.filter(a=>a.blocking);
  if(!b.servingCost||!b.pricing.price)reasons.push('Serving costs/pricing unknown; viability cannot be asserted');
  if(badEconomics)reasons.push('Serving-cost range consumes plausible price before acquisition');
  if(reject)reasons.push('Fatal pre-mortem risk or do-not-build business model');
  if(blockers.length)reasons.push(`Blocking assessments: ${blockers.map(a=>a.function).join(', ')}`);
  if(!strongEvidence)reasons.push('Fresh economic/buyer evidence insufficient; complaints alone do not justify material investment');
  if(!distributionEvidence||!b.reachBuyers.trim())reasons.push('Distribution to qualified prospects unproven');
  if(claims.some(a=>a.stale||a.contradictions.length||a.confidence<0.25))reasons.push('Judge contradictions/uncertainty remain');
  if(irreversible&&!strongEvidence)reasons.push('Irreversibility needs stronger evidence');
  if(b.pricing.model.includes('subscription')&&!b.pricing.recurringValue?.trim())reasons.push('Recurring value thesis missing');
  const outcome=reject?'REJECT':blockers.length?'HOLD':reasons.length?(b.experiments.length?'EXPERIMENT':'RESEARCH_MORE'):'GREENLIGHT';
  return {outcome,reasons:reasons.length?reasons:['Evidence-backed bounded private investment; creator approval and quality gates remain required'],disagreements,evidenceIds};
}
export function qualityResult(contract:ProductContract,assessment:QualityAssessment):{passed:boolean;errors:string[]} {
  const errors:string[]=[];
  for(const gate of contract.gates) {
    const actual=assessment.gates.find(g=>g.gate===gate.gate);
    if(gate.required&&actual?.status!=='PASS')errors.push(`${gate.gate}: ${actual?.status??'INSUFFICIENT_EVIDENCE'}`);
    if(actual?.status==='NOT_APPLICABLE'&&gate.required)errors.push(`${gate.gate}: required criterion cannot be discarded`);
  }
  return {passed:!errors.length,errors};
}
export function contractReference(record:{key:string;revision:number;hash:string}) {return {key:record.key,revision:record.revision,hash:record.hash};}
export function claimInputHash(value:unknown):string{return buildHash(JSON.stringify(value));}
export function allowedFunction(kind:string):CompanyFunction[] {
  if(['quality','contract','health','dependency'].includes(kind))return ['BUILDER','ENTREPRENEUR'];
  if(['gtm','growthLearning','voice'].includes(kind))return ['GROWTH','ENTREPRENEUR'];
  if(['claim','confidence','economicSnapshot','forecastOutcome','metricDefinition','causal','benchmark','scorecard'].includes(kind))return ['JUDGE'];
  return ['ENTREPRENEUR'];
}
export function cheapestInformation(b:BusinessCase):BusinessCase['experiments'][number]|null {
  return [...b.experiments].filter(e=>e.informationValue.low>0).sort((a,b)=>a.costCents-b.costCents||a.builderHours-b.builderHours||a.key.localeCompare(b.key))[0]??null;
}
export function rangeValid(r:Range):boolean{return Number.isFinite(r.low)&&Number.isFinite(r.high)&&r.low<=r.high&&typeof r.unit==='string'&&r.unit.length>0&&Number.isFinite(r.confidence)&&r.confidence>=0&&r.confidence<=1&&Array.isArray(r.evidenceIds)&&Array.isArray(r.assumptionIds);}
