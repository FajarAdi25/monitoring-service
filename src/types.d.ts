import type { User } from "./common/types/user";

declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

export {};
