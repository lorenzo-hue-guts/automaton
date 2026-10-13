import type { UnifiedInferenceResult } from "../../../inference/inference-client.js";
import type { ProductArchitecture, ModelBuildRequest, ModelBuildResponse, ProductBriefContent } from "../../../product-factory/index.js";
import type { Contract } from "./acceptance-contracts.js";

/** Test-only bounded contract compiler. No lookup by brief/product name, no catalogue of products.
 * This double proves the production protocol and execution, NOT external LLM generalization. */
function identifier(value:string):string {if(!/^[a-zA-Z_]\w*(?:\.\w+)*$/.test(value))throw Error("contract identifier");return value;}
function expression(e:any):string {
  if (!e || typeof e!=="object") return JSON.stringify(e);
  if (e.read) return identifier(e.read);
  if ("literal" in e) return JSON.stringify(e.literal);
  if (e.lookup) return `(${expression(e.lookup)})[${expression(e.key)}]`;
  if (e.object) return `{${Object.entries(e.object).map(([k,v])=>`${JSON.stringify(k)}:${expression(v)}`).join(",")}}`;
  if (e.op) {if(e.op==="type")return `(typeof ${expression(e.args[0])} === ${expression(e.args[1])})`;if(!["+","-","*","/",">",">=","===","!==","&&","||"].includes(e.op))throw Error("operator");return `(${e.args.map(expression).join(` ${e.op} `)})`;}
  if (e.call==="length") return `(${expression(e.value)}).length`;
  if (["find","filter","every","map"].includes(e.call)) return `(${expression(e.array)}).${e.call}((${identifier(e.as)}:any)=>(${expression(e.where)}))`;
  throw Error("Unsupported contract expression");
}
function statement(s:any):string {
  if(s.let)return `const ${identifier(s.let)}:any=${expression(s.value)};`;
  if(s.check)return `if(!(${expression(s.check)}))throw Error(${JSON.stringify(s.error)});`;
  if(s.push)return `db.${identifier(s.push)}.push(${expression(s.value)});`;
  if(s.assign)return `${identifier(s.assign)}=${expression(s.value)};`;
  if("return" in s)return `return ${expression(s.return)};`;
  throw Error("Unsupported contract statement");
}
export function compileContract(contract:Contract):{architecture:ProductArchitecture;files:{path:string;content:string}[]} {
  const paths=contract.routes.map(r=>`domain/${r.name}.ts`);
  const files=contract.routes.map(r=>({path:`domain/${r.name}.ts`,content:`export function handle(input:any,db:any):any{${r.statements.map(statement).join("")}}`}));
  const imports=contract.routes.map((r,i)=>`import {handle as action${i}} from './domain/${r.name}';`).join("\n");
  const branches=contract.routes.map((r,i)=>`if(request.method===${JSON.stringify(r.method)}&&request.url===${JSON.stringify(r.path)}){const result=action${i}(input,db);${contract.persistence?"fs.writeFileSync('state.json',JSON.stringify(db));":""}respond(200,result);return;}`).join("\n");
  let html="Private API application";
  if(contract.ui){const ui=contract.ui;html=`<!doctype html><html><body><h1>${ui.heading}</h1><form id="form">${ui.fields.map(f=>`<label>${f.name}<input name="${f.name}" type="${f.type}" value="${f.type==="number"?"3":""}"></label>`).join("")}<button id="submit">Create</button></form><pre id="result"></pre><script>document.querySelector('#form').onsubmit=async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));${ui.fields.filter(f=>f.type==="number").map(f=>`values.${f.name}=Number(values.${f.name});`).join("")}const response=await fetch(${JSON.stringify(ui.route)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)});document.querySelector('#result').textContent=JSON.stringify(await response.json())};</script></body></html>`;}
  files.push({path:"views.ts",content:`export const html=${JSON.stringify(html)};`});
  files.push({path:"server.ts",content:`${imports}\nimport {html} from './views';\ndeclare const require:any;declare const process:any;const fs=require('fs'),http=require('http');const db=${contract.persistence?"fs.existsSync('state.json')?JSON.parse(fs.readFileSync('state.json','utf8')):":""}${JSON.stringify(Object.fromEntries(Object.keys(contract.tables).map(k=>[k,[]])))};let requests=0;http.createServer((request:any,response:any)=>{requests++;function respond(status:number,body:any){response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body));}if(request.url==='/health'){respond(200,{ready:true,service:${JSON.stringify(contract.label)}});return;}if(request.url==='/metrics'){respond(200,{requests});return;}if(request.url==='/'){response.writeHead(200,{'content-type':'text/html'});response.end(html);return;}let raw='';request.on('data',(chunk:any)=>{raw+=chunk;if(raw.length>48000)request.destroy()});request.on('end',()=>{try{const input=raw?JSON.parse(raw):null;${branches}\nrespond(404,{error:'route not found'});}catch(error){respond(400,{error:error instanceof Error?error.message:'invalid input'});}});}).listen(8080,'127.0.0.1');`});
  files.push({path:"test.ts",content:"declare const require:any;const assert=require('assert');assert.ok(require('./views').html.length>0);console.log('module smoke passed');"});
  files.push({path:"package.json",content:JSON.stringify({private:true,dependencies:{}})});
  const argv=["node","/toolchain/typescript/lib/tsc.js","--strict","--target","es2022","--module","commonjs","server.ts","views.ts","test.ts",...paths];
  const architecture:ProductArchitecture={revision:1,stack:["Node.js","TypeScript"],components:contract.routes.map(r=>r.name),dataModel:Object.entries(contract.tables).map(([k,v])=>`${k}: ${v.join(",")}`),api:contract.routes.map(r=>`${r.method} ${r.path}`),frontend:contract.ui?"Native HTML forms":"HTTP JSON",backend:"Domain handlers and private HTTP transport",auth:"Role input mock only when required",payments:"mock-only",instrumentation:["requests"],tests:["Approved product contract journeys","Private HTTP","Restart"],deploymentRequirements:["No public ports or network"],referenceInsightIds:[],dependencies:[],runtime:{kind:"http",port:8080,readinessPath:"/health"},commands:{lint:[...argv,"--noEmit"],typecheck:[...argv,"--noEmit"],build:[...argv,"--outDir","dist"],test:["node","dist/test.js"],run:["node","dist/server.js"]},compiledArtifacts:["dist/server.js","dist/views.js","dist/test.js",...paths.map(p=>"dist/"+p.replace(/\.ts$/,".js"))]};
  return {architecture,files};
}
export class ContractInferenceDouble {
  readonly source="deterministic-contract-double";
  calls:ModelBuildRequest[]=[];
  fault:"compile"|"runtime"|"acceptance"|"malformed"|"path"|"dependency"|"none"="none";
  failures=1; costCredits=0;
  async chat(params:{messages:{role:string;content:string}[]}):Promise<UnifiedInferenceResult> {
    const request=JSON.parse(params.messages.find(m=>m.role==="user")!.content) as ModelBuildRequest;this.calls.push(structuredClone(request));
    const contract=(request.brief as ProductBriefContent).applicationContract as unknown as Contract;
    const generated=compileContract(contract);
    if(this.fault==="dependency")generated.architecture.dependencies=[{name:"not-approved",version:"1"}];
    let response:Omit<ModelBuildResponse,"costCents">;
    if(request.phase==="architecture")response={architecture:generated.architecture};
    else {
      if(this.failures-->0){
        if(this.fault==="compile")generated.files[0].content+="const invalid:number='wrong';";
        if(this.fault==="runtime")generated.files.find(f=>f.path==="server.ts")!.content="throw Error('Injected startup failure');\n"+generated.files.find(f=>f.path==="server.ts")!.content;
        if(this.fault==="acceptance")for(const f of generated.files)f.content=f.content.replace("input.actual - input.expected","input.actual + input.expected");
        if(this.fault==="path")generated.files[0].path="../constitution.md";
      }
      response={files:generated.files,diagnosis:request.previous?`Observed: ${request.previous.errors.join('; ')}`:"Implementation from contract",repairPlan:request.previous?["Correct the failed implementation","Retain approved contract","Rebuild and retest real interfaces"]:[],...(request.phase==="replan"?{architecture:generated.architecture}:{})};
    }
    let content=JSON.stringify(response);
    if(request.phase!=="architecture"&&this.fault==="malformed"&&this.failures===0) {this.failures=-1;content='{"files":[';}
    return {content,usage:{inputTokens:0,outputTokens:0,totalTokens:0},cost:{inputCostCredits:0,outputCostCredits:this.costCredits,totalCostCredits:this.costCredits},metadata:{providerId:this.source,modelId:"bounded-contract-codegen",tier:"reasoning",latencyMs:0,retries:0,failedProviders:[]}};
  }
}
