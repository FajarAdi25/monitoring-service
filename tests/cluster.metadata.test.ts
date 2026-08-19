import assert from "node:assert/strict";
import test from "node:test";
import { ClusterEnvironment } from "../src/modules/clusters/cluster.enums";
import type { ClusterEntity } from "../src/modules/clusters/cluster.entity";
import { toClusterMetadata } from "../src/modules/clusters/cluster.types";

test("cluster metadata excludes Nomad URL and token", () => {
  const cluster = {
    clusterId: "1",
    url: "https://10.11.39.32:4646",
    clusterName: "Cluster EAST",
    site: "cawang",
    appName: "Nomad East Lab App",
    env: ClusterEnvironment.PRODUCTION,
    token: "f61f7a1e-57e6-fe85-90d8-e94fd311b298",
    createdAt: new Date("2026-08-19T00:00:00.000Z"),
    updatedAt: new Date("2026-08-19T00:00:00.000Z")
  } as ClusterEntity;

  const metadata = toClusterMetadata(cluster);

  assert.deepEqual(metadata, {
    clusterId: "1",
    clusterName: "Cluster EAST",
    site: "cawang",
    appName: "Nomad East Lab App",
    env: ClusterEnvironment.PRODUCTION
  });
  assert.equal("url" in metadata, false);
  assert.equal("token" in metadata, false);
});
