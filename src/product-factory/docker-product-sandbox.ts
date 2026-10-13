import { execFile } from "node:child_process";
import type { ProductSandboxProvider, ProductSandboxSession, SandboxResult } from "./model-build-types.js";
/** Narrow tool backend: local installed immutable image, no pulls, host mounts or published ports. */
export class DockerProductSandbox implements ProductSandboxProvider {
  get imageDigest():string { return this.image; }
  readonly isolation = "filesystem-and-network" as const;
  constructor(private readonly image: string, private readonly startupTimeoutMs = 10_000) { if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("An installed immutable image digest is required"); if(!Number.isInteger(startupTimeoutMs)||startupTimeoutMs<1000||startupTimeoutMs>60000)throw Error("Bounded startup timeout required"); }
  private command(args: string[], timeoutMs = 10_000, input?: string): Promise<SandboxResult> {
    const start = performance.now();
    return new Promise((resolve) => {
      const child = execFile("docker", args, { timeout: timeoutMs, maxBuffer: 1_000_000 }, (error, stdout, stderr) => resolve({ exitCode: error ? typeof error.code === "number" ? error.code : 124 : 0, stdout: stdout.slice(0, 64_000), stderr: stderr.slice(0, 16_000), durationMs: performance.now() - start, truncated: stdout.length > 64_000 || stderr.length > 16_000 }));
      child.stdin?.end(input ?? "");
    });
  }
  async open(buildId: string, recoverySessionId?: string): Promise<ProductSandboxSession> {
    if (!/^[0-9A-Z]{26}$/.test(buildId)) throw new Error("Invalid build identity");
    const name = `automaton-pf-${buildId.toLowerCase()}`;
    if (recoverySessionId) {
      if (recoverySessionId !== name) throw new Error("Invalid recovery identity");
      const inspected = await this.command(["inspect", name]);
      if (inspected.exitCode === 0) {
        const container = JSON.parse(inspected.stdout)[0];
        if (container.Config.Labels?.["automaton.product-build"] !== buildId || container.Image !== this.image) throw new Error("Recovery container ownership mismatch");
        const removed = await this.command(["rm", "--force", name]);
        if (removed.exitCode) throw new Error("Cannot recover orphaned product sandbox");
      }
    }
    const created = await this.command(["run", "--detach", "--pull=never", "--name", name, "--label", `automaton.product-build=${buildId}`, "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=256m", "--cpus=1", "--user=10000:10000", "--tmpfs", "/work:rw,nosuid,nodev,noexec,size=64m,uid=10000,gid=10000,mode=700", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,uid=10000,gid=10000", this.image, "-e", "setInterval(()=>{},1000)"], this.startupTimeoutMs);
    if (created.exitCode !== 0) { await this.command(["rm", "--force", name]); throw new Error("Isolated local container unavailable (no unsafe fallback)"); }
    let closed = false;
    const execute = async (argv: string[], timeoutMs: number, input?: string) => {
      if (closed || argv[0] !== "node" || argv.some((v) => typeof v !== "string" || v.includes("\0"))) throw new Error("Only isolated Node/toolchain execution supported");
      return this.command(["exec", "-i", name, "/usr/local/bin/node", ...argv.slice(1)], timeoutMs, input);
    };
    const close = async () => { if (!closed) { closed = true; await this.command(["rm", "--force", name]); } };
    return {
      id: name,
      exec: execute,
      startRuntime: async (argv, timeoutMs) => {
        if (argv[0] !== "node" || argv.some(v => typeof v !== "string" || v.includes("\0"))) throw new Error("Unsupported runtime command");
        const code = `const fs=require('fs'),cp=require('child_process');const argv=JSON.parse(fs.readFileSync(0,'utf8'));const out=fs.openSync('.factory-runtime-out',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600),err=fs.openSync('.factory-runtime-err',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);const child=cp.spawn('/usr/local/bin/node',argv.slice(1),{detached:true,stdio:['ignore',out,err]});child.on('error',()=>process.exit(1));child.on('spawn',()=>{const fd=fs.openSync('.factory-runtime-pid',fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,String(child.pid));fs.closeSync(fd);child.unref();process.stdout.write(JSON.stringify({started:true}));});`;
        return execute(["node", "-e", code], timeoutMs, JSON.stringify(argv));
      },
      stopRuntime: async () => {
        const code = `const fs=require('fs');if(fs.existsSync('.factory-runtime-pid')){if(fs.lstatSync('.factory-runtime-pid').isSymbolicLink())throw Error('symlink');const pid=Number(fs.readFileSync('.factory-runtime-pid','utf8'));if(Number.isInteger(pid)&&pid>1){try{process.kill(-pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}}fs.unlinkSync('.factory-runtime-pid');}`;
        const result = await execute(["node", "-e", code], 5000);
        if (result.exitCode) throw new Error("Cannot stop private runtime");
      },
      write: async (files) => {
        const code = `const fs=require('fs'),path=require('path');const files=JSON.parse(fs.readFileSync(0,'utf8'));for(const f of files){const target=path.resolve('/work',f.path);if(!target.startsWith('/work/'))throw Error('path');let cur='/work';for(const part of f.path.split('/')){cur=path.join(cur,part);try{if(fs.lstatSync(cur).isSymbolicLink())throw Error('symlink')}catch(e){if(e.code!=='ENOENT')throw e}}fs.mkdirSync(path.dirname(target),{recursive:true});const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,f.content)}finally{fs.closeSync(fd)}}`;
        const result = await execute(["node", "-e", code], 10_000, JSON.stringify(files)); if (result.exitCode) throw new Error("Sandbox write failed");
      },
      read: async (file) => {
        if (!/^[\w./-]+$/.test(file) || file.split("/").includes("..")) throw new Error("Invalid sandbox artifact path");
        const result = await execute(["node", "-e", "const fs=require('fs');const p=process.argv[1];if(fs.lstatSync(p).isSymbolicLink())throw Error('symlink');process.stdout.write(fs.readFileSync(p,'utf8'));", file], 10_000);
        if (result.exitCode || result.truncated) throw new Error("Sandbox read failed or artifact exceeds bounded output limit"); return result.stdout;
      }, close,
    };
  }
}
