import type { AtomicEvidence, DiscoveryOpportunity } from "./discovery-types.js";
import type { Database } from "better-sqlite3";
import type { FactoryEntities, FactoryEntityKind } from "./types.js";

const FIELDS = {
  opportunities: ["id", "createdAt", "title", "problem", "status"],
  evidence: ["id", "createdAt", "opportunityId", "source", "content", "confidence"],
  products: ["id", "createdAt", "opportunityId", "creatorAddress", "name", "stage", "revenueCents"],
  hypotheses: ["id", "createdAt", "productId", "statement", "successCriterion", "status"],
  experiments: ["id", "createdAt", "productId", "hypothesisId", "goalId", "taskId", "status", "method"],
  metricSnapshots: ["id", "createdAt", "productId", "experimentId", "metrics", "capturedAt"],
  feedback: ["id", "createdAt", "productId", "source", "content"],
  features: ["id", "createdAt", "productId", "title", "description", "status", "taskId"],
  decisions: ["id", "createdAt", "productId", "rationale", "evidenceIds", "outcome"],
  learnings: ["id", "createdAt", "productId", "experimentId", "content", "confidence"],
  resourceReservations: ["id", "createdAt", "productId", "taskId", "resource", "units", "operationalCostCents", "status", "expiresAt"],
  capacitySnapshots: ["id", "createdAt", "availableComputeUnits", "availableStorageMb", "availableOperationalBudgetCents", "capturedAt"],
  approvals: ["id", "createdAt", "productId", "action", "status", "requestedBy", "decidedBy", "decidedAt"],
  events: ["id", "createdAt", "productId", "type", "actor", "payload"],
} as const satisfies { [K in FactoryEntityKind]: readonly (keyof FactoryEntities[K])[] };
const JSON_FIELDS = new Set(["metrics", "evidenceIds", "payload"]);
const column = (field: string): string => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
function table(kind: FactoryEntityKind): string {
  // Runtime allowlist protects SQL identifiers even when called from untyped JS.
  if (!Object.hasOwn(FIELDS, kind)) throw new Error("Unknown Product Factory entity");
  return `factory_${column(kind)}`;
}
function encode(value: unknown): string | number | null {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Invalid Product Factory field value");
}
function decode<K extends FactoryEntityKind>(kind: K, row: Record<string, unknown>): FactoryEntities[K] {
  const result: Record<string, unknown> = {};
  for (const field of FIELDS[kind]) {
    const value = row[column(field)];
    result[field] = JSON_FIELDS.has(field) ? JSON.parse(value as string) as unknown : value;
  }
  if ((kind === "evidence" || kind === "decisions") && row.company_metadata != null) result.company = JSON.parse(row.company_metadata as string);
  if (kind === "decisions" && row.opportunity_id != null) result.opportunityId = row.opportunity_id;
  if (kind === "approvals" && row.factory_action_id != null) result.factoryActionId = row.factory_action_id;
  return result as unknown as FactoryEntities[K];
}
/** Typed access to the existing connection; never opens a second database. */
export class ProductFactoryStore {
  constructor(readonly database: Database) {}

  insert<K extends FactoryEntityKind>(kind: K, record: FactoryEntities[K]): void {
    const name = table(kind);
    const fields = FIELDS[kind];
    const object = record as unknown as Record<string, unknown>;
    const values = fields.map((field) => {
      const value = object[field];
      if (!JSON_FIELDS.has(field)) {
        if (field.endsWith("Cents") && (typeof value !== "number" || !Number.isSafeInteger(value))) {
          throw new Error("Money must be safe integer cents");
        }
        return encode(value);
      }
      if (field === "metrics" && (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.values(value).some((metric) => typeof metric !== "number" || !Number.isFinite(metric)))) {
        throw new Error("Metrics must contain finite numbers");
      }
      if (field === "evidenceIds" && (!Array.isArray(value) || value.some((id) => typeof id !== "string"))) {
        throw new Error("Evidence IDs must be strings");
      }
      return encode(JSON.stringify(value, (_key, entry: unknown) => {
        if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("JSON numbers must be finite");
        if (entry === undefined || typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint") {
          throw new Error("Invalid JSON value");
        }
        return entry;
      }));
    });
    if (kind === "decisions") {
      for (const id of (record as FactoryEntities["decisions"]).evidenceIds) {
        if (!this.get("evidence", id)) throw new Error(`Unknown evidence: ${id}`);
      }
    }
    if(kind === "decisions" && (record as FactoryEntities["decisions"]).company) {
      const d=record as FactoryEntities["decisions"];
      if(d.productId&&this.get("products",d.productId)?.creatorAddress!==d.company!.owner)throw new Error("Foreign company decision");
      if(d.opportunityId)for(const id of d.evidenceIds)if(this.get("evidence",id)?.opportunityId!==d.opportunityId)throw new Error("Evidence belongs to another opportunity");
      this.database.prepare(`INSERT INTO ${name} (${fields.map(column).join(", ")},opportunity_id,company_address,company_metadata) VALUES (${fields.map(()=>"?").join(", ")},?,?,?)`).run(...values,d.opportunityId??null,d.company!.owner,JSON.stringify(d.company));
      return;
    }
    if (kind === "decisions" && (record as FactoryEntities["decisions"]).opportunityId !== undefined) {
      const opportunityId = (record as FactoryEntities["decisions"]).opportunityId!;
      for (const id of (record as FactoryEntities["decisions"]).evidenceIds) {
        if (this.get("evidence", id)?.opportunityId !== opportunityId) throw new Error("Evidence belongs to another opportunity");
      }
      this.database.prepare(`INSERT INTO ${name} (${fields.map(column).join(", ")}, opportunity_id) VALUES (${fields.map(() => "?").join(", ")}, ?)`).run(...values, opportunityId);
      return;
    }
    if (kind === "approvals" && (record as FactoryEntities["approvals"]).factoryActionId !== undefined) {
      const actionId = (record as FactoryEntities["approvals"]).factoryActionId!;
      if (!actionId.trim()) throw new Error("Factory action ID required");
      this.database.prepare(`INSERT INTO ${name} (${fields.map(column).join(", ")}, factory_action_id) VALUES (${fields.map(() => "?").join(", ")}, ?)`)
        .run(...values, actionId);
      return;
    }
    this.database.prepare(`INSERT INTO ${name} (${fields.map(column).join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`).run(...values);
  }

  insertDiscoveryOpportunity(record: DiscoveryOpportunity): void {
    this.database.transaction(() => {
      this.insert("opportunities", record);
      this.updateDiscoveryOpportunity(record.id, record.discovery, record.status);
    }).immediate();
  }
  updateDiscoveryOpportunity(id: string, metadata: DiscoveryOpportunity["discovery"], status?: FactoryEntities["opportunities"]["status"]): void {
    if (!metadata.creatorAddress.trim()) throw new Error("Creator required");
    const result = this.database.prepare("UPDATE factory_opportunities SET discovery_metadata = ?, status = COALESCE(?, status) WHERE id = ?").run(JSON.stringify(metadata), status ?? null, id);
    if (result.changes !== 1) throw new Error("Unknown opportunity");
  }
  getDiscoveryOpportunity(id: string): DiscoveryOpportunity | undefined {
    const row = this.database.prepare("SELECT * FROM factory_opportunities WHERE id = ? AND discovery_metadata IS NOT NULL").get(id) as Record<string, unknown> | undefined;
    return row ? { ...decode("opportunities", row), discovery: JSON.parse(row.discovery_metadata as string) as DiscoveryOpportunity["discovery"] } : undefined;
  }
  listDiscoveryOpportunities(creatorAddress: string): DiscoveryOpportunity[] {
    const rows = this.database.prepare("SELECT id FROM factory_opportunities WHERE json_extract(discovery_metadata, '$.creatorAddress') = ? ORDER BY id").all(creatorAddress) as { id: string }[];
    return rows.map((r) => this.getDiscoveryOpportunity(r.id)!);
  }
  insertAtomicEvidence(record: AtomicEvidence): void {
    this.database.transaction(() => {
      this.insert("evidence", record);
      this.database.prepare("UPDATE factory_evidence SET discovery_metadata = ?, signal_fingerprint = ? WHERE id = ?").run(JSON.stringify(record.provenance), record.provenance.fingerprint, record.id);
    }).immediate();
  }
  getAtomicEvidence(id: string): AtomicEvidence | undefined {
    const row = this.database.prepare("SELECT * FROM factory_evidence WHERE id = ? AND discovery_metadata IS NOT NULL").get(id) as Record<string, unknown> | undefined;
    return row ? { ...decode("evidence", row), provenance: JSON.parse(row.discovery_metadata as string) as AtomicEvidence["provenance"] } : undefined;
  }
  listAtomicEvidence(opportunityId: string): AtomicEvidence[] {
    const rows = this.database.prepare("SELECT id FROM factory_evidence WHERE opportunity_id = ? AND discovery_metadata IS NOT NULL ORDER BY id").all(opportunityId) as { id: string }[];
    return rows.map((r) => this.getAtomicEvidence(r.id)!);
  }

  get<K extends FactoryEntityKind>(kind: K, id: string): FactoryEntities[K] | undefined {
    const row = this.database.prepare(`SELECT * FROM ${table(kind)} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? decode(kind, row) : undefined;
  }

  list<K extends FactoryEntityKind>(kind: K, options: { productId?: string; limit?: number } = {}): FactoryEntities[K][] {
    const name = table(kind);
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid list limit");
    if (options.productId !== undefined && !(FIELDS[kind] as readonly string[]).includes("productId")) {
      throw new Error("Entity does not have a product scope");
    }
    const scoped = options.productId !== undefined;
    const rows = this.database.prepare(`SELECT * FROM ${name}${scoped ? " WHERE product_id = ?" : ""} ORDER BY created_at, id LIMIT ?`)
      .all(...(scoped ? [options.productId!, limit] : [limit])) as Record<string, unknown>[];
    return rows.map((row) => decode(kind, row));
  }
}
