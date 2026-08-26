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

function bool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AppError(400, "INVALID_QUERY", "acknowledged must be true or false.");
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
    acknowledged: bool(query.acknowledged),
    resourceType: one(query.resourceType),
    from: date(query.from),
    to: date(query.to),
    page: positiveInt(query.page, 1, 1_000_000),
    limit: positiveInt(query.limit, 20, 100)
  };
}

export function parseAcknowledgeBody(body: unknown): { note?: string } {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object") throw new AppError(400, "INVALID_REQUEST", "Request body must be an object.");
  const input = body as Record<string, unknown>;
  if (input.note !== undefined && typeof input.note !== "string") throw new AppError(400, "INVALID_REQUEST", "note must be a string.");
  return { note: input.note as string | undefined };
}

export function parsePostponeBody(body: unknown): { postponeUntil: Date; remark?: string } {
  if (!body || typeof body !== "object") {
    throw new AppError(400, "INVALID_REQUEST", "Request body is required.");
  }

  const input = body as Record<string, unknown>;
  if (typeof input.postponeUntil !== "string" || input.postponeUntil.trim() === "") {
    throw new AppError(400, "INVALID_REQUEST", "postponeUntil is required and must be an ISO datetime string.");
  }

  const postponeUntil = new Date(input.postponeUntil);
  if (Number.isNaN(postponeUntil.getTime())) {
    throw new AppError(400, "INVALID_REQUEST", "postponeUntil must be a valid datetime.");
  }

  if (input.remark !== undefined && typeof input.remark !== "string") {
    throw new AppError(400, "INVALID_REQUEST", "remark must be a string.");
  }

  return {
    postponeUntil,
    remark: input.remark as string | undefined
  };
}

export const queryHelpers = { one, positiveInt, bool, date, enumValue };
