// Storage layer implementing user-specific location data with authentication
import {
  users,
  locationPoints,
  locationDatasets,
  uniqueLocations,
  dailyGeocodes,
  type User,
  type UpsertUser,
  type LocationPoint,
  type InsertLocationPoint,
  type LocationDataset,
  type InsertLocationDataset,
  type UniqueLocation,
  type InsertUniqueLocation,
  type DailyGeocode,
  type InsertDailyGeocode,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations - MANDATORY for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Location dataset operations (user-specific)
  createLocationDataset(dataset: InsertLocationDataset): Promise<LocationDataset>;
  getUserLocationDatasets(userId: string): Promise<LocationDataset[]>;
  getLocationDataset(id: string, userId: string): Promise<LocationDataset | undefined>;
  updateDatasetProcessed(id: string, deduplicatedPoints: number): Promise<void>;
  
  // Location point operations (user-specific)
  insertLocationPoints(points: InsertLocationPoint[]): Promise<LocationPoint[]>;
  getUserLocationPoints(userId: string, datasetId?: string): Promise<LocationPoint[]>;
  getUserLocationPointsCount(userId: string): Promise<number>;
  clearUserLocationData(userId: string): Promise<void>;
  
  // Unique location operations (user-specific)
  insertUniqueLocations(locations: InsertUniqueLocation[]): Promise<UniqueLocation[]>;
  getUserUniqueLocations(userId: string): Promise<UniqueLocation[]>;
  updateLocationGeocoding(id: string, address: string, city?: string, state?: string, country?: string): Promise<void>;
  
  // Daily centroid analytics pipeline (user-specific)
  computeAndUpsertDailyCentroids(userId: string, datasetId: string): Promise<number>;
  getUngeocodedDailyCentroids(userId: string): Promise<DailyGeocode[]>;
  updateDailyCentroidGeocoding(id: string, address: string, city?: string, state?: string, country?: string): Promise<void>;
  getLocationStatsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<{
    totalDays: number;
    countries: Array<{ country: string; days: number; percent: number }>;
    usStates: Array<{ state: string; days: number; percent: number }>;
    dateRange: { start: Date; end: Date };
  }>;
}

export class DatabaseStorage implements IStorage {
  // User operations - MANDATORY for Replit Auth
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Location dataset operations
  async createLocationDataset(dataset: InsertLocationDataset): Promise<LocationDataset> {
    const [created] = await db.insert(locationDatasets).values(dataset).returning();
    return created;
  }

  async getUserLocationDatasets(userId: string): Promise<LocationDataset[]> {
    return await db
      .select()
      .from(locationDatasets)
      .where(eq(locationDatasets.userId, userId))
      .orderBy(desc(locationDatasets.uploadedAt));
  }

  async getLocationDataset(id: string, userId: string): Promise<LocationDataset | undefined> {
    const [dataset] = await db
      .select()
      .from(locationDatasets)
      .where(and(eq(locationDatasets.id, id), eq(locationDatasets.userId, userId)));
    return dataset;
  }

  async updateDatasetProcessed(id: string, deduplicatedPoints: number): Promise<void> {
    await db
      .update(locationDatasets)
      .set({
        deduplicatedPoints,
        processedAt: new Date(),
      })
      .where(eq(locationDatasets.id, id));
  }

  // Location point operations
  async insertLocationPoints(points: InsertLocationPoint[]): Promise<LocationPoint[]> {
    if (points.length === 0) return [];
    
    // Use batch insertion for large datasets to avoid stack overflow
    const BATCH_SIZE = 2500; // Optimal batch size for PostgreSQL
    const allResults: LocationPoint[] = [];
    
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      const batchResults = await db.insert(locationPoints).values(batch).returning();
      allResults.push(...batchResults);
      
      // Log progress for large uploads
      if (points.length > BATCH_SIZE) {
        const progress = Math.min(i + BATCH_SIZE, points.length);
        console.log(`Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${progress}/${points.length} location points`);
      }
    }
    
    console.log(`Successfully inserted ${allResults.length} location points in ${Math.ceil(points.length / BATCH_SIZE)} batches`);
    return allResults;
  }

  async getUserLocationPoints(userId: string, datasetId?: string): Promise<LocationPoint[]> {
    const conditions = [eq(locationPoints.userId, userId)];
    if (datasetId) {
      conditions.push(eq(locationPoints.datasetId, datasetId));
    }
    
    return await db
      .select()
      .from(locationPoints)
      .where(and(...conditions))
      .orderBy(desc(locationPoints.timestamp));
  }

  async getUserLocationPointsCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(locationPoints)
      .where(eq(locationPoints.userId, userId));
    return result[0]?.count || 0;
  }

  async clearUserLocationData(userId: string): Promise<void> {
    // Clear in proper order due to foreign key constraints
    await db.delete(locationPoints).where(eq(locationPoints.userId, userId));
    await db.delete(uniqueLocations).where(eq(uniqueLocations.userId, userId));
    await db.delete(locationDatasets).where(eq(locationDatasets.userId, userId));
  }

  // Unique location operations
  async insertUniqueLocations(locations: InsertUniqueLocation[]): Promise<UniqueLocation[]> {
    if (locations.length === 0) return [];
    return await db.insert(uniqueLocations).values(locations).returning();
  }

  async getUserUniqueLocations(userId: string): Promise<UniqueLocation[]> {
    return await db
      .select()
      .from(uniqueLocations)
      .where(eq(uniqueLocations.userId, userId))
      .orderBy(desc(uniqueLocations.visitCount));
  }

  async updateLocationGeocoding(
    id: string,
    address: string,
    city?: string,
    state?: string,
    country?: string
  ): Promise<void> {
    await db
      .update(locationPoints)  // Fixed: Update location points, not unique locations
      .set({
        address,  // Fixed: Actually persist the address parameter
        ...(city && { city }),
        ...(state && { state }),
        ...(country && { country }),
      })
      .where(eq(locationPoints.id, id));
  }

  // Daily centroid analytics pipeline methods
  async computeAndUpsertDailyCentroids(userId: string, datasetId: string): Promise<number> {
    // SQL-first approach: compute daily centroids using date_trunc
    const dailyCentroids = await db
      .select({
        userId: sql<string>`${locationPoints.userId}`,
        datasetId: sql<string>`${locationPoints.datasetId}`,
        date: sql<Date>`date_trunc('day', ${locationPoints.timestamp})`,
        lat: sql<number>`avg(${locationPoints.lat})`,
        lng: sql<number>`avg(${locationPoints.lng})`,
        pointCount: sql<number>`count(*)`,
      })
      .from(locationPoints)
      .where(and(
        eq(locationPoints.userId, userId),
        eq(locationPoints.datasetId, datasetId)
      ))
      .groupBy(
        locationPoints.userId,
        locationPoints.datasetId,
        sql`date_trunc('day', ${locationPoints.timestamp})`
      );

    if (dailyCentroids.length === 0) {
      return 0;
    }

    // Upsert daily centroids with conflict resolution
    const insertData = dailyCentroids.map(centroid => ({
      userId: centroid.userId,
      datasetId: centroid.datasetId,
      date: centroid.date,
      lat: centroid.lat,
      lng: centroid.lng,
      pointCount: centroid.pointCount,
      geocoded: false,
    }));

    const upserted = await db
      .insert(dailyGeocodes)
      .values(insertData)
      .onConflictDoUpdate({
        target: [dailyGeocodes.userId, dailyGeocodes.datasetId, dailyGeocodes.date],
        set: {
          lat: sql`EXCLUDED.lat`,
          lng: sql`EXCLUDED.lng`,
          pointCount: sql`EXCLUDED.point_count`,
          // Only update geocoded status if new pointCount is higher (better data)
          geocoded: sql`CASE WHEN EXCLUDED.point_count > daily_geocodes.point_count THEN false ELSE daily_geocodes.geocoded END`,
          city: sql`CASE WHEN EXCLUDED.point_count > daily_geocodes.point_count THEN null ELSE daily_geocodes.city END`,
          state: sql`CASE WHEN EXCLUDED.point_count > daily_geocodes.point_count THEN null ELSE daily_geocodes.state END`,
          country: sql`CASE WHEN EXCLUDED.point_count > daily_geocodes.point_count THEN null ELSE daily_geocodes.country END`,
          address: sql`CASE WHEN EXCLUDED.point_count > daily_geocodes.point_count THEN null ELSE daily_geocodes.address END`,
        },
      })
      .returning();

    console.log(`Upserted ${upserted.length} daily centroids for user ${userId}, dataset ${datasetId}`);
    return upserted.length;
  }

  async getUngeocodedDailyCentroids(userId: string): Promise<DailyGeocode[]> {
    return await db
      .select()
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        eq(dailyGeocodes.geocoded, false)
      ))
      .orderBy(desc(dailyGeocodes.date))
      .limit(100); // Batch process to avoid overwhelming geocoding service
  }

  async updateDailyCentroidGeocoding(
    id: string,
    address: string,
    city?: string,
    state?: string,
    country?: string
  ): Promise<void> {
    await db
      .update(dailyGeocodes)
      .set({
        address,
        ...(city && { city }),
        ...(state && { state }),
        ...(country && { country }),
        geocoded: true,
        geocodedAt: new Date(),
      })
      .where(eq(dailyGeocodes.id, id));
  }

  async getLocationStatsByDateRange(
    userId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<{
    totalDays: number;
    countries: Array<{ country: string; days: number; percent: number }>;
    usStates: Array<{ state: string; days: number; percent: number }>;
    dateRange: { start: Date; end: Date };
  }> {
    // Get deduplicated daily centroids within date range (highest pointCount per day wins)
    const deduplicatedCentroids = await db
      .select({
        date: dailyGeocodes.date,
        country: dailyGeocodes.country,
        state: dailyGeocodes.state,
        pointCount: sql<number>`max(${dailyGeocodes.pointCount})`,
      })
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        sql`${dailyGeocodes.date} >= ${startDate}`,
        sql`${dailyGeocodes.date} <= ${endDate}`,
        eq(dailyGeocodes.geocoded, true)
      ))
      .groupBy(dailyGeocodes.date, dailyGeocodes.country, dailyGeocodes.state);

    const totalDays = deduplicatedCentroids.length;
    
    if (totalDays === 0) {
      return {
        totalDays: 0,
        countries: [],
        usStates: [],
        dateRange: { start: startDate, end: endDate },
      };
    }

    // Count countries (exclude null values)
    const countryMap = new Map<string, number>();
    const stateMap = new Map<string, number>();
    
    deduplicatedCentroids.forEach(record => {
      if (record.country) {
        countryMap.set(record.country, (countryMap.get(record.country) || 0) + 1);
      }
      
      // Only count US states
      if (record.country === 'United States' && record.state) {
        stateMap.set(record.state, (stateMap.get(record.state) || 0) + 1);
      }
    });

    // Convert to sorted arrays with percentages
    const countries = Array.from(countryMap.entries())
      .map(([country, days]) => ({
        country,
        days,
        percent: Math.round((days / totalDays) * 100 * 100) / 100, // Round to 2 decimal places
      }))
      .sort((a, b) => b.days - a.days);

    const usStates = Array.from(stateMap.entries())
      .map(([state, days]) => ({
        state,
        days,
        percent: Math.round((days / totalDays) * 100 * 100) / 100, // Round to 2 decimal places
      }))
      .sort((a, b) => b.days - a.days);

    return {
      totalDays,
      countries,
      usStates,
      dateRange: { start: startDate, end: endDate },
    };
  }
}

// Legacy in-memory storage for comparison (not used with authentication)
export class MemStorage implements IStorage {
  // Not implementing user authentication methods for memory storage
  async getUser(id: string): Promise<User | undefined> {
    throw new Error("Memory storage does not support user authentication");
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    throw new Error("Memory storage does not support user authentication");
  }

  // Stub implementations for memory storage (not used)
  async createLocationDataset(dataset: InsertLocationDataset): Promise<LocationDataset> {
    throw new Error("Use DatabaseStorage for persistent user data");
  }

  async getUserLocationDatasets(userId: string): Promise<LocationDataset[]> {
    return [];
  }

  async getLocationDataset(id: string, userId: string): Promise<LocationDataset | undefined> {
    return undefined;
  }

  async updateDatasetProcessed(id: string, deduplicatedPoints: number): Promise<void> {}

  async insertLocationPoints(points: InsertLocationPoint[]): Promise<LocationPoint[]> {
    return [];
  }

  async getUserLocationPoints(userId: string, datasetId?: string): Promise<LocationPoint[]> {
    return [];
  }

  async getUserLocationPointsCount(userId: string): Promise<number> {
    return 0;
  }

  async clearUserLocationData(userId: string): Promise<void> {}

  async insertUniqueLocations(locations: InsertUniqueLocation[]): Promise<UniqueLocation[]> {
    return [];
  }

  async getUserUniqueLocations(userId: string): Promise<UniqueLocation[]> {
    return [];
  }

  async updateLocationGeocoding(
    id: string,
    address: string,
    city?: string,
    state?: string,
    country?: string
  ): Promise<void> {}

  // Stub implementations for daily centroid methods (not used in memory storage)
  async computeAndUpsertDailyCentroids(userId: string, datasetId: string): Promise<number> {
    return 0;
  }

  async getUngeocodedDailyCentroids(userId: string): Promise<DailyGeocode[]> {
    return [];
  }

  async updateDailyCentroidGeocoding(
    id: string,
    address: string,
    city?: string,
    state?: string,
    country?: string
  ): Promise<void> {}

  async getLocationStatsByDateRange(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalDays: number;
    countries: Array<{ country: string; days: number; percent: number }>;
    usStates: Array<{ state: string; days: number; percent: number }>;
    dateRange: { start: Date; end: Date };
  }> {
    return {
      totalDays: 0,
      countries: [],
      usStates: [],
      dateRange: { start: startDate, end: endDate },
    };
  }
}

// Use database storage for user authentication and persistent data
export const storage = new DatabaseStorage();