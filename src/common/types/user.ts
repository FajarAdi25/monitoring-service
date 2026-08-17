import type { Role } from "../../config/env";

export interface User {
  id: string;
  name: string;
  username?: string;
  role?: Role;
}
