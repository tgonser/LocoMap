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
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

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
    return await db.insert(travelStops).values(stops).returning();
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
    return await db.insert(travelSegments).values(segments).returning();
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

  // **STOP DETECTION ALGORITHM**
  // Identifies places where user stayed ≥minDwellMinutes within maxDistanceMeters radius
  async computeTravelStopsFromPoints(
    userId: string,
    datasetId: string,
    minDwellMinutes: number = 15,
    maxDistanceMeters: number = 150
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

      // Check if point is within distance threshold of cluster centroid
      const clusterCentroid = this.calculateClusterCentroid(currentCluster);
      const distanceToCluster = this.calculateDistanceMeters(
        point.lat, point.lng,
        clusterCentroid.lat, clusterCentroid.lng
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

      // Calculate distance between stops
      const distanceMiles = this.calculateDistanceMiles(
        fromStop.lat, fromStop.lng,
        toStop.lat, toStop.lng
      );

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

  // **COMPLETE WAYPOINT COMPUTATION PIPELINE**
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