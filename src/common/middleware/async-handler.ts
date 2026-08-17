import type { RequestHandler } from "express";

export function asyncHandler<P = any>(
  handler: RequestHandler<P>
): RequestHandler<P> {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
