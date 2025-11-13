import { User } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};

import { UserRole } from "@prisma/client"; // si usas enum de Prisma

declare global {
  namespace Express {
    interface UserPayload {
      id: number;
      email: string;
      role: UserRole | string; // depende de cómo definas los roles
    }

    interface Request {
      user?: UserPayload; // opcional porque el middleware la añade
    }
  }
}
