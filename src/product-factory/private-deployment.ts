import type { BuildRecord, BuildValidation, PrivateDeployment, PrivateDeploymentProvider } from "./build-types.js";
/** A durable deployment intent only: no listener, public URL, DNS, VM, network or payment. */
export class SyntheticPrivateDeploymentProvider implements PrivateDeploymentProvider {
  readonly id = "synthetic-local" as const;
  deploy(build: BuildRecord, validation: BuildValidation): PrivateDeployment {
    if (!validation.passed) throw new Error("Build validation required");
    return { version: 1, id: `private:${build.id}`, buildId: build.id, productId: build.productId, provider: this.id, buildDigest: validation.artifactDigest, status: "active", visibility: "private", publicUrl: null, externallyAccessible: false, costCents: 0, createdAt: new Date().toISOString() };
  }
  rollback(deployment: PrivateDeployment): PrivateDeployment { return { ...deployment, status: "rolled_back", rolledBackAt: deployment.rolledBackAt ?? new Date().toISOString() }; }
}
