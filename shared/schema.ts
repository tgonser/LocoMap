import { sql } from "drizzle-orm";
import { pgTable, text, varchar, real, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Location data points from Google location history
export const locationPoints = pgTable("location_points", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  accuracy: integer("accuracy"), // meters
  activity: text("activity"), // still, walking, in_vehicle, etc.
  address: text("address"), // reverse geocoded address
  city: text("city"),
  state: text("state"),
  country: text("country"),
  userId: varchar("user_id"), // for multi-user support later
});

export const insertLocationPointSchema = createInsertSchema(locationPoints).omit({
  id: true,
});

export type InsertLocationPoint = z.infer<typeof insertLocationPointSchema>;
export type LocationPoint = typeof locationPoints.$inferSelect;

// Keep existing user schema for future multi-user support
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;