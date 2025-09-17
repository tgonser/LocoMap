import { sql } from 'drizzle-orm';
import {
  boolean,
  text,
  timestamp,
  pgTable,
  index,
  jsonb,
  varchar,
  real,
  integer
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table - MANDATORY for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - MANDATORY for Replit Auth  
export const users = pgTable("users", {
  id: varchar("id").primaryKey(),  // Replit user ID from claims.sub
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User-specific location data uploads - tracks each file upload
export const locationDatasets = pgTable('location_datasets', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id).notNull(),
  filename: text('filename').notNull(),
  fileSize: integer('file_size').notNull(),
  totalPoints: integer('total_points').notNull(),
  deduplicatedPoints: integer('deduplicated_points').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow(),
  processedAt: timestamp('processed_at'),
});

// Location data points from Google location history (user-specific)
export const locationPoints = pgTable("location_points", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id).notNull(),
  datasetId: varchar('dataset_id').references(() => locationDatasets.id).notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  accuracy: integer("accuracy"), // meters
  activity: text("activity"), // still, walking, in_vehicle, etc.
  address: text("address"), // reverse geocoded address
  city: text("city"),
  state: text("state"),  
  country: text("country"),
});

// Unique locations table - stores deduplicated locations with geocoding (user-specific)
export const uniqueLocations = pgTable('unique_locations', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id).notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  city: text('city'),
  state: text('state'),
  country: text('country'),
  geocoded: boolean('geocoded').default(false),
  visitCount: integer('visit_count').default(1),
  firstVisit: timestamp('first_visit').notNull(),
  lastVisit: timestamp('last_visit').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Note: Indexes are defined within table definitions above

// Zod schemas for validation

// Replit Auth schemas
export const insertUserSchema = createInsertSchema(users);
export const insertLocationDatasetSchema = createInsertSchema(locationDatasets).omit({
  id: true,
  uploadedAt: true,
});

export const insertLocationPointSchema = createInsertSchema(locationPoints).omit({
  id: true,
});

export const insertUniqueLocationSchema = createInsertSchema(uniqueLocations).omit({
  id: true,
  createdAt: true,
});

// TypeScript types for Replit Auth
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// TypeScript types for location data
export type LocationDataset = typeof locationDatasets.$inferSelect;
export type InsertLocationDataset = z.infer<typeof insertLocationDatasetSchema>;
export type LocationPoint = typeof locationPoints.$inferSelect;
export type InsertLocationPoint = z.infer<typeof insertLocationPointSchema>;
export type UniqueLocation = typeof uniqueLocations.$inferSelect;
export type InsertUniqueLocation = z.infer<typeof insertUniqueLocationSchema>;