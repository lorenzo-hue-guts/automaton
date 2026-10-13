import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createDatabase } from "../../state/database.js";
import * as schema from "../../state/schema.js";
import { DEFAULT_CONFIG, type AutomatonDatabase } from "../../types.js";
import { appendFactoryEvent, DEFAULT_PRODUCT_FACTORY_CONFIG, ProductFactory, resolveProductFactoryConfig } from "../../product-factory/index.js";
import type { FactoryEntities, FactoryEntityKind, Product } from "../../product-factory/index.js";
import { createConfig, loadConfig, saveConfig } from "../../config.js";

const paths = vi.hoisted(() => ({ configDir: "" }));
vi.mock("../../identity/wallet.js", () => ({ getAutomatonDir: () => paths.configDir }));
vi.mock("../../identity/provision.js", () => ({ loadApiKeyFromConfig: () => undefined }));
const now = "2026-10-07T00:00:00.000Z";
const base = (id: string) => ({ id, createdAt: now });
const creator = "creator-address";
const product = (id = "product-1"): Product => ({ ...base(id), name: "Local prototype", creatorAddress: creator, opportunityId: null, stage: "draft", revenueCents: 0 });
const approval = (id: string, productId: string, action: FactoryEntities["approvals"]["action"] = "experiment"): FactoryEntities["approvals"] => ({ ...base(id), productId, action, status: "pending", requestedBy: "automaton", decidedBy: null, decidedAt: null });

/** A real V11 schema, without executing V12 or modifying any preexisting data. */
function makeV11(filename: string): void {
  const db = new Database(filename);
  for (const sql of [schema.CREATE_TABLES, schema.MIGRATION_V2, schema.MIGRATION_V3, schema.MIGRATION_V4,
    schema.MIGRATION_V4_ALTER, schema.MIGRATION_V4_ALTER2, schema.MIGRATION_V4_ALTER_INBOX_STATUS,
    schema.MIGRATION_V4_ALTER_INBOX_RETRY, schema.MIGRATION_V4_ALTER_INBOX_MAX_RETRIES,
    schema.MIGRATION_V5, schema.MIGRATION_V6, schema.MIGRATION_V7, schema.MIGRATION_V8,
    schema.MIGRATION_V9, schema.MIGRATION_V9_ALTER_CHILDREN_ROLE, schema.MIGRATION_V10, schema.MIGRATION_V11]) db.exec(sql);
  db.prepare("INSERT INTO schema_version(version) VALUES (11)").run();
  db.prepare("INSERT INTO kv(key, value) VALUES ('existing-state', 'preserve-me')").run();
  db.prepare("INSERT INTO goals(id, title, description, created_at) VALUES ('goal-1', 'Existing goal', 'Retain', ?)").run(now);
  db.close();
}

let directory: string;
let db: AutomatonDatabase;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "factory-foundations-"));
  paths.configDir = directory;
  db = createDatabase(path.join(directory, "state.db"));
});
afterEach(() => { if (db.raw.open) db.close(); rmSync(directory, { recursive: true, force: true }); });

const fixtures: FactoryEntities = {
  opportunities: { ...base("opportunity-1"), title: "Problem", problem: "Need", status: "new" },
  evidence: { ...base("evidence-1"), opportunityId: "opportunity-1", source: "local interview", content: "Observed need", confidence: 0.7 },
  products: { ...product(), opportunityId: "opportunity-1", revenueCents: 125 },
  hypotheses: { ...base("hypothesis-1"), productId: "product-1", statement: "Useful", successCriterion: "Two local users", status: "proposed" },
  experiments: { ...base("experiment-1"), productId: "product-1", hypothesisId: "hypothesis-1", goalId: null, taskId: null, status: "planned", method: "Local interview" },
  metricSnapshots: { ...base("metric-1"), productId: "product-1", experimentId: "experiment-1", metrics: { interviews: 2, conversion: 0.5 }, capturedAt: now },
  feedback: { ...base("feedback-1"), productId: "product-1", source: "local user", content: "Useful" },
  features: { ...base("feature-1"), productId: "product-1", title: "Prototype", description: "Local only", status: "proposed", taskId: null },
  decisions: { ...base("decision-1"), productId: "product-1", rationale: "Evidence supports", evidenceIds: ["evidence-1"], outcome: "Explore" },
  learnings: { ...base("learning-1"), productId: "product-1", experimentId: "experiment-1", content: "Need validated locally", confidence: 0.6 },
  resourceReservations: { ...base("reservation-1"), productId: "product-1", taskId: null, resource: "compute", units: 1, operationalCostCents: 0, status: "requested", expiresAt: now },
  capacitySnapshots: { ...base("capacity-1"), availableComputeUnits: 1, availableStorageMb: 100, availableOperationalBudgetCents: 0, capturedAt: now },
  approvals: approval("approval-1", "product-1"),
  events: { ...base("event-1"), productId: "product-1", type: "product.created", actor: creator, payload: { local: true, nested: [null, 1] } },
};
function insertFixtures(): void {
  for (const kind of Object.keys(fixtures) as FactoryEntityKind[]) db.productFactory.insert(kind, fixtures[kind]);
}

describe("Product Factory migration V12", () => {
  it("creates all 14 tables on the same connection with foreign keys enabled", () => {
    expect(db.productFactory.database).toBe(db.raw);
    expect(db.raw.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.raw.prepare("SELECT MAX(version) AS version FROM schema_version").get()).toEqual({ version: schema.SCHEMA_VERSION });
    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'factory_%'").all();
    expect(tables).toHaveLength(14);
    expect(db.raw.pragma("foreign_key_check")).toEqual([]);
  });

  it("upgrades V11 preserving existing state and reopens without repeating V12", () => {
    db.close();
    const filename = path.join(directory, "v11.db");
    makeV11(filename);
    db = createDatabase(filename);
    expect(db.getKV("existing-state")).toBe("preserve-me");
    expect(db.raw.prepare("SELECT title FROM goals WHERE id = 'goal-1'").get()).toEqual({ title: "Existing goal" });
    db.productFactory.insert("products", product());
    db.close();
    db = createDatabase(filename);
    expect(db.productFactory.get("products", "product-1")).toEqual(product());
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM schema_version WHERE version = 12").get()).toEqual({ count: 1 });
    expect(db.raw.pragma("integrity_check", { simple: true })).toBe("ok");
  });

  it("rolls back the entire migration on a DDL failure", () => {
    const filename = path.join(directory, "rollback.db");
    makeV11(filename);
    const old = new Database(filename);
    old.exec("CREATE TABLE factory_events(id TEXT PRIMARY KEY)");
    expect(() => old.transaction(() => { old.exec(schema.MIGRATION_V12); old.prepare("INSERT INTO schema_version(version) VALUES (12)").run(); })()).toThrow();
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name = 'factory_products'").get()).toBeUndefined();
    expect(old.prepare("SELECT MAX(version) AS version FROM schema_version").get()).toEqual({ version: 11 });
    old.close();
  });
});

describe("typed domain persistence", () => {
  it("round-trips every domain entity and leaves runtime treasury untouched", () => {
    db.insertTransaction({ id: "operational", type: "credit_purchase", amountCents: 10, description: "Existing", timestamp: now });
    insertFixtures();
    for (const kind of Object.keys(fixtures) as FactoryEntityKind[]) {
      expect(db.productFactory.get(kind, fixtures[kind].id)).toEqual(fixtures[kind]);
      expect(db.productFactory.list(kind)).toEqual([fixtures[kind]]);
    }
    expect(db.getRecentTransactions(10)).toHaveLength(1);
    expect(db.getRecentTransactions(10)[0].amountCents).toBe(10);
    expect(db.productFactory.get("products", "product-1")?.revenueCents).toBe(125);
    expectTypeOf(db.productFactory.get("products", "product-1")).toEqualTypeOf<Product | undefined>();
    expectTypeOf(resolveProductFactoryConfig().allowRealTransactions).toEqualTypeOf<false>();
    if (false) {
      // @ts-expect-error A product insert must not accept an opportunity.
      db.productFactory.insert("products", fixtures.opportunities);
      // @ts-expect-error Product revenue is integer cents, not textual money.
      const invalidProduct: Product = { ...product(), revenueCents: "100" };
      void invalidProduct;
    }
  });

  it("enforces referential integrity and rejects cross-product hypotheses/experiments", () => {
    db.productFactory.insert("products", product());
    db.productFactory.insert("products", product("product-2"));
    db.productFactory.insert("hypotheses", fixtures.hypotheses);
    expect(() => db.productFactory.insert("experiments", { ...fixtures.experiments, productId: "product-2" })).toThrow();
    db.productFactory.insert("experiments", fixtures.experiments);
    expect(() => db.productFactory.insert("learnings", { ...fixtures.learnings, productId: "product-2" })).toThrow();
    expect(() => db.productFactory.insert("feedback", { ...fixtures.feedback, productId: "missing" })).toThrow();
    expect(() => db.productFactory.insert("features", { ...fixtures.features, taskId: "missing" })).toThrow();
    expect(() => db.productFactory.insert("decisions", fixtures.decisions)).toThrow("Unknown evidence");
  });

  it("references existing Task Graph goals and tasks without creating another queue", () => {
    db.raw.prepare("INSERT INTO goals(id, title, description, created_at) VALUES ('goal', 'Goal', 'Existing', ?)").run(now);
    db.raw.prepare("INSERT INTO task_graph(id, goal_id, title, description, created_at) VALUES ('task', 'goal', 'Task', 'Existing', ?)").run(now);
    db.productFactory.insert("products", product());
    db.productFactory.insert("hypotheses", fixtures.hypotheses);
    db.productFactory.insert("experiments", { ...fixtures.experiments, goalId: "goal", taskId: "task" });
    expect(db.productFactory.get("experiments", "experiment-1")?.taskId).toBe("task");
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM task_graph").get()).toEqual({ count: 1 });
  });

  it("rejects invalid money, metrics, confidence, identity and reservation units", () => {
    db.productFactory.insert("products", product());
    for (const revenueCents of [-1, 0.5, NaN, Infinity]) expect(() => db.productFactory.insert("products", { ...product(String(revenueCents)), revenueCents })).toThrow();
    expect(() => db.productFactory.insert("products", { ...product("empty-owner"), creatorAddress: " " })).toThrow();
    expect(() => db.productFactory.insert("metricSnapshots", { ...fixtures.metricSnapshots, experimentId: null, metrics: { broken: NaN } })).toThrow();
    expect(() => db.productFactory.insert("resourceReservations", { ...fixtures.resourceReservations, units: 0 })).toThrow();
    db.productFactory.insert("opportunities", fixtures.opportunities);
    expect(() => db.productFactory.insert("evidence", { ...fixtures.evidence, confidence: 1.1 })).toThrow();
  });

  it("preserves creator ownership and append-only events at the SQL boundary", () => {
    insertFixtures();
    expect(() => db.raw.prepare("UPDATE factory_products SET creator_address = 'other'").run()).toThrow("immutable");
    expect(() => db.raw.prepare("UPDATE factory_events SET actor = 'other'").run()).toThrow("append-only");
    expect(() => db.raw.prepare("DELETE FROM factory_events").run()).toThrow("append-only");
    expect(() => db.raw.exec("INSERT OR REPLACE INTO factory_events SELECT * FROM factory_events")).toThrow("append-only");
    expect(() => db.raw.exec("INSERT OR REPLACE INTO factory_products SELECT * FROM factory_products")).toThrow("replacement");
    expect(() => db.raw.prepare("UPDATE factory_approvals SET status = 'approved', decided_by = 'other', decided_at = ?").run(now)).toThrow("creator");
  });

  it("scopes queries, bounds limits and uses an identifier allowlist", () => {
    insertFixtures();
    expect(db.productFactory.list("feedback", { productId: "missing" })).toEqual([]);
    expect(db.productFactory.list("feedback", { productId: "product-1", limit: 1 })).toHaveLength(1);
    expect(db.productFactory.get("products", "' OR 1=1 --")).toBeUndefined();
    expect(() => db.productFactory.list("products", { limit: -1 })).toThrow();
    expect(() => db.productFactory.list("events", { limit: 1001 })).toThrow();
    expect(() => db.productFactory.list("capacitySnapshots", { productId: "product-1" })).toThrow();
    expect(() => db.productFactory.list("products; DROP TABLE kv" as FactoryEntityKind)).toThrow();
  });
});

describe("conservative configuration", () => {
  it("defaults old and empty configurations to disabled with immutable safety limits", () => {
    expect(resolveProductFactoryConfig()).toEqual(DEFAULT_PRODUCT_FACTORY_CONFIG);
    expect(resolveProductFactoryConfig({})).toEqual(DEFAULT_PRODUCT_FACTORY_CONFIG);
    expect(DEFAULT_CONFIG.productFactory?.enabled).toBe(false);
    const resolved = resolveProductFactoryConfig();
    resolved.enabled = true;
    expect(resolveProductFactoryConfig().enabled).toBe(false);
  });
  it.each([ { enabled: "true" }, { maxActiveProducts: 0 }, { maxConcurrentExperiments: 0.5 },
    { operationalBudgetCents: -1 }, { operationalBudgetCents: Infinity }, { operationalBudgetCents: Number.MAX_SAFE_INTEGER + 1 },
    { mode: "production" }, { allowPublicLaunch: true }, { allowAdvertisingSpend: true },
    { allowRealTransactions: true }, { requireCreatorApproval: false }, { ownership: "automaton" },
    { revenueDestination: "automaton-treasury" }, { unexpected: true }, [] ])("rejects unsafe/malformed configuration %j", (raw) => {
    expect(() => resolveProductFactoryConfig(raw)).toThrow();
  });
  it("merges, persists and loads partial settings through existing configuration", () => {
    const config = createConfig({ name: "Test", genesisPrompt: "Local test", creatorAddress: creator, registeredWithConway: false, sandboxId: "local", walletAddress: "test-wallet", apiKey: "" });
    expect(config.productFactory?.enabled).toBe(false);
    saveConfig(config);
    expect(loadConfig()?.productFactory).toEqual(DEFAULT_PRODUCT_FACTORY_CONFIG);
    const filename = path.join(directory, "automaton.json");
    const raw = JSON.parse(readFileSync(filename, "utf8"));
    delete raw.productFactory;
    writeFileSync(filename, JSON.stringify(raw));
    expect(loadConfig()?.productFactory?.enabled).toBe(false);
    raw.productFactory = { enabled: true, maxActiveProducts: 2 };
    writeFileSync(filename, JSON.stringify(raw));
    expect(loadConfig()?.productFactory).toEqual({ ...DEFAULT_PRODUCT_FACTORY_CONFIG, enabled: true, maxActiveProducts: 2 });
    raw.productFactory.allowRealTransactions = true;
    writeFileSync(filename, JSON.stringify(raw));
    expect(loadConfig()).toBeNull();
    expect(() => saveConfig({ ...config, productFactory: raw.productFactory })).toThrow();
  });
});

describe("local lifecycle and events", () => {
  it("does nothing when disabled", () => {
    const factory = new ProductFactory(db, undefined, creator);
    expect(() => factory.createProduct("Test")).toThrow("disabled");
    expect(() => factory.transitionProduct("missing", "building")).toThrow("disabled");
    expect(() => factory.decideApproval("missing", "approved")).toThrow("disabled");
    expect(db.productFactory.list("products")).toEqual([]);
    expect(db.productFactory.list("events")).toEqual([]);
  });
  it("enforces capacity, creator approval and local stage transitions", () => {
    const factory = new ProductFactory(db, resolveProductFactoryConfig({ enabled: true }), creator);
    const p = factory.createProduct("  Local product  ");
    expect(p.name).toBe("Local product");
    expect(p.creatorAddress).toBe(creator);
    expect(() => factory.createProduct("Second")).toThrow("capacity");
    expect(() => factory.transitionProduct(p.id, "building")).toThrow("transition");
    expect(() => factory.transitionProduct(p.id, "validating")).toThrow("approval");
    db.productFactory.insert("approvals", approval("validate", p.id));
    factory.decideApproval("validate", "approved");
    expect(() => factory.decideApproval("validate", "rejected")).toThrow("already decided");
    expect(() => db.raw.prepare("UPDATE factory_approvals SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = 'validate'").run()).toThrow("already decided");
    expect(factory.transitionProduct(p.id, "validating").stage).toBe("validating");
    db.productFactory.insert("approvals", approval("build", p.id, "prototype"));
    factory.decideApproval("build", "approved");
    expect(factory.transitionProduct(p.id, "building").stage).toBe("building");
    factory.transitionProduct(p.id, "archived");
    expect(() => factory.transitionProduct(p.id, "draft")).toThrow("transition");
    expect(factory.createProduct("Next").stage).toBe("draft");
    expect(db.productFactory.list("events", { productId: p.id }).map((event) => event.type)).toEqual([
      "product.created", "approval.decided", "product.stage_changed", "approval.decided", "product.stage_changed", "product.stage_changed",
    ]);
    expect(db.getRecentTransactions(10)).toEqual([]);
    expect(db.getHeartbeatEntries()).toEqual([]);
  });
  it("rejects another creator and rejected approvals", () => {
    db.productFactory.insert("products", product());
    db.productFactory.insert("approvals", approval("reject", "product-1"));
    const other = new ProductFactory(db, resolveProductFactoryConfig({ enabled: true }), "other");
    expect(() => other.decideApproval("reject", "approved")).toThrow("another creator");
    expect(() => other.transitionProduct("product-1", "paused")).toThrow("another creator");
    const factory = new ProductFactory(db, resolveProductFactoryConfig({ enabled: true }), creator);
    factory.decideApproval("reject", "rejected");
    expect(() => factory.transitionProduct("product-1", "validating")).toThrow("approval");
  });
  it("rolls back lifecycle state and approvals if event persistence fails", () => {
    const factory = new ProductFactory(db, resolveProductFactoryConfig({ enabled: true }), creator);
    const p = factory.createProduct("Local");
    db.productFactory.insert("approvals", approval("pending", p.id));
    db.raw.exec("CREATE TRIGGER reject_factory_event BEFORE INSERT ON factory_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    expect(() => factory.transitionProduct(p.id, "paused")).toThrow("audit unavailable");
    expect(db.productFactory.get("products", p.id)?.stage).toBe("draft");
    expect(() => factory.decideApproval("pending", "approved")).toThrow("audit unavailable");
    expect(db.productFactory.get("approvals", "pending")?.status).toBe("pending");
    expect(db.productFactory.list("events")).toHaveLength(1);
    expect(() => db.raw.prepare("DELETE FROM factory_products WHERE id = ?").run(p.id)).toThrow("FOREIGN KEY");
  });
  it("rolls back product creation when its initial event cannot be saved", () => {
    db.raw.exec("CREATE TRIGGER reject_factory_event BEFORE INSERT ON factory_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
    const factory = new ProductFactory(db, resolveProductFactoryConfig({ enabled: true }), creator);
    expect(() => factory.createProduct("Local")).toThrow("audit unavailable");
    expect(db.productFactory.list("products")).toEqual([]);
  });
  it("appends typed events inside existing transactions", () => {
    db.productFactory.insert("products", product());
    const event = appendFactoryEvent(db.productFactory, { productId: "product-1", actor: creator, type: "product.created", payload: { stage: "draft" } });
    expect(db.productFactory.get("events", event.id)).toEqual(event);
    expect(() => db.runTransaction(() => { appendFactoryEvent(db.productFactory, { productId: "product-1", actor: creator, type: "product.stage_changed", payload: {} }); throw new Error("rollback"); })).toThrow("rollback");
    expect(db.productFactory.list("events")).toHaveLength(1);
  });
});
