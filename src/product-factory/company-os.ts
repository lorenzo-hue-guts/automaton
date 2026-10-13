import { assertSurfaceQuality } from './surface-acceptance.js';
import { SURFACE_ACCEPTANCE_KINDS } from './surface-builder-types.js';
import { OPTIMIZATION_KINDS } from './optimization-types.js';
import { ulid } from 'ulid';
import { getTaskById } from '../state/database.js';
import type { FactoryOrchestrator } from './factory-orchestrator.js';
import type { CompanyAdmission } from './company-policy.js';
import { CompanyStore, canonical } from './company-store.js';
import { CompanyEvidence, type CompanyEvidenceProvider } from './company-evidence.js';
import { resolveCompanyConfig, validateOwnerTarget } from './company-config.js';
import { COMPANY_CAPABILITIES, COMPANY_FUNCTIONS, COMPANY_MISSION, BUSINESS_MODELS, QUALITY_GATES, REVIEW_CLASSES, RISK_TYPES } from './company-types.js';
import type { CompanyConfig,CompanyEntityMap,CompanyKind,CompanyRecord,CompanyFunction,DecisionMetadata,ProductContract,CapitalAllocation,QualityAssessment,MetricValue,OwnerTarget,Forecast,CompanyScorecard,DomainAssessment,FrozenDossier } from './company-types.js';
import { DECISION_HIERARCHY,allowedFunction,assessCouncil,cheapestInformation,qualityResult,rangeValid,type CouncilInputs } from './company-governance.js';
import { accessibleRevenue,compareCapital,deriveEconomics,ECONOMIC_METRICS,forecastCalibration,revenueGap,unknownMetric } from './company-economics.js';
import { buildHash,BuildStore } from './build-store.js';
import { OpportunityEngine } from './opportunity-engine.js';
import { ProductBriefEngine } from './product-brief.js';
import { companyProductUsage,companyEvidenceDigest } from './company-guards.js';
import type { Decision,JsonValue } from './types.js';
import type { ProductBrief } from './build-types.js';
export type CompanyActor=CompanyFunction|'CREATOR';
const protectedKinds=new Set<CompanyKind>(['company','target','stretch','contract','allocation','economicSnapshot','forecastOutcome','review','mode','portfolio','confidence','scorecard','quality','experimentPlan']);
/** Synchronous governance/domain facade. No timer, worker, external call or second execution loop. */
export class CompanyOperatingSystem {
  readonly store:CompanyStore;readonly evidence:CompanyEvidence;readonly config:CompanyConfig;
  private readonly admission:CompanyAdmission;
  private readonly clock:()=>Date;
  constructor(readonly factory:FactoryOrchestrator,options:{config?:unknown;admission?:CompanyAdmission;providers?:CompanyEvidenceProvider[];clock?:()=>Date}={}) {
    this.store=new CompanyStore(factory.database,factory.creatorAddress);
    this.clock=options.clock??(()=>new Date());this.admission=options.admission??(()=>({allowed:false,reason:'Company policy admission is not configured'}));
    const persisted=this.store.get('company','operating-model');
    this.config=resolveCompanyConfig(options.config??persisted?.body.config??factory.resources.config.company);
    freeze(this.config);
    if(persisted&&options.config&&canonical(persisted.body.config)!==canonical(this.config))throw Error('Company config changes require explicit creator action');
    this.evidence=new CompanyEvidence(this.store,options.providers??[],this.config.enabled&&factory.resources.config.enabled,this.clock);
    if(this.config.enabled&&factory.resources.config.enabled&&!persisted) {
      this.store.append('company','operating-model',{mission:COMPANY_MISSION,objective:'durable-risk-adjusted-portfolio-profit-and-customer-value',creatorAddress:factory.creatorAddress,config:this.config,functions:COMPANY_FUNCTIONS,capabilities:COMPANY_CAPABILITIES,hierarchy:DECISION_HIERARCHY,operatingLoop:['MAKE','GROW','PROTECT','REINVEST']},0,this.clock());
      for(const t of this.config.initialOwnerTargets) {
        if(!this.store.get('metricDefinition',t.metricDefinition.key))this.store.append('metricDefinition',t.metricDefinition.key,{name:t.metric,unit:`${t.currency}:cents`,kind:'RESULT',formula:'Observed monetary value by occurrence in the fixed target period',includes:[t.metric],excludes:['synthetic','unpaid_trials'],changeReason:'Creator initial target configuration'},0,this.clock());
        this.ownerTarget(`initial:${t.periodStart}`,t,'CREATOR');
      }
    }
  }
  private enabled():void {const current=this.store.get('company','operating-model');if(current&&canonical(current.body.config)!==canonical(this.config))throw Error('Company configuration changed; reload domain facade');if(!(this.store.get('company','operating-model')?.body.config.enabled??this.config.enabled)||!this.config.enabled||!this.factory.resources.config.enabled)throw Error('Company OS / Product Factory disabled');}
  private owns(productId:string):void {if(!this.factory.portfolio.get(productId))throw Error('Unknown/foreign company product');}
  private validateReferences(body:unknown):void {
    const walk=(v:unknown):void=>{
      if(!v||typeof v!=='object')return;
      if(Array.isArray(v)){v.forEach(walk);return;}
      const o=v as Record<string,unknown>;
      if('low'in o&&'high'in o&&!rangeValid(o as unknown as Parameters<typeof rangeValid>[0]))throw Error('Invalid uncertain range');
      if(typeof o.expiresAt==='string'&&!Number.isFinite(Date.parse(o.expiresAt)))throw Error('Invalid evidence/assumption freshness');
      if((o.unit==='probability'||o.unit==='fraction')&&(Number(o.low)<0||Number(o.high)>1))throw Error('Invalid probability range');
      if('confidence'in o&&(typeof o.confidence!=='number'||!Number.isFinite(o.confidence)||o.confidence<0||o.confidence>1))throw Error('Invalid confidence');
      if(Array.isArray(o.evidenceIds))for(const id of o.evidenceIds)this.evidence.require(String(id));
      if(Array.isArray(o.assumptionIds))for(const id of o.assumptionIds)if(!this.store.get('assumption',String(id)))throw Error('Unknown critical assumption');
      if(typeof o.productId==='string')this.owns(o.productId);
      if(typeof o.opportunityId==='string'&&this.store.db.productFactory.getDiscoveryOpportunity(o.opportunityId)?.discovery.creatorAddress!==this.factory.creatorAddress)throw Error('Unknown/foreign company opportunity');
      Object.values(o).forEach(walk);
    };canonical(body);walk(body);
  }
  record<K extends CompanyKind>(kind:K,key:string,body:CompanyEntityMap[K],actor:CompanyActor,expectedRevision=0):CompanyRecord<K> {
    this.enabled();if(protectedKinds.has(kind)||kind.startsWith('analytics')||(SURFACE_ACCEPTANCE_KINDS as readonly string[]).includes(kind)||(OPTIMIZATION_KINDS as readonly string[]).includes(kind))throw Error('Use guarded company workflow');
    if(actor!=='CREATOR'&&!allowedFunction(kind).includes(actor))throw Error('Company decision rights denied');
    this.validateReferences(body);
    if(kind==='businessCase'){const b=body as CompanyEntityMap['businessCase'];if(!b.buyer.buyer?.trim()||!b.problem?.trim()||!b.wedge?.trim()||!BUSINESS_MODELS.includes(b.pricing.model))throw Error('Incomplete business case');accessibleRevenue(b.accessibleRevenue.customers,b.accessibleRevenue.penetration,b.accessibleRevenue.revenuePerCustomer);}
    if(kind==='gtm'){const g=body as CompanyEntityMap['gtm'];if(g.execution!=='disabled'||!g.firstQualifiedProspects?.trim()||!Number.isSafeInteger(g.budgetCents)||g.budgetCents<0)throw Error('GTM is planning only');}
    if(kind==='competitor'&&(body as CompanyEntityMap['competitor']).reviews.some(r=>!REVIEW_CLASSES.includes(r.classification)))throw Error('Unknown review classification');
    if(kind==='pattern'&&(body as CompanyEntityMap['pattern']).copyingPermitted!==false)throw Error('Proprietary copying forbidden');
    if(kind==='risk'&&!RISK_TYPES.includes((body as CompanyEntityMap['risk']).type))throw Error('Unknown risk class');
    if(kind==='causal'){const c=body as CompanyEntityMap['causal'];if(c.causalClaim==='supported'&&c.method==='observational')throw Error('Correlation cannot self-certify causation');}
    if(kind==='proposal'){const p=body as CompanyEntityMap['proposal'];for(const n of [p.capitalCents,p.builderHours,p.computeUnits,p.downsideCents,p.upsideCents,p.historicalSpendCents])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid capital resources');if(p.successProbability.low<0||p.successProbability.high>1)throw Error('Invalid success probability');}
    if(kind==='capabilityLearning') {const learning=body as CompanyEntityMap['capabilityLearning'];if(!learning.evidenceIds.length||['FACT','CALCULATED_FROM_OBSERVED_DATA'].includes(learning.nature)&&!learning.evidenceIds.some(id=>(this.evidence.effectiveLevel(this.evidence.require(id),this.clock())??-1)>=3))throw Error('Capability learning needs evidence, not agent belief');}
    if(kind==='health')throw Error('Use guarded Product Health');
    if(kind==='metricDefinition'&&!(body as CompanyEntityMap['metricDefinition']).changeReason?.trim())throw Error('Metric definition changes must be explained');
    if(kind==='claim'){const claim=body as CompanyEntityMap['claim'];claim.assumptionVersions=Object.fromEntries(claim.assumptionIds.map(id=>[id,this.store.get('assumption',id)!.revision]));}
    return this.store.append(kind,key,body,expectedRevision,this.clock());
  }
  decide(key:string,outcome:string,rationale:string,input:{productId?:string|null;opportunityId?:string;evidenceIds:string[];assumptionIds?:string[];versions?:Record<string,number>;contradictions?:string[];alternatives?:string[];expectedOutcome?:string;inputs?:JsonValue;reversibility?:DecisionMetadata['reversibility'];approvalId?:string|null;capitalCents?:number},actor:CompanyActor='ENTREPRENEUR'):Decision {
    this.enabled();if(actor!=='ENTREPRENEUR'&&actor!=='CREATOR')throw Error('Entrepreneur owns company business decisions');
    if(input.opportunityId&&this.store.db.productFactory.getDiscoveryOpportunity(input.opportunityId)?.discovery.creatorAddress!==this.factory.creatorAddress)throw Error('Unknown/foreign decision opportunity');
    if(input.productId)this.owns(input.productId);input.evidenceIds.forEach(id=>this.evidence.require(id));
    const old=this.store.db.raw.prepare("SELECT id FROM factory_decisions WHERE json_extract(company_metadata,'$.logicalKey')=? AND json_extract(company_metadata,'$.owner')=?").get(key,this.factory.creatorAddress) as {id:string}|undefined;
    const policy=this.admission({action:outcome,productId:input.productId??null,capitalCents:input.capitalCents??0,externalExecution:false});
    const metadata:DecisionMetadata={function:'ENTREPRENEUR',owner:this.factory.creatorAddress,logicalKey:key,evidenceIds:input.evidenceIds,assumptionIds:input.assumptionIds??[],rationale,confidence:Math.min(1,...input.evidenceIds.map(id=>this.evidence.require(id).provenance.reliability)),versions:{...input.versions,...Object.fromEntries((input.assumptionIds??[]).map(id=>[`assumption:${id}`,this.store.get('assumption',id)?.revision??0]))},inputs:input.inputs??null,contradictions:input.contradictions??[],alternatives:input.alternatives??[],expectedOutcome:input.expectedOutcome??outcome,policy,approvalId:input.approvalId??null,reversibility:input.reversibility??'EASILY_REVERSIBLE',rights:DECISION_HIERARCHY};
    this.validateReferences(metadata);
    const record:Decision={id:ulid(),productId:input.productId??null,...(input.opportunityId?{opportunityId:input.opportunityId}:{}),rationale,evidenceIds:input.evidenceIds,outcome:policy.allowed?outcome:'HOLD',createdAt:this.clock().toISOString(),company:metadata};
    if(old){const previous=this.store.db.productFactory.get('decisions',old.id)!;if(previous.outcome!==record.outcome||canonical(previous.company)!==canonical(metadata))throw Error('Logical company decision inputs changed');return previous;}
    return this.store.db.raw.transaction(()=>{
      this.store.db.productFactory.insert('decisions',record);
      return this.store.db.productFactory.get('decisions',record.id)!;
    }).immediate();
  }
  ownerTarget(key:string,target:OwnerTarget,actor:CompanyActor,expectedRevision=0):CompanyRecord<'target'> {
    this.enabled();if(actor!=='CREATOR')throw Error('Only creator may impose/change Owner Targets');
    validateOwnerTarget(target,this.config.currency);
    const definition=this.store.get('metricDefinition',target.metricDefinition.key,target.metricDefinition.revision);
    if(!definition||definition.body.kind!=='RESULT'||definition.body.unit!==`${target.currency}:cents`)throw Error('Versioned monetary result metric required');
    const old=this.store.get('target',key);
    if(old&&canonical(old.body)===canonical(target))return old;
    if(!old&&Date.parse(target.periodStart)<=this.clock().getTime())throw Error('Targets must be imposed before the target period/results');
    if(old&&(Date.parse(old.body.periodStart)<=this.clock().getTime()||this.store.list('review').some(r=>r.body.dossier.target.key===key)))throw Error('Historical Owner Target immutable');
    if(old&&(old.body.periodStart!==target.periodStart||old.body.periodEnd!==target.periodEnd||canonical(old.body.metricDefinition)!==canonical(target.metricDefinition)))throw Error('Target periods/measurement cannot be silently moved');
    const overlap=this.store.list('target').some(t=>t.key!==key&&t.body.metric===target.metric&&Date.parse(t.body.periodStart)<Date.parse(target.periodEnd)&&Date.parse(target.periodStart)<Date.parse(t.body.periodEnd));
    if(overlap)throw Error('Duplicate/overlapping Owner Target period');
    return this.store.append('target',key,target,expectedRevision,this.clock());
  }
  createContract(key:string,body:ProductContract,actor:CompanyActor,expectedRevision=0):CompanyRecord<'contract'> {
    this.enabled();if(!['ENTREPRENEUR','CREATOR'].includes(actor)||body.status!=='draft'||body.authorizedBy!=='ENTREPRENEUR')throw Error('Contract revisions require Entrepreneur/creator workflow');
    this.validateReferences(body);
    if(this.factory.resources.config.optimization?.enabled&&!body.surfaceDecision)throw Error('Product Surface decision required for new optimization-era contracts');
    if(body.surfaceDecision){const r=this.store.get('productSurfaceDecision',body.surfaceDecision.key,body.surfaceDecision.revision);if(!r||r.hash!==body.surfaceDecision.hash||r.body.productId!==body.productId||r.body.opportunityId!==body.opportunityId)throw Error('Exact owned Product Surface decision required');}
    if(!body.changeReason?.trim()||!body.desiredOutcome?.trim()||!body.mainJourney?.trim()||!body.acceptanceCriteria.length||!body.gates.length||body.gates.some(g=>!QUALITY_GATES.includes(g.gate)||typeof g.required!=='boolean'||typeof g.requiresBrowser!=='boolean'||!Number.isInteger(g.minimumLevel)||g.minimumLevel<0||g.minimumLevel>5||!g.criterion.trim())||new Set(body.gates.map(g=>g.gate)).size!==body.gates.length)throw Error('Incomplete Product Contract');
    const b=this.store.get('businessCase',body.businessCaseKey,body.businessCaseRevision);
    if(!b||b.body.opportunityId!==body.opportunityId||!this.store.get('gtm',body.gtmKey))throw Error('Contract needs exact Business Case and GTM');
    const product=this.factory.portfolio.get(body.productId)!;
    if(product.opportunityId&&product.opportunityId!==body.opportunityId)throw Error('Product already belongs to another opportunity');
    this.store.db.raw.prepare('UPDATE factory_products SET opportunity_id=? WHERE id=?').run(body.opportunityId,body.productId);
    const record=this.store.append('contract',key,body,expectedRevision,this.clock());
    this.store.db.setKV(`product-factory:company-product:${body.productId}`,key);
    return record;
  }
  council(key:string,input:CouncilInputs):Decision {
    this.enabled();
    return this.store.db.raw.transaction(()=>{
      const b=this.store.get('businessCase',input.businessCaseKey),c=this.store.get('contract',input.contractKey,input.contractRevision);
      if(!b||!c||c.body.businessCaseKey!==b.key||c.body.businessCaseRevision!==b.revision||this.store.get('contract',c.key)?.revision!==c.revision)throw Error('Council inputs stale/mismatched');
      if(input.assessments.length!==4||new Set(input.assessments.map(a=>a.function)).size!==4||input.assessments.some(a=>!COMPANY_FUNCTIONS.includes(a.function)))throw Error('Four concise independent assessments required');
      const evaluations=input.claimKeys.map(k=>this.evidence.evaluate(k,this.clock()));
      const evidence=b.body.evidenceIds.map(id=>this.evidence.require(id));
      const requiredLevel=input.reversibility==='EFFECTIVELY_IRREVERSIBLE'?Math.max(4,this.config.minGreenlightLevel):this.config.minGreenlightLevel;
      const strong=evidence.some(e=>e.company?.aspect==='money_flow'&&(this.evidence.effectiveLevel(e,this.clock())??-1)>=requiredLevel&&e.provenance.relation==='supports')&&evidence.some(e=>e.company?.aspect==='buyer'&&(this.evidence.effectiveLevel(e,this.clock())??-1)>=2&&e.provenance.relation==='supports');
      const distribution=evidence.some(e=>e.company?.aspect==='distribution'&&(this.evidence.effectiveLevel(e,this.clock())??-1)>=2&&e.provenance.relation==='supports');
      const result=assessCouncil(b.body,c.body,input.assessments,evaluations,strong,distribution,input.reversibility==='EFFECTIVELY_IRREVERSIBLE');
      const market=this.store.get('marketThesis',b.body.marketThesisKey)?.body;
      if(market?.competitiveResponse.risk==='fatal'){result.outcome='REJECT';result.reasons.push('Fatal platform/competitive response risk');}
      if(this.config.maxRisk==='low'&&b.body.preMortem.some(r=>r.severity==='material')&&result.outcome==='GREENLIGHT'){result.outcome='HOLD';result.reasons.push('Risk exceeds creator boundary');}
      const allEvidence=this.store.db.productFactory.listAtomicEvidence(c.body.opportunityId);
      const judgeRefutes=allEvidence.filter(e=>e.company&&this.evidence.effectiveLevel(e,this.clock())!==null&&e.provenance.relation==='refutes'&&e.company.level>=this.config.minGreenlightLevel);
      if(judgeRefutes.length){result.evidenceIds=[...new Set([...result.evidenceIds,...judgeRefutes.map(e=>e.id)])];result.disagreements.push(...judgeRefutes.map(e=>e.id));result.reasons.push('Fresh contradictory evidence cannot be discarded');if(result.outcome==='GREENLIGHT')result.outcome=b.body.experiments.length?'EXPERIMENT':'RESEARCH_MORE';}
      const invalidAssumption=b.body.assumptionIds.some(id=>{const a=this.store.get('assumption',id)?.body;return !a||a.status!=='valid'||Date.parse(a.expiresAt)<=this.clock().getTime();});
      if(invalidAssumption&&result.outcome==='GREENLIGHT'){result.outcome='RESEARCH_MORE';result.reasons.push('Critical assumptions invalid/stale');}
      const decision=this.decide(key,result.outcome,result.reasons.join('; '),{productId:c.body.productId,opportunityId:c.body.opportunityId,evidenceIds:result.evidenceIds,assumptionIds:b.body.assumptionIds,versions:{[`contract:${c.key}`]:c.revision,[`businessCase:${b.key}`]:b.revision},contradictions:result.disagreements.concat(evaluations.flatMap(e=>e.contradictions)),inputs:JSON.parse(canonical({council:input,cheapestExperiment:cheapestInformation(b.body),result,evidenceSnapshotHash:companyEvidenceDigest(this.store.db,c.body.opportunityId)})),capitalCents:input.capitalCents,reversibility:input.reversibility});
      return decision;
    }).immediate();
  }
  approveContract(key:string,revision:number,decisionId:string):CompanyRecord<'contract'> {
    this.enabled();return this.store.db.raw.transaction(()=>{
      const old=this.store.get('contract',key,revision),decision=this.store.db.productFactory.get('decisions',decisionId);
      if(old&&this.store.get('contract',key)?.body.status==='approved'&&this.store.get('contract',key)?.revision===revision+1&&canonical({...old.body,status:'approved'})===canonical(this.store.get('contract',key)!.body))return this.store.get('contract',key)!;
      if(!old||decision?.outcome!=='GREENLIGHT'||decision.productId!==old.body.productId||decision.company?.versions[`contract:${key}`]!==revision||this.store.get('contract',key)?.revision!==revision)throw Error('Exact council greenlight required');
      if(decision.evidenceIds.some(id=>{const e=this.evidence.require(id);return e.company&&this.evidence.effectiveLevel(e,this.clock())===null;}))throw Error('Greenlight economic evidence expired');
      const sourceInputs=decision.company.inputs as {evidenceSnapshotHash?:string}|null;
      if(sourceInputs?.evidenceSnapshotHash!==companyEvidenceDigest(this.store.db,old.body.opportunityId))throw Error('Greenlight evidence changed; new council review required');
      // Approval is a new immutable version. Its own builder greenlight references this exact version.
      if(decision.company.assumptionIds.some(id=>{const a=this.store.get('assumption',id);return !a||a.body.status!=='valid'||Date.parse(a.body.expiresAt)<=this.clock().getTime()||decision.company?.versions[`assumption:${id}`]!==a.revision;}))throw Error('Greenlight assumptions changed/stale');
      if(old.body.status==='approved')return old;
      const approved=this.store.append('contract',key,{...old.body,status:'approved'},revision,this.clock());
      const currentDecision=this.decide(`${decision.company.logicalKey}:approved-contract`,'GREENLIGHT',decision.rationale,{productId:old.body.productId,opportunityId:old.body.opportunityId,evidenceIds:decision.evidenceIds,assumptionIds:decision.company.assumptionIds,versions:{...decision.company.versions,[`contract:${key}`]:approved.revision},inputs:{councilDecisionId:decisionId,evidenceSnapshotHash:sourceInputs.evidenceSnapshotHash}});
      if(currentDecision.outcome!=='GREENLIGHT')throw Error('Policy blocks contract greenlight');
      return approved;
    }).immediate();
  }
  contractBrief(key:string,revision:number):ProductBrief {
    this.enabled();return this.store.db.raw.transaction(()=>{
      const c=this.store.get('contract',key,revision);
      if(!c||c.body.status!=='approved'||this.store.get('contract',key)?.revision!==revision)throw Error('Approved current Product Contract required');
      const existing=this.store.db.getKV(`product-factory:contract-brief:${key}:${revision}`),bs=new BuildStore(this.store.db,this.factory.creatorAddress);
      if(existing)return bs.brief(existing)!;
      const rows=this.store.db.raw.prepare("SELECT id FROM factory_decisions WHERE product_id=? AND outcome='GREENLIGHT' AND json_extract(company_metadata,?)=?").all(c.body.productId,`$.versions."contract:${key}"`,revision) as {id:string}[];
      if(!rows.length)throw Error('Exact greenlight missing');
      const engine=new ProductBriefEngine(bs,this.factory),brief=engine.create(c.body.opportunityId,{...structuredClone(c.body.briefContent),companyContext:JSON.parse(canonical({...c.body,briefContent:c.body.briefContent,...(c.body.surfaceDecision?{productSurfaces:this.store.get('productSurfaceDecision',c.body.surfaceDecision.key,c.body.surfaceDecision.revision)!.body}:{})}))});
      brief.productId=c.body.productId;brief.companyContract={key,revision,hash:c.hash,decisionId:rows[0].id};bs.saveBrief(brief);
      const reviewed=engine.requestReview(brief.id);
      if(reviewed.productId!==c.body.productId)throw Error('Contract/Brief product mismatch');
      this.store.db.setKV(`product-factory:contract-brief:${key}:${revision}`,reviewed.id);
      return reviewed;
    }).immediate();
  }
  quality(key:string,assessment:QualityAssessment,actor:CompanyActor):CompanyRecord<'quality'> {
    this.enabled();if(actor!=='BUILDER'&&actor!=='JUDGE')throw Error('Builder/Judge quality evidence required');
    this.validateReferences(assessment);const c=this.store.get('contract',assessment.contractKey,assessment.contractRevision);
    if(!c||c.body.productId!==assessment.productId)throw Error('Quality Contract mismatch');
    for(const gate of assessment.gates) {
      const expected=c.body.gates.find(g=>g.gate===gate.gate);
      if(!expected)throw Error('Undeclared quality gate');
      if(gate.status==='PASS') {
        const evidence=gate.evidenceIds.map(id=>this.evidence.require(id));
        const sufficient=evidence.some(e=>e.company?.aspect==='quality'&&(this.evidence.effectiveLevel(e,this.clock())??-1)>=Math.max(3,expected.minimumLevel)&&e.provenance.relation==='supports');
        const allQuality=this.store.db.productFactory.listAtomicEvidence(c.body.opportunityId).filter(e=>e.company?.aspect==='quality');
        const contradicts=[...evidence,...allQuality].some(e=>(this.evidence.effectiveLevel(e,this.clock())??-1)>=expected.minimumLevel&&e.provenance.relation==='refutes');
        let technical=false;
        if(gate.acceptance) {
          const build=new BuildStore(this.store.db,this.factory.creatorAddress).build(gate.acceptance.buildId);
          const brief=build?new BuildStore(this.store.db,this.factory.creatorAddress).brief(build.briefId):undefined;
          const proof=build?.model?.attempts.at(-1)?.acceptance?.find(p=>p.probeId===gate.acceptance!.probeId);
          const probe=brief?.content.acceptanceProbes?.find(p=>p.id===gate.acceptance!.probeId);
          const compatible=(gate.gate==='FUNCTIONAL'&&['functional','integration'].includes(probe?.kind??'')||gate.gate==='UX'&&['error','functional','integration'].includes(probe?.kind??'')||['ONBOARDING','VISUAL','ACCESSIBILITY','TIME_TO_VALUE'].includes(gate.gate)&&proof?.transport==='browser')&&!!probe?.featureIds.length;
          technical=compatible&&!!build&&brief?.companyContract?.key===assessment.contractKey&&brief.companyContract.revision===assessment.contractRevision&&build.productId===assessment.productId&&!!proof?.passed&&proof.execution==='real'&&!!probe&&proof.contractHash===buildHash(JSON.stringify(probe))&&proof.briefId===brief?.id&&(!expected.requiresBrowser||proof.transport==='browser');
        }
        if(expected.requiresBrowser&&technical){if(!gate.acceptance?.surfaceReceiptKey)throw Error('Immutable exact browser acceptance receipt required');assertSurfaceQuality(this.store,new BuildStore(this.store.db,this.factory.creatorAddress),gate.acceptance.surfaceReceiptKey,assessment.productId,assessment.contractKey,assessment.contractRevision);const receipt=this.store.get('surfaceReceipt',gate.acceptance.surfaceReceiptKey)!.body;if(gate.gate==='TIME_TO_VALUE'&&!receipt.firstValue?.achieved)throw Error('Declared first-value evidence missing');if(['VISUAL','ACCESSIBILITY'].includes(gate.gate)&&!receipt.observations.some(o=>o.capability===(gate.gate==='VISUAL'?'VISUAL_INSPECTION':'ACCESSIBILITY')&&o.passed))throw Error('Relevant browser quality dimension missing');}
        if(contradicts||expected.requiresBrowser&&!technical||!sufficient&&!technical)throw Error('Quality cannot self-certify; appropriate real execution/user evidence required');
      }
      if(gate.status==='NOT_APPLICABLE'&&expected.required)throw Error('Required gate cannot be redefined');
    }
    if(key!==`${assessment.contractKey}:${assessment.contractRevision}`)throw Error('Quality key must bind exact Contract version');
    return this.store.append('quality',key,assessment,this.store.get('quality',key)?.revision??0,this.clock());
  }
  health(body:CompanyEntityMap['health'],actor:CompanyActor):CompanyRecord<'health'> {
    this.enabled();if(!['BUILDER','JUDGE'].includes(actor))throw Error('Product Health requires Builder/Judge');this.validateReferences(body);
    const values=Object.values(body.factors);if(values.some(v=>!['healthy','degraded','critical','unknown'].includes(v)))throw Error('Invalid Product Health factors');
    const status=values.includes('critical')?'critical':values.includes('degraded')?'degraded':values.some(v=>v==='unknown')||!values.length?'unknown':'healthy';
    if(body.status!==status)throw Error('Revenue cannot override Product Health factors');
    return this.store.append('health',body.productId,body,this.store.get('health',body.productId)?.revision??0,this.clock());
  }
  snapshot(key:string,input:CompanyEntityMap['economicSnapshot']):CompanyRecord<'economicSnapshot'> {
    this.enabled();this.validateReferences(input);
    if(input.currency!==this.config.currency||input.costBucketsDisjoint!==true||!Number.isFinite(Date.parse(input.start))||!Number.isFinite(Date.parse(input.end))||Date.parse(input.end)<=Date.parse(input.start))throw Error('Invalid economic period/cost basis');
    if(Object.keys(input.unitEconomics).some(k=>ECONOMIC_METRICS.includes(k as any)||['ownerTarget','actual'].includes(k)))throw Error('Unit metrics cannot overwrite canonical economics');
    for(const [name,m] of Object.entries(input.unitEconomics)){
      if(m.value===null&&m.nature!=='UNKNOWN'||m.value!==null&&!Number.isFinite(m.value))throw Error('Invalid unit metric');
      if(['FACT','CALCULATED_FROM_OBSERVED_DATA'].includes(m.nature)){
        const ev=m.evidenceIds.map(id=>this.evidence.require(id));
        if(!ev.length||ev.some(e=>e.company?.origin!=='observed'||(this.evidence.effectiveLevel(e,this.clock())??-1)<3||e.company.productId!==input.productId||e.company.periodStart!==input.start||e.company.periodEnd!==input.end||e.company.measurements?.[name]===undefined)||ev.reduce((sum,e)=>sum+e.company!.measurements![name],0)!==m.value)throw Error('Unit economics need verified measurements/calculation evidence');
      }
    }
    for(const metric of ECONOMIC_METRICS) {
      const m=input.metrics[metric];if(!m)throw Error('Missing economic field must be explicitly UNKNOWN');
      if(m.unit!==`${input.currency}:cents`||m.value!==null&&!Number.isSafeInteger(m.value)||m.value===null&&m.nature!=='UNKNOWN'||m.value!==null&&m.nature==='UNKNOWN')throw Error('Invalid monetary value/nature');
      if(m.value!==null&&!['netRevenue','contribution','profit','cash'].includes(metric)&&m.value<0)throw Error('Revenue/refunds/costs/commitments must be nonnegative');
      if(['netRevenue','contribution','profit'].includes(metric))continue; // Calculated below, never trust asserted profit.
      if(m.nature==='FACT'||m.nature==='CALCULATED_FROM_OBSERVED_DATA') {
        if(!m.evidenceIds.length)throw Error('Economic fact without evidence');
        const ev=m.evidenceIds.map(id=>this.evidence.require(id));
        if(ev.some(e=>e.company?.origin!=='observed'||(this.evidence.effectiveLevel(e,this.clock())??-1)<(['grossRevenue','refunds'].includes(metric)?4:3)||(['grossRevenue','refunds'].includes(metric)&&e.company?.paymentStatus!=='settled')||e.company.productId!==input.productId||e.company.currency!==input.currency||e.company.periodStart!==input.start||e.company.periodEnd!==input.end))throw Error('Synthetic/stale/wrong-period evidence cannot be real actual');
        const unique=new Set(ev.map(e=>e.company!.verificationRef));if(unique.size!==ev.length)throw Error('Duplicated monetary evidence');
        if(ev.some(e=>e.company?.measurements?.[metric]===undefined)||ev.reduce((sum,e)=>sum+e.company!.measurements![metric],0)!==m.value)throw Error('Economic fact differs from verified source measurements');
      }
      if(m.nature==='SYNTHETIC'&&m.evidenceIds.some(id=>this.evidence.require(id).company?.origin!=='synthetic'))throw Error('Synthetic value provenance mismatch');
    }
    return this.store.append('economicSnapshot',key,deriveEconomics(input),0,this.clock());
  }
  private latestEconomics(productId:string) {return this.store.list('economicSnapshot').filter(s=>s.body.productId===productId).sort((a,b)=>Date.parse(a.body.end)-Date.parse(b.body.end)||Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.id.localeCompare(b.id)).at(-1);}
  capitalComparisons(keys:string[]) {
    this.enabled();const proposed=keys.map(key=>{const p=this.store.get('proposal',key);if(!p)throw Error('Unknown capital proposal');return p;});
    const committed=this.store.list('allocation').filter(a=>a.body.status==='committed');
    const crisis=this.store.list('mode').some(m=>m.body.mode==='CRISIS');
    const spent=(this.store.db.raw.prepare('SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id IS NOT NULL').get() as {cents:number}).cents;
    const rows=compareCapital(proposed,{capitalCents:Math.min(this.config.maxCapitalCents,this.factory.resources.config.operationalBudgetCents)-spent-committed.reduce((s,a)=>s+a.body.capitalCents,0),builderHours:this.config.maxBuilderHours-committed.reduce((s,a)=>s+a.body.builderHours,0),computeUnits:this.config.maxComputeUnits-committed.reduce((s,a)=>s+a.body.computeUnits,0),crisis});
    for(const r of rows) {
      const p=proposed.find(p=>p.key===r.key)!;
      if(p.body.riskKeys.some(k=>{const risk=this.store.get('risk',k);return !risk||risk.body.status==='open'&&(risk.body.impact==='critical'||this.config.maxRisk==='low'&&risk.body.impact==='material');})){r.eligible=false;r.reason='Unresolved critical risk';}
      if(p.body.assumptionIds.some(k=>{const a=this.store.get('assumption',k)?.body;return !a||a.status!=='valid'||Date.parse(a.expiresAt)<=this.clock().getTime();})){r.eligible=false;r.reason='Critical assumptions stale/invalid';}
      const health=p.body.productId?this.store.get('health',p.body.productId)?.body:undefined;
      if(['BUILD','GROWTH','SCALE'].includes(p.body.action)&&health?.status==='critical'){r.eligible=false;r.reason='Critical Product Health requires PROTECT/FIX first';}
      if(p.body.action==='SCALE'){
        const economics=p.body.productId?this.latestEconomics(p.body.productId)?.body:undefined;
        if(health?.status!=='healthy'||!economics||economics.metrics.profit.value===null||economics.metrics.profit.value<=0||!['FACT','CALCULATED_FROM_OBSERVED_DATA'].includes(economics.metrics.profit.nature)||!p.body.evidenceIds.some(id=>(this.evidence.effectiveLevel(this.evidence.require(id),this.clock())??-1)>=4)){r.eligible=false;r.reason='Scaling needs observed positive economics, purchase evidence and Product Health';}
      }
      if(['BUILD','GROWTH','SCALE'].includes(p.body.action)&&!p.body.evidenceIds.some(id=>(this.evidence.effectiveLevel(this.evidence.require(id),this.clock())??-1)>=this.config.minGreenlightLevel)){r.eligible=false;r.reason='Material capital requires stronger evidence';}
    }
    return rows.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||Number(b.priority==='PROTECT')-Number(a.priority==='PROTECT')||b.conservativeExpectedProfit-a.conservativeExpectedProfit||a.key.localeCompare(b.key));
  }
  requestAllocation(key:string,proposalKey:string,decisionId:string):CompanyRecord<'allocation'> {
    this.enabled();return this.store.db.raw.transaction(()=>{
      const old=this.store.get('allocation',key);if(old){if(old.body.proposalKey!==proposalKey||old.body.decisionId!==decisionId)throw Error('Allocation idempotency inputs changed');return old;}
      const p=this.store.get('proposal',proposalKey),decision=this.store.db.productFactory.get('decisions',decisionId);
      if(!p?.body.productId||!decision?.company?.policy.allowed||!['GREENLIGHT','ALLOCATE','FIX','PROTECT','GROW'].includes(decision.outcome)||decision.productId!==p.body.productId)throw Error('Authorized product capital decision required');
      if(!this.capitalComparisons([proposalKey])[0]?.eligible)throw Error('Capital proposal ineligible');
      const pending=this.store.list('allocation').filter(a=>a.body.status!=='released');
      const spent=(this.store.db.raw.prepare('SELECT COALESCE(SUM(actual_cost_cents),0) AS cents FROM task_graph WHERE product_id IS NOT NULL').get() as {cents:number}).cents;
      if(spent+pending.reduce((sum,a)=>sum+a.body.capitalCents,0)+p.body.capitalCents>Math.min(this.config.maxCapitalCents,this.factory.resources.config.operationalBudgetCents)||pending.reduce((sum,a)=>sum+a.body.builderHours,0)+p.body.builderHours>this.config.maxBuilderHours||pending.reduce((sum,a)=>sum+a.body.computeUnits,0)+p.body.computeUnits>this.config.maxComputeUnits)throw Error('Pending/committed capital exhausted');
      if(pending.some(a=>a.body.productId===p.body.productId))throw Error('Release existing product allocation before replacement');
      if(!this.admission({action:'REQUEST_CAPITAL',productId:p.body.productId,capitalCents:p.body.capitalCents,externalExecution:false}).allowed)throw Error('Policy blocks capital request');
      const approvalId=ulid(),usage=companyProductUsage(this.store.db,this.factory.creatorAddress,p.body.productId);
      const body:CapitalAllocation={proposalKey,proposalRevision:p.revision,productId:p.body.productId,decisionId,approvalId,status:'proposed',capitalCents:p.body.capitalCents,builderHours:p.body.builderHours,computeUnits:p.body.computeUnits,baselineCostCents:usage.cost,baselineDurationMs:usage.duration,baselineComputeUnits:usage.compute};
      const digest=buildHash(canonical(body));
      this.store.db.productFactory.insert('approvals',{id:approvalId,productId:body.productId,factoryActionId:`company-capital:${key}:${digest}`,action:'resource_reservation',status:'pending',requestedBy:this.factory.creatorAddress,decidedBy:null,decidedAt:null,createdAt:this.clock().toISOString()});
      this.store.db.setKV(`product-factory:company-product:${body.productId}`,proposalKey);
      return this.store.append('allocation',key,body,0,this.clock());
    }).immediate();
  }
  commitAllocation(key:string):CompanyRecord<'allocation'> {
    this.enabled();return this.store.db.raw.transaction(()=>{
      const old=this.store.get('allocation',key);if(!old)throw Error('Unknown allocation');if(old.body.status==='committed')return old;
      const a=old.body,approval=this.store.db.productFactory.get('approvals',a.approvalId);
      if(a.status!=='proposed'||approval?.status!=='approved'||approval.decidedBy!==this.factory.creatorAddress||approval.productId!==a.productId||approval.factoryActionId!==`company-capital:${key}:${buildHash(canonical(a))}`)throw Error('Exact creator capital approval required');
      if(!this.admission({action:'COMMIT_CAPITAL',productId:a.productId,capitalCents:a.capitalCents,externalExecution:false}).allowed)throw Error('Policy blocks capital commitment');
      return this.store.append('allocation',key,{...a,status:'committed'},old.revision,this.clock());
    }).immediate();
  }
  releaseAllocation(key:string,actor:CompanyActor):CompanyRecord<'allocation'> {
    this.enabled();if(!['CREATOR','ENTREPRENEUR'].includes(actor))throw Error('Capital decision rights denied');
    const a=this.store.get('allocation',key);if(!a)throw Error('Unknown allocation');
    if(this.factory.resources.leases(true).some(r=>r.productId===a.body.productId))throw Error('Cannot release capital with active reservations');
    return this.store.append('allocation',key,{...a.body,status:'released'},a.revision,this.clock());
  }
  forecast(key:string,input:Forecast,actor:CompanyActor):CompanyRecord<'forecast'> {
    this.enabled();if(actor!=='ENTREPRENEUR'&&actor!=='JUDGE')throw Error('Forecast function rights denied');this.validateReferences(input);
    if(!this.config.forecastHorizons.includes(input.horizonWeeks)||input.currency!==this.config.currency||Date.parse(input.end)<=Date.parse(input.start))throw Error('Invalid forecast horizon/period');
    const history=this.store.list('forecastOutcome').filter(o=>this.store.get('forecast',o.body.forecastKey,o.body.forecastRevision)?.body.processKey===input.processKey);
    const factor=forecastCalibration(history.map(o=>o.body)).confidenceFactor;
    return this.store.append('forecast',key,{...input,confidence:input.confidence*factor},0,this.clock());
  }
  forecastActual(key:string,forecastKey:string,snapshotKey:string,metric:keyof CompanyEntityMap['economicSnapshot']['metrics']='grossRevenue') {
    this.enabled();const f=this.store.get('forecast',forecastKey),s=this.store.get('economicSnapshot',snapshotKey);if(!f||!s||f.body.start!==s.body.start||f.body.end!==s.body.end||f.body.currency!==s.body.currency||f.body.productId!==s.body.productId)throw Error('Forecast/actual period or scope mismatch');
    const actual=s.body.metrics[metric],r=f.body.metrics[metric],known=actual.value!==null&&['FACT','CALCULATED_FROM_OBSERVED_DATA'].includes(actual.nature)&&!!r;
    const inRange=known?actual.value!>=r!.low&&actual.value!<=r!.high:null;
    return this.store.append('forecastOutcome',key,{forecastKey,forecastRevision:f.revision,actualSnapshotKey:snapshotKey,actualSnapshotRevision:s.revision,metric,actual,inRange,error:known?actual.value!-(r!.low+r!.high)/2:null,direction:!known?'unknown':inRange?'in_range':actual.value!<r!.low?'optimistic':'pessimistic'},0,this.clock());
  }
  review(key:string,input:{type:'weekly'|'monthly';targetKey:string;snapshotKey:string;forecastKey?:string;assessments:DomainAssessment[];stopDoing:string[];priorities:string[]}):CompanyRecord<'review'> {
    this.enabled();if(input.type==='weekly'&&!this.config.reviews.weekly||input.type==='monthly'&&!this.config.reviews.monthly)throw Error('Review cadence disabled');
    return this.store.db.raw.transaction(()=>{
      const old=this.store.get('review',key);if(old){if(old.body.dossier.target.key!==input.targetKey||old.body.dossier.snapshot.key!==input.snapshotKey||canonical(old.body.assessments)!==canonical(input.assessments))throw Error('Review idempotency inputs changed');return old;}
      const target=this.store.get('target',input.targetKey),snapshot=this.store.get('economicSnapshot',input.snapshotKey),forecast=input.forecastKey?this.store.get('forecast',input.forecastKey):undefined;
      if(!target||!snapshot||snapshot.body.productId!==null||target.body.currency!==snapshot.body.currency||this.clock().getTime()<Date.parse(snapshot.body.end))throw Error('Closed portfolio period required');
      if(input.type==='weekly'&&(target.body.periodStart!==snapshot.body.start||target.body.periodEnd!==snapshot.body.end))throw Error('Target period mismatch; revenue cannot move periods');
      if(input.assessments.length!==4||new Set(input.assessments.map(a=>a.function)).size!==4||!input.assessments.every(a=>COMPANY_FUNCTIONS.includes(a.function)))throw Error('Four concise review assessments required');
      input.assessments.forEach(a=>this.validateReferences(a));
      const metric=target.body.metric,actual=snapshot.body.metrics[metric];
      const definitionMatches=actual.definition?.key===target.body.metricDefinition.key&&actual.definition?.revision===target.body.metricDefinition.revision;
      const known=actual.value!==null&&['FACT','CALCULATED_FROM_OBSERVED_DATA'].includes(actual.nature)&&definitionMatches&&input.type==='weekly';
      const outcome=actual.nature==='SYNTHETIC'?'SYNTHETIC':!known?'UNKNOWN':actual.value!>target.body.amountCents?'EXCEEDED':actual.value!>=target.body.amountCents?'REACHED':actual.value!>=target.body.amountCents*this.config.materialMissRatio?'NEAR':'MISSED';
      const validForecast=forecast&&forecast.body.productId===null&&forecast.body.start===snapshot.body.start&&forecast.body.end===snapshot.body.end&&Date.parse(forecast.body.freshUntil)>this.clock().getTime()?forecast:undefined;
      const gap=revenueGap(target.body.amountCents,validForecast?.body.metrics[metric]??null);
      const health=Object.fromEntries(this.store.list('health').map(h=>[h.key,h.body]));
      const facts:Record<string,MetricValue>={...snapshot.body.metrics,...snapshot.body.unitEconomics,ownerTarget:{value:target.body.amountCents,unit:`${this.config.currency}:cents`,nature:'FACT',evidenceIds:[],confidence:1},actual:definitionMatches?actual:unknownMetric(actual.unit,'Metric definition does not match frozen Owner Target')};
      const analytics=this.store.list('analyticsDossier').find(d=>d.body.snapshotKey===snapshot.key)?.body;
      const dossierWithoutHash={...(analytics?{analytics}:{}),frozenAt:this.clock().toISOString(),target:{key:target.key,revision:target.revision},forecast:validForecast?{key:validForecast.key,revision:validForecast.revision}:null,snapshot:{key:snapshot.key,revision:snapshot.revision},facts,health,portfolioKeys:this.store.list('portfolio').map(p=>p.key),experimentKeys:this.store.list('experimentPlan').map(p=>p.key),riskKeys:this.store.list('risk').map(p=>p.key),feedbackKeys:this.store.list('voice').map(p=>p.key)};
      const dossier:FrozenDossier={...dossierWithoutHash,hash:buildHash(canonical(dossierWithoutHash))};
      const past=this.store.list('review').filter(r=>r.body.type==='weekly'&&Date.parse(r.body.end)<=Date.parse(snapshot.body.start)).sort((a,b)=>b.body.end.localeCompare(a.body.end));
      let misses=outcome==='MISSED'?1:0;for(const r of past){if(r.body.targetOutcome!=='MISSED'||!misses)break;misses++;}
      const decision=this.decide(`review:${key}`,outcome==='MISSED'?'RECOVERY':outcome==='EXCEEDED'?'EVALUATE_REPEATABILITY':'REVIEW',outcome==='MISSED'?'Owner Target missed and remains missed; diagnose causes, stop low-return work, compare alternatives':outcome==='EXCEEDED'?'Target exceeded; evaluate repeatability, marginal return, quality and saturation; continue mission':'Shared Judge facts; unknown values remain unknown',{evidenceIds:[...new Set(Object.values(facts).flatMap(f=>f.evidenceIds))],contradictions:input.assessments.flatMap(a=>a.disagreements),inputs:JSON.parse(canonical({dossierHash:dossier.hash,assessments:input.assessments,stopDoing:input.stopDoing,priorities:input.priorities})),alternatives:this.store.list('shadow').map(s=>s.key)});
      const result=this.store.append('review',key,{type:input.type,start:snapshot.body.start,end:snapshot.body.end,dossier,assessments:input.assessments,decisionId:decision.id,targetOutcome:outcome,revenueGap:gap,stopDoing:input.stopDoing,nextPriorities:input.priorities,boardQuestion:input.type==='monthly'?'If this company started today with everything we currently know, would we allocate resources to the same portfolio?':null,repeatability:outcome==='EXCEEDED'?'Investigate cause/repeatability, marginal contribution, saturation, retention and Product Health before raising ambition':null},0,this.clock());
      if(outcome==='MISSED'&&decision.company?.policy.allowed)this.store.append('mode','company',{mode:'RECOVERY',productId:null,reason:'Material target miss; causal diagnosis required; safety/approvals remain binding',evidenceIds:actual.evidenceIds,consecutiveMisses:misses,strategicReviewRequired:misses>=this.config.strategicMissCount,decisionId:decision.id},this.store.get('mode','company')?.revision??0,this.clock());
      return result;
    }).immediate();
  }
  stretch(key:string,targetKey:string,amountCents:number,evidenceIds:string[],rationale:string):CompanyRecord<'stretch'> {
    this.enabled();const t=this.store.get('target',targetKey);
    if(!this.config.allowStretch||!t||!Number.isSafeInteger(amountCents)||amountCents<=t.body.amountCents||!rationale.trim()||!evidenceIds.some(id=>(this.evidence.effectiveLevel(this.evidence.require(id),this.clock())??-1)>=5))throw Error('Higher ambition requires repeatability/retention evidence and policy');
    if(this.store.list('health').some(h=>h.body.status==='critical'))throw Error('Product Health blocks faster growth ambition');
    return this.store.append('stretch',key,{ownerTargetKey:targetKey,ownerTargetRevision:t.revision,amountCents,rationale,evidenceIds},0,this.clock());
  }
  portfolioState(key:string,body:CompanyEntityMap['portfolio']):CompanyRecord<'portfolio'> {
    this.enabled();this.validateReferences(body);if(body.productId!==key)throw Error('Portfolio scope mismatch');
    const d=this.store.db.productFactory.get('decisions',body.decisionId);
    if(!d?.company?.policy.allowed||d.productId!==key||d.outcome!==body.state)throw Error('Authorized economic portfolio decision required');
    if(body.state==='HARVEST') {
      const economics=this.latestEconomics(key)?.body;
      if(!economics||economics.metrics.profit.value===null||economics.metrics.profit.value<=0||!['FACT','CALCULATED_FROM_OBSERVED_DATA'].includes(economics.metrics.profit.nature)||this.store.get('health',key)?.body.status!=='healthy')throw Error('Harvest requires observed profitability and healthy stable product');
    }
    const overlay=this.store.append('portfolio',key,body,this.store.get('portfolio',key)?.revision??0,this.clock());
    if(['KILL','ARCHIVE'].includes(body.state))this.factory.portfolio.setState(key,body.state==='KILL'?'killed':'archived',d.rationale);
    return overlay;
  }
  pulse(key:string,anomalies:CompanyEntityMap['pulse']['anomalies']):CompanyRecord<'pulse'> {
    this.enabled();this.validateReferences(anomalies);
    return this.store.db.raw.transaction(()=>{
      const old=this.store.get('pulse',key);if(old)return old;
      const critical=anomalies.filter(a=>a.severity==='critical');
      const d=critical.length?this.decide(`pulse:${key}`,'PROTECT','Critical anomaly; preserve customer access, reliability, privacy and existing policies',{productId:critical[0].productId,evidenceIds:[...new Set(critical.flatMap(a=>a.evidenceIds))],inputs:JSON.parse(canonical(critical))}):null;
      if(d?.company?.policy.allowed) {
        const productId=critical[0].productId;
        this.store.append('mode',productId??'company',{mode:'CRISIS',productId,reason:d.rationale,evidenceIds:d.evidenceIds,consecutiveMisses:0,strategicReviewRequired:false,decisionId:d.id},this.store.get('mode',productId??'company')?.revision??0,this.clock());
      }
      return this.store.append('pulse',key,{at:this.clock().toISOString(),anomalies,decisionId:d?.id??null},0,this.clock());
    }).immediate();
  }
  scorecard(key:string,snapshotKey:string,targetKey?:string,forecastKey?:string):CompanyRecord<'scorecard'> {
    this.enabled();const snapshot=this.store.get('economicSnapshot',snapshotKey);if(!snapshot)throw Error('Economic snapshot required');
    const target=targetKey?this.store.get('target',targetKey):undefined,forecast=forecastKey?this.store.get('forecast',forecastKey):undefined;
    const metrics:Record<string,MetricValue>={...snapshot.body.metrics,...snapshot.body.unitEconomics};
    for(const k of ['burn','recurringRevenue','customers','activation','conversion','retention','churn','cac','ltv','cacLtv','payback','margin','targetProgress','forecastAccuracy','evidenceQuality'])if(!metrics[k])metrics[k]=unknownMetric('unspecified');
    if(target)metrics.ownerTarget={value:target.body.amountCents,unit:`${this.config.currency}:cents`,nature:'FACT',evidenceIds:[],confidence:1};
    const f=forecast&&Date.parse(forecast.body.freshUntil)>this.clock().getTime()?forecast.body.metrics[target?.body.metric??'grossRevenue']:null;
    const analytics=this.store.list('analyticsDossier').find(d=>d.body.snapshotKey===snapshotKey)?.body;
    const body:CompanyScorecard={...(analytics?{analytics}:{}),capturedAt:this.clock().toISOString(),metrics,targetKey:target?.key??null,forecastKey:forecast?.key??null,revenueGap:target?revenueGap(target.body.amountCents,f??null):null,productHealth:Object.fromEntries(this.store.list('health').map(h=>[h.key,h.body])),portfolioFactors:{...snapshot.body.revenueQuality},decisionIds:[]};
    return this.store.append('scorecard',key,body,0,this.clock());
  }
  experiment(key:string,input:{productId:string;statement:string;success:string;failure:string;stop:string;metricDefinitions:{key:string;revision:number}[];evidenceIds:string[]}):CompanyRecord<'experimentPlan'> {
    this.enabled();this.validateReferences(input);for(const m of input.metricDefinitions)if(!this.store.get('metricDefinition',m.key,m.revision))throw Error('Unknown experiment metric definition');
    return this.store.db.raw.transaction(()=>{
      const old=this.store.get('experimentPlan',key);if(old){if(old.body.success!==input.success||old.body.failure!==input.failure||old.body.productId!==input.productId)throw Error('Experiment definitions frozen before results');return old;}
      const hypothesisId=ulid(),experimentId=ulid();
      this.store.db.productFactory.insert('hypotheses',{id:hypothesisId,createdAt:this.clock().toISOString(),productId:input.productId,statement:input.statement,successCriterion:input.success,status:'proposed'});
      this.store.db.productFactory.insert('experiments',{id:experimentId,createdAt:this.clock().toISOString(),productId:input.productId,hypothesisId,goalId:null,taskId:null,status:'planned',method:'Frozen company experiment; execution via existing Task Graph only'});
      return this.store.append('experimentPlan',key,{...input,hypothesisId,experimentId},0,this.clock());
    }).immediate();
  }
  assumptionImpact(key:string) {
    this.enabled();const all=this.store.list('assumption'),stale=all.filter(a=>a.body.status!=='valid'||Date.parse(a.body.expiresAt)<=this.clock().getTime());
    const keys=stale.map(a=>a.key),rows=this.store.db.raw.prepare('SELECT id,company_metadata FROM factory_decisions WHERE company_address=?').all(this.factory.creatorAddress) as {id:string;company_metadata:string}[];
    const decisions=rows.filter(r=>JSON.parse(r.company_metadata).assumptionIds.some((id:string)=>keys.includes(id))).map(r=>r.id);
    for(const claim of this.store.list('claim').filter(c=>c.body.assumptionIds.some(id=>keys.includes(id))))this.evidence.evaluate(claim.key,this.clock());
    const body={evaluatedAt:this.clock().toISOString(),assumptionVersions:Object.fromEntries(all.map(a=>[a.key,a.revision])),staleKeys:keys,affectedProducts:[...new Set(stale.flatMap(a=>a.body.affectedProductIds))],affectedDecisionIds:decisions,reviewRequired:keys.length>0};
    return this.store.append('assumptionImpact',key,body,0,this.clock());
  }
  portfolioAlternatives() {
    const keys=[...new Set([...this.store.list('proposal').map(p=>p.key),...this.store.list('shadow').filter(s=>s.body.status==='available').map(s=>s.body.proposalKey)])];
    return this.capitalComparisons(keys);
  }
  rejectOpportunity(key:string,opportunityId:string,evidenceIds:string[],reason:string,conditions:string[]) {
    this.enabled();return this.store.db.raw.transaction(()=>{
      const decision=this.decide(`graveyard:${key}`,'REJECT',reason,{opportunityId,evidenceIds,alternatives:conditions});
      if(!decision.company?.policy.allowed)return decision;
      new OpportunityEngine(this.store.db,this.factory).decide(opportunityId,'REJECT',reason);
      this.store.append('graveyard',key,{opportunityId,proposalKey:'',status:'rejected',reevaluationConditions:conditions,representation:'independent_product',alternatives:[],evidenceIds,assumptionIds:[],rationale:reason,confidence:decision.company.confidence},0,this.clock());
      return decision;
    }).immediate();
  }
  voice(key:string,body:CompanyEntityMap['voice']) {
    this.enabled();return this.store.db.raw.transaction(()=>{
      const record=this.record('voice',key,body,'GROWTH');
      const link=`product-factory:company-feedback:${key}`,old=this.store.db.getKV(link);
      if(!old){const id=ulid();this.store.db.productFactory.insert('feedback',{id,createdAt:this.clock().toISOString(),productId:body.productId,source:'company-voice-of-customer',content:body.content});this.store.db.setKV(link,id);}
      return record;
    }).immediate();
  }
  learning(key:string,body:CompanyEntityMap['causal'],experimentId:string|null=null) {
    this.enabled();return this.store.db.raw.transaction(()=>{
      const record=this.record('causal',key,body,'JUDGE');
      const link=`product-factory:company-learning:${key}`;
      if(!this.store.db.getKV(link)){const id=ulid();this.store.db.productFactory.insert('learnings',{id,createdAt:this.clock().toISOString(),productId:body.productId,experimentId,content:body.intervention+': '+body.causalClaim,confidence:body.confidence});this.store.db.setKV(link,id);}
      return record;
    }).immediate();
  }
  configure(config:unknown,actor:CompanyActor) {
    if(actor!=='CREATOR')throw Error('Company configuration is creator controlled');
    const next=resolveCompanyConfig(config),old=this.store.get('company','operating-model');
    if(!old)throw Error('Initialize Company OS explicitly before reconfiguration');
    const record=this.store.append('company','operating-model',{...old.body,config:next},old.revision,this.clock());
    // Recreate the domain facade to adopt it; running execution does not acquire a new runtime.
    return record;
  }
  planResearch(productId:string,key:string,description:string,costCents=0) {
    this.enabled();this.owns(productId);
    if(!Number.isSafeInteger(costCents)||costCents<0)throw Error('Invalid research estimate');
    return this.store.db.raw.transaction(()=>{
      if(costCents>0&&!this.store.db.getKV(`product-factory:company-product:${productId}`))this.store.db.setKV(`product-factory:company-product:${productId}`,`research:${key}`);
      const goalKey=`product-factory:company-goal:${this.factory.creatorAddress}:${productId}`;
      const existing=this.store.db.raw.prepare('SELECT id FROM task_graph WHERE product_id=? AND factory_action_id=?').get(productId,`company-research:${key}`) as {id:string}|undefined;
      if(existing)return getTaskById(this.store.db.raw,existing.id)!;
      const prior=this.store.db.getKV(goalKey);
      const active=prior&&(this.store.db.raw.prepare('SELECT status FROM goals WHERE id=?').get(prior) as {status:string}|undefined)?.status==='active';
      const goal=active?prior!:this.factory.createProductGoal(productId,'Company research and evidence','Untrusted evidence; planning only, no external commercial execution');
      this.store.db.setKV(goalKey,goal);
      return this.factory.planAction({goalId:goal,title:'Company research',description,estimatedCostCents:costCents,maxRetries:2,timeoutMs:30000,factory:{productId,factoryActionId:`company-research:${key}`,resourceClass:'research',urgency:40,requiresApproval:false,preemptible:true,criticalIncident:false,resourceUnits:1,failureScope:'action',signals:{businessImpact:0.5,evidenceConfidence:0.3,strategicFit:0.5,userImpact:0.5,risk:0.2}}});
    }).immediate();
  }
}

function freeze(value:unknown):void {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}}
