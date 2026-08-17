import type { Request, Response, NextFunction } from "express";
import { env } from "../../config/env";

export function userMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.user = { ...env.user };
  next();
}
