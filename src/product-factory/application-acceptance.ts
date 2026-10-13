import { isDeepStrictEqual } from "node:util";
import type { AcceptanceProbe, ProductSandboxSession, SandboxResult } from "./model-build-types.js";

export function privateRoute(path: string): boolean {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && path.length <= 1000 && !/[\r\n\x00]/.test(path);
}
/** Trusted client runs inside the same network-none sandbox. No host proxy/port forwarding. */
export async function privateHttp(session: ProductSandboxSession, port: number, probe: AcceptanceProbe, timeoutMs: number): Promise<SandboxResult> {
  const h = probe.http!;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !privateRoute(h.path) || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(h.method)) throw new Error("Invalid private HTTP contract");
  const code = `const http=require('http'),fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));const data=JSON.stringify(p.input??null);const request=http.request({hostname:'127.0.0.1',port:p.port,path:p.path,method:p.method,headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},response=>{let raw='';response.on('data',c=>{raw+=c;if(raw.length>48000){request.destroy(Error('response too large'));}});response.on('end',()=>{let body;try{body=JSON.parse(raw)}catch{body=raw}process.stdout.write(JSON.stringify({status:response.statusCode,body}));});});request.setTimeout(p.timeout,()=>request.destroy(Error('HTTP timeout')));request.on('error',e=>{process.stderr.write(e.message);process.exitCode=1;});request.end(data);`;
  return session.exec(["node", "-e", code], timeoutMs, JSON.stringify({ port, path: h.path, method: h.method, input: probe.input, timeout: Math.max(1, timeoutMs - 100) }));
}
export function httpAcceptancePassed(probe: AcceptanceProbe, result: SandboxResult): boolean {
  if (result.exitCode || result.truncated) return false;
  try {
    const observed = JSON.parse(result.stdout);
    if (observed.status !== probe.http!.status) return false;
    if (!probe.http!.assertions?.length) return isDeepStrictEqual(observed.body, probe.expected);
    return probe.http!.assertions.every(a => {
      const value = a.path.split(".").reduce((v: any, key) => v?.[key], observed.body);
      return (a.minimum === undefined || typeof value === "number" && value >= a.minimum) && (a.equals === undefined || isDeepStrictEqual(value, a.equals));
    });
  } catch { return false; }
}

export async function privateReadiness(session: ProductSandboxSession, port: number, path: string, timeoutMs: number): Promise<SandboxResult> {
  if (!privateRoute(path)) throw new Error("Invalid readiness path");
  const code = `const http=require('http'),fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));const end=Date.now()+p.timeout;function attempt(){const r=http.get({hostname:'127.0.0.1',port:p.port,path:p.path},response=>{response.resume();response.on('end',()=>{if(response.statusCode===200){process.stdout.write(JSON.stringify({ready:true}));}else retry()})});r.setTimeout(200,()=>r.destroy());r.on('error',retry)}function retry(){if(Date.now()>=end){let log='';try{log=fs.readFileSync('.factory-runtime-err','utf8').slice(-3000)}catch{}process.stderr.write('Private readiness failed '+log);process.exitCode=1;}else setTimeout(attempt,50)}attempt();`;
  return session.exec(["node", "-e", code], timeoutMs, JSON.stringify({port,path,timeout:Math.max(1,timeoutMs-250)}));
}
