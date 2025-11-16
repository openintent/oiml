import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: number | string;
      email: string;
      first_name?: string | null;
      last_name?: string | null;
    };
  }

  interface User {
    id: number | string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: number | string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
  }
}
