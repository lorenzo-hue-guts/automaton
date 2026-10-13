import type { PolicyEngine } from '../agent/policy-engine.js';
import type { ToolContext } from '../types.js';
import { SpendTracker } from '../agent/spend-tracker.js';
export interface CompanyIntent { action:string;productId:string|null;capitalCents:number;externalExecution:false }
export type CompanyAdmission=(intent:CompanyIntent)=>{allowed:boolean;reason:string};
export function createCompanyPolicyAdmission(policy:PolicyEngine,context:()=>ToolContext):CompanyAdmission {
  return intent=>{
    const ctx=context();
    const decision=policy.evaluate({tool:{name:'company_governance',description:'Local company planning; no external execution',parameters:{},category:'memory',riskLevel:'safe',execute:async()=>''},args:{...intent},context:ctx,turnContext:{inputSource:'system',turnToolCallCount:0,sessionSpend:new SpendTracker(ctx.db.raw)}});
    policy.logDecision(decision);
    return {allowed:decision.action==='allow',reason:`${decision.reasonCode}: ${decision.humanMessage}`};
  };
}
