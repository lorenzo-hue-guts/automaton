import type { AutomatonDatabase } from '../../../types.js';
import { CompanyOperatingSystem,FactoryOrchestrator,resolveProductFactoryConfig,OpportunityEngine,EvidenceEngine,SCORE_WEIGHTS,ECONOMIC_METRICS,unknownMetric } from '../../../product-factory/index.js';
import type { BusinessCase,ProductContract,CapitalProposal,EconomicSnapshot,MetricValue,CompanyFunction,DomainAssessment,OwnerTarget,Forecast,EvidenceGovernance } from '../../../product-factory/index.js';
import { UNKNOWN_BRIEFS } from './acceptance-contracts.js';
import type { DiscoverySignal,ScoreCriterion } from '../../../product-factory/index.js';
export function companyFixture(db:AutomatonDatabase,patch:Record<string,unknown>={}) {
  let now=new Date('2026-10-01T12:00:00Z');let counter=0;
  const config={enabled:true,maxCapitalCents:10000,maxBuilderHours:20,maxComputeUnits:1000,allowStretch:true,...patch};
  const factory=new FactoryOrchestrator(db,resolveProductFactoryConfig({enabled:true,maxActiveProducts:30,operationalBudgetCents:10000,resources:{globalConcurrency:6,perProductConcurrency:2,buildSlots:2,researchSlots:3,monitoringSlots:2,computeUnits:8,perProductBudgetCents:10000,inferenceBudgetCents:10000},company:config}),'creator',()=>({action:'allow',reasonCode:'TEST',humanMessage:'Deterministic admission double'}));
  const options={config,admission:()=>({allowed:true,reason:'Deterministic policy admission double'}),providers:[{id:'model',origin:'model' as const},{id:'synthetic',origin:'synthetic' as const},{id:'public-contract',origin:'public' as const,verify:(_s:DiscoverySignal,g:EvidenceGovernance)=>g.verificationRef.startsWith('test-contract:')},{id:'observed-contract',origin:'observed' as const,verify:(_s:DiscoverySignal,g:EvidenceGovernance)=>g.verificationRef.startsWith('test-contract:')}],clock:()=>now};
  const os=new CompanyOperatingSystem(factory,options);
  const provenance={evidenceIds:[] as string[],assumptionIds:[] as string[],rationale:'Explicit synthetic company simulation; not market validation',confidence:.9};
  const range=(low:number,high=low,unit='EUR:cents')=>({low,high,unit,confidence:.8,evidenceIds:[] as string[],assumptionIds:[] as string[]});
  function opportunity(label='Opportunity',technical=true) {
    const oe=new OpportunityEngine(db,factory),o=oe.create(`${label} ${++counter}`,`domain${counter} workflow${counter} buyer${counter} segment${counter} outcome${counter}`);
    if(!technical)return o.id;
    for(const criterion of Object.keys(SCORE_WEIGHTS) as ScoreCriterion[])new EvidenceEngine(db,'creator',true).ingest('legacy-fixture',{opportunityId:o.id,sourceType:'forum',sourceRef:`fixture://${counter}/${criterion}`,independenceKey:`legacy-${criterion}`,capturedAt:now.toISOString(),summary:'Technical discovery only',excerpt:'Synthetic observation',reliability:1,tags:[],relation:'supports',kind:'observation',criterion});
    oe.assess(o.id,{values:Object.fromEntries(Object.keys(SCORE_WEIGHTS).map(k=>[k,1])) as Record<ScoreCriterion,number>,estimatedCostCents:0,risk:0,unverifiedHypotheses:[]});
    oe.decide(o.id,'SELECT','Fixture selected for private Brief');
    return o.id;
  }
  function evidence(opportunityId:string,aspect:EvidenceGovernance['aspect']='money_flow',level:0|1|2|3|4|5=2,relation:'supports'|'refutes'='supports',extra:Partial<EvidenceGovernance>={}) {
    const id=++counter,origin=level===0?'model':level===1?'synthetic':level===2?'public':'observed';
    const provider=origin==='model'?'model':origin==='synthetic'?'synthetic':origin==='public'?'public-contract':'observed-contract';
    return os.evidence.ingest(provider,{opportunityId,sourceType:'competitor',sourceRef:`fixture://company/${id}`,independenceKey:`source-${id}`,capturedAt:now.toISOString(),summary:`${aspect} contract-compatible double`,excerpt:`Record ${id}`,reliability:1,tags:['fixture'],relation,kind:'observation',criterion:'willingnessToPay'},{level,origin,aspect,expiresAt:'2027-12-31T00:00:00Z',verificationRef:`test-contract:${id}`,...extra}).id;
  }
  function business(opportunityId:string,ids:string[],key='business'):BusinessCase {
    const body:BusinessCase={...provenance,evidenceIds:ids,opportunityId,buyer:{user:'Analyst',champion:'Team lead',buyer:'Finance manager',decisionMaker:'Director',budgetOwner:'Operations'},problem:'Manual process consumes paid staff time',currentWorkaround:'Paid staff and existing software',currentCost:range(10000,20000),whyNow:'Vendor removed workflow',whySwitch:'Addressable missing integration',whyThis:'Narrow trusted workflow',reachBuyers:'Reach first 100 qualified prospects via partner with observed audience',acquisitionCost:range(100,200),reasonToStay:'Repeated weekly workflow',servingCost:range(10,30),pricing:{...provenance,evidenceIds:ids,model:'license',price:range(500,1000),packaging:['Team license'],recurringValue:null,valueToCustomer:'Avoid expensive errors',expansion:[{offer:'Automation',additionalValue:'Reduce repeated manual work'}]},accessibleRevenue:{customers:range(50,100,'customers'),penetration:range(.05,.1,'fraction'),revenuePerCustomer:range(500,1000),period:'month'},revenueShapes:[{customers:10,revenuePerCustomerCents:1000,period:'month',rationale:'Compare narrow high-value market'}],unfairOpportunity:'Small specialized vertical',wedge:'One expensive workflow',expansion:['More automation'],invalidators:['Buyer has no budget'],marketThesisKey:'market',desirability:{pain:{assessment:'supported',evidenceIds:ids,rationale:'Workflow evidence'}},preMortem:[],experiments:[]};
    os.record('businessCase',key,body,'ENTREPRENEUR');return body;
  }
  function product() {return factory.portfolio.create('Existing owned product').id;}
  function contract(opportunityId:string,productId:string,ids:string[],key='contract',businessKey='business'):ProductContract {
    os.record('gtm',`gtm:${productId}`,{...provenance,evidenceIds:ids,productId,icp:'Qualified finance teams',buyer:'Finance manager',firstQualifiedProspects:'Partner channel reaches first 100 relevant teams',stage:'PRE_LAUNCH_VALIDATION',channels:['partnership'],message:'Eliminate the manual workflow',offer:'Test one useful result',creativeHypothesis:'Show an honest demonstration',funnel:['qualified_account','first_value','purchase'],conversion:range(.01,.1,'fraction'),cac:range(100,200),budgetCents:0,measurementKeys:['gross'],stopConditions:['Contribution negative'],execution:'disabled'},'GROWTH');
    const b=os.store.get('businessCase',businessKey)!;
    const body:ProductContract={...provenance,evidenceIds:ids,productId,opportunityId,briefId:null,businessCaseKey:businessKey,businessCaseRevision:b.revision,status:'draft',buyer:b.body.buyer,problem:b.body.problem,currentWorkaround:b.body.currentWorkaround,currentSpend:b.body.currentCost,whyNow:b.body.whyNow,whySwitch:b.body.whySwitch,promise:'One correct reliable outcome',desiredOutcome:'User completes a meaningful workflow',wedge:b.body.wedge,differentiation:'Specialized workflow',capabilities:['Convert dimensions safely'],nonGoals:['Real payments'],mainJourney:'Submit valid input, get result, reject incompatible input',timeToFirstValue:range(1,3,'minutes'),reasonToPay:'Avoid paid manual work',reasonToStay:b.body.reasonToStay,pricing:b.body.pricing,gtmKey:`gtm:${productId}`,acceptanceCriteria:[{id:'valid-result',description:'Correct result and invalid input errors'}],designExpectations:['Clear readable interface'],gates:[{gate:'FUNCTIONAL',required:true,criterion:'Main journey works',minimumLevel:3,requiresBrowser:false},{gate:'UX',required:true,criterion:'Understandable user journey',minimumLevel:3,requiresBrowser:false}],successMetrics:[{key:'gross',definitionRevision:1,criterion:'Observed revenue'}],constraints:['Private only'],risks:['Platform could bundle'],briefContent:structuredClone(UNKNOWN_BRIEFS[4].content),changeReason:'Initial contract before build/results',authorizedBy:'ENTREPRENEUR'};
    os.createContract(key,body,'ENTREPRENEUR');return body;
  }
  const assessments=(block?:CompanyFunction):DomainAssessment[]=>['ENTREPRENEUR','BUILDER','GROWTH','JUDGE'].map(f=>({function:f as CompanyFunction,summary:`Concise ${f} assessment`,evidenceIds:[],claims:[],disagreements:[],blocking:f===block}));
  function target(key='week1',amount=30000,start='2026-10-12T00:00:00Z',end='2026-10-19T00:00:00Z') {
    if(!os.store.get('metricDefinition','gross'))os.record('metricDefinition','gross',{name:'Gross revenue',unit:'EUR:cents',kind:'RESULT',formula:'Sum verified paid revenue by occurred period',includes:['paid_money'],excludes:['unpaid_trials','synthetic'],changeReason:'Initial definition'},'JUDGE');
    const t:OwnerTarget={periodStart:start,periodEnd:end,timezone:'Europe/Paris',currency:'EUR',metric:'grossRevenue',metricDefinition:{key:'gross',revision:1},amountCents:amount,creatorAuthorized:true,changeReason:'Explicit creator target'};
    return os.ownerTarget(key,t,'CREATOR');
  }
  function snapshot(key:string,gross:number,cost:number,productId:string|null=null,start='2026-10-12T00:00:00Z',end='2026-10-19T00:00:00Z',synthetic=false) {
    const o=opportunity('Accounting',false),measurements=Object.fromEntries(ECONOMIC_METRICS.map(k=>[k,k==='grossRevenue'?gross:k==='acquisitionCost'?cost:0]));
    const e=evidence(o,'economics',synthetic?1:4,'supports',{currency:'EUR',periodStart:start,periodEnd:end,measurements,paymentStatus:'settled',productId});
    const metrics=Object.fromEntries(ECONOMIC_METRICS.map(k=>[k,{value:measurements[k],unit:'EUR:cents',nature:synthetic?'SYNTHETIC':'FACT',evidenceIds:[e],confidence:1,...(k==='grossRevenue'?{definition:{key:'gross',revision:1}}:{})}])) as EconomicSnapshot['metrics'];
    return os.snapshot(key,{productId,start,end,currency:'EUR',costBucketsDisjoint:true,metrics,unitEconomics:{},revenueQuality:{}});
  }
  function proposal(key:string,productId:string,profit=5000,capital=1000,hours=2,ids:string[]=[]) {
    const p:CapitalProposal={...provenance,evidenceIds:ids,productId,opportunityId:null,action:'FIX',capitalCents:capital,builderHours:hours,computeUnits:100,expectedProfit:range(profit,profit+1000),successProbability:range(.8,.9,'probability'),downsideCents:100,upsideCents:profit+1000,paybackWeeks:range(1,4,'weeks'),reversibility:'EASILY_REVERSIBLE',strategicValue:'Durable customer value',marginalContribution:null,historicalSpendCents:0,alternatives:[],riskKeys:[],approvalRequired:true};
    os.record('proposal',key,p,'ENTREPRENEUR');return p;
  }
  function forecast(key:string,low=1000,high=1500,start='2026-10-12T00:00:00Z',end='2026-10-19T00:00:00Z'):Forecast {
    const body:Forecast={...provenance,productId:null,start,end,horizonWeeks:4,currency:'EUR',processKey:'process-A',metrics:{grossRevenue:range(low,high)},capitalRequired:range(100),builderHours:range(2,3,'hours'),acquisitionRequired:null,risks:['Estimates uncertain'],driverModel:{type:'b2b',drivers:{qualifiedAccounts:range(10,20,'accounts')},explanation:'Qualified accounts times close rate times value; not SaaS universal'},freshUntil:'2027-01-01T00:00:00Z'};
    os.forecast(key,body,'ENTREPRENEUR');return body;
  }
  return {os,factory,options,provenance,range,opportunity,evidence,business,contract,product,assessments,target,snapshot,proposal,forecast,setNow:(s:string)=>{now=new Date(s);},now:()=>now};
}
