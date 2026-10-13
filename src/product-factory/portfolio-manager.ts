import { CompanyStore } from './company-store.js';
import type { PortfolioOverlay } from './company-types.js';
import { assertManagedLaunchReadiness } from "./build-validator.js";
import { ulid } from "ulid";
import type { AutomatonDatabase } from "../types.js";
import { cancelTask } from "../orchestration/task-graph.js";
import { appendFactoryEvent } from "./events.js";
import { resolveProductFactoryConfig, type ProductFactoryConfig } from "./config.js";
import type { Product } from "./types.js";
import type { PortfolioState } from "./scheduling-types.js";

export interface PortfolioProduct extends Product { economic?:PortfolioOverlay; portfolioState: PortfolioState; paused: boolean; failure: string | null }
const STATES: readonly PortfolioState[] = ["research", "building", "launch_ready", "validation", "optimizing", "scaling", "pivoting", "killed", "archived"];
export class PortfolioManager {
  private readonly config: ProductFactoryConfig;
  constructor(private readonly db: AutomatonDatabase, config: ProductFactoryConfig | undefined, readonly creatorAddress: string) {
    this.config = resolveProductFactoryConfig(config);
    if (!creatorAddress.trim()) throw new Error("Creator is required");
  }
  private enabled(): void { if (!this.config.enabled) throw new Error("Product Factory is disabled"); }
  get(id: string): PortfolioProduct | undefined {
    const product = this.db.productFactory.get("products", id);
    if (!product || product.creatorAddress !== this.creatorAddress) return undefined;
    const row = this.db.raw.prepare("SELECT portfolio_state, factory_paused, factory_failure FROM factory_products WHERE id = ?").get(id) as { portfolio_state: PortfolioState; factory_paused: number; factory_failure: string | null };
    const economic=new CompanyStore(this.db,this.creatorAddress).get('portfolio',id)?.body;
    return { ...product,...(economic?{economic}:{}), portfolioState: row.portfolio_state, paused: !!row.factory_paused, failure: row.factory_failure };
  }
  list(): PortfolioProduct[] {
    const ids = this.db.raw.prepare("SELECT id FROM factory_products WHERE creator_address = ? ORDER BY created_at, id").all(this.creatorAddress) as { id: string }[];
    return ids.map(({ id }) => this.get(id)!);
  }
  canReceiveWork(id: string): boolean {
    const product = this.get(id);
    return !!product && !product.paused && !product.failure && product.stage !== "paused" && product.stage !== "archived" && !["killed", "archived"].includes(product.portfolioState);
  }
  create(name: string, portfolioState: PortfolioState = "research"): PortfolioProduct {
    this.enabled();
    if (!name.trim() || !STATES.includes(portfolioState)) throw new Error("Invalid product");
    return this.db.raw.transaction(() => {
      const row = this.db.raw.prepare("SELECT COUNT(*) AS count FROM factory_products WHERE stage != 'archived' AND portfolio_state NOT IN ('killed','archived')").get() as { count: number };
      if (row.count >= this.config.maxActiveProducts) throw new Error("Product capacity reached");
      const id = ulid();
      this.db.productFactory.insert("products", { id, name: name.trim(), creatorAddress: this.creatorAddress, opportunityId: null, stage: "draft", revenueCents: 0, createdAt: new Date().toISOString() });
      this.db.raw.prepare("UPDATE factory_products SET portfolio_state = ? WHERE id = ?").run(portfolioState, id);
      appendFactoryEvent(this.db.productFactory, { productId: id, type: "product.created", actor: this.creatorAddress, payload: { portfolioState } });
      return this.get(id)!;
    }).immediate();
  }
  /** Explicit creator decision only; no automatic SCALE/PIVOT/KILL evaluator. */
  setState(id: string, state: PortfolioState, rationale: string): PortfolioProduct {
    this.enabled();
    if (!STATES.includes(state) || !rationale.trim()) throw new Error("Explicit product decision required");
    return this.db.raw.transaction(() => {
      const product = this.get(id);
      if (!product) throw new Error("Unknown/foreign product");
      if (state === "launch_ready") assertManagedLaunchReadiness(this.db, id);
      const terminal = ["killed", "archived"].includes(product.portfolioState) || product.stage === "archived";
      if (terminal && !["killed", "archived"].includes(state)) {
        const count = this.db.raw.prepare("SELECT COUNT(*) AS count FROM factory_products WHERE stage != 'archived' AND portfolio_state NOT IN ('killed','archived')").get() as { count: number };
        if (count.count >= this.config.maxActiveProducts) throw new Error("Product capacity reached");
      }
      this.db.productFactory.insert("decisions", { id: ulid(), productId: id, rationale, outcome: state, evidenceIds: [], createdAt: new Date().toISOString() });
      const failures = this.db.raw.prepare("SELECT id FROM task_graph WHERE product_id = ? AND status = 'failed'").all(id) as { id: string }[];
      for (const failed of failures) this.db.setKV(`product-factory:observed-failure:${failed.id}`, "acknowledged by creator decision");
      this.db.raw.prepare("UPDATE factory_products SET portfolio_state = ?, factory_paused = 0, factory_failure = NULL, stage = CASE WHEN stage IN ('archived','paused') THEN 'draft' ELSE stage END WHERE id = ?").run(state, id);
      if (["killed", "archived"].includes(state)) this.cancelOutstanding(id);
      appendFactoryEvent(this.db.productFactory, { productId: id, type: "product.stage_changed", actor: this.creatorAddress, payload: { from: product.portfolioState, to: state, rationale } });
      return this.get(id)!;
    }).immediate();
  }
  pause(id: string, failure: string | null = null): void {
    this.enabled();
    this.db.raw.transaction(() => {
      const product = this.get(id);
      if (!product) throw new Error("Unknown/foreign product");
      this.db.raw.prepare("UPDATE factory_products SET factory_paused = 1, factory_failure = ? WHERE id = ?").run(failure, id);
      this.cancelOutstanding(id);
      appendFactoryEvent(this.db.productFactory, { productId: id, type: "product.stage_changed", actor: this.creatorAddress,
        payload: { portfolioState: product.portfolioState, paused: true, failure } });
    }).immediate();
  }
  private cancelOutstanding(productId: string): void {
    const rows = this.db.raw.prepare("SELECT id FROM task_graph WHERE product_id = ? AND status NOT IN ('completed','failed','cancelled')").all(productId) as { id: string }[];
    for (const row of rows) cancelTask(this.db.raw, row.id);
  }
}
