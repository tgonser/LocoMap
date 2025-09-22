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
  // Production: Use regular PostgreSQL client for Render
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  db = drizzlePg(pool, { schema });
} else {
  // Development: Use Neon HTTP client for Replit
  const sql = neon(process.env.DATABASE_URL);
  db = drizzle(sql, { schema });
}

export { db };