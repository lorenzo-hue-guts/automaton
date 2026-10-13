import type { SurfaceExecutionCapabilityEvidence, SurfaceExecutionCapability, SurfaceEnvironment, SurfaceAcceptanceReceipt } from './surface-builder-types.js';
import type { ProductSurface } from './optimization-types.js';
import { deriveSurfaceExecutionCapability } from './surface-acceptance.js';
export type MobileAction = {action:'LAUNCH'|'BACK'|'RESTART'|'SCREENSHOT'|'READ_ACCESSIBLE_UI'}|{action:'TAP'|'ASSERT_VISIBLE'|'WAIT_FOR'|'SCROLL';accessibilityId:string}|{action:'TYPE'|'SELECT'|'ASSERT_TEXT';accessibilityId:string;value:string}|{action:'GRANT_PERMISSION'|'DENY_PERMISSION';permission:string};
export const MOBILE_RUNTIME_REQUIREMENTS = Object.freeze(['authorized isolated emulator/device','exact hashed artifact installed','semantic interaction','persistence/restart','permission allow/deny if required','network isolation','crash/ANR diagnostics','bounded cleanup']);
export function assertMobilePermissions(requested:string[],required:string[]) {if(requested.some(p=>!required.includes(p)))throw Error('Unnecessary Android dangerous permission');}
export function deriveSurfaceRegistry(surface:ProductSurface,receipts:SurfaceAcceptanceReceipt[],environment:SurfaceEnvironment,mandatory:SurfaceExecutionCapability[]) {
 const caps=mandatory.map(c=>deriveSurfaceExecutionCapability(surface,c,receipts,environment));
 const status=caps.every(c=>c.status==='SUPPORTED')?'SUPPORTED':caps.some(c=>c.status==='EXPERIMENTAL'||c.status==='SUPPORTED')?'PARTIALLY_SUPPORTED':caps.some(c=>c.status==='BLOCKED')?'BLOCKED':'NOT_IMPLEMENTED';
 return {surface,status,capabilities:caps,limitations:['No cross-surface certification; no store submission or commercial validation']};
}
/** Unsigned/debug artifacts cannot certify distribution signing or store readiness. */
export function signingReadiness(mode:'unsigned'|'debug'|'release',hasValidatedConfiguration:boolean) {return mode==='debug'?'TEST_SIGNING_ONLY':hasValidatedConfiguration?'SIGNING_CONFIGURATION_READY':'NOT_CONFIGURED';}
