import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error";
import type { User } from "../types/user";

const MYSQL_UNSIGNED_BIGINT_MAX = 18_446_744_073_709_551_615n;

function normalizeTelegramUserId(value: string): string | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const numeric = BigInt(normalized);
  if (numeric <= 0n || numeric > MYSQL_UNSIGNED_BIGINT_MAX) return null;
  return numeric.toString();
}

function parseTelegramUserId(value: unknown): string {
  if (typeof value === "string") {
    const normalized = normalizeTelegramUserId(value);
    if (normalized !== null) return normalized;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }

  throw new AppError(400, "INVALID_USER", "user.id is required and must be a valid Telegram user id.");
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError(400, "INVALID_USER", `${field} is required and must be a non-empty string.`);
  }

  const normalized = value.trim();
  if (normalized.length > 255) {
    throw new AppError(400, "INVALID_USER", `${field} must not exceed 255 characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new AppError(400, "INVALID_USER", `${field} must be a string when provided.`);
  }

  const normalized = value.trim();
  if (normalized === "") return undefined;
  if (normalized.length > 255) {
    throw new AppError(400, "INVALID_USER", `${field} must not exceed 255 characters.`);
  }
  return normalized;
}

export function telegramUserMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      throw new AppError(400, "INVALID_USER", "Request body must contain user identity.");
    }

    const body = req.body as Record<string, unknown>;
    if (!body.user || typeof body.user !== "object" || Array.isArray(body.user)) {
      throw new AppError(400, "INVALID_USER", "body.user is required.");
    }

    const input = body.user as Record<string, unknown>;
    const user: User = {
      id: parseTelegramUserId(input.id),
      name: requiredText(input.name, "user.name")
    };

    const username = optionalText(input.username, "user.username");
    if (username !== undefined) user.username = username;

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
