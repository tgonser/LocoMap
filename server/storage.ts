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
import { db } from "./db.js";
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
  computeDailyCentroidsForAllDatasets(userId: string): Promise<number>;
  getUngeocodedDailyCentroids(userId: string, limit?: number): Promise<DailyGeocode[]>;
  getUngeocodedCentroidsCount(userId: string): Promise<number>;
  // Date range filtering versions for better user experience
  getUngeocodedDailyCentroidsByDateRange(userId: string, startDate: Date, endDate: Date, limit?: number): Promise<DailyGeocode[]>;
  getUngeocodedCentroidsCountByDateRange(userId: string, startDate: Date, endDate: Date): Promise<number>;
  updateDailyCentroidGeocoding(id: string, address: string, city?: string, state?: string, country?: string): Promise<void>;
  getLocationStatsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<{
    totalDays: number;
    geocodedDays: number;
    geocodingCoverage: number;
    countries: Array<{ country: string; days: number; percent: number }>;
    usStates: Array<{ state: string; days: number; percent: number }>;
    dateRange: { start: Date; end: Date };
  }>;
  debugGeocodingCoverage(userId: string, year: number): Promise<{
    expectedDays: number;
    actualGeocodedDays: number;
    coverage: number;
    ungeocodedCount: number;
  }>;
  getUngeocodedSummary(userId: string): Promise<Array<{
    year: number;
    month: number;
    monthName: string;
    count: number;
    dateRange: string;
  }>>;
  
  // New method for analytics endpoint
  getGeocodedDailyCentroidsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<DailyGeocode[]>;
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
        date: sql<string>`date_trunc('day', ${locationPoints.timestamp})::text`,
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

    // Convert string dates to proper Date objects and prepare for batch upsert
    const insertData = dailyCentroids.map((centroid: { userId: string; datasetId: string; date: string; lat: number; lng: number; pointCount: number }) => ({
      userId: centroid.userId,
      datasetId: centroid.datasetId,
      date: new Date(centroid.date), // Convert string to proper Date object
      lat: centroid.lat,
      lng: centroid.lng,
      pointCount: centroid.pointCount,
      geocoded: false,
    }));

    // Use batch processing to avoid "value too large to transmit" errors
    const BATCH_SIZE = 100; // Smaller batch size for upsert operations with conflict resolution
    let totalUpserted = 0;
    
    for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
      const batch = insertData.slice(i, i + BATCH_SIZE);
      
      const upserted = await db
        .insert(dailyGeocodes)
        .values(batch)
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
        
      totalUpserted += upserted.length;
      
      // Log progress for large batches
      if (insertData.length > BATCH_SIZE) {
        const progress = Math.min(i + BATCH_SIZE, insertData.length);
        console.log(`Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${progress}/${insertData.length} daily centroids`);
      }
    }

    console.log(`Successfully upserted ${totalUpserted} daily centroids for user ${userId}, dataset ${datasetId} in ${Math.ceil(insertData.length / BATCH_SIZE)} batches`);
    return totalUpserted;
  }

  async computeDailyCentroidsForAllDatasets(userId: string): Promise<number> {
    // Get all datasets for the user
    const datasets = await this.getUserLocationDatasets(userId);
    
    if (datasets.length === 0) {
      return 0;
    }

    console.log(`Computing daily centroids for ${datasets.length} datasets for user ${userId}`);
    
    let totalCentroidsCreated = 0;
    
    for (const dataset of datasets) {
      try {
        const centroidsCreated = await this.computeAndUpsertDailyCentroids(userId, dataset.id);
        totalCentroidsCreated += centroidsCreated;
        console.log(`Computed ${centroidsCreated} centroids for dataset ${dataset.id} (${dataset.filename})`);
      } catch (error) {
        console.error(`Failed to compute centroids for dataset ${dataset.id}:`, error);
      }
    }
    
    console.log(`Total ${totalCentroidsCreated} daily centroids computed for user ${userId}`);
    return totalCentroidsCreated;
  }

  async getUngeocodedCentroidsCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        eq(dailyGeocodes.geocoded, false)
      ));
    return result[0]?.count || 0;
  }

  async getUngeocodedDailyCentroids(userId: string, limit?: number): Promise<DailyGeocode[]> {
    const query = db
      .select()
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        eq(dailyGeocodes.geocoded, false)
      ))
      .orderBy(desc(dailyGeocodes.date));
    
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getUngeocodedDailyCentroidsByDateRange(
    userId: string, 
    startDate: Date, 
    endDate: Date, 
    limit?: number
  ): Promise<DailyGeocode[]> {
    const query = db
      .select()
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        eq(dailyGeocodes.geocoded, false),
        sql`${dailyGeocodes.date} >= ${startDate}`,
        sql`${dailyGeocodes.date} <= ${endDate}`
      ))
      .orderBy(desc(dailyGeocodes.date));
    
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getUngeocodedCentroidsCountByDateRange(
    userId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        eq(dailyGeocodes.geocoded, false),
        sql`${dailyGeocodes.date} >= ${startDate}`,
        sql`${dailyGeocodes.date} <= ${endDate}`
      ));
    return result[0]?.count || 0;
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
    geocodedDays: number;
    geocodingCoverage: number;
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

    // Get true total days from location_points (not just geocoded ones) - moved up first
    const actualDaysResult = await db
      .select({
        date: sql<Date>`date_trunc('day', ${locationPoints.timestamp})`,
      })
      .from(locationPoints)
      .where(and(
        eq(locationPoints.userId, userId),
        sql`${locationPoints.timestamp} >= ${startDate}`,
        sql`${locationPoints.timestamp} <= ${endDate}`
      ))
      .groupBy(sql`date_trunc('day', ${locationPoints.timestamp})`);
    
    const actualTotalDays = actualDaysResult.length;
    const geocodedDays = deduplicatedCentroids.length;
    
    if (actualTotalDays === 0) {
      return {
        totalDays: 0,
        geocodedDays: 0,
        geocodingCoverage: 0,
        countries: [],
        usStates: [],
        dateRange: { start: startDate, end: endDate },
      };
    }

    // Count countries (exclude null values)
    const countryMap = new Map<string, number>();
    const stateMap = new Map<string, number>();
    
    deduplicatedCentroids.forEach((record: { date: Date; country: string | null; state: string | null; pointCount: number }) => {
      if (record.country) {
        countryMap.set(record.country, (countryMap.get(record.country) || 0) + 1);
      }
      
      // Only count US states
      if (record.country === 'United States' && record.state) {
        stateMap.set(record.state, (stateMap.get(record.state) || 0) + 1);
      }
    });

    // Convert to sorted arrays with percentages - FIXED: Use actualTotalDays for proper percentages
    const countries = Array.from(countryMap.entries())
      .map(([country, days]) => ({
        country,
        days,
        percent: Math.round((days / actualTotalDays) * 100 * 100) / 100, // Fixed: Use actualTotalDays
      }))
      .sort((a, b) => b.days - a.days);

    const usStates = Array.from(stateMap.entries())
      .map(([state, days]) => ({
        state,
        days,
        percent: Math.round((days / actualTotalDays) * 100 * 100) / 100, // Fixed: Use actualTotalDays
      }))
      .sort((a, b) => b.days - a.days);
    const geocodingCoverage = actualTotalDays > 0 ? Math.round((geocodedDays / actualTotalDays) * 100 * 100) / 100 : 0;

    return {
      totalDays: actualTotalDays,
      geocodedDays,
      geocodingCoverage,
      countries,
      usStates,
      dateRange: { start: startDate, end: endDate },
    };
  }

  async debugGeocodingCoverage(userId: string, year: number): Promise<{
    expectedDays: number;
    actualGeocodedDays: number;
    coverage: number;
    ungeocodedCount: number;
  }> {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31T23:59:59`);
    
    // Count total days with location data
    const expectedDaysResult = await db
      .select({
        date: sql<Date>`date_trunc('day', ${locationPoints.timestamp})`,
      })
      .from(locationPoints)
      .where(and(
        eq(locationPoints.userId, userId),
        sql`${locationPoints.timestamp} >= ${startDate}`,
        sql`${locationPoints.timestamp} <= ${endDate}`
      ))
      .groupBy(sql`date_trunc('day', ${locationPoints.timestamp})`);
      
    const expectedDays = expectedDaysResult.length;
    
    // Count geocoded days
    const geocodedDaysResult = await db
      .select({
        date: dailyGeocodes.date,
      })
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        sql`${dailyGeocodes.date} >= ${startDate}`,
        sql`${dailyGeocodes.date} <= ${endDate}`,
        eq(dailyGeocodes.geocoded, true)
      ))
      .groupBy(dailyGeocodes.date);
      
    const actualGeocodedDays = geocodedDaysResult.length;
    
    // Count ungeocoded centroids
    const ungeocodedCount = await this.getUngeocodedCentroidsCount(userId);
    
    const coverage = expectedDays > 0 ? Math.round((actualGeocodedDays / expectedDays) * 100 * 100) / 100 : 0;
    
    return {
      expectedDays,
      actualGeocodedDays,
      coverage,
      ungeocodedCount,
    };
  }

  async getUngeocodedSummary(userId: string): Promise<Array<{
    year: number;
    month: number;
    monthName: string;
    count: number;
    dateRange: string;
  }>> {
    // SQL query to group ungeocoded centroids by year and month
    const results = await db
      .select({
        year: sql<number>`EXTRACT(YEAR FROM ${dailyGeocodes.date})`,
        month: sql<number>`EXTRACT(MONTH FROM ${dailyGeocodes.date})`,
        count: sql<number>`count(*)`
      })
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        eq(dailyGeocodes.geocoded, false)
      ))
      .groupBy(
        sql`EXTRACT(YEAR FROM ${dailyGeocodes.date})`,
        sql`EXTRACT(MONTH FROM ${dailyGeocodes.date})`
      )
      .orderBy(
        sql`EXTRACT(YEAR FROM ${dailyGeocodes.date}) DESC`,
        sql`EXTRACT(MONTH FROM ${dailyGeocodes.date}) DESC`
      );

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // Transform results to include month names and formatted date ranges
    return results.map(result => ({
      year: result.year,
      month: result.month,
      monthName: monthNames[result.month - 1], // month is 1-indexed
      count: result.count,
      dateRange: `${monthNames[result.month - 1]} ${result.year}`
    }));
  }

  // Get geocoded daily centroids by date range for analytics
  async getGeocodedDailyCentroidsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<DailyGeocode[]> {
    console.log(`DEBUG: getGeocodedDailyCentroidsByDateRange called with:`, {
      userId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startDateFormatted: startDate.toISOString().split('T')[0],
      endDateFormatted: endDate.toISOString().split('T')[0]
    });

    // Use proper PostgreSQL date comparison - convert dates to string format for comparison
    const startDateStr = startDate.toISOString().split('T')[0]; // Get YYYY-MM-DD format
    const endDateStr = endDate.toISOString().split('T')[0]; // Get YYYY-MM-DD format

    const result = await db
      .select()
      .from(dailyGeocodes)
      .where(and(
        eq(dailyGeocodes.userId, userId),
        eq(dailyGeocodes.geocoded, true),
        // Use DATE comparison to ensure proper filtering - cast both sides to DATE type
        sql`DATE(${dailyGeocodes.date}) >= DATE(${startDateStr})`,
        sql`DATE(${dailyGeocodes.date}) <= DATE(${endDateStr})`,
        // Ensure we have meaningful location data
        sql`${dailyGeocodes.city} IS NOT NULL OR ${dailyGeocodes.country} IS NOT NULL`
      ))
      .orderBy(desc(dailyGeocodes.date));

    console.log(`DEBUG: Query returned ${result.length} geocoded centroids for date range ${startDateStr} to ${endDateStr}`);
    if (result.length > 0) {
      console.log(`DEBUG: First result date: ${result[0].date}, Last result date: ${result[result.length - 1].date}`);
    }

    return result;
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

  async getUngeocodedDailyCentroids(userId: string, limit?: number): Promise<DailyGeocode[]> {
    return [];
  }

  async computeDailyCentroidsForAllDatasets(userId: string): Promise<number> {
    return 0;
  }

  async getUngeocodedCentroidsCount(userId: string): Promise<number> {
    return 0;
  }

  async updateDailyCentroidGeocoding(
    id: string,
    address: string,
    city?: string,
    state?: string,
    country?: string
  ): Promise<void> {}

  // Stub implementations for new date range methods (not used in memory storage)
  async getUngeocodedDailyCentroidsByDateRange(
    userId: string, 
    startDate: Date, 
    endDate: Date, 
    limit?: number
  ): Promise<DailyGeocode[]> {
    return [];
  }

  async getUngeocodedCentroidsCountByDateRange(
    userId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<number> {
    return 0;
  }

  async getLocationStatsByDateRange(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalDays: number;
    geocodedDays: number;
    geocodingCoverage: number;
    countries: Array<{ country: string; days: number; percent: number }>;
    usStates: Array<{ state: string; days: number; percent: number }>;
    dateRange: { start: Date; end: Date };
  }> {
    return {
      totalDays: 0,
      geocodedDays: 0,
      geocodingCoverage: 0,
      countries: [],
      usStates: [],
      dateRange: { start: startDate, end: endDate },
    };
  }

  async debugGeocodingCoverage(userId: string, year: number): Promise<{
    expectedDays: number;
    actualGeocodedDays: number;
    coverage: number;
    ungeocodedCount: number;
  }> {
    return {
      expectedDays: 0,
      actualGeocodedDays: 0,
      coverage: 0,
      ungeocodedCount: 0,
    };
  }

  async getUngeocodedSummary(userId: string): Promise<Array<{
    year: number;
    month: number;
    monthName: string;
    count: number;
    dateRange: string;
  }>> {
    return [];
  }

  async getGeocodedDailyCentroidsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<DailyGeocode[]> {
    return [];
  }
}

// Use database storage for user authentication and persistent data
export const storage = new DatabaseStorage();