import { AppError } from "../../common/errors/app-error";
import { IncidentSeverity, IncidentStatus } from "./incident.enums";
import type { IncidentListFilters } from "./incident.types";

function one(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AppError(400, "INVALID_QUERY", `Expected integer between 1 and ${max}.`);
  }
  return parsed;
}

function date(value: unknown): Date | undefined {
  const raw = one(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new AppError(400, "INVALID_QUERY", `Invalid date: ${raw}`);
  return parsed;
}

function enumValue<T extends Record<string, string>>(value: unknown, enumObject: T, field: string): T[keyof T] | undefined {
  const raw = one(value);
  if (!raw) return undefined;
  if (!Object.values(enumObject).includes(raw)) {
    throw new AppError(400, "INVALID_QUERY", `Invalid ${field}.`);
  }
  return raw as T[keyof T];
}

export function parseIncidentListFilters(query: Record<string, unknown>): IncidentListFilters {
  return {
    cluster: one(query.cluster),
    site: one(query.site),
    source: one(query.source),
    type: one(query.type),
    severity: enumValue(query.severity, IncidentSeverity, "severity"),
    status: enumValue(query.status, IncidentStatus, "status"),
    resourceType: one(query.resourceType),
    from: date(query.from),
    to: date(query.to),
    page: positiveInt(query.page, 1, 1_000_000),
    limit: positiveInt(query.limit, 20, 100)
  };
}

export const queryHelpers = { one, positiveInt, date, enumValue };
