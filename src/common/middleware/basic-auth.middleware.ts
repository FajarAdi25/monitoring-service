// Version: 2.5.5
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";

function safeCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return timingSafeEqual(aBuffer, bBuffer);
}

export function basicAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === "/health" || req.originalUrl.endsWith("/dashboard/health")) {
    next();
    return;
  }

  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Basic ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const decoded = Buffer.from(
    authorization.slice("Basic ".length),
    "base64",
  ).toString("utf8");

  const separator = decoded.indexOf(":");

  if (separator === -1) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (
    !safeCompare(username, env.telegramBot.basicAuthUsername) ||
    !safeCompare(password, env.telegramBot.basicAuthPassword)
  ) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  next();
}
