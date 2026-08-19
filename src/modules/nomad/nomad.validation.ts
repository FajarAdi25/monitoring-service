export function parseNomadClusterQuery(query: Record<string, unknown>): string | undefined {
  const value = Array.isArray(query.cluster) ? query.cluster[0] : query.cluster;
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
