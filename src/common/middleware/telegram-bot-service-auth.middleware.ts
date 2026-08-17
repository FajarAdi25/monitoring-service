import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { AppError } from "../errors/app-error";

function secureEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicCredentials(authorization: string | undefined): { username: string; password: string } | null {
  const match = authorization?.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return null;

  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 1) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1)
    };
  } catch {
    return null;
  }
}

export function telegramBotServiceAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const credentials = parseBasicCredentials(req.header("authorization"));

  const validUsername = credentials
    ? secureEquals(credentials.username, env.telegramBot.basicAuthUsername)
    : false;
  const validPassword = credentials
    ? secureEquals(credentials.password, env.telegramBot.basicAuthPassword)
    : false;

  if (!validUsername || !validPassword) {
    next(new AppError(401, "UNAUTHORIZED_SERVICE", "Invalid Telegram Bot Service credentials."));
    return;
  }

  next();
}
