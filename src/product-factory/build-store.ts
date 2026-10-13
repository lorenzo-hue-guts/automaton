import { createHash } from "node:crypto";
import type { AutomatonDatabase } from "../types.js";
import { insertEvent } from "../state/database.js";
import { estimateTokens } from "../memory/event-stream.js";
import type { ProductBrief, BuildRecord, PrivateDeployment, BuildTaskBinding } from "./build-types.js";
export const buildHash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Typed versioned records on the existing SQLite KV, never another connection or store. */
export class BuildStore {
  constructor(readonly db: AutomatonDatabase, readonly creatorAddress: string) {}
  private read<T extends { version: 1 }>(kind: string, id: string): T | undefined {
    const value = this.db.getKV(`product-factory:${kind}:${id}`);
    if (!value) return undefined;
    const record = JSON.parse(value) as T;
    if (record.version !== 1) throw new Error("Unsupported build record version");
    return record;
  }
  brief(id: string): ProductBrief | undefined { const r = this.read<ProductBrief>("brief", id); return r?.creatorAddress === this.creatorAddress ? r : undefined; }
  build(id: string): BuildRecord | undefined { const r = this.read<BuildRecord>("build", id); return r?.creatorAddress === this.creatorAddress ? r : undefined; }
  deployment(id: string): PrivateDeployment | undefined {
    const r = this.read<PrivateDeployment>("deployment", id);
    return r && this.build(r.buildId)?.productId === r.productId ? r : undefined;
  }
  binding(taskId: string): BuildTaskBinding | undefined {
    const raw = this.db.getKV(`product-factory:build-task:${taskId}`);
    const binding = raw ? JSON.parse(raw) as BuildTaskBinding : undefined;
    return binding && this.build(binding.buildId) ? binding : undefined;
  }
  saveBrief(r: ProductBrief): void { const old = this.brief(r.id); if (old?.approvalId && JSON.stringify(old) !== JSON.stringify(r)) throw new Error("Reviewed briefs are immutable; create a new revision"); if (r.creatorAddress !== this.creatorAddress) throw new Error("Foreign brief"); this.db.setKV(`product-factory:brief:${r.id}`, JSON.stringify(r)); }
  saveBuild(r: BuildRecord): void { if (r.creatorAddress !== this.creatorAddress) throw new Error("Foreign build"); this.db.setKV(`product-factory:build:${r.id}`, JSON.stringify(r)); }
  saveDeployment(r: PrivateDeployment): void { if (!this.build(r.buildId) || r.visibility !== "private" || r.publicUrl !== null || r.externallyAccessible !== false || r.costCents !== 0) throw new Error("Unsafe deployment metadata"); this.db.setKV(`product-factory:deployment:${r.id}`, JSON.stringify(r)); }
  bind(taskId: string, binding: BuildTaskBinding): void { this.db.setKV(`product-factory:build-task:${taskId}`, JSON.stringify(binding)); }
  audit(action: string, ids: Record<string, string>): void {
    const content = JSON.stringify({ action, ...ids });
    insertEvent(this.db.raw, { type: "factory_build", agentAddress: this.creatorAddress, content, tokenCount: estimateTokens(content) });
  }
}
