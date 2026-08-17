import { createHash } from "node:crypto";

export function createNomadFingerprint(input: {
  clusterId: string;
  type: string;
  resourceType: string;
  resourceKey: string;
}): string {
  return createHash("sha256")
    .update([input.clusterId, "NOMAD", input.type, input.resourceType, input.resourceKey].join("|"))
    .digest("hex");
}
