import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error";

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user.role !== "ADMIN") {
    next(new AppError(403, "FORBIDDEN", "Admin permission is required."));
    return;
  }
  next();
}
