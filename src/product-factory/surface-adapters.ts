import { privateHttp } from './application-acceptance.js';
import type { ProductSurface } from './optimization-types.js';
import type { ProductArchitecture, ProductSandboxSession, SandboxResult } from './model-build-types.js';
import type { SurfaceBuilderAdapter, SurfaceEnvironment, SurfaceAdapterResolution, SurfaceAcceptancePlan, SurfaceAcceptanceProfile } from './surface-builder-types.js';
import { IsolatedPlaywrightAcceptance } from './surface-browser.js';
export function acceptanceProfile(surface:ProductSurface):SurfaceAcceptanceProfile {
 const common=['PROJECT_GENERATION','STATIC_VALIDATION','COMPILATION','UNIT_TEST','PACKAGE'] as const;
 const web=['RUNTIME_START','BROWSER_LAUNCH','BROWSER_NAVIGATION','BROWSER_INTERACTION','NETWORK_BEHAVIOR','CRASH_DETECTION'] as const;
 const mobile=['DEPENDENCY_RESOLUTION','MOBILE_LAUNCH','MOBILE_INTERACTION','NETWORK_BEHAVIOR','CRASH_DETECTION'] as const;
 return {surface,version:1,mandatory:[...common,...(surface==='API_SERVICE'?['RUNTIME_START','HTTP_ACCEPTANCE'] as const:['ANDROID','IOS','MOBILE_CROSS_PLATFORM'].includes(surface)?mobile:web)],optional:['PERSISTENCE','VISUAL_INSPECTION','ACCESSIBILITY','PERMISSIONS','SIGNING_READINESS','STORE_ARTIFACT_READINESS'],limitations:['Product Contract adds relevant persistence, viewport, permission and quality requirements','Automated acceptance is not customer or commercial validation']};
}
export class WebSurfaceAdapter implements SurfaceBuilderAdapter {
 readonly id='isolated-playwright';readonly version='1';readonly surfaces=['WEB_APP','WEB_SAAS','PWA'] as const;
 validateEnvironment(e:SurfaceEnvironment):SurfaceAdapterResolution['status'] {return e.browser==='AVAILABLE'?'EXPERIMENTAL':e.browser==='BLOCKED'?'BLOCKED':'NOT_IMPLEMENTED';}
 validateArchitecture(a:ProductArchitecture) {if(!a.runtime)throw Error('Web acceptance requires declared private HTTP runtime');}
 interact(s:ProductSandboxSession,port:number,p:SurfaceAcceptancePlan) {return new IsolatedPlaywrightAcceptance().runPlan(s,port,p);}
}
/** Android uses the same Node tool entrypoint with a provisioned offline SDK image. */
export class AndroidSurfaceAdapter implements SurfaceBuilderAdapter {
 readonly id='offline-native-android';readonly version='1';readonly surfaces=['ANDROID'] as const;
 validateEnvironment(e:SurfaceEnvironment):SurfaceAdapterResolution['status'] {return e.androidBuild==='AVAILABLE'?'EXPERIMENTAL':e.androidBuild==='BLOCKED'?'BLOCKED':'NOT_IMPLEMENTED';}
 validateArchitecture(a:ProductArchitecture) {if(a.surface!=='ANDROID'||a.runtime||a.commands.build[1]!=='/toolchain/android-build.cjs'||!a.compiledArtifacts.some(p=>p.endsWith('.apk')))throw Error('Exact bounded Android architecture required');}
 async interact(_s:ProductSandboxSession,_port:number,_p:SurfaceAcceptancePlan):Promise<SandboxResult> {return {exitCode:125,stdout:'',stderr:'BLOCKED_BY_ENVIRONMENT: no verified Android emulator/device runner',durationMs:0};}
}
export class IOSSurfaceAdapter implements SurfaceBuilderAdapter {
 readonly id='authorized-macos-runner';readonly version='1';readonly surfaces=['IOS'] as const;
 validateEnvironment(e:SurfaceEnvironment):SurfaceAdapterResolution['status'] {return e.ios==='AVAILABLE'?'NOT_IMPLEMENTED':'UNSUPPORTED_ENVIRONMENT';}
 validateArchitecture():void {throw Error('Authorized macOS runner not configured; iOS cannot compile on this adapter');}
 async interact():Promise<SandboxResult> {return {exitCode:125,stdout:'',stderr:'BLOCKED_BY_ENVIRONMENT: authorized macOS/Xcode runner required',durationMs:0};}
}
export class SurfaceAdapterRegistry {
 private adapters=new Map<ProductSurface,SurfaceBuilderAdapter>();
 register(a:SurfaceBuilderAdapter) {for(const surface of a.surfaces){if(this.adapters.has(surface))throw Error('Duplicate surface adapter');this.adapters.set(surface,a);}}
 resolve(surface:ProductSurface,e:SurfaceEnvironment):SurfaceAdapterResolution {
  const a=this.adapters.get(surface);return a?{status:a.validateEnvironment(e),adapter:a,reason:'Requested surface resolved exactly; no strategy substitution'}:{status:'NOT_IMPLEMENTED',adapter:null,reason:`No implemented adapter for ${surface}`};
 }
}

export class APISurfaceAdapter implements SurfaceBuilderAdapter {
 readonly id='private-http-api';readonly version='1';readonly surfaces=['API_SERVICE'] as const;
 validateEnvironment(e:SurfaceEnvironment):SurfaceAdapterResolution['status'] {return e.toolchain.node?'EXPERIMENTAL':'BLOCKED';}
 validateArchitecture(a:ProductArchitecture) {if(!a.runtime)throw Error('API requires private HTTP runtime');}
 interact(s:ProductSandboxSession,port:number,p:SurfaceAcceptancePlan) {if(p.probe.transport!=='http')throw Error('API acceptance requires declared HTTP probe');return privateHttp(s,port,p.probe,p.timeoutMs);}
}
export function defaultSurfaceAdapters(){const registry=new SurfaceAdapterRegistry();registry.register(new APISurfaceAdapter());registry.register(new WebSurfaceAdapter());registry.register(new AndroidSurfaceAdapter());registry.register(new IOSSurfaceAdapter());return registry;}
