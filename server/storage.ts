// Storage layer implementing user-specific location data with authentication
import {
  users,
  locationPoints,
  locationDatasets,
  uniqueLocations,
  dailyGeocodes,
  travelStops,
  travelSegments,
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
  type TravelStop,
  type InsertTravelStop,
  type TravelSegment,
  type InsertTravelSegment,
} from "@shared/schema";
import { db } from "./db.js";
import { eq, and, or, desc, sql, gte, lte, exists, inArray } from "drizzle-orm";

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
  
  // Raw file storage for deferred processing
  storeRawFile(datasetId: string, userId: string, rawContent: string): Promise<void>;
  getRawFile(datasetId: string, userId: string): Promise<string | undefined>;
  
  
  // Location point operations (user-specific)
  insertLocationPoints(points: InsertLocationPoint[]): Promise<LocationPoint[]>;
  getUserLocationPoints(userId: string, datasetId?: string): Promise<LocationPoint[]>;
  getUserLocationPointsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<LocationPoint[]>;
  getUserLocationPointsCount(userId: string): Promise<number>;
  clearUserLocationData(userId: string): Promise<void>;
  
  // Unique location operations (user-specific)
  insertUniqueLocations(locations: InsertUniqueLocation[]): Promise<UniqueLocation[]>;
  getUserUniqueLocations(userId: string): Promise<UniqueLocation[]>;
  updateLocationGeocoding(id: string, address: string, city?: string, state?: string, country?: string): Promise<void>;
  
  // Daily centroid analytics pipeline (user-specific)
  computeAndUpsertDailyCentroids(userId: string, datasetId: string): Promise<number>;
  computeDailyCentroidsForAllDatasets(userId: string): Promise<number>;
  computeDailyCentroidsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<number>;
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
  
  // Waypoint-based analytics operations (replaces daily centroids)
  // Travel stops operations
  insertTravelStops(stops: InsertTravelStop[]): Promise<TravelStop[]>;
  getUserTravelStops(userId: string, datasetId?: string): Promise<TravelStop[]>;
  getUserTravelStopsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<TravelStop[]>;
  updateTravelStopGeocoding(id: string, address: string, city?: string, state?: string, country?: string): Promise<void>;
  
  // Travel segments operations
  insertTravelSegments(segments: InsertTravelSegment[]): Promise<TravelSegment[]>;
  getUserTravelSegments(userId: string, datasetId?: string): Promise<TravelSegment[]>;
  getUserTravelSegmentsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<TravelSegment[]>;
  
  // Waypoint computation pipeline
  computeTravelStopsFromPoints(userId: string, datasetId: string, minDwellMinutes?: number, maxDistanceMeters?: number): Promise<number>;
  computeTravelSegmentsFromStops(userId: string, datasetId: string): Promise<number>;
  computeWaypointAnalytics(userId: string, datasetId: string): Promise<{ stopsCreated: number; segmentsCreated: number }>;
  
  // Analytics from waypoints (replaces centroid-based analytics)
  getWaypointCityJumpsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<Array<{
    fromCity: string;
    fromState?: string;
    fromCountry: string;
    fromCoords: { lat: number; lng: number };
    toCity: string;
    toState?: string;
    toCountry: string;
    toCoords: { lat: number; lng: number };
    date: string;
    mode: string;
    distance: number;
  }>>;
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
      .select({
        id: locationDatasets.id,
        userId: locationDatasets.userId,
        filename: locationDatasets.filename,
        fileSize: locationDatasets.fileSize,
        totalPoints: locationDatasets.totalPoints,
        deduplicatedPoints: locationDatasets.deduplicatedPoints,
        uploadedAt: locationDatasets.uploadedAt,
        processedAt: locationDatasets.processedAt,
        rawContent: sql`NULL`.as('rawContent'), // Exclude actual content to avoid "response too large" error
      })
      .from(locationDatasets)
      .where(eq(locationDatasets.userId, userId))
      .orderBy(desc(locationDatasets.uploadedAt)) as LocationDataset[];
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

  async resetDatasetProcessed(id: string): Promise<void> {
    await db
      .update(locationDatasets)
      .set({
        deduplicatedPoints: 0,
        processedAt: null,
      })
      .where(eq(locationDatasets.id, id));
  }
  
  // Raw file storage for deferred processing  
  async storeRawFile(datasetId: string, userId: string, rawContent: string): Promise<void> {
    await db
      .update(locationDatasets)
      .set({ rawContent })
      .where(and(eq(locationDatasets.id, datasetId), eq(locationDatasets.userId, userId)));
  }
  
  async getRawFile(datasetId: string, userId: string): Promise<string | undefined> {
    const [dataset] = await db
      .select({ rawContent: locationDatasets.rawContent })
      .from(locationDatasets)
      .where(and(eq(locationDatasets.id, datasetId), eq(locationDatasets.userId, userId)));
    
    if (!dataset?.rawContent) return undefined;
    
    // Handle file path format for large files
    if (dataset.rawContent.startsWith('FILE:')) {
      try {
        const filePath = dataset.rawContent.slice(5); // Remove 'FILE:' prefix
        console.log(`📁 Reading large file from disk: ${filePath}`);
        
        const fs = await import('fs/promises');
        const fileContent = await fs.readFile(filePath, 'utf8');
        
        console.log(`✅ File read successfully: ${(fileContent.length / (1024 * 1024)).toFixed(2)}MB`);
        return fileContent;
      } catch (error) {
        console.error(`💥 Failed to read file from disk:`, error);
        throw new Error(`Failed to read location history file from storage`);
      }
    }
    
    // Return database-stored content for smaller files
    return dataset.rawContent;
  }
  

  // Location point operations
  async insertLocationPoints(points: InsertLocationPoint[]): Promise<LocationPoint[]> {
    if (points.length === 0) return [];
    
    // Use batch insertion for large datasets to avoid stack overflow
    const BATCH_SIZE = 2500; // Optimal batch size for PostgreSQL
    const allResults: LocationPoint[] = [];
    
    for (let i = 0; i < points.length; i += BATCH_SIZE) {
      const batch = points.slice(i, i + BATCH_SIZE);
      try {
        const batchResults = await db.insert(locationPoints).values(batch).onConflictDoNothing().returning();
        allResults.push(...batchResults);
        
        // Log progress for large uploads
        if (points.length > BATCH_SIZE) {
          const progress = Math.min(i + BATCH_SIZE, points.length);
          const inserted = batchResults.length;
          const skipped = batch.length - inserted;
          console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${progress}/${points.length} processed (${inserted} inserted, ${skipped} duplicates skipped)`);
        }
      } catch (error) {
        console.error(`❌ Failed to insert batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error);
        // Continue with next batch instead of failing completely
      }
    }
    
    console.log(`Successfully processed ${points.length} location points - ${allResults.length} inserted (${points.length - allResults.length} duplicates skipped)`);
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

  async getUserLocationPointsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<LocationPoint[]> {
    const conditions = [
      eq(locationPoints.userId, userId),
      gte(locationPoints.timestamp, startDate),
      lte(locationPoints.timestamp, endDate)
    ];
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

  async deleteLocationDataset(datasetId: string, userId: string): Promise<void> {
    await db.delete(locationDatasets)
      .where(and(eq(locationDatasets.id, datasetId), eq(locationDatasets.userId, userId)));
  }

  async deleteLocationPointsByDataset(datasetId: string, userId: string): Promise<void> {
    await db.delete(locationPoints)
      .where(and(eq(locationPoints.datasetId, datasetId), eq(locationPoints.userId, userId)));
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
    console.log(`🔍 [DEBUG-2016] Computing daily centroids for user ${userId}, dataset ${datasetId}`);
    
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

    console.log(`🔍 [DEBUG-2016] Found ${dailyCentroids.length} daily centroids`);
    
    if (dailyCentroids.length === 0) {
      console.log(`🔍 [DEBUG-2016] No daily centroids found, returning 0`);
      return 0;
    }

    // Debug: Log all computed centroids and validate them
    console.log(`🔍 [DEBUG-2016] Daily centroid validation:`);
    dailyCentroids.forEach((centroid, index) => {
      const isValid = !isNaN(centroid.lat) && !isNaN(centroid.lng) && 
                     centroid.lat !== 0 && centroid.lng !== 0 &&
                     centroid.lat >= -90 && centroid.lat <= 90 &&
                     centroid.lng >= -180 && centroid.lng <= 180;
      const status = isValid ? "✅ VALID" : "❌ INVALID";
      console.log(`   [${index}] ${status}: date=${centroid.date}, lat=${centroid.lat}, lng=${centroid.lng}, points=${centroid.pointCount}`);
    });

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

  // OPTIMIZED: Compute daily centroids only for the requested date range
  async computeDailyCentroidsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<number> {
    console.log(`🚀 Computing daily centroids for user ${userId} in date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // SQL-first approach: compute daily centroids using date_trunc with date filtering
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
        sql`${locationPoints.timestamp} >= ${startDate}`,
        sql`${locationPoints.timestamp} <= ${endDate}`
      ))
      .groupBy(
        locationPoints.userId,
        locationPoints.datasetId,
        sql`date_trunc('day', ${locationPoints.timestamp})`
      );

    if (dailyCentroids.length === 0) {
      console.log(`📊 No location points found in date range for user ${userId}`);
      return 0;
    }

    console.log(`📊 Found ${dailyCentroids.length} daily centroids to process in date range`);

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
        console.log(`📊 Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${progress}/${insertData.length} daily centroids`);
      }
    }

    console.log(`✅ Successfully upserted ${totalUpserted} daily centroids for user ${userId} in date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    return totalUpserted;
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
    console.log(`🔍 [DEBUG-2016] updateDailyCentroidGeocoding called for ID: ${id}`);
    console.log(`   Address: ${address}`);
    console.log(`   City: ${city || 'None'}`);
    console.log(`   State: ${state || 'None'}`);
    console.log(`   Country: ${country || 'None'}`);
    
    // Log the decision criteria
    const willMarkAsGeocoded = true; // Always true since this method is called when geocoding succeeds
    const hasCountry = !!country;
    const analyticsWillCount = hasCountry; // Analytics only counts entries with country
    
    console.log(`   Will mark as geocoded: ${willMarkAsGeocoded}`);
    console.log(`   Has country data: ${hasCountry}`);
    console.log(`   Analytics will count this: ${analyticsWillCount}`);
    
    if (!hasCountry) {
      console.log(`   ⚠️  WARNING: Marking as geocoded but analytics won't count it (no country data)`);
    } else {
      console.log(`   ✅ GOOD: Marking as geocoded and analytics will count it (country: ${country})`);
    }
    
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
      
    console.log(`   ✅ Successfully updated daily centroid ${id} as geocoded`);
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
    console.log(`🔍 [DEBUG-2016] getLocationStatsByDateRange called:`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Get deduplicated daily centroids within date range (highest pointCount per day wins)
    console.log(`🔍 [DEBUG-2016] Querying geocoded daily centroids...`);
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

    console.log(`🔍 [DEBUG-2016] Found ${deduplicatedCentroids.length} geocoded daily centroids`);
    
    // Debug: Log details about geocoded centroids
    console.log(`🔍 [DEBUG-2016] Geocoded centroids breakdown:`);
    const withCountry = deduplicatedCentroids.filter(c => c.country);
    const withoutCountry = deduplicatedCentroids.filter(c => !c.country);
    console.log(`   With country: ${withCountry.length}`);
    console.log(`   Without country: ${withoutCountry.length}`);
    
    if (withCountry.length > 0) {
      console.log(`   Sample geocoded centroids with country:`);
      withCountry.slice(0, 5).forEach((c, i) => {
        console.log(`     [${i}] Date: ${c.date.toISOString().split('T')[0]}, Country: ${c.country}, State: ${c.state || 'None'}`);
      });
    }
    
    if (withoutCountry.length > 0) {
      console.log(`   ⚠️  Sample geocoded centroids WITHOUT country (analytics won't count these):`);
      withoutCountry.slice(0, 5).forEach((c, i) => {
        console.log(`     [${i}] Date: ${c.date.toISOString().split('T')[0]}, State: ${c.state || 'None'}`);
      });
    }

    // Get true total days from location_points (not just geocoded ones) - moved up first
    console.log(`🔍 [DEBUG-2016] Querying actual days with location data...`);
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
    
    console.log(`🔍 [DEBUG-2016] Location stats computation:`);
    console.log(`   Total days with location data: ${actualTotalDays}`);
    console.log(`   Days marked as geocoded: ${geocodedDays}`);
    console.log(`   Days with country data: ${withCountry.length}`);
    
    // Show the critical mismatch
    if (geocodedDays !== withCountry.length) {
      console.log(`   🚨 MISMATCH DETECTED: ${geocodedDays} geocoded but only ${withCountry.length} have country data!`);
      console.log(`   This explains why analytics coverage might be lower than expected.`);
    }
    
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
    const actualAnalyticsCoverage = actualTotalDays > 0 ? Math.round((withCountry.length / actualTotalDays) * 100 * 100) / 100 : 0;
    
    console.log(`🔍 [DEBUG-2016] Final coverage calculations:`);
    console.log(`   Reported geocoding coverage: ${geocodingCoverage}% (${geocodedDays}/${actualTotalDays})`);
    console.log(`   Actual analytics coverage: ${actualAnalyticsCoverage}% (${withCountry.length}/${actualTotalDays})`);
    
    if (geocodingCoverage !== actualAnalyticsCoverage) {
      console.log(`   🚨 COVERAGE MISMATCH: Reported ${geocodingCoverage}% but analytics will show ${actualAnalyticsCoverage}%`);
    }

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
    // Use proper PostgreSQL date comparison - convert dates to string format for comparison
    const startDateStr = startDate.toISOString().split('T')[0]; // Get YYYY-MM-DD format
    const endDateStr = endDate.toISOString().split('T')[0]; // Get YYYY-MM-DD format


    // Use completely raw SQL since Drizzle date filtering isn't working
    const result = await db.execute(sql`
      SELECT * FROM daily_geocodes 
      WHERE user_id = ${userId} 
      AND geocoded = true 
      AND date >= ${startDateStr}::date 
      AND date <= ${endDateStr}::date
      AND (city IS NOT NULL OR country IS NOT NULL)
      ORDER BY date DESC
    `);

    // Convert raw SQL results to proper format
    const formattedResults = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      datasetId: row.dataset_id,
      date: new Date(row.date as string),
      lat: row.lat,
      lng: row.lng,
      city: row.city,
      state: row.state,
      country: row.country,
      address: row.address,
      geocoded: row.geocoded
    })) as DailyGeocode[];


    return formattedResults;
  }

  // ================== WAYPOINT-BASED ANALYTICS IMPLEMENTATION ==================
  // Replaces daily centroid approach with accurate stop detection and trip segmentation

  // CRUD operations for travel stops
  async insertTravelStops(stops: InsertTravelStop[]): Promise<TravelStop[]> {
    if (stops.length === 0) return [];
    
    const BATCH_SIZE = 100; // Process in batches to prevent stack overflow
    const allInsertedStops: TravelStop[] = [];
    
    console.log(`🔄 Inserting ${stops.length} travel stops in batches of ${BATCH_SIZE}...`);
    
    for (let i = 0; i < stops.length; i += BATCH_SIZE) {
      const batch = stops.slice(i, i + BATCH_SIZE);
      const batchResult = await db.insert(travelStops).values(batch).returning();
      allInsertedStops.push(...batchResult);
      
      if (i % (BATCH_SIZE * 5) === 0) { // Log progress every 500 stops
        console.log(`📝 Processed ${Math.min(i + BATCH_SIZE, stops.length)}/${stops.length} travel stops`);
      }
    }
    
    console.log(`✅ Successfully inserted ${allInsertedStops.length} travel stops in ${Math.ceil(stops.length / BATCH_SIZE)} batches`);
    return allInsertedStops;
  }

  async getUserTravelStops(userId: string, datasetId?: string): Promise<TravelStop[]> {
    const conditions = [eq(travelStops.userId, userId)];
    if (datasetId) {
      conditions.push(eq(travelStops.datasetId, datasetId));
    }
    
    return await db
      .select()
      .from(travelStops)
      .where(and(...conditions))
      .orderBy(desc(travelStops.start));
  }

  async getUserTravelStopsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<TravelStop[]> {
    const conditions = [
      eq(travelStops.userId, userId),
      gte(travelStops.start, startDate),
      lte(travelStops.end, endDate)
    ];
    if (datasetId) {
      conditions.push(eq(travelStops.datasetId, datasetId));
    }
    
    return await db
      .select()
      .from(travelStops)
      .where(and(...conditions))
      .orderBy(desc(travelStops.start));
  }

  async updateTravelStopGeocoding(
    id: string,
    address: string,
    city?: string,
    state?: string,
    country?: string
  ): Promise<void> {
    await db
      .update(travelStops)
      .set({
        address,
        city,
        state,
        country,
        geocoded: true,
        geocodedAt: new Date(),
      })
      .where(eq(travelStops.id, id));
  }

  // CRUD operations for travel segments
  async insertTravelSegments(segments: InsertTravelSegment[]): Promise<TravelSegment[]> {
    if (segments.length === 0) return [];
    
    const BATCH_SIZE = 100; // Process in batches to prevent stack overflow
    const allInsertedSegments: TravelSegment[] = [];
    
    console.log(`🔄 Inserting ${segments.length} travel segments in batches of ${BATCH_SIZE}...`);
    
    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
      const batch = segments.slice(i, i + BATCH_SIZE);
      const batchResult = await db.insert(travelSegments).values(batch).returning();
      allInsertedSegments.push(...batchResult);
      
      if (i % (BATCH_SIZE * 5) === 0) { // Log progress every 500 segments
        console.log(`📝 Processed ${Math.min(i + BATCH_SIZE, segments.length)}/${segments.length} travel segments`);
      }
    }
    
    console.log(`✅ Successfully inserted ${allInsertedSegments.length} travel segments in ${Math.ceil(segments.length / BATCH_SIZE)} batches`);
    return allInsertedSegments;
  }

  async getUserTravelSegments(userId: string, datasetId?: string): Promise<TravelSegment[]> {
    // Join with travel stops to filter by dataset if needed
    if (datasetId) {
      const result = await db
        .select({
          id: travelSegments.id,
          userId: travelSegments.userId,
          fromStopId: travelSegments.fromStopId,
          toStopId: travelSegments.toStopId,
          start: travelSegments.start,
          end: travelSegments.end,
          distanceMiles: travelSegments.distanceMiles,
          polyline: travelSegments.polyline,
          cities: travelSegments.cities,
          createdAt: travelSegments.createdAt,
        })
        .from(travelSegments)
        .innerJoin(travelStops, eq(travelSegments.fromStopId, travelStops.id))
        .where(and(
          eq(travelSegments.userId, userId),
          eq(travelStops.datasetId, datasetId)
        ))
        .orderBy(desc(travelSegments.start));
      
      return result as TravelSegment[];
    }
    
    return await db
      .select()
      .from(travelSegments)
      .where(eq(travelSegments.userId, userId))
      .orderBy(desc(travelSegments.start));
  }

  async getUserTravelSegmentsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<TravelSegment[]> {
    if (datasetId) {
      const result = await db
        .select({
          id: travelSegments.id,
          userId: travelSegments.userId,
          fromStopId: travelSegments.fromStopId,
          toStopId: travelSegments.toStopId,
          start: travelSegments.start,
          end: travelSegments.end,
          distanceMiles: travelSegments.distanceMiles,
          polyline: travelSegments.polyline,
          cities: travelSegments.cities,
          createdAt: travelSegments.createdAt,
        })
        .from(travelSegments)
        .innerJoin(travelStops, eq(travelSegments.fromStopId, travelStops.id))
        .where(and(
          eq(travelSegments.userId, userId),
          eq(travelStops.datasetId, datasetId),
          gte(travelSegments.start, startDate),
          lte(travelSegments.end, endDate)
        ))
        .orderBy(desc(travelSegments.start));
      
      return result as TravelSegment[];
    }
    
    const conditions = [
      eq(travelSegments.userId, userId),
      gte(travelSegments.start, startDate),
      lte(travelSegments.end, endDate)
    ];
    
    return await db
      .select()
      .from(travelSegments)
      .where(and(...conditions))
      .orderBy(desc(travelSegments.start));
  }

  // ================== CORE ALGORITHMS ==================

  // Distance calculation utility using Haversine formula (returns meters)
  private calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Distance calculation in miles (for travel segments)
  private calculateDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
    return this.calculateDistanceMeters(lat1, lng1, lat2, lng2) * 0.000621371; // Convert meters to miles
  }

  // GPS error filtering to remove anomalous coordinates
  private isValidGPSCoordinate(lat: number, lng: number): boolean {
    // Filter out obvious GPS errors
    if (lat === 0 && lng === 0) return false; // Common GPS error
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false; // Invalid coordinate range
    if (lat === null || lng === null || isNaN(lat) || isNaN(lng)) return false; // Invalid data
    return true;
  }

  // Calculate actual route distance by summing GPS coordinate movements from JSON data
  private async calculateActualRouteDistanceFromJSON(
    fromStop: TravelStop, 
    toStop: TravelStop, 
    userId: string, 
    datasetId: string
  ): Promise<number> {
    try {
      // Use existing getRawFile method to handle both database and file-based storage
      const rawContent = await this.getRawFile(datasetId, userId);
      if (!rawContent) {
        console.log(`⚠️ No raw JSON content for dataset ${datasetId}, using straight-line distance`);
        return this.calculateDistanceMiles(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng);
      }

      // Process JSON to get GPS points between stops
      const { processTimelinePathsForDateRange, buildParentIndex } = await import("./timelineAssociation.js");
      
      const jsonData = JSON.parse(rawContent);
      const parentIndex = buildParentIndex(jsonData);

      // Calculate precise time range for GPS filtering
      const fromStopEndMs = fromStop.end.getTime();
      const toStopStartMs = toStop.start.getTime();
      
      // Get GPS points for a wider date range (to catch points spanning day boundaries)
      const startDate = new Date(fromStopEndMs - 86400000); // 1 day before
      const endDate = new Date(toStopStartMs + 86400000);   // 1 day after
      
      const routePoints = processTimelinePathsForDateRange(
        jsonData,
        parentIndex,
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      );

      // Filter points to exact time range using precise timestamps
      const filteredPoints = routePoints.filter(point => {
        return point.timestampMs >= fromStopEndMs && point.timestampMs <= toStopStartMs;
      }).sort((a, b) => a.timestampMs - b.timestampMs);

      if (filteredPoints.length === 0) {
        console.log(`⚠️ No GPS points found between stops, using straight-line distance`);
        return this.calculateDistanceMiles(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng);
      }

      // Calculate actual route distance by summing GPS movements
      let totalDistanceMiles = 0;
      let previousPoint = { lat: fromStop.lat, lng: fromStop.lng }; // Start from departure stop
      let previousTimestamp = fromStopEndMs;

      for (const point of filteredPoints) {
        // Skip invalid GPS coordinates
        if (!this.isValidGPSCoordinate(point.latitude, point.longitude)) {
          continue;
        }

        // Calculate distance from previous valid point
        const segmentDistance = this.calculateDistanceMiles(
          previousPoint.lat, previousPoint.lng,
          point.latitude, point.longitude
        );

        // Time-aware filtering: reject impossibly fast movement (over 600 mph between points)
        const timeDeltaHours = (point.timestampMs - previousTimestamp) / (1000 * 60 * 60);
        const maxReasonableSpeed = 600; // mph (covers even aircraft)
        
        if (timeDeltaHours > 0 && segmentDistance / timeDeltaHours > maxReasonableSpeed) {
          console.log(`⚠️ Filtering GPS jump: ${segmentDistance.toFixed(1)} miles in ${timeDeltaHours.toFixed(2)}h = ${(segmentDistance/timeDeltaHours).toFixed(0)} mph`);
          continue;
        }

        totalDistanceMiles += segmentDistance;
        previousPoint = { lat: point.latitude, lng: point.longitude };
        previousTimestamp = point.timestampMs;
      }

      // Add final segment to arrival stop if reasonable
      if (this.isValidGPSCoordinate(toStop.lat, toStop.lng)) {
        const finalSegment = this.calculateDistanceMiles(
          previousPoint.lat, previousPoint.lng,
          toStop.lat, toStop.lng
        );
        
        const finalTimeDelta = (toStopStartMs - previousTimestamp) / (1000 * 60 * 60);
        if (finalTimeDelta <= 0 || finalSegment / Math.max(finalTimeDelta, 0.01) <= 600) {
          totalDistanceMiles += finalSegment;
        }
      }

      console.log(`📏 Route distance: ${totalDistanceMiles.toFixed(1)} miles from ${filteredPoints.length} GPS points`);
      return totalDistanceMiles;

    } catch (error) {
      console.error(`❌ Error calculating route distance: ${error}`);
      // Fallback to straight-line distance
      return this.calculateDistanceMiles(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng);
    }
  }

  // **STOP DETECTION ALGORITHM**
  // Identifies places where user stayed ≥minDwellMinutes within maxDistanceMeters radius
  async computeTravelStopsFromPoints(
    userId: string,
    datasetId: string,
    minDwellMinutes: number = 8,
    maxDistanceMeters: number = 300
  ): Promise<number> {
    console.log(`🔍 Computing travel stops for user ${userId}, dataset ${datasetId} (min dwell: ${minDwellMinutes}min, max distance: ${maxDistanceMeters}m)`);
    
    // Get all location points for this dataset, ordered by time
    const points = await db
      .select()
      .from(locationPoints)
      .where(and(
        eq(locationPoints.userId, userId),
        eq(locationPoints.datasetId, datasetId)
      ))
      .orderBy(locationPoints.timestamp);

    if (points.length === 0) {
      console.log(`❌ No location points found for dataset ${datasetId}`);
      return 0;
    }

    console.log(`📍 Processing ${points.length} location points for stop detection`);

    const stops: InsertTravelStop[] = [];
    let currentCluster: typeof points = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      
      if (currentCluster.length === 0) {
        // Start new cluster
        currentCluster = [point];
        continue;
      }

      // Check if point is within distance threshold of FIRST point in cluster (not moving centroid)
      const clusterOrigin = currentCluster[0]; // Use first point as stable reference
      const distanceToCluster = this.calculateDistanceMeters(
        point.lat, point.lng,
        clusterOrigin.lat, clusterOrigin.lng
      );

      if (distanceToCluster <= maxDistanceMeters) {
        // Add to current cluster
        currentCluster.push(point);
      } else {
        // Process current cluster if it meets dwell time requirement
        const stop = await this.processCluster(currentCluster, userId, datasetId, minDwellMinutes);
        if (stop) {
          stops.push(stop);
        }
        
        // Start new cluster with current point
        currentCluster = [point];
      }
    }

    // Process final cluster
    if (currentCluster.length > 0) {
      const stop = await this.processCluster(currentCluster, userId, datasetId, minDwellMinutes);
      if (stop) {
        stops.push(stop);
      }
    }

    // Insert all detected stops
    if (stops.length > 0) {
      await this.insertTravelStops(stops);
      console.log(`✅ Created ${stops.length} travel stops`);
    } else {
      console.log(`❌ No significant stops detected (min dwell: ${minDwellMinutes} minutes)`);
    }

    return stops.length;
  }

  // Helper: Calculate centroid of a cluster of points
  private calculateClusterCentroid(cluster: LocationPoint[]): { lat: number; lng: number } {
    const lat = cluster.reduce((sum, p) => sum + p.lat, 0) / cluster.length;
    const lng = cluster.reduce((sum, p) => sum + p.lng, 0) / cluster.length;
    return { lat, lng };
  }

  // Helper: Process a cluster to determine if it's a significant stop
  private async processCluster(
    cluster: LocationPoint[],
    userId: string,
    datasetId: string,
    minDwellMinutes: number
  ): Promise<InsertTravelStop | null> {
    if (cluster.length === 0) return null;

    const startTime = new Date(Math.min(...cluster.map(p => p.timestamp.getTime())));
    const endTime = new Date(Math.max(...cluster.map(p => p.timestamp.getTime())));
    const dwellMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);

    // Only create stop if dwell time meets minimum requirement
    if (dwellMinutes < minDwellMinutes) {
      return null;
    }

    const centroid = this.calculateClusterCentroid(cluster);

    return {
      userId,
      datasetId,
      start: startTime,
      end: endTime,
      lat: centroid.lat,
      lng: centroid.lng,
      pointCount: cluster.length,
      dwellMinutes: Math.round(dwellMinutes),
    };
  }

  // **TRIP SEGMENTATION ALGORITHM**
  // Creates travel segments between consecutive stops
  async computeTravelSegmentsFromStops(userId: string, datasetId: string): Promise<number> {
    console.log(`🛤️  Computing travel segments for user ${userId}, dataset ${datasetId}`);
    
    // Get all stops for this dataset, ordered by start time
    const stops = await db
      .select()
      .from(travelStops)
      .where(and(
        eq(travelStops.userId, userId),
        eq(travelStops.datasetId, datasetId)
      ))
      .orderBy(travelStops.start);

    if (stops.length < 2) {
      console.log(`❌ Need at least 2 stops to create segments. Found: ${stops.length}`);
      return 0;
    }

    const segments: InsertTravelSegment[] = [];

    for (let i = 0; i < stops.length - 1; i++) {
      const fromStop = stops[i];
      const toStop = stops[i + 1];

      // Calculate actual route distance using GPS coordinates from JSON
      const distanceMiles = await this.calculateActualRouteDistanceFromJSON(
        fromStop, toStop, userId, datasetId
      );

      console.log(`🛤️ Route ${fromStop.city || 'Unknown'} → ${toStop.city || 'Unknown'}: ${distanceMiles.toFixed(1)} miles (actual route)`);

      // Get intermediate cities along the route
      const intermediateCities = await this.getIntermediateCities(
        fromStop, toStop, userId, datasetId
      );

      const segment: InsertTravelSegment = {
        userId,
        fromStopId: fromStop.id,
        toStopId: toStop.id,
        start: fromStop.end, // Travel starts when previous stop ends
        end: toStop.start,   // Travel ends when next stop starts
        distanceMiles,
        cities: intermediateCities,
      };

      segments.push(segment);
    }

    // Insert all segments
    if (segments.length > 0) {
      await this.insertTravelSegments(segments);
      console.log(`✅ Created ${segments.length} travel segments`);
    }

    return segments.length;
  }

  // Helper: Get intermediate cities along a travel route
  private async getIntermediateCities(
    fromStop: TravelStop,
    toStop: TravelStop,
    userId: string,
    datasetId: string
  ): Promise<string[]> {
    // Get GPS points between the two stops
    const routePoints = await db
      .select()
      .from(locationPoints)
      .where(and(
        eq(locationPoints.userId, userId),
        eq(locationPoints.datasetId, datasetId),
        gte(locationPoints.timestamp, fromStop.end),
        lte(locationPoints.timestamp, toStop.start)
      ))
      .orderBy(locationPoints.timestamp);

    // Sample points every 25-50km for intermediate city detection
    const sampledPoints = this.sampleRoutePoints(routePoints, 40000); // 40km intervals in meters
    
    // Extract unique cities from sampled points
    const cities = new Set<string>();
    
    for (const point of sampledPoints) {
      if (point.city && point.city.trim() !== '') {
        cities.add(point.city.trim());
      }
    }

    // Exclude the from/to cities if they're already known
    if (fromStop.city) cities.delete(fromStop.city);
    if (toStop.city) cities.delete(toStop.city);

    return Array.from(cities).sort();
  }

  // Helper: Sample GPS points along route at regular distance intervals
  private sampleRoutePoints(points: LocationPoint[], intervalMeters: number): LocationPoint[] {
    if (points.length === 0) return [];
    
    const sampled: LocationPoint[] = [points[0]]; // Always include first point
    let lastSampledPoint = points[0];
    let accumulatedDistance = 0;

    for (let i = 1; i < points.length; i++) {
      const currentPoint = points[i];
      const segmentDistance = this.calculateDistanceMeters(
        lastSampledPoint.lat, lastSampledPoint.lng,
        currentPoint.lat, currentPoint.lng
      );
      
      accumulatedDistance += segmentDistance;
      
      if (accumulatedDistance >= intervalMeters) {
        sampled.push(currentPoint);
        lastSampledPoint = currentPoint;
        accumulatedDistance = 0;
      }
    }

    // Always include last point
    if (points.length > 1 && sampled[sampled.length - 1]?.id !== points[points.length - 1].id) {
      sampled.push(points[points.length - 1]);
    }

    return sampled;
  }

  // ============= DATE-RANGE-BOUNDED WAYPOINT METHODS =============
  
  // Clean existing waypoint data in date range for idempotency (NO TRANSACTION: Neon doesn't support them)
  async cleanWaypointDataInDateRange(userId: string, datasetId: string, startDate: Date, endDate: Date): Promise<void> {
    console.log(`🧹 Cleaning existing waypoint data in range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} for dataset ${datasetId}`);
    
    // STEP 1: Identify the target stop set S = stops that overlap the time range
    // These are the stops we plan to delete in step 3
    const targetStops = await db
      .select({ id: travelStops.id })
      .from(travelStops)
      .where(and(
        eq(travelStops.userId, userId),
        eq(travelStops.datasetId, datasetId),
        // Overlap detection: stop overlaps if start <= endDate AND end >= startDate
        lte(travelStops.start, endDate),
        gte(travelStops.end, startDate)
      ));
    
    if (targetStops.length === 0) {
      console.log(`🔍 No overlapping stops found in date range - cleanup complete`);
      return;
    }
    
    const targetStopIds = targetStops.map(s => s.id);
    console.log(`🎯 Found ${targetStopIds.length} stops to clean in date range`);
    
    // STEP 2: Delete ALL segments referencing ANY target stop (regardless of segment time)
    // This prevents FK violations when we delete the stops in step 3
    await db.delete(travelSegments)
      .where(and(
        eq(travelSegments.userId, userId),
        or(
          inArray(travelSegments.fromStopId, targetStopIds),
          inArray(travelSegments.toStopId, targetStopIds)
        )
      ));
    
    console.log(`🗑️ Deleted segments referencing target stops`);
    
    // STEP 3: Delete the target stops (safe now that referencing segments are gone)
    await db.delete(travelStops)
      .where(and(
        eq(travelStops.userId, userId),
        eq(travelStops.datasetId, datasetId),
        inArray(travelStops.id, targetStopIds)
      ));
    
    console.log(`🗑️ Deleted ${targetStopIds.length} stops in date range`);
    
    // STEP 4: Post-cleanup invariant check (FAIL if any segments still reference deleted stops)
    const remainingSegments = await db
      .select({ count: sql`count(*)` })
      .from(travelSegments)
      .where(and(
        eq(travelSegments.userId, userId),
        or(
          inArray(travelSegments.fromStopId, targetStopIds),
          inArray(travelSegments.toStopId, targetStopIds)
        )
      ));
    
    const remainingCount = Number(remainingSegments[0]?.count || 0);
    console.log(`✅ Invariant check: ${remainingCount} segments still reference deleted stops (should be 0)`);
    
    if (remainingCount > 0) {
      console.error(`⚠️ Warning: ${remainingCount} segments still reference deleted stops - may indicate FK constraint issue`);
      // Don't throw error for now since Neon doesn't support transactions anyway
    }
  }

  // Compute travel stops ONLY from GPS points in the specified date range
  async computeTravelStopsFromPointsByDateRange(
    userId: string, 
    datasetId: string, 
    startDate: Date, 
    endDate: Date,
    minDwellMinutes: number = 8,
    maxDistanceMeters: number = 300
  ): Promise<number> {
    console.log(`🔍 Computing travel stops for date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // CRITICAL FIX: Use SAME method as maps - process JSON directly instead of empty database
    const { processTimelinePathsForDateRange, buildParentIndex } = await import("./timelineAssociation.js");
    
    // Get dataset for this user to find JSON file
    const datasets = await this.getUserLocationDatasets(userId);
    const dataset = datasets.find(d => d.id === datasetId);
    if (!dataset) {
      console.log(`❌ Dataset ${datasetId} not found for user ${userId}`);
      return 0;
    }

    // Read JSON file and process timelinePath data (SAME as maps)
    const fs = await import('fs');
    const filePath = `./uploads/${datasetId}.json`;
    
    if (!fs.existsSync(filePath)) {
      console.log(`❌ JSON file not found: ${filePath}`);
      return 0;
    }

    const jsonContent = fs.readFileSync(filePath, 'utf8');
    const jsonData = JSON.parse(jsonContent);
    
    // Use SAME processing as maps to get GPS points
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    console.log(`🔗 Using SAME method as maps to process GPS data for analytics...`);
    
    // Build parent index (SAME as maps)
    const parentIndex = buildParentIndex(jsonData);
    
    const timelinePoints = await processTimelinePathsForDateRange(
      jsonData,
      parentIndex,
      startDateStr,
      endDateStr
    );

    if (timelinePoints.length === 0) {
      console.log(`❌ No GPS points found in date range using timeline processing`);
      return 0;
    }

    console.log(`📍 Processing ${timelinePoints.length} GPS points from JSON (SAME as maps) in date range`);
    
    // Convert timeline points to the format expected by analytics
    const points = timelinePoints.map(tp => ({
      userId,
      datasetId,
      lat: tp.latitude,
      lng: tp.longitude,
      timestamp: new Date(tp.timestampMs),
      accuracy: null, // Not available in timeline format
    }));

    const stops: InsertTravelStop[] = [];
    let currentCluster: typeof points = [];

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      
      if (currentCluster.length === 0) {
        currentCluster = [point];
        continue;
      }

      // Check if point is within distance threshold of FIRST point in cluster (not moving centroid)
      const clusterOrigin = currentCluster[0]; // Use first point as stable reference
      const distanceToCluster = this.calculateDistanceMeters(
        point.lat, point.lng,
        clusterOrigin.lat, clusterOrigin.lng
      );

      if (distanceToCluster <= maxDistanceMeters) {
        currentCluster.push(point);
      } else {
        // Process current cluster if it meets dwell time requirement
        const stop = await this.processCluster(currentCluster, userId, datasetId, minDwellMinutes);
        if (stop) {
          stops.push(stop);
        }
        
        currentCluster = [point];
      }
    }

    // Process final cluster
    if (currentCluster.length > 0) {
      const stop = await this.processCluster(currentCluster, userId, datasetId, minDwellMinutes);
      if (stop) {
        stops.push(stop);
      }
    }

    // Insert all detected stops with batching
    if (stops.length > 0) {
      await this.insertTravelStops(stops);
      console.log(`✅ Created ${stops.length} travel stops in date range`);
    } else {
      console.log(`❌ No significant stops detected in date range (min dwell: ${minDwellMinutes} minutes)`);
    }

    return stops.length;
  }

  // Compute travel segments ONLY from stops in the specified date range
  async computeTravelSegmentsFromStopsByDateRange(
    userId: string, 
    datasetId: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<number> {
    console.log(`🛣️  Computing travel segments for date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Get stops in date range, ordered by time
    const stops = await db
      .select()
      .from(travelStops)
      .where(and(
        eq(travelStops.userId, userId),
        eq(travelStops.datasetId, datasetId),
        gte(travelStops.start, startDate),
        lte(travelStops.end, endDate)
      ))
      .orderBy(travelStops.start);

    if (stops.length < 2) {
      console.log(`❌ Need at least 2 stops to create segments, found ${stops.length} in date range`);
      return 0;
    }

    console.log(`🔗 Creating segments between ${stops.length} stops in date range`);

    const segments: InsertTravelSegment[] = [];

    for (let i = 0; i < stops.length - 1; i++) {
      const fromStop = stops[i];
      const toStop = stops[i + 1];
      
      const distanceMiles = this.calculateDistanceMeters(
        fromStop.lat, fromStop.lng,
        toStop.lat, toStop.lng
      ) / 1609.34; // Convert meters to miles

      const segment: InsertTravelSegment = {
        userId,
        fromStopId: fromStop.id,
        toStopId: toStop.id,
        start: fromStop.end, // Travel starts when leaving first stop
        end: toStop.start,   // Travel ends when arriving at next stop
        distanceMiles: Math.round(distanceMiles * 10) / 10 // Round to 1 decimal
      };

      segments.push(segment);
    }

    // Insert all segments with batching
    if (segments.length > 0) {
      await this.insertTravelSegments(segments);
      console.log(`✅ Created ${segments.length} travel segments in date range`);
    }

    return segments.length;
  }

  // **NEW: DATE-RANGE-FIRST WAYPOINT COMPUTATION** (replaces dataset-wide processing)
  async computeWaypointAnalyticsByDateRange(
    userId: string, 
    datasetId: string, 
    startDate: Date, 
    endDate: Date,
    minDwellMinutes: number = 8,
    maxDistanceMeters: number = 300,
    taskId?: string,
    progressCallback?: (taskId: string, data: any) => void
  ): Promise<{ stopsCreated: number; segmentsCreated: number; stopGeocoded?: number }> {
    console.log(`🎯 Starting DATE-RANGE waypoint computation for user ${userId}:`, {
      dataset: datasetId,
      dateRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
      architecture: "date-range-first (NEW)"
    });
    
    // Step 1: Clean existing data in date range for idempotency
    await this.cleanWaypointDataInDateRange(userId, datasetId, startDate, endDate);
    
    // Step 2: Detect travel stops ONLY in the date range
    const stopsCreated = await this.computeTravelStopsFromPointsByDateRange(userId, datasetId, startDate, endDate, minDwellMinutes, maxDistanceMeters);
    
    // Step 3: Create travel segments between stops in date range
    const segmentsCreated = await this.computeTravelSegmentsFromStopsByDateRange(userId, datasetId, startDate, endDate);
    
    // Step 4: NEW - Geocode the newly created travel stops for city information
    const stopsGeocoded = await this.geocodeTravelStopsInDateRange(userId, datasetId, startDate, endDate, taskId, progressCallback);
    
    console.log(`✅ DATE-RANGE waypoint analytics complete: ${stopsCreated} stops, ${segmentsCreated} segments, ${stopsGeocoded} geocoded`);
    
    return { stopsCreated, segmentsCreated, stopGeocoded: stopsGeocoded };
  }

  // Geocode travel stops in date range (batches of 25 like user's Geoapify system)
  async geocodeTravelStopsInDateRange(
    userId: string, 
    datasetId: string, 
    startDate: Date, 
    endDate: Date,
    taskId?: string,
    progressCallback?: (taskId: string, data: any) => void
  ): Promise<number> {
    console.log(`🌍 Geocoding travel stops in date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    // Get ungeocoded travel stops in the date range
    const ungeocodedStops = await db
      .select()
      .from(travelStops)
      .where(and(
        eq(travelStops.userId, userId),
        eq(travelStops.datasetId, datasetId),
        lte(travelStops.start, endDate),
        gte(travelStops.end, startDate),
        // Only get stops without city information
        sql`${travelStops.city} IS NULL`
      ));
    
    if (ungeocodedStops.length === 0) {
      console.log(`✅ No ungeocoded stops found in date range`);
      return 0;
    }
    
    console.log(`🎯 Found ${ungeocodedStops.length} ungeocoded stops to process`);
    
    // Emit initial geocoding start event
    if (taskId && progressCallback) {
      progressCallback(taskId, {
        type: 'geocoding_start',
        totalLocations: ungeocodedStops.length,
        message: `Geocoding ${ungeocodedStops.length} locations`
      });
    }
    
    // BATCH PROCESSING: 25 coordinates per batch (like user's Geoapify system)
    const BATCH_SIZE = 25;
    let totalGeocoded = 0;
    
    for (let i = 0; i < ungeocodedStops.length; i += BATCH_SIZE) {
      const batch = ungeocodedStops.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(ungeocodedStops.length / BATCH_SIZE);
      
      console.log(`🔄 Processing geocoding batch ${batchNumber}/${totalBatches} (${batch.length} stops)`);
      
      // Emit batch progress event
      if (taskId && progressCallback) {
        progressCallback(taskId, {
          type: 'geocoding_progress',
          batch: batchNumber,
          totalBatches,
          batchSize: batch.length,
          totalProcessed: i,
          totalLocations: ungeocodedStops.length,
          percentage: Math.round((i / ungeocodedStops.length) * 100),
          message: `Batch ${batchNumber}/${totalBatches} (${batch.length} locations)`
        });
      }
      
      // Prepare coordinates for batch geocoding
      const coordinates = batch.map(stop => ({ lat: stop.lat, lng: stop.lng }));
      
      try {
        // Use batch geocoding system with cache metrics
        const { batchReverseGeocode } = await import("./geocodingService.js");
        const batchResult = await batchReverseGeocode(coordinates);
        const { results: geocodeResults, cacheMetrics } = batchResult;
        
        // Update each stop with geocoding results
        for (let j = 0; j < batch.length; j++) {
          const stop = batch[j];
          const result = geocodeResults[j];
          
          if (result && (result.city || result.address)) {
            await this.updateTravelStopGeocoding(
              stop.id,
              result.address || 'Unknown',
              result.city,
              result.state,
              result.country
            );
            totalGeocoded++;
          }
        }
        
        const batchSuccessful = geocodeResults.filter(r => r && (r.city || r.address)).length;
        console.log(`✅ Processed geocoding batch ${batchNumber}/${totalBatches}: ${batchSuccessful}/${batch.length} successful`);
        
        // Emit batch completion event with cache metrics
        if (taskId && progressCallback) {
          progressCallback(taskId, {
            type: 'geocoding_batch_complete',
            batch: batchNumber,
            totalBatches,
            batchSuccessful,
            batchSize: batch.length,
            totalProcessed: i + batch.length,
            totalLocations: ungeocodedStops.length,
            percentage: Math.round(((i + batch.length) / ungeocodedStops.length) * 100),
            cacheHits: cacheMetrics.cacheHits,
            newApiCalls: cacheMetrics.newApiCalls,
            cacheHitRate: cacheMetrics.totalRequested > 0 ? Math.round((cacheMetrics.cacheHits / cacheMetrics.totalRequested) * 100) : 0,
            message: `Batch ${batchNumber}/${totalBatches} (${cacheMetrics.cacheHits} cached, ${cacheMetrics.newApiCalls} new)`
          });
        }
        
        // Add delay between batches (1-2 seconds like user's system)
        if (i + BATCH_SIZE < ungeocodedStops.length) {
          console.log(`⏱️ Waiting 1.5 seconds before next batch...`);
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
      } catch (error) {
        console.error(`❌ Failed to geocode batch ${batchNumber}:`, error);
        // Continue with next batch
      }
    }
    
    console.log(`🌍 Geocoding complete: ${totalGeocoded}/${ungeocodedStops.length} stops successfully geocoded`);
    return totalGeocoded;
  }

  // **LEGACY: COMPLETE WAYPOINT COMPUTATION PIPELINE** (processes entire dataset)
  async computeWaypointAnalytics(userId: string, datasetId: string): Promise<{ stopsCreated: number; segmentsCreated: number }> {
    console.log(`🚀 Starting complete waypoint analytics pipeline for user ${userId}, dataset ${datasetId}`);
    
    // Step 1: Detect travel stops
    const stopsCreated = await this.computeTravelStopsFromPoints(userId, datasetId);
    
    // Step 2: Create travel segments between stops
    const segmentsCreated = await this.computeTravelSegmentsFromStops(userId, datasetId);
    
    console.log(`✅ Waypoint analytics complete: ${stopsCreated} stops, ${segmentsCreated} segments`);
    
    return { stopsCreated, segmentsCreated };
  }

  // **ANALYTICS FROM WAYPOINTS** (replaces centroid-based city jumps)
  async getWaypointCityJumpsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<Array<{
    fromCity: string;
    fromState?: string;
    fromCountry: string;
    fromCoords: { lat: number; lng: number };
    toCity: string;
    toState?: string;
    toCountry: string;
    toCoords: { lat: number; lng: number };
    date: string;
    mode: string;
    distance: number;
  }>> {
    // Get travel segments within date range with stop information
    const result = await db
      .select({
        segment: travelSegments,
        fromStop: travelStops,
        toStop: {
          id: sql`to_stop.id`,
          city: sql`to_stop.city`,
          state: sql`to_stop.state`,
          country: sql`to_stop.country`,
          lat: sql`to_stop.lat`,
          lng: sql`to_stop.lng`,
        }
      })
      .from(travelSegments)
      .innerJoin(travelStops, eq(travelSegments.fromStopId, travelStops.id))
      .innerJoin(sql`travel_stops as to_stop`, sql`${travelSegments.toStopId} = to_stop.id`)
      .where(and(
        eq(travelSegments.userId, userId),
        gte(travelSegments.start, startDate),
        lte(travelSegments.end, endDate),
        // Only include segments where both stops have city information
        sql`${travelStops.city} IS NOT NULL`,
        sql`to_stop.city IS NOT NULL`
      ))
      .orderBy(travelSegments.start);

    return result.map(row => ({
      fromCity: row.fromStop.city || 'Unknown',
      fromState: row.fromStop.state || undefined,
      fromCountry: row.fromStop.country || 'Unknown',
      fromCoords: { lat: row.fromStop.lat, lng: row.fromStop.lng },
      toCity: row.toStop.city as string || 'Unknown',
      toState: (row.toStop.state as string) || undefined,
      toCountry: row.toStop.country as string || 'Unknown',
      toCoords: { lat: row.toStop.lat as number, lng: row.toStop.lng as number },
      date: row.segment.start.toISOString().split('T')[0],
      mode: 'travel', // Could be enhanced to detect transportation mode
      distance: row.segment.distanceMiles,
    }));
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
  
  // Raw file storage stubs for memory storage
  async storeRawFile(datasetId: string, userId: string, rawContent: string): Promise<void> {
    throw new Error("Use DatabaseStorage for persistent raw file storage");
  }
  
  async getRawFile(datasetId: string, userId: string): Promise<string | undefined> {
    return undefined;
  }
  

  async insertLocationPoints(points: InsertLocationPoint[]): Promise<LocationPoint[]> {
    return [];
  }

  async getUserLocationPoints(userId: string, datasetId?: string): Promise<LocationPoint[]> {
    return [];
  }

  async getUserLocationPointsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<LocationPoint[]> {
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

  async computeDailyCentroidsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<number> {
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

  // Waypoint-based analytics operations (stub implementations)
  async insertTravelStops(stops: InsertTravelStop[]): Promise<TravelStop[]> {
    return [];
  }

  async getUserTravelStops(userId: string, datasetId?: string): Promise<TravelStop[]> {
    return [];
  }

  async getUserTravelStopsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<TravelStop[]> {
    return [];
  }

  async updateTravelStopGeocoding(
    id: string,
    address: string,
    city?: string,
    state?: string,
    country?: string
  ): Promise<void> {}

  async insertTravelSegments(segments: InsertTravelSegment[]): Promise<TravelSegment[]> {
    return [];
  }

  async getUserTravelSegments(userId: string, datasetId?: string): Promise<TravelSegment[]> {
    return [];
  }

  async getUserTravelSegmentsByDateRange(userId: string, startDate: Date, endDate: Date, datasetId?: string): Promise<TravelSegment[]> {
    return [];
  }

  async computeTravelStopsFromPoints(userId: string, datasetId: string, minDwellMinutes?: number, maxDistanceMeters?: number): Promise<number> {
    return 0;
  }

  async computeTravelSegmentsFromStops(userId: string, datasetId: string): Promise<number> {
    return 0;
  }

  async computeWaypointAnalytics(userId: string, datasetId: string): Promise<{ stopsCreated: number; segmentsCreated: number }> {
    return { stopsCreated: 0, segmentsCreated: 0 };
  }

  async getWaypointCityJumpsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<Array<{
    fromCity: string;
    fromState?: string;
    fromCountry: string;
    fromCoords: { lat: number; lng: number };
    toCity: string;
    toState?: string;
    toCountry: string;
    toCoords: { lat: number; lng: number };
    date: string;
    mode: string;
    distance: number;
  }>> {
    return [];
  }
}

// Use database storage for user authentication and persistent data
export const storage = new DatabaseStorage();