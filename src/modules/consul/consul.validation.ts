import { AppError } from "../../common/errors/app-error";
import type { ConsulHealthState } from "./consul.types";

const HEALTH_STATES: readonly ConsulHealthState[] = ["any", "passing", "warning", "critical"];

function queryString(query: Record<string, unknown>, name: string): string | undefined {
  const value = Array.isArray(query[name]) ? (query[name] as unknown[])[0] : query[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function parseConsulClusterQuery(query: Record<string, unknown>): string | undefined {
  return queryString(query, "cluster");
}

export function parseConsulDatacenterQuery(query: Record<string, unknown>): string | undefined {
  return queryString(query, "dc");
}

export function parseConsulHealthStateQuery(query: Record<string, unknown>): ConsulHealthState {
  const value = queryString(query, "state") ?? "critical";
  if (!HEALTH_STATES.includes(value as ConsulHealthState)) {
    throw new AppError(400, "INVALID_QUERY", `state must be one of: ${HEALTH_STATES.join(", ")}.`);
  }
  return value as ConsulHealthState;
}
