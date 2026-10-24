import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { functions } from "./functions.ts";

export interface DatabaseEnv {
  DATABASE_URL?: string;
  SUPABASE_API_SCHEMA?: string;
}
export interface DatabaseError {
  code: string;
  message: string;
}
export interface Database {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: DatabaseError | null }>;
  close(): Promise<void>;
}

function databaseError(error: unknown): DatabaseError {
  // Prisma's raw-query error preserves the driver's original PostgreSQL error.
  const e = error as {
    meta?: {
      code?: string;
      message?: string;
      driverAdapterError?: {
        cause?: { originalCode?: string; originalMessage?: string };
      };
    };
  };
  const cause = e?.meta?.driverAdapterError?.cause;
  const code = cause?.originalCode ?? e?.meta?.code;
  const message = cause?.originalMessage ?? e?.meta?.message;
  if (code && /^[A-Z0-9]{5}$/.test(code) && message) return { code, message };
  // Never propagate a URL, query, SQL detail or Prisma diagnostic to callers.
  return { code: "database_unavailable", message: "database_unavailable" };
}

/** One request/drain owns this lazy client. Do not retain it across Workers requests. */
export function createDatabase(env: DatabaseEnv): Database {
  const schema = env.SUPABASE_API_SCHEMA || "api";
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid database API schema.");
  let client: PrismaClient | undefined;
  let closed = false;
  return {
    async rpc(name, args) {
      const signature = Object.hasOwn(functions, name)
        ? functions[name]
        : undefined;
      if (
        closed ||
        !signature ||
        Object.keys(args).some((key) => !Object.hasOwn(signature, key))
      )
        return {
          data: null,
          error: {
            code: "invalid_database_call",
            message: "invalid_database_call",
          },
        };
      try {
        if (!client) {
          if (!env.DATABASE_URL)
            throw new Error("Database configuration required.");
          const url = new URL(env.DATABASE_URL);
          if (!["postgres:", "postgresql:"].includes(url.protocol))
            throw new Error("Invalid database connection.");
          // pg gives URL parameters precedence over explicit config. Discard
          // these overrides so a normal URL option cannot bypass role/timeout.
          url.searchParams.delete("options");
          url.searchParams.delete("statement_timeout");
          client = new PrismaClient({
            adapter: new PrismaPg({
              connectionString: url.href,
              max: 1,
              connectionTimeoutMillis: 5000,
              idleTimeoutMillis: 5000,
              statement_timeout: 5000,
              // Apply on every connection, never as a session mutation in a pool.
              options: "-c role=service_role",
            }),
            log: [],
          });
        }
        const parameters = Object.entries(args).map(([key, value]) => {
          const type = signature[key];
          const bound =
            type === "jsonb" && value !== null ? JSON.stringify(value) : value;
          return Prisma.sql`${Prisma.raw(`"${key}"`)} => ${bound}::${Prisma.raw(type)}`;
        });
        // Both identifiers are validated above; only values become placeholders.
        const rows = await client.$queryRaw<{ result: unknown }[]>(
          Prisma.sql`select to_jsonb(${Prisma.raw(`"${schema}"."${name}"`)}(${Prisma.join(parameters)})) as result`,
        );
        return { data: rows[0]?.result ?? null, error: null };
      } catch (error) {
        return { data: null, error: databaseError(error) };
      }
    },
    async close() {
      closed = true;
      await client?.$disconnect();
    },
  };
}
