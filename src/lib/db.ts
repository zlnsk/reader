import { Pool } from "pg";

declare global { var __pgPool: Pool | undefined; }

export const pool: Pool =
  globalThis.__pgPool ??
  new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalThis.__pgPool = pool;

export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
