// Routes with Replit Auth integration and user-specific location data
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { parseGoogleLocationHistory, validateGoogleLocationHistory } from "./googleLocationParser";
import { batchReverseGeocode, deduplicateCoordinates } from "./geocodingService";
import { z } from "zod";
import OpenAI from "openai";

// OpenAI client setup for interesting places feature
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// OpenAI curation removed for performance - analytics now return in under 2 seconds

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit for large Google location history files
});

// Type assertion helper for authenticated requests
function getAuthenticatedUser(req: Request) {
  const user = req.user as any;
  return {
    claims: {
      sub: user.claims.sub,
      email: user.claims.email,
      first_name: user.claims.first_name,
      last_name: user.claims.last_name,
    }
  };
}

// Background geocoding function for user-specific location data (restored analytics pipeline)
async function geocodeUserLocationPoints(userId: string, datasetId: string) {
  try {
    
    const locations = await storage.getUserLocationPoints(userId, datasetId);
    
    // Filter locations that don't have city information yet
    const locationsToGeocode = locations.filter(loc => !loc.city);
    
    if (locationsToGeocode.length === 0) {
      return;
    }
    
    
    // Deduplicate coordinates to reduce API calls
    const coordinates = locationsToGeocode.map(loc => ({ lat: loc.lat, lng: loc.lng }));
    const uniqueCoords = deduplicateCoordinates(coordinates);
    
    
    // Batch geocode the unique coordinates
    const geocodeResults = await batchReverseGeocode(
      uniqueCoords.map(coord => ({ lat: coord.lat, lng: coord.lng }))
    );
    
    // Update locations with geocoded information
    for (let i = 0; i < uniqueCoords.length; i++) {
      const uniqueCoord = uniqueCoords[i];
      const geocodeResult = geocodeResults[i];
      
      // Update all locations that match this coordinate
      for (const index of uniqueCoord.indices) {
        const location = locationsToGeocode[index];
        await storage.updateLocationGeocoding(
          location.id,
          geocodeResult.address || '',
          geocodeResult.city || undefined,
          geocodeResult.state || undefined,
          geocodeResult.country || undefined
        );
      }
    }
    
  } catch (error) {
    console.error(`Geocoding process failed for user ${userId}:`, error);
  }
}

// Background geocoding function for daily centroids (analytics pipeline) - Enhanced with progress tracking
async function geocodeDailyCentroids(userId: string) {
  try {
    let totalProcessed = 0;
    let batchNumber = 1;
    const BATCH_SIZE = 25; // Reduced batch size for better performance and user experience
    const startTime = Date.now();
    
    while (true) {
      // Get remaining ungeocoded centroids count for progress tracking
      const remainingCount = await storage.getUngeocodedCentroidsCount(userId);
      
      if (remainingCount === 0) {
        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`✅ Geocoding queue drained for user ${userId}. Total processed: ${totalProcessed} in ${totalTime.toFixed(1)}s`);
        break;
      }
      
      // Get next batch of ungeocoded centroids
      const ungeocoded = await storage.getUngeocodedDailyCentroids(userId, BATCH_SIZE);
      
      if (ungeocoded.length === 0) {
        console.log(`No ungeocoded centroids found, but count shows ${remainingCount}. Breaking loop.`);
        break;
      }

      // Calculate time estimates
      const elapsedTime = (Date.now() - startTime) / 1000;
      const averageTimePerBatch = totalProcessed > 0 ? elapsedTime / (batchNumber - 1) : 0;
      const remainingBatches = Math.ceil(remainingCount / BATCH_SIZE);
      const estimatedTimeRemaining = averageTimePerBatch * remainingBatches;
      
      const progressPercent = totalProcessed > 0 ? ((totalProcessed / (totalProcessed + remainingCount)) * 100).toFixed(1) : '0.0';
      
      console.log(`🔄 Batch ${batchNumber}: Geocoding ${ungeocoded.length} centroids for user ${userId}`);
      console.log(`   📊 Progress: ${totalProcessed} completed, ${remainingCount} remaining (${progressPercent}%)`);
      if (averageTimePerBatch > 0) {
        console.log(`   ⏱️  Estimated time remaining: ${Math.ceil(estimatedTimeRemaining)}s (avg: ${averageTimePerBatch.toFixed(1)}s/batch)`);
      }
      
      const batchStartTime = Date.now();
      try {
        // Batch geocode the centroids
        const coordinates = ungeocoded.map(centroid => ({ lat: centroid.lat, lng: centroid.lng }));
        const geocodeResults = await batchReverseGeocode(coordinates);
        
        // Update daily centroids with geocoding results
        for (let i = 0; i < ungeocoded.length; i++) {
          const centroid = ungeocoded[i];
          const geocodeResult = geocodeResults[i];
          
          await storage.updateDailyCentroidGeocoding(
            centroid.id,
            geocodeResult.address || '',
            geocodeResult.city || undefined,
            geocodeResult.state || undefined,
            geocodeResult.country || undefined
          );
        }
        
        totalProcessed += ungeocoded.length;
        const batchTime = (Date.now() - batchStartTime) / 1000;
        console.log(`✅ Batch ${batchNumber} completed: ${ungeocoded.length} centroids geocoded in ${batchTime.toFixed(1)}s`);
        
      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed for user ${userId}:`, batchError);
        // Continue with next batch even if one fails
      }
      
      batchNumber++;
      
      // Small delay between batches to be respectful to geocoding service
      if (remainingCount > BATCH_SIZE) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
  } catch (error) {
    console.error(`💥 Daily centroid geocoding pipeline failed for user ${userId}:`, error);
  }
}

// Enhanced geocoding function with date range filtering and better progress tracking
async function geocodeDailyCentroidsByDateRange(
  userId: string, 
  startDate: Date, 
  endDate: Date,
  progressCallback?: (progress: { processed: number; total: number; percent: number; estimatedTimeRemaining?: number }) => void
) {
  try {
    let totalProcessed = 0;
    let batchNumber = 1;
    const BATCH_SIZE = 25; // Consistent with global batch size
    const startTime = Date.now();
    
    // Get total count for the date range
    const totalCount = await storage.getUngeocodedCentroidsCountByDateRange(userId, startDate, endDate);
    
    if (totalCount === 0) {
      console.log(`✅ No ungeocoded centroids found for user ${userId} in date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      return { processed: 0, total: 0, timeElapsed: 0 };
    }
    
    console.log(`🚀 Starting date-range geocoding for user ${userId}: ${totalCount} centroids from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    
    while (true) {
      // Get next batch of ungeocoded centroids within date range
      const ungeocoded = await storage.getUngeocodedDailyCentroidsByDateRange(userId, startDate, endDate, BATCH_SIZE);
      
      if (ungeocoded.length === 0) {
        break;
      }

      // Calculate progress and time estimates
      const elapsedTime = (Date.now() - startTime) / 1000;
      const progressPercent = (totalProcessed / totalCount) * 100;
      const averageTimePerItem = totalProcessed > 0 ? elapsedTime / totalProcessed : 0;
      const remainingItems = totalCount - totalProcessed;
      const estimatedTimeRemaining = averageTimePerItem * remainingItems;
      
      console.log(`🔄 Batch ${batchNumber}: Geocoding ${ungeocoded.length} centroids (${totalProcessed}/${totalCount}, ${progressPercent.toFixed(1)}%)`);
      if (averageTimePerItem > 0) {
        console.log(`   ⏱️  Estimated time remaining: ${Math.ceil(estimatedTimeRemaining)}s`);
      }
      
      // Call progress callback if provided
      if (progressCallback) {
        progressCallback({
          processed: totalProcessed,
          total: totalCount,
          percent: progressPercent,
          estimatedTimeRemaining: estimatedTimeRemaining
        });
      }
      
      const batchStartTime = Date.now();
      try {
        // Batch geocode the centroids
        const coordinates = ungeocoded.map(centroid => ({ lat: centroid.lat, lng: centroid.lng }));
        const geocodeResults = await batchReverseGeocode(coordinates);
        
        // Update daily centroids with geocoding results
        for (let i = 0; i < ungeocoded.length; i++) {
          const centroid = ungeocoded[i];
          const geocodeResult = geocodeResults[i];
          
          await storage.updateDailyCentroidGeocoding(
            centroid.id,
            geocodeResult.address || '',
            geocodeResult.city || undefined,
            geocodeResult.state || undefined,
            geocodeResult.country || undefined
          );
        }
        
        totalProcessed += ungeocoded.length;
        const batchTime = (Date.now() - batchStartTime) / 1000;
        console.log(`✅ Batch ${batchNumber} completed: ${ungeocoded.length} centroids geocoded in ${batchTime.toFixed(1)}s`);
        
      } catch (batchError) {
        console.error(`❌ Batch ${batchNumber} failed for user ${userId}:`, batchError);
        // Continue with next batch even if one fails
      }
      
      batchNumber++;
      
      // Small delay between batches to be respectful to geocoding service
      if (ungeocoded.length === BATCH_SIZE) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`✅ Date-range geocoding completed for user ${userId}: ${totalProcessed}/${totalCount} processed in ${totalTime.toFixed(1)}s`);
    
    // Final progress callback
    if (progressCallback) {
      progressCallback({
        processed: totalProcessed,
        total: totalCount,
        percent: 100,
        estimatedTimeRemaining: 0
      });
    }
    
    return {
      processed: totalProcessed,
      total: totalCount,
      timeElapsed: totalTime
    };
    
  } catch (error) {
    console.error(`💥 Date-range geocoding pipeline failed for user ${userId}:`, error);
    throw error;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication - MANDATORY for Replit Auth
  await setupAuth(app);

  // Auth routes - from blueprint javascript_log_in_with_replit
  app.get('/api/auth/user', isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const user = await storage.getUser(claims.sub);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Protected route: Upload and parse Google location history (user-specific)
  app.post("/api/upload-location-history", isAuthenticated, upload.single("file"), async (req: Request & { file?: Express.Multer.File }, res) => {
    const { claims } = getAuthenticatedUser(req);
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = claims.sub;
      
      let fileContent: string;
      try {
        fileContent = req.file.buffer.toString("utf8");
      } catch (stringError) {
        console.error("Error converting file to string:", stringError);
        return res.status(400).json({ error: "File conversion failed" });
      }
      
      let jsonData;
      
      
      try {
        jsonData = JSON.parse(fileContent);
      } catch (parseError: any) {
        console.error("JSON parse error:", parseError);
        return res.status(400).json({ 
          error: `JSON parsing failed: ${parseError?.message || 'Unknown error'}. File size: ${Math.round(req.file.buffer.length / (1024 * 1024))}MB` 
        });
      }

      const isValid = validateGoogleLocationHistory(jsonData);

      if (!isValid) {
        const errorMsg = Array.isArray(jsonData) 
          ? `Invalid Google location history format. Array with ${jsonData.length} elements detected, but validation failed.`
          : `Invalid Google location history format. Found keys: ${Object.keys(jsonData).join(', ')}. Expected 'timelineObjects', 'locations', or mobile array format.`;
        
        return res.status(400).json({ error: errorMsg });
      }

      // Parse the location data
      const parsedLocations = parseGoogleLocationHistory(jsonData);
      
      if (parsedLocations.length === 0) {
        return res.status(400).json({ 
          error: "No location data found in the file" 
        });
      }

      // Create dataset record for this upload
      const dataset = await storage.createLocationDataset({
        userId,
        filename: req.file.originalname || 'location-history.json',
        fileSize: req.file.buffer.length,
        totalPoints: parsedLocations.length,
        deduplicatedPoints: 0, // Will be updated after processing
      });

      // Clear existing user data before importing new (optional - user can have multiple datasets)
      // await storage.clearUserLocationData(userId);

      // Convert to database format with user association
      const locationPoints = parsedLocations.map(location => ({
        userId,
        datasetId: dataset.id,
        lat: location.lat,
        lng: location.lng,
        timestamp: location.timestamp,
        accuracy: location.accuracy || null,
        activity: location.activity || null,
        address: null,
        city: null,
        state: null,
        country: null,
      }));

      // Store in database
      const savedPoints = await storage.insertLocationPoints(locationPoints);

      // Update dataset with actual saved count
      await storage.updateDatasetProcessed(dataset.id, savedPoints.length);

      res.json({
        success: true,
        message: `Successfully imported ${savedPoints.length} location points`,
        pointCount: savedPoints.length,
        datasetId: dataset.id,
        dateRange: {
          start: new Date(Math.min(...parsedLocations.map(l => l.timestamp.getTime()))),
          end: new Date(Math.max(...parsedLocations.map(l => l.timestamp.getTime())))
        }
      });

      // NOTE: All geocoding and analytics processing is now handled by the POST /api/analytics/run endpoint
      // Upload only stores raw data - no processing

      console.log(`Successfully imported ${savedPoints.length} points for user ${userId}`);

    } catch (error) {
      console.error("Error processing location history:", error);
      res.status(500).json({ error: "Failed to process location history file" });
    }
  });

  // Protected route: Get user's location points with optional date range filtering
  app.get("/api/locations", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const datasetId = req.query.datasetId as string;
      const start = req.query.start as string;
      const end = req.query.end as string;

      let locations;
      
      // If both start and end dates are provided, use date range filtering
      if (start && end) {
        try {
          // Parse dates with consistent UTC boundaries to avoid timezone issues
          const startDate = new Date(`${start}T00:00:00.000Z`);
          const endDate = new Date(`${end}T23:59:59.999Z`);
          
          // Validate dates
          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD format." });
          }
          
          // Validate date range
          if (startDate > endDate) {
            return res.status(400).json({ error: "Start date must be less than or equal to end date." });
          }
          
          locations = await storage.getUserLocationPointsByDateRange(userId, startDate, endDate, datasetId);
          console.log(`Fetched ${locations.length} location points for user ${userId} between ${start} and ${end}`);
        } catch (dateError) {
          console.error("Error parsing dates:", dateError);
          return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD format." });
        }
      } else {
        // Backwards compatibility: no date filtering, return all data
        locations = await storage.getUserLocationPoints(userId, datasetId);
        console.log(`Fetched ${locations.length} location points for user ${userId} (no date filter)`);
      }
      
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // Protected route: Get user's location datasets
  app.get("/api/datasets", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const datasets = await storage.getUserLocationDatasets(userId);
      res.json(datasets);
    } catch (error) {
      console.error("Error fetching datasets:", error);
      res.status(500).json({ error: "Failed to fetch datasets" });
    }
  });

  // Protected route: Get user's unique locations (for analytics)
  app.get("/api/locations/unique", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const locations = await storage.getUserUniqueLocations(userId);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching unique locations:", error);
      res.status(500).json({ error: "Failed to fetch unique locations" });
    }
  });

  // Protected route: Get user's location statistics by date range (analytics pipeline)
  app.get("/api/locations/stats", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      
      // Parse start and end date parameters
      const startDateParam = req.query.start as string;
      const endDateParam = req.query.end as string;
      
      if (!startDateParam || !endDateParam) {
        return res.status(400).json({ 
          error: "Missing required parameters: start and end date (YYYY-MM-DD format)" 
        });
      }
      
      let startDate: Date;
      let endDate: Date;
      
      try {
        startDate = new Date(startDateParam);
        endDate = new Date(endDateParam);
        
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error("Invalid date format");
        }
        
        if (startDate > endDate) {
          throw new Error("Start date must be before end date");
        }
      } catch (dateError) {
        return res.status(400).json({ 
          error: "Invalid date format. Use YYYY-MM-DD format for start and end parameters" 
        });
      }
      
      // Use the analytics pipeline to get date-range statistics
      const stats = await storage.getLocationStatsByDateRange(userId, startDate, endDate);
      
      // Transform the response to match frontend API contract
      // Backend returns: {country/state, days, percent}
      // Frontend expects: {name, days, percentage}
      const transformedStats = {
        totalDays: stats.totalDays,
        geocodedDays: stats.geocodedDays,
        geocodingCoverage: stats.geocodingCoverage,
        dateRange: {
          start: stats.dateRange.start.toISOString().split('T')[0], // Convert Date to YYYY-MM-DD string
          end: stats.dateRange.end.toISOString().split('T')[0]      // Convert Date to YYYY-MM-DD string
        },
        countries: stats.countries.map(country => ({
          name: country.country,
          days: country.days,
          percentage: country.percent
        })),
        usStates: stats.usStates.map(state => ({
          name: state.state,
          days: state.days,
          percentage: state.percent
        }))
      };
      
      res.json(transformedStats);
    } catch (error) {
      console.error("Error fetching location stats:", error);
      res.status(500).json({ error: "Failed to fetch location statistics" });
    }
  });

  // Protected route: Clear user's location data
  app.delete("/api/locations", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      await storage.clearUserLocationData(userId);
      res.json({ success: true, message: "All user location data cleared" });
    } catch (error) {
      console.error("Error clearing locations:", error);
      res.status(500).json({ error: "Failed to clear location data" });
    }
  });

  // FIXED: Backfill daily centroids - NO GEOCODING (violates user requirements)
  app.post("/api/analytics/backfill-centroids", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      
      console.log(`🔄 Starting centroid backfill for user ${userId}`);
      const centroidsCreated = await storage.computeDailyCentroidsForAllDatasets(userId);
      
      // NOTE: No geocoding triggered - user must use analytics/run with date range
      
      res.json({ 
        success: true, 
        message: `Backfilled ${centroidsCreated} daily centroids. Use analytics/run with date range for geocoding.`,
        centroidsCreated 
      });
    } catch (error) {
      console.error("Error backfilling centroids:", error);
      res.status(500).json({ error: "Failed to backfill centroids" });
    }
  });

  // FIXED: Manual geocoding queue status - NO PROCESSING (violates user requirements)
  app.get("/api/analytics/geocoding-queue-status", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      
      const ungeocodedCount = await storage.getUngeocodedCentroidsCount(userId);
      
      res.json({ 
        success: true, 
        message: "Use analytics/run with date range to process geocoding",
        ungeocodedCount 
      });
    } catch (error) {
      console.error("Error checking geocoding queue:", error);
      res.status(500).json({ error: "Failed to check geocoding queue" });
    }
  });

  // CRITICAL FIX: Debug geocoding coverage for specific year
  app.get("/api/analytics/debug/:year", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const year = parseInt(req.params.year);
      
      if (!year || year < 2000 || year > new Date().getFullYear()) {
        return res.status(400).json({ 
          error: "Invalid year parameter. Use format: /api/analytics/debug/2024" 
        });
      }
      
      const coverage = await storage.debugGeocodingCoverage(userId, year);
      
      res.json({
        year,
        expectedDays: coverage.expectedDays,
        actualGeocodedDays: coverage.actualGeocodedDays,
        coverage: coverage.coverage,
        ungeocodedCount: coverage.ungeocodedCount,
        message: `Coverage analysis for ${year}: ${coverage.actualGeocodedDays}/${coverage.expectedDays} days geocoded (${coverage.coverage}%). ${coverage.ungeocodedCount} centroids in geocoding queue.`
      });
    } catch (error) {
      console.error("Error debugging geocoding coverage:", error);
      res.status(500).json({ error: "Failed to debug geocoding coverage" });
    }
  });

  // CRITICAL FIX: Get geocoding queue status
  app.get("/api/analytics/geocoding-status", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      
      const ungeocodedCount = await storage.getUngeocodedCentroidsCount(userId);
      const datasets = await storage.getUserLocationDatasets(userId);
      
      res.json({
        ungeocodedCount,
        datasetsCount: datasets.length,
        queueEmpty: ungeocodedCount === 0,
        message: ungeocodedCount === 0 
          ? "Geocoding queue is empty ✅" 
          : `${ungeocodedCount} centroids waiting for geocoding 🔄`
      });
    } catch (error) {
      console.error("Error getting geocoding status:", error);
      res.status(500).json({ error: "Failed to get geocoding status" });
    }
  });

  // Get ungeocoded summary grouped by month/year for quick testing
  app.get("/api/analytics/ungeocoded-summary", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      
      const summary = await storage.getUngeocodedSummary(userId);
      
      res.json({
        success: true,
        ranges: summary,
        totalRanges: summary.length,
        message: summary.length === 0 
          ? "All data is geocoded ✅" 
          : `Found ${summary.length} date ranges with ungeocoded data`
      });
    } catch (error) {
      console.error("Error getting ungeocoded summary:", error);
      res.status(500).json({ error: "Failed to get ungeocoded summary" });
    }
  });

  // NEW: Date-range specific geocoding endpoint for better user experience
  app.post("/api/analytics/geocode-date-range", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      
      const { startDate, endDate } = req.body;
      
      // Validate date parameters
      if (!startDate || !endDate) {
        return res.status(400).json({ 
          error: "Both startDate and endDate are required (format: YYYY-MM-DD or ISO string)" 
        });
      }
      
      let start: Date, end: Date;
      try {
        start = new Date(startDate);
        end = new Date(endDate);
        
        // Ensure valid dates
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          throw new Error("Invalid date format");
        }
        
        // Ensure start is before end
        if (start > end) {
          return res.status(400).json({ 
            error: "startDate must be before or equal to endDate" 
          });
        }
        
        // Prevent excessively large date ranges (> 2 years)
        const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > 730) {
          return res.status(400).json({ 
            error: "Date range too large. Maximum allowed range is 2 years (730 days)" 
          });
        }
        
      } catch (dateError) {
        return res.status(400).json({ 
          error: "Invalid date format. Use YYYY-MM-DD or ISO 8601 format" 
        });
      }
      
      // Get count for this date range
      const ungeocodedCount = await storage.getUngeocodedCentroidsCountByDateRange(userId, start, end);
      
      if (ungeocodedCount === 0) {
        return res.json({ 
          success: true, 
          message: `No ungeocoded centroids found for date range ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
          processed: 0,
          total: 0,
          timeElapsed: 0
        });
      }
      
      // Limit processing to reasonable batch sizes for API responses
      if (ungeocodedCount > 500) {
        return res.status(400).json({
          error: `Date range contains ${ungeocodedCount} ungeocoded centroids. Please use a smaller date range (max 500 centroids per request).`,
          suggestion: "Try processing one month at a time for large datasets."
        });
      }
      
      // Start geocoding process and track progress
      let progressData: any = {};
      
      try {
        const result = await geocodeDailyCentroidsByDateRange(
          userId, 
          start, 
          end,
          (progress) => {
            progressData = progress;
            // In a real-world scenario, you might emit progress via WebSocket
            console.log(`📊 Progress update: ${progress.processed}/${progress.total} (${progress.percent.toFixed(1)}%)`);
          }
        );
        
        res.json({ 
          success: true, 
          message: `Successfully processed ${result.processed}/${result.total} centroids for date range ${start.toISOString().split('T')[0]} to ${end.toISOString().split('T')[0]}`,
          processed: result.processed,
          total: result.total,
          timeElapsed: result.timeElapsed,
          dateRange: {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0]
          }
        });
        
      } catch (geocodingError: any) {
        console.error(`Date-range geocoding failed for user ${userId}:`, geocodingError);
        res.status(500).json({ 
          error: "Geocoding process failed", 
          details: geocodingError?.message || 'Unknown error',
          partialProgress: progressData
        });
      }
      
    } catch (error) {
      console.error("Error in date-range geocoding endpoint:", error);
      res.status(500).json({ error: "Failed to process date-range geocoding request" });
    }
  });

  // Orchestrated analytics endpoint: Automates the entire centroids → geocoding → analytics pipeline
  app.post('/api/analytics/run', isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;

      // Input validation with zod
      const dateRangeSchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format")
      });

      let validatedInput;
      try {
        validatedInput = dateRangeSchema.parse(req.body);
      } catch (validationError) {
        console.log(`❌ Date validation failed for user ${userId}:`, validationError);
        return res.status(400).json({ 
          error: "Invalid date format. Both startDate and endDate must be in YYYY-MM-DD format",
          details: validationError instanceof z.ZodError ? validationError.errors : undefined
        });
      }

      const { startDate: startDateStr, endDate: endDateStr } = validatedInput;
      
      // Convert to proper Date objects
      const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDate = new Date(`${endDateStr}T23:59:59.999Z`);

      console.log(`🚀 Starting orchestrated analytics pipeline for user ${userId}:`, {
        dateRange: `${startDateStr} to ${endDateStr}`,
        step: "1/4 - Input validation complete"
      });

      if (startDate >= endDate) {
        return res.status(400).json({ 
          error: "startDate must be before endDate" 
        });
      }

      // Step 1: Ensure centroids exist for the requested date range ONLY (OPTIMIZED)
      console.log(`🚀 Step 2/4 - Computing daily centroids for date range ONLY (optimized)`);
      let centroidsCreated = 0;
      
      try {
        // Check if we need to create centroids for any datasets
        const datasets = await storage.getUserLocationDatasets(userId);
        
        if (datasets.length === 0) {
          return res.status(400).json({
            error: "No location datasets found. Please upload location data first."
          });
        }

        // OPTIMIZED: Create centroids ONLY for the requested date range instead of all datasets
        const startTime = Date.now();
        centroidsCreated = await storage.computeDailyCentroidsByDateRange(userId, startDate, endDate);
        const computeTime = (Date.now() - startTime) / 1000;
        console.log(`✅ OPTIMIZED: Computed ${centroidsCreated} centroids for date range in ${computeTime.toFixed(1)}s (instead of processing all ${datasets.length} datasets)`);
      } catch (error) {
        console.error(`❌ Failed to compute centroids for date range for user ${userId}:`, error);
        return res.status(500).json({
          error: "Failed to compute daily centroids for date range",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }

      // Step 2: ASYNC Geocoding - Return analytics immediately, geocode in background
      console.log(`🚀 Step 3/4 - ASYNC geocoding: checking for missing locations (non-blocking)`);
      
      let ungeocodedCount = 0;
      let geocodingStatus = 'complete';
      
      try {
        ungeocodedCount = await storage.getUngeocodedCentroidsCountByDateRange(userId, startDate, endDate);
        
        if (ungeocodedCount > 0) {
          console.log(`🌍 Found ${ungeocodedCount} ungeocoded centroids in date range - starting BACKGROUND geocoding`);
          geocodingStatus = 'in_progress';
          
          // ASYNC: Start geocoding in background, don't wait for completion
          geocodeDailyCentroidsByDateRange(userId, startDate, endDate)
            .then(() => {
              console.log(`✅ BACKGROUND: Geocoding completed for user ${userId} date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
            })
            .catch((error) => {
              console.error(`❌ BACKGROUND: Geocoding failed for user ${userId}:`, error);
            });
          
          console.log(`🚀 ASYNC: Analytics proceeding with currently available geocoded data (${ungeocodedCount} locations will be geocoded in background)`);
        } else {
          console.log(`✅ No geocoding needed - all centroids in date range already geocoded`);
        }
      } catch (error) {
        console.error(`❌ Failed to check geocoding status for user ${userId}:`, error);
        // Don't fail the entire request - proceed with analytics using available data
        console.log(`⚠️ Proceeding with analytics despite geocoding check error`);
      }

      // Step 3: Generate analytics using the existing geocoded-places logic
      console.log(`📈 Step 4/4 - Generating analytics with curated places`);
      
      try {
        // Get geocoded daily centroids within the date range
        const geocodedCentroids = await storage.getGeocodedDailyCentroidsByDateRange(userId, startDate, endDate);
        
        // Calculate expected total days in the date range
        const totalDaysInRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        
        console.log(`📊 Analytics results for user ${userId}:`, {
          dateRangeRequested: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
          totalDaysInRange,
          geocodedCentroidsFound: geocodedCentroids.length,
          geocodingCoverage: `${((geocodedCentroids.length / totalDaysInRange) * 100).toFixed(1)}%`
        });

        if (geocodedCentroids.length === 0) {
          console.log(`⚠️  No geocoded centroids found for user ${userId} in date range`);
          return res.json({
            success: true,
            pipeline: {
              centroidsCreated,
              geocoded: 0,
              analyticsGenerated: true
            },
            analytics: {
              totalDays: totalDaysInRange,
              geocodedDays: 0,
              geocodingCoverage: 0,
              geocodingInProgress: ungeocodedCount > 0, // Clear boolean flag for frontend
              ungeocodedCount: ungeocodedCount, // Count of locations being processed
              countries: {},
              states: {},
              cities: {},
              curatedPlaces: [],
              dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0]
              },
              note: ungeocodedCount > 0 ? `${ungeocodedCount} locations are being geocoded in the background. Re-run analytics in a few minutes for complete data.` : undefined
            }
          });
        }

        // Group locations by city/state/country and calculate visit statistics
        const locationStats = {
          countries: new Map<string, number>(),
          states: new Map<string, number>(),
          cities: new Map<string, number>(),
          locations: [] as any[]
        };

        geocodedCentroids.forEach(centroid => {
          if (centroid.country) {
            locationStats.countries.set(centroid.country, (locationStats.countries.get(centroid.country) || 0) + 1);
          }
          
          if (centroid.state && centroid.country === 'United States') {
            locationStats.states.set(centroid.state, (locationStats.states.get(centroid.state) || 0) + 1);
          }
          
          if (centroid.city) {
            const cityKey = centroid.state ? `${centroid.city}, ${centroid.state}` : `${centroid.city}, ${centroid.country}`;
            locationStats.cities.set(cityKey, (locationStats.cities.get(cityKey) || 0) + 1);
          }

          // Location data collection removed since OpenAI curation is disabled
        });

        // Convert Maps to Objects for frontend compatibility
        const countriesObject = Object.fromEntries(locationStats.countries);
        const statesObject = Object.fromEntries(locationStats.states);  
        const citiesObject = Object.fromEntries(locationStats.cities);

        // OpenAI curation removed for performance - analytics now return in under 2 seconds
        const curatedPlaces: any[] = []; // Empty array to maintain API compatibility

        const analyticsResult = {
          success: true,
          pipeline: {
            centroidsCreated,
            geocoded: ungeocodedCount || 0,
            geocodingStatus, // 'complete' or 'in_progress'
            analyticsGenerated: true,
            optimized: true, // Flag indicating this used the optimized date-range pipeline
            processingTimeOptimization: centroidsCreated < 100 ? 'significant' : 'moderate'
          },
          analytics: {
            totalDays: totalDaysInRange,
            geocodedDays: geocodedCentroids.length,
            geocodingCoverage: Number(((geocodedCentroids.length / totalDaysInRange) * 100).toFixed(1)),
            geocodingInProgress: ungeocodedCount > 0, // Clear boolean flag for frontend
            ungeocodedCount: ungeocodedCount, // Count of locations being processed
            countries: countriesObject,
            states: statesObject,
            cities: citiesObject,
            curatedPlaces,
            dateRange: {
              start: startDate.toISOString().split('T')[0],
              end: endDate.toISOString().split('T')[0]
            },
            note: ungeocodedCount > 0 ? `${ungeocodedCount} locations are being geocoded in the background. Re-run analytics in a few minutes for complete data.` : undefined
          }
        };

        console.log(`🎉 Orchestrated analytics pipeline completed successfully for user ${userId}`);
        res.json(analyticsResult);

      } catch (error) {
        console.error(`❌ Analytics generation failed for user ${userId}:`, error);
        return res.status(500).json({
          error: "Failed to generate analytics",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }

    } catch (error) {
      console.error(`💥 Orchestrated analytics pipeline failed:`, error);
      res.status(500).json({ 
        error: "Failed to run analytics pipeline",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Analytics endpoint: Geocoded places analysis with OpenAI curation
  app.post('/api/analytics/geocoded-places', isAuthenticated, async (req, res) => {
    try {
      const user = getAuthenticatedUser(req);
      const userId = user.claims.sub;
      
      // Add proper date validation using zod for YYYY-MM-DD format
      const dateRangeSchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format")
      });
      
      let validatedInput;
      try {
        validatedInput = dateRangeSchema.parse(req.body);
      } catch (validationError) {
        console.log(`❌ Date validation failed for user ${userId}:`, validationError);
        return res.status(400).json({ 
          error: "Invalid date format. Both startDate and endDate must be in YYYY-MM-DD format",
          details: validationError instanceof z.ZodError ? validationError.errors : undefined
        });
      }
      
      const { startDate: startDateStr, endDate: endDateStr } = validatedInput;
      
      // Fix UTC timezone conversion with proper format
      const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDate = new Date(`${endDateStr}T23:59:59.999Z`);
      
      // Add debug logging to verify correct date processing
      console.log(`🔍 Analytics date range processing for user ${userId}:`, {
        inputStartDate: startDateStr,
        inputEndDate: endDateStr,
        parsedStartDate: startDate.toISOString(),
        parsedEndDate: endDate.toISOString(),
        startDateFormatted: startDate.toISOString().split('T')[0],
        endDateFormatted: endDate.toISOString().split('T')[0],
        expectedDays: Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000))
      });

      if (startDate >= endDate) {
        return res.status(400).json({ 
          error: "startDate must be before endDate" 
        });
      }

      // Get geocoded daily centroids within the date range
      const geocodedCentroids = await storage.getGeocodedDailyCentroidsByDateRange(userId, startDate, endDate);
      
      // Calculate expected total days in the date range
      const totalDaysInRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      
      console.log(`📊 Analytics results for user ${userId}:`, {
        dateRangeRequested: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        totalDaysInRange,
        geocodedCentroidsFound: geocodedCentroids.length,
        geocodingCoverage: `${((geocodedCentroids.length / totalDaysInRange) * 100).toFixed(1)}%`,
        dateRangeSpan: `${totalDaysInRange} days`
      });

      if (geocodedCentroids.length === 0) {
        console.log(`⚠️  No geocoded centroids found for user ${userId} in date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
        return res.json({
          totalDays: totalDaysInRange,
          geocodedDays: 0,
          countries: {},
          states: {},
          cities: {},
          curatedPlaces: [],
          dateRange: {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0]
          }
        });
      }

      // Group locations by city/state/country and calculate visit statistics
      const locationStats = {
        countries: new Map<string, number>(),
        states: new Map<string, number>(),
        cities: new Map<string, number>(),
        locations: [] as any[]
      };

      // Process each centroid and aggregate data
      geocodedCentroids.forEach(centroid => {
        // Count countries
        if (centroid.country) {
          locationStats.countries.set(
            centroid.country, 
            (locationStats.countries.get(centroid.country) || 0) + 1
          );
        }

        // Count US states
        if (centroid.country === 'United States' && centroid.state) {
          locationStats.states.set(
            centroid.state,
            (locationStats.states.get(centroid.state) || 0) + 1
          );
        }

        // Count cities
        if (centroid.city) {
          const cityKey = `${centroid.city}, ${centroid.state || centroid.country}`;
          locationStats.cities.set(
            cityKey,
            (locationStats.cities.get(cityKey) || 0) + 1
          );
        }

        // Location data collection removed since OpenAI curation is disabled
      });

      // Convert Maps to objects for JSON response
      const countriesObj = Object.fromEntries(locationStats.countries);
      const statesObj = Object.fromEntries(locationStats.states);
      const citiesObj = Object.fromEntries(locationStats.cities);

      // OpenAI curation removed for performance - analytics now return in under 2 seconds
      const curatedPlaces: any[] = []; // Empty array to maintain API compatibility
      const aiCurationStatus = 'disabled';

      // Return complete analytics response with corrected totalDays calculation
      const finalResponse = {
        totalDays: totalDaysInRange, // Fixed: Use expected days in range, not geocoded count
        geocodedDays: geocodedCentroids.length,
        countries: countriesObj,
        states: statesObj,
        cities: citiesObj,
        curatedPlaces,
        aiCurationStatus,
        dateRange: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0]
        }
      };
      
      console.log(`✅ Analytics response for user ${userId}:`, {
        requestedRange: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
        totalDays: finalResponse.totalDays,
        geocodedDays: finalResponse.geocodedDays,
        countriesCount: Object.keys(finalResponse.countries).length,
        statesCount: Object.keys(finalResponse.states).length,
        citiesCount: Object.keys(finalResponse.cities).length,
        curatedPlacesCount: finalResponse.curatedPlaces.length
      });
      
      res.json(finalResponse);

    } catch (error) {
      console.error("Error in geocoded places analytics endpoint:", error);
      res.status(500).json({ 
        error: "Failed to process geocoded places analytics request",
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Interesting Places endpoint: AI-powered recommendations
  app.post('/api/interesting-places', isAuthenticated, async (req, res) => {
    try {
      const user = getAuthenticatedUser(req);
      const userId = user.claims.sub;
      
      console.log(`🎯 Interesting places request for user ${userId}`);
      
      // Validate request body
      const requestSchema = z.object({
        cities: z.record(z.string(), z.number()).optional().default({})
      });
      
      let validatedInput;
      try {
        validatedInput = requestSchema.parse(req.body);
      } catch (validationError) {
        console.log(`❌ Validation failed for user ${userId}:`, validationError);
        return res.status(400).json({ 
          error: "Invalid request format. Expected { cities: Record<string, number> }",
          details: validationError instanceof z.ZodError ? validationError.errors : undefined
        });
      }
      
      const { cities } = validatedInput;
      
      if (Object.keys(cities).length === 0) {
        return res.json({
          places: [],
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          message: "No cities provided"
        });
      }
      
      // Get top 10 visited cities for AI input (sorted by visit count)
      const topCities = Object.entries(cities)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([city, count]) => `${city} (visited ${count} days)`);
      
      console.log(`🚀 Generating AI recommendations for ${topCities.length} cities`);
      
      // Construct AI prompt for interesting places
      const prompt = `You are a travel expert helping someone discover interesting places near cities they've visited. 

Based on these visited cities:
${topCities.join('\n')}

Find exactly 5 interesting tourist attractions, landmarks, or unique spots that are:
- Near or accessible from these visited cities
- Well-known, publicly accessible places
- Worth visiting for tourists
- Diverse (different types of attractions)

For each place, provide:
- A brief description (1-2 sentences)
- The location/city it's near
- A Google Maps search URL

Return your response as a JSON object with this exact structure:
{
  "places": [
    {
      "description": "Brief description of the place",
      "location": "City/Location Name",
      "googleMapsUrl": "https://www.google.com/maps/search/Place+Name+Location"
    }
  ]
}`;

      try {
        // Call OpenAI API with GPT-4o mini for cost efficiency
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a helpful travel expert assistant. Always respond with valid JSON in the exact format requested."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: { type: "json_object" },
          max_tokens: 1000,
          temperature: 0.7
        });
        
        const aiResponse = completion.choices[0]?.message?.content;
        const tokenUsage = {
          promptTokens: completion.usage?.prompt_tokens || 0,
          completionTokens: completion.usage?.completion_tokens || 0,
          totalTokens: completion.usage?.total_tokens || 0
        };
        
        console.log(`✅ OpenAI response received for user ${userId}:`, {
          tokenUsage,
          responseLength: aiResponse?.length || 0
        });
        
        if (!aiResponse) {
          throw new Error("No response from OpenAI");
        }
        
        // Parse AI response
        let parsedResponse;
        try {
          parsedResponse = JSON.parse(aiResponse);
        } catch (parseError) {
          console.error(`❌ Failed to parse AI response for user ${userId}:`, parseError);
          throw new Error("Invalid response format from AI");
        }
        
        // Validate the AI response structure
        const placesSchema = z.object({
          places: z.array(z.object({
            description: z.string(),
            location: z.string(),
            googleMapsUrl: z.string().url()
          })).min(1).max(5)
        });
        
        let validatedPlaces;
        try {
          validatedPlaces = placesSchema.parse(parsedResponse);
        } catch (validationError) {
          console.error(`❌ AI response validation failed for user ${userId}:`, validationError);
          throw new Error("AI response doesn't match expected format");
        }
        
        console.log(`🎉 Successfully generated ${validatedPlaces.places.length} interesting places for user ${userId}`);
        
        // Return successful response
        res.json({
          places: validatedPlaces.places,
          tokenUsage,
          model: "gpt-4o-mini"
        });
        
      } catch (aiError) {
        console.error(`💥 OpenAI API error for user ${userId}:`, aiError);
        
        // Return specific error messages for different AI failures
        let errorMessage = "Failed to generate interesting places";
        if (aiError instanceof Error) {
          if (aiError.message.includes("API key")) {
            errorMessage = "OpenAI API configuration error";
          } else if (aiError.message.includes("quota") || aiError.message.includes("billing")) {
            errorMessage = "OpenAI API quota exceeded";
          } else if (aiError.message.includes("rate limit")) {
            errorMessage = "OpenAI API rate limit exceeded. Please try again in a moment.";
          } else {
            errorMessage = aiError.message;
          }
        }
        
        return res.status(500).json({
          error: errorMessage,
          details: aiError instanceof Error ? aiError.message : "Unknown AI error"
        });
      }
      
    } catch (error) {
      console.error(`💥 Interesting places endpoint failed for user:`, error);
      res.status(500).json({ 
        error: "Failed to process interesting places request",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}