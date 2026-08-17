import { AppError } from "../../common/errors/app-error";
import { IncidentSeverity, IncidentStatus } from "../incidents/incident.enums";

function one(value: unknown): string | undefined {
  if (Array.isArray(value)) return one(value[0]);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function bool(value: unknown, field: string): boolean | undefined {
  const raw = one(value);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new AppError(400, "INVALID_QUERY", `${field} must be true or false.`);
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  const raw = one(value);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new AppError(400, "INVALID_QUERY", `Expected integer between 1 and ${max}.`);
  }
  return parsed;
}

function date(value: unknown, field: string): Date | undefined {
  const raw = one(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, "INVALID_QUERY", `${field} must be a valid datetime.`);
  }
  return parsed;
}

function enumValue<T extends Record<string, string>>(
  value: unknown,
  enumObject: T,
  field: string
): T[keyof T] | undefined {
  const raw = one(value);
  if (!raw) return undefined;
  if (!Object.values(enumObject).includes(raw)) {
    throw new AppError(400, "INVALID_QUERY", `Invalid ${field}.`);
  }
  return raw as T[keyof T];
}

export interface DashboardRecentFilters {
  cluster?: string;
  source?: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  type?: string;
  acknowledged?: boolean;
  postponed?: boolean;
  limit: number;
}

export interface DashboardResolvedFilters {
  cluster?: string;
  source?: string;
  severity?: IncidentSeverity;
  type?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
}

export function parseDashboardOverviewQuery(query: Record<string, unknown>): { cluster?: string } {
  return { cluster: one(query.cluster) };
}

export function parseDashboardRecentQuery(query: Record<string, unknown>): DashboardRecentFilters {
  return {
    cluster: one(query.cluster),
    source: one(query.source),
    status: enumValue(query.status, IncidentStatus, "status"),
    severity: enumValue(query.severity, IncidentSeverity, "severity"),
    type: one(query.type),
    acknowledged: bool(query.acknowledged, "acknowledged"),
    postponed: bool(query.postponed, "postponed"),
    limit: positiveInt(query.limit, 20, 100)
  };
}

export function parseDashboardResolvedQuery(query: Record<string, unknown>): DashboardResolvedFilters {
  const from = date(query.from, "from");
  const to = date(query.to, "to");
  if (from && to && from.getTime() > to.getTime()) {
    throw new AppError(400, "INVALID_QUERY", "from must be earlier than or equal to to.");
  }

  return {
    cluster: one(query.cluster),
    source: one(query.source),
    severity: enumValue(query.severity, IncidentSeverity, "severity"),
    type: one(query.type),
    from,
    to,
    page: positiveInt(query.page, 1, 1_000_000),
    limit: positiveInt(query.limit, 20, 100)
  };
}
