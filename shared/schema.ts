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
  integer,
  unique
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

// User storage table - Updated for username/password authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username", { length: 50 }).unique(),
  email: varchar("email").unique(),
  password: varchar("password", { length: 255 }), // Hashed password
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  
  // Approval system fields
  isApproved: boolean("is_approved").default(false),
  approvalStatus: varchar("approval_status", { length: 20 }).default("pending"), // pending, approved, rejected
  approvedBy: varchar("approved_by"), // User ID who approved
  approvedAt: timestamp("approved_at"),
  rejectedReason: varchar("rejected_reason", { length: 500 }),
  
  // Role management
  role: varchar("role", { length: 20 }).default("user"), // user, admin
  
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
  rawContent: text('raw_content'), // Store raw JSON for later processing (compressed if large)
  
  // Merge tracking fields
  mergeCount: integer('merge_count').default(0),
  lastMergeAt: timestamp('last_merge_at'),
  firstDataAt: timestamp('first_data_at'),
  lastDataAt: timestamp('last_data_at'),
  totalSources: integer('total_sources').default(1),
  lastMergeAdded: integer('last_merge_added'),
  lastMergeDuplicates: integer('last_merge_duplicates'),
});

// Dataset merge events - tracks each merge operation for audit trail
export const datasetMergeEvents = pgTable('dataset_merge_events', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  datasetId: varchar('dataset_id').references(() => locationDatasets.id).notNull(),
  mergedAt: timestamp('merged_at').defaultNow(),
  addedObjects: integer('added_objects').notNull(),
  duplicatesRemoved: integer('duplicates_removed').notNull(),
  newDataStart: timestamp('new_data_start'),
  newDataEnd: timestamp('new_data_end'),
  sourceFilename: text('source_filename'),
}, (table) => [
  index('idx_dataset_merge_events_dataset').on(table.datasetId),
  index('idx_dataset_merge_events_date').on(table.mergedAt),
]);

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
}, (table) => [
  // Critical indexes for date range queries and analytics optimization
  index('idx_location_points_user_timestamp').on(table.userId, table.timestamp),
  index('idx_location_points_dataset').on(table.datasetId),
  index('idx_location_points_timestamp').on(table.timestamp), // For date range filtering
  // Unique constraint to prevent duplicate location points
  unique('unique_location_point').on(table.userId, table.datasetId, table.timestamp, table.lat, table.lng),
]);

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

// Authentication schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const registerSchema = insertUserSchema.pick({
  username: true,
  email: true,
  password: true,
  firstName: true,
  lastName: true,
}).extend({
  password: z.string().min(6, "Password must be at least 6 characters"),
  username: z.string().min(3, "Username must be at least 3 characters").max(50),
  email: z.string().email("Invalid email address"),
});

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const insertLocationDatasetSchema = createInsertSchema(locationDatasets).omit({
  id: true,
  uploadedAt: true,
});

export const insertDatasetMergeEventSchema = createInsertSchema(datasetMergeEvents).omit({
  id: true,
  mergedAt: true,
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

// Travel stops - waypoint-based analytics replacing daily centroids
export const travelStops = pgTable('travel_stops', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id).notNull(),
  datasetId: varchar('dataset_id').references(() => locationDatasets.id).notNull(),
  start: timestamp('start').notNull(), // When the stop started
  end: timestamp('end').notNull(), // When the stop ended
  lat: real('lat').notNull(), // Stop location latitude
  lng: real('lng').notNull(), // Stop location longitude
  pointCount: integer('point_count').notNull(), // Number of GPS points at this stop
  dwellMinutes: integer('dwell_minutes').notNull(), // How long user stayed (minutes)
  city: text('city'),
  state: text('state'),
  country: text('country'),
  address: text('address'),
  geocoded: boolean('geocoded').default(false),
  geocodedAt: timestamp('geocoded_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_travel_stops_user_time').on(table.userId, table.start),
  index('idx_travel_stops_dataset').on(table.datasetId),
  index('idx_travel_stops_dwell').on(table.dwellMinutes), // For filtering significant stops
]);

// Travel segments - routes between consecutive stops
export const travelSegments = pgTable('travel_segments', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id).notNull(),
  fromStopId: varchar('from_stop_id').references(() => travelStops.id).notNull(),
  toStopId: varchar('to_stop_id').references(() => travelStops.id).notNull(),
  start: timestamp('start').notNull(), // When travel started
  end: timestamp('end').notNull(), // When travel ended  
  distanceMiles: real('distance_miles').notNull(), // Calculated travel distance
  polyline: text('polyline'), // Encoded polyline of the route
  cities: text('cities').array().default([]), // Intermediate cities along route
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_travel_segments_user_time').on(table.userId, table.start),
  index('idx_travel_segments_from').on(table.fromStopId),
  index('idx_travel_segments_to').on(table.toStopId),
  unique('unique_travel_segments_from_to').on(table.fromStopId, table.toStopId)
]);

// Daily geocoded centroids for efficient analytics (user-specific)
export const dailyGeocodes = pgTable('daily_geocodes', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id).notNull(),
  datasetId: varchar('dataset_id').references(() => locationDatasets.id).notNull(),
  date: timestamp('date').notNull(), // Date for the centroid (YYYY-MM-DD)
  lat: real('lat').notNull(), // Daily centroid latitude
  lng: real('lng').notNull(), // Daily centroid longitude
  pointCount: integer('point_count').notNull(), // Number of points for this day
  city: text('city'),
  state: text('state'),
  country: text('country'),
  address: text('address'),
  geocoded: boolean('geocoded').default(false),
  geocodedAt: timestamp('geocoded_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_daily_geocodes_user_date').on(table.userId, table.date),
  index('idx_daily_geocodes_dataset').on(table.datasetId),
  unique('unique_daily_geocodes_user_dataset_date').on(table.userId, table.datasetId, table.date)
]);

// Geocoding cache table to avoid duplicate API calls
export const geocodeCache = pgTable('geocode_cache', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  latRounded: real('lat_rounded').notNull(), // Rounded to 3-4 decimals
  lngRounded: real('lng_rounded').notNull(), // Rounded to 3-4 decimals
  city: text('city'),
  state: text('state'),
  country: text('country'),
  address: text('address'),
  cachedAt: timestamp('cached_at').defaultNow(),
}, (table) => [
  index('idx_geocode_cache_coords').on(table.latRounded, table.lngRounded),
  unique('unique_geocode_coords').on(table.latRounded, table.lngRounded)
]);

// Zod schemas for new tables
export const insertDailyGeocodeSchema = createInsertSchema(dailyGeocodes).omit({
  id: true,
  createdAt: true,
});

export const insertGeocodeCacheSchema = createInsertSchema(geocodeCache).omit({
  id: true,
  cachedAt: true,
});

// Zod schemas for waypoint tables
export const insertTravelStopSchema = createInsertSchema(travelStops).omit({
  id: true,
  createdAt: true,
});

export const insertTravelSegmentSchema = createInsertSchema(travelSegments).omit({
  id: true,
  createdAt: true,
});

// Yearly report cache to avoid expensive regeneration
export const yearlyReportCache = pgTable('yearly_report_cache', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id).notNull(),
  year: integer('year').notNull(),
  reportType: varchar('report_type').notNull(), // 'state_country', etc.
  reportData: jsonb('report_data').notNull(), // Cached JSON report
  generatedAt: timestamp('generated_at').defaultNow(),
  cacheVersion: varchar('cache_version').default('v1'), // For cache invalidation
}, (table) => [
  index('idx_yearly_report_cache_user_year').on(table.userId, table.year, table.reportType),
  unique('unique_yearly_report_cache').on(table.userId, table.year, table.reportType)
]);

export const insertYearlyReportCacheSchema = createInsertSchema(yearlyReportCache).omit({
  id: true,
  generatedAt: true,
});

// TypeScript types for location data
export type LocationDataset = typeof locationDatasets.$inferSelect;
export type InsertLocationDataset = z.infer<typeof insertLocationDatasetSchema>;
export type DatasetMergeEvent = typeof datasetMergeEvents.$inferSelect;
export type InsertDatasetMergeEvent = z.infer<typeof insertDatasetMergeEventSchema>;
export type LocationPoint = typeof locationPoints.$inferSelect;
export type InsertLocationPoint = z.infer<typeof insertLocationPointSchema>;
export type UniqueLocation = typeof uniqueLocations.$inferSelect;
export type InsertUniqueLocation = z.infer<typeof insertUniqueLocationSchema>;
export type DailyGeocode = typeof dailyGeocodes.$inferSelect;
export type InsertDailyGeocode = z.infer<typeof insertDailyGeocodeSchema>;
export type GeocodeCache = typeof geocodeCache.$inferSelect;
export type InsertGeocodeCache = z.infer<typeof insertGeocodeCacheSchema>;
export type TravelStop = typeof travelStops.$inferSelect;
export type InsertTravelStop = z.infer<typeof insertTravelStopSchema>;
export type TravelSegment = typeof travelSegments.$inferSelect;
export type InsertTravelSegment = z.infer<typeof insertTravelSegmentSchema>;
export type YearlyReportCache = typeof yearlyReportCache.$inferSelect;
export type InsertYearlyReportCache = z.infer<typeof insertYearlyReportCacheSchema>;

// Daily presence detection types (for visit/activity analysis)
export const dailyPresenceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD format
  lat: z.number(),
  lng: z.number(),
  state: z.string().optional(),
  country: z.string(),
  provenance: z.enum(['visit', 'activity']), // Source of the location data
  resolution: z.enum(['cache', 'api']), // How state/country was determined
  sampleCount: z.number(), // Number of visits/activities on this day
});

export type DailyPresence = z.infer<typeof dailyPresenceSchema>;

// Simple visitor tracking table for basic analytics
export const pageVisits = pgTable('page_visits', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  path: varchar('path', { length: 500 }).notNull(), // URL path visited
  timestamp: timestamp('timestamp').defaultNow(),
  ipHash: varchar('ip_hash', { length: 64 }), // Hashed IP for privacy
  userAgent: text('user_agent'), // Browser info
  referrer: text('referrer'), // Where they came from
}, (table) => [
  index('idx_page_visits_timestamp').on(table.timestamp),
  index('idx_page_visits_path').on(table.path),
]);

// Simple visitor counter aggregation table
export const visitorStats = pgTable('visitor_stats', {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: timestamp('date').notNull(), // Date for the stats (YYYY-MM-DD)
  totalVisits: integer('total_visits').default(0),
  uniqueVisitors: integer('unique_visitors').default(0), // Based on IP hash
  topPaths: jsonb('top_paths'), // Top visited paths for the day
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_visitor_stats_date').on(table.date),
  unique('unique_visitor_stats_date').on(table.date)
]);

// Zod schemas for visitor tracking
export const insertPageVisitSchema = createInsertSchema(pageVisits).omit({
  id: true,
  timestamp: true,
});

export const insertVisitorStatsSchema = createInsertSchema(visitorStats).omit({
  id: true,
  updatedAt: true,
});

// TypeScript types for visitor tracking
export type PageVisit = typeof pageVisits.$inferSelect;
export type InsertPageVisit = z.infer<typeof insertPageVisitSchema>;
export type VisitorStats = typeof visitorStats.$inferSelect;
export type InsertVisitorStats = z.infer<typeof insertVisitorStatsSchema>;