import { createHash } from "node:crypto";

export function createConsulFingerprint(input: {
  clusterId: string;
  type: string;
  resourceType: string;
  resourceKey: string;
}): string {
  return createHash("sha256")
    .update([input.clusterId, "CONSUL", input.type, input.resourceType, input.resourceKey].join("|"))
    .digest("hex");
}
