// Database connection for Drizzle ORM with PostgreSQL
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@shared/schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Use Neon for development (when running locally), PostgreSQL for production (Render)
const isProduction = process.env.NODE_ENV === 'production';

let db;

if (isProduction) {
  // Production: Use regular PostgreSQL client for Render with optimized settings for large operations
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
    connectionTimeoutMillis: 60000, // How long to wait for a connection
    statement_timeout: 300000, // 5 minutes for large operations
    query_timeout: 300000, // 5 minutes query timeout
  });
  db = drizzlePg(pool, { schema });
} else {
  // Development: Use Neon HTTP client for Replit
  const sql = neon(process.env.DATABASE_URL);
  db = drizzle(sql, { schema });
}

export { db };