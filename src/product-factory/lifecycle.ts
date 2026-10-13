import { ulid } from "ulid";
import { appendFactoryEvent } from "./events.js";
import type { AutomatonDatabase } from "../types.js";
import { resolveProductFactoryConfig, type ProductFactoryConfig } from "./config.js";
import type { Approval, FactoryEvent, Product, ProductStage } from "./types.js";

export const PRODUCT_STAGE_TRANSITIONS: Readonly<Record<ProductStage, readonly ProductStage[]>> = Object.freeze({
  draft: Object.freeze(["validating", "paused", "archived"] as const),
  validating: Object.freeze(["building", "paused", "archived"] as const),
  building: Object.freeze(["paused", "archived"] as const),
  paused: Object.freeze(["validating", "building", "archived"] as const),
  archived: Object.freeze([]),
});

/** Local lifecycle only. No timers, external tools, wallet calls or payment execution. */
export class ProductFactory {
  private readonly config: Readonly<ProductFactoryConfig>;
  constructor(private readonly db: AutomatonDatabase, config: ProductFactoryConfig | undefined, private readonly creatorAddress: string) {
    this.config = Object.freeze(resolveProductFactoryConfig(config));
    if (!creatorAddress.trim()) throw new Error("Product creator is required");
  }

  private requireEnabled(): void {
    if (!this.config.enabled) throw new Error("Product Factory is disabled");
  }

  private ownedProduct(id: string): Product {
    const product = this.db.productFactory.get("products", id);
    if (!product) throw new Error("Unknown product");
    if (product.creatorAddress !== this.creatorAddress) throw new Error("Product belongs to another creator");
    return product;
  }

  private event(productId: string, type: FactoryEvent["type"], payload: FactoryEvent["payload"]): void {
    appendFactoryEvent(this.db.productFactory, { productId, type, actor: this.creatorAddress, payload });
  }

  createProduct(name: string, opportunityId: string | null = null): Product {
    this.requireEnabled();
    if (!name.trim()) throw new Error("Product name is required");
    return this.db.runTransaction(() => {
      const count = this.db.raw.prepare("SELECT COUNT(*) AS count FROM factory_products WHERE stage != 'archived' AND portfolio_state NOT IN ('killed','archived')").get() as { count: number };
      if (count.count >= this.config.maxActiveProducts) throw new Error("Product capacity reached");
      const product: Product = {
        id: ulid(), name: name.trim(), opportunityId, creatorAddress: this.creatorAddress,
        stage: "draft", revenueCents: 0, createdAt: new Date().toISOString(),
      };
      this.db.productFactory.insert("products", product);
      this.event(product.id, "product.created", { stage: "draft" });
      return product;
    });
  }

  transitionProduct(id: string, stage: ProductStage): Product {
    this.requireEnabled();
    return this.db.runTransaction(() => {
      const product = this.ownedProduct(id);
      if (!PRODUCT_STAGE_TRANSITIONS[product.stage].includes(stage)) throw new Error("Invalid product lifecycle transition");
      if (stage === "validating" || stage === "building") {
        const action = stage === "building" ? "prototype" : "experiment";
        const approval = this.db.raw.prepare("SELECT id FROM factory_approvals WHERE product_id = ? AND action = ? AND status = 'approved' AND decided_by = ? LIMIT 1").get(id, action, this.creatorAddress);
        if (!approval) throw new Error("Creator approval required");
      }
      this.db.raw.prepare(`UPDATE factory_products SET stage = ?, portfolio_state = CASE ?
        WHEN 'validating' THEN 'validation' WHEN 'building' THEN 'building' WHEN 'archived' THEN 'archived'
        ELSE portfolio_state END WHERE id = ?`).run(stage, stage, id);
      this.event(id, "product.stage_changed", { from: product.stage, to: stage });
      return { ...product, stage };
    });
  }

  decideApproval(id: string, status: "approved" | "rejected"): Approval {
    this.requireEnabled();
    if (status !== "approved" && status !== "rejected") throw new Error("Invalid approval decision");
    return this.db.runTransaction(() => {
      const approval = this.db.productFactory.get("approvals", id);
      if (!approval) throw new Error("Unknown approval");
      this.ownedProduct(approval.productId);
      if (approval.status !== "pending") throw new Error("Approval already decided");
      const decidedAt = new Date().toISOString();
      this.db.raw.prepare("UPDATE factory_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(status, this.creatorAddress, decidedAt, id);
      this.event(approval.productId, "approval.decided", { approvalId: id, status });
      return { ...approval, status, decidedBy: this.creatorAddress, decidedAt };
    });
  }
}
