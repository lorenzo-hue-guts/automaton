import type { AcceptanceProbe, BrowserAcceptanceProvider, ProductSandboxSession } from './model-build-types.js';
import type { SurfaceAcceptancePlan } from './surface-builder-types.js';
import { privateRoute } from './application-acceptance.js';
/** Trusted harness script; product/model never supplies executable acceptance code. */
async function browserProgram() {
 const fs=require('fs'),crypto=require('crypto');const config=JSON.parse(fs.readFileSync(0,'utf8'));
 let browser:any;const begun=Date.now(),observations:any[]=[],findings:any[]=[],screenshots:any[]=[];
 const finding=(type:string,message:string,step:number|null,viewport:string|null)=>findings.push({type,severity:'critical',strength:'DETERMINISTIC_ASSERTION',message:message.slice(0,1000),step,viewport,blocking:true});
 let launched=false,steps=0,semantic:any[]=[];
 try {
  const {chromium}=require('/toolchain/playwright-core');
  browser=await chromium.launch({executablePath:'/usr/lib/chromium/chromium',chromiumSandbox:true,headless:true,timeout:Math.min(config.timeoutMs,10000),args:['--disable-dev-shm-usage','--no-first-run','--no-default-browser-check']});launched=true;
  const origin='http://127.0.0.1:'+config.port;
  for(const viewport of config.viewports){
   const context=await browser.newContext({viewport:{width:viewport.width,height:viewport.height},acceptDownloads:false,serviceWorkers:'block'});
   context.on('page',(popup:any)=>{if(context.pages().length>1){finding('UNEXPECTED_WINDOW','Popup blocked',null,viewport.name);void popup.close();}});
   const page=await context.newPage();page.setDefaultTimeout(Math.min(3000,config.timeoutMs));
   await context.route('**/*',async(route:any)=>{const u=new URL(route.request().url());if(u.origin!==origin){finding('UNEXPECTED_NETWORK','Blocked destination origin '+u.origin,null,viewport.name);await route.abort();}else await route.continue();});
   page.on('pageerror',(err:any)=>finding('RUNTIME_EXCEPTION',err.message,null,viewport.name));
   page.on('download',()=>finding('UNCONTROLLED_DOWNLOAD','Download denied',null,viewport.name));
   page.on('crash',()=>finding('BROWSER_CRASH','Page crashed',null,viewport.name));
   page.on('requestfailed',(req:any)=>{if(req.url().startsWith(origin))finding('REQUEST_FAILURE',new URL(req.url()).pathname,null,viewport.name);});
   await page.goto(origin+config.probe.browser.path,{waitUntil:'domcontentloaded'});
   if(!(await page.locator('body').innerText()).trim())finding('BLANK_RENDER','Empty rendered document',null,viewport.name);
   for(let i=0;i<config.probe.browser.steps.length;i++){
    if(Date.now()-begun>=config.timeoutMs)throw Error('Acceptance wall-clock limit');
    const s=config.probe.browser.steps[i];let target:any;
    if(s.target){target=s.target.kind==='role'?page.getByRole(s.target.role,{name:s.target.name,exact:true}):s.target.kind==='label'?page.getByLabel(s.target.name,{exact:true}):page.getByTestId(s.target.name);}else if(s.selector)target=page.locator(s.selector);
    try{
     switch(s.action){
      case 'fill':case 'TYPE':await target.fill(s.value);break;
      case 'click':case 'CLICK':case 'SUBMIT':await target.click();break;
      case 'visible':case 'ASSERT_TEXT':if(!await target.isVisible()||!String(await target.innerText()).includes(s.text))throw Error('Required visible text missing');break;
      case 'ASSERT_VISIBLE':if(!await target.isVisible())throw Error('Required element not visible');break;
      case 'ASSERT_STATE':if(s.state==='enabled'?!await target.isEnabled():s.state==='checked'?!await target.isChecked():s.state==='focused'?!await target.evaluate((e:any)=>e===document.activeElement):true)throw Error('Required control state missing');break;
      case 'SELECT':await target.selectOption(s.value);break;
      case 'WAIT_FOR':await target.waitFor({state:'visible'});break;
      case 'NAVIGATE':await page.goto(origin+s.path,{waitUntil:'domcontentloaded'});break;
      case 'ASSERT_URL':if(new URL(page.url()).pathname!==s.path)throw Error('Unexpected private route');break;
      case 'RELOAD':await page.reload({waitUntil:'domcontentloaded'});break;
      case 'BACK':await page.goBack();break;
      case 'SCROLL':await target.scrollIntoViewIfNeeded();break;
      case 'READ_ACCESSIBLE_STATE':semantic.push({viewport:viewport.name,step:i,title:await page.title(),route:new URL(page.url()).pathname,snapshot:(await page.locator('body').ariaSnapshot()).slice(0,5000)});break;
      case 'SCREENSHOT':if(screenshots.length>=config.maxScreenshots)throw Error('Screenshot evidence budget exhausted');if(screenshots.length<config.maxScreenshots){const b=await page.screenshot({type:'jpeg',quality:30});if(b.length>16000)throw Error('Screenshot evidence size bound');screenshots.push({sha256:crypto.createHash('sha256').update(b).digest('hex'),base64:b.toString('base64'),step:i,route:new URL(page.url()).pathname,viewport:viewport.name,format:'jpeg',timestamp:new Date().toISOString()});}break;
      default:throw Error('Unsupported bounded browser action');
     }
     steps++;
    }catch(err:any){finding('JOURNEY_FAILURE',err.message,i,viewport.name);break;}
   }
   const issues=await page.evaluate(()=>{const out:string[]=[];if(document.documentElement.scrollWidth>innerWidth+2)out.push('VIEWPORT_OVERFLOW');for(const e of Array.from(document.querySelectorAll('button,input,select,textarea,a[href]')).slice(0,100)){const rect=e.getBoundingClientRect();if(!rect.width||!rect.height)continue;if(!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&!e.textContent?.trim()&&!(e as HTMLInputElement).labels?.length)out.push('MISSING_ACCESSIBLE_NAME');}return out;});
   for(const issue of issues)finding(issue,'Automated layout/accessibility check failed',null,viewport.name);
   await context.close();
  }
 }catch(err:any){finding(launched?'EXECUTION_FAILURE':'BROWSER_UNAVAILABLE',err.message,null,null);}
 finally{if(browser)await browser.close();}
 observations.push({capability:'BROWSER_LAUNCH',passed:launched,strength:'RUNTIME_RECEIPT',detail:'Actual Chromium process launch'},...(['BROWSER_NAVIGATION','BROWSER_INTERACTION','VISUAL_INSPECTION','ACCESSIBILITY','NETWORK_BEHAVIOR','CRASH_DETECTION'] as const).map(capability=>({capability,passed:launched&&!findings.some(f=>f.blocking),strength:'DEVICE_OR_BROWSER_ACCEPTANCE',detail:'Declared bounded journey and automated checks; no full usability/WCAG claim'})));
 const body={passed:launched&&!findings.some(f=>f.blocking),status:!launched?'BLOCKED':findings.some(f=>f.blocking)?'FAIL':'PASS',engine:browser?browser.version():null,observations,findings,screenshots,semantic,firstValue:config.probe.browser.firstValueStep===undefined?null:{achieved:launched&&!findings.some(f=>f.blocking)&&steps>=config.probe.browser.firstValueStep+1,steps,elapsedMs:Date.now()-begun}};
 process.stdout.write(JSON.stringify(body));process.exitCode=body.passed?0:body.status==='BLOCKED'?125:1;
}
/** Fixed trusted harness source for an independently isolated runner; never supplied by a product. */
export const trustedBrowserProgramSource=()=>`(${browserProgram.toString()})().catch(e=>{process.stderr.write(String(e));process.exitCode=1})`;
export function validateBrowserProbe(probe:AcceptanceProbe):void {
 const b=probe.browser;if(!b||!privateRoute(b.path)||!Array.isArray(b.steps)||!b.steps.length||b.steps.length>60)throw Error('Bounded browser plan required');
 const actions=['fill','click','visible','NAVIGATE','CLICK','TYPE','SELECT','SUBMIT','WAIT_FOR','ASSERT_VISIBLE','ASSERT_TEXT','ASSERT_STATE','ASSERT_URL','RELOAD','BACK','SCROLL','SCREENSHOT','READ_ACCESSIBLE_STATE'];
 if(probe.kind==='persistence'&&(!b.persistenceLayer||!b.steps.some(s=>s.action==='RELOAD')||!b.steps.some(s=>s.action==='ASSERT_TEXT'||s.action==='visible')))throw Error('Persistence requires reload and post-reload assertion with declared durable layer');
 if(b.firstValueStep!==undefined&&(!Number.isInteger(b.firstValueStep)||b.firstValueStep<0||b.firstValueStep>=b.steps.length))throw Error('Invalid declared first-value checkpoint');
 for(const step of b.steps){if('value'in step&&(typeof step.value!=='string'||step.value.length>10000)||'text'in step&&(typeof step.text!=='string'||step.text.length>1000))throw Error('Bounded browser data required');if(!actions.includes(step.action)||'path'in step&&!privateRoute(step.path))throw Error('Forbidden browser action/origin');if('selector'in step&&(typeof step.selector!=='string'||step.selector.length>200||/[{};\n]/.test(step.selector)))throw Error('Invalid stable selector');if('target'in step&&step.target&&(!['role','label','testId'].includes(step.target.kind)||step.target.name.length>100))throw Error('Invalid semantic target');}
}
export class IsolatedPlaywrightAcceptance implements BrowserAcceptanceProvider {
 readonly execution='real' as const;
 async runPlan(session:ProductSandboxSession,port:number,plan:SurfaceAcceptancePlan) {
  validateBrowserProbe(plan.probe);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Private runtime port required');
  return session.exec(['node','-e',trustedBrowserProgramSource()],Math.ceil(plan.timeoutMs),JSON.stringify({...plan,port}));
 }
 run(session:ProductSandboxSession,port:number,probe:AcceptanceProbe,timeoutMs:number) {
  return this.runPlan(session,port,{probe,timeoutMs,viewports:probe.browser?.viewports??[{name:'DESKTOP',width:1280,height:800}],maxScreenshots:2} as SurfaceAcceptancePlan);
 }
}
