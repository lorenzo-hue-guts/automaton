import { resolveOptimizationConfig } from './optimization-config.js';
import type { OptimizationConfig } from './optimization-types.js';
import { resolveAnalyticsConfig } from './analytics-config.js';
import type { AnalyticsConfig } from './analytics-types.js';
import { resolveCompanyConfig } from './company-config.js';
import type { CompanyConfig } from './company-types.js';
import type { ResourceLimits } from "./scheduling-types.js";

export interface ProductFactoryConfig {
  enabled: boolean;
  company?: CompanyConfig;
  analytics?: AnalyticsConfig;
  optimization?: OptimizationConfig;
  resources: ResourceLimits;
  mode: "local-only";
  maxActiveProducts: number;
  maxConcurrentExperiments: number;
  operationalBudgetCents: number;
  requireCreatorApproval: true;
  allowPublicLaunch: false;
  allowAdvertisingSpend: false;
  allowRealTransactions: false;
  ownership: "creator";
  revenueDestination: "creator-product-account";
}
export const DEFAULT_RESOURCE_LIMITS: Readonly<ResourceLimits> = Object.freeze({
  globalConcurrency: 2, perProductConcurrency: 1, criticalReservedSlots: 1,
  criticalReservedComputeUnits: 1,
  buildSlots: 1, researchSlots: 1, monitoringSlots: 1, inferenceSlots: 1,
  inferenceBudgetCents: 0,
  computeUnits: 2, perProductBudgetCents: 0, ageBonusPerHour: 10,
});
export const DEFAULT_PRODUCT_FACTORY_CONFIG: Readonly<ProductFactoryConfig> = Object.freeze({
  resources: DEFAULT_RESOURCE_LIMITS,
  company: resolveCompanyConfig(),
  analytics: resolveAnalyticsConfig(),
  optimization: resolveOptimizationConfig(),
  enabled: false, mode: "local-only", maxActiveProducts: 1, maxConcurrentExperiments: 1,
  operationalBudgetCents: 0, requireCreatorApproval: true, allowPublicLaunch: false,
  allowAdvertisingSpend: false, allowRealTransactions: false, ownership: "creator",
  revenueDestination: "creator-product-account",
});
/** Invalid or unsafe configuration fails closed; old configs remain disabled. */
export function resolveProductFactoryConfig(input?: unknown): ProductFactoryConfig {
  if (input === undefined || input === null) return { ...DEFAULT_PRODUCT_FACTORY_CONFIG, resources: { ...DEFAULT_RESOURCE_LIMITS }, company: resolveCompanyConfig() };
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid Product Factory config");
  const raw = input as Record<string, unknown>;
  const config = { ...DEFAULT_PRODUCT_FACTORY_CONFIG, resources: { ...DEFAULT_RESOURCE_LIMITS }, company: resolveCompanyConfig() };
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DEFAULT_PRODUCT_FACTORY_CONFIG, key)) throw new Error(`Unknown Product Factory setting: ${key}`);
  }
  if (raw.optimization !== undefined) config.optimization = resolveOptimizationConfig(raw.optimization);
  if (raw.analytics !== undefined) config.analytics = resolveAnalyticsConfig(raw.analytics);
  if (raw.company !== undefined) config.company = resolveCompanyConfig(raw.company);
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== "boolean") throw new Error("enabled must be boolean");
    config.enabled = raw.enabled;
  }
  for (const key of ["maxActiveProducts", "maxConcurrentExperiments", "operationalBudgetCents"] as const) {
    const value = raw[key];
    if (value !== undefined) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (key === "operationalBudgetCents" ? 0 : 1)) {
        throw new Error(`Invalid Product Factory setting: ${key}`);
      }
      config[key] = value;
    }
  }
  if (raw.resources !== undefined) {
    if (!raw.resources || typeof raw.resources !== "object" || Array.isArray(raw.resources)) throw new Error("Invalid resource limits");
    for (const [key, value] of Object.entries(raw.resources)) {
      if (!Object.hasOwn(DEFAULT_RESOURCE_LIMITS, key) || typeof value !== "number" || !Number.isSafeInteger(value) ||
        value < (["criticalReservedSlots", "criticalReservedComputeUnits", "perProductBudgetCents", "inferenceBudgetCents"].includes(key) ? 0 : 1)) throw new Error(`Invalid resource limit: ${key}`);
      config.resources[key as keyof ResourceLimits] = value;
    }
    if (config.resources.criticalReservedSlots >= config.resources.globalConcurrency) throw new Error("Critical reserve must leave a normal slot");
    if (config.resources.criticalReservedComputeUnits >= config.resources.computeUnits) throw new Error("Critical reserve must leave normal compute capacity");
  }
  for (const key of ["mode", "requireCreatorApproval", "allowPublicLaunch", "allowAdvertisingSpend", "allowRealTransactions", "ownership", "revenueDestination"] as const) {
    if (raw[key] !== undefined && raw[key] !== config[key]) throw new Error(`Unsupported Product Factory setting: ${key}`);
  }
  return config;
}
