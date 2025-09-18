// Routes with Replit Auth integration and user-specific location data
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { parseGoogleLocationHistory, validateGoogleLocationHistory } from "./googleLocationParser";
import { batchReverseGeocode, deduplicateCoordinates } from "./geocodingService";
import OpenAI from "openai";
import { z } from "zod";

// OpenAI integration for analyzing and curating interesting places
// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Function to analyze and curate interesting places using OpenAI
async function curateInterestingPlaces(locations: any[]): Promise<any[]> {
  try {
    // Limit data sent to OpenAI to avoid token limits - sample diverse locations
    const sampledLocations = sampleDiverseLocations(locations, 50);
    
    const locationData = sampledLocations.map(loc => ({
      city: loc.city,
      state: loc.state,
      country: loc.country,
      lat: loc.lat,
      lng: loc.lng,
      visitDays: loc.visitDays,
      address: loc.address
    }));

    const prompt = `Analyze the following location data from a person's travel history and select 8-12 of the most interesting places. Focus on:

1. Landmarks and famous tourist destinations
2. Beautiful natural areas (national parks, scenic locations)
3. Major cities with cultural significance
4. Unique or unusual places
5. Places with diverse geographical representation

Location data:
${JSON.stringify(locationData, null, 2)}

Select the most interesting and diverse places, ensuring good geographical spread. For each selected place, provide:
- The exact city, state (if applicable), country from the data
- Latitude and longitude from the data
- A brief reason why this place is interesting (1-2 sentences)
- Visit information from the data

Return ONLY a JSON object with this structure:
{
  "curatedPlaces": [
    {
      "city": "exact city from data",
      "state": "exact state from data if exists",
      "country": "exact country from data", 
      "lat": latitude_from_data,
      "lng": longitude_from_data,
      "visitDays": visit_days_from_data,
      "reason": "why this place is interesting",
      "mapsLink": "https://www.google.com/maps/search/{lat},{lng}"
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content || '{"curatedPlaces": []}');
    
    // Ensure Google Maps links are properly formatted
    if (result.curatedPlaces) {
      result.curatedPlaces.forEach((place: any) => {
        place.mapsLink = `https://www.google.com/maps/search/${place.lat},${place.lng}`;
      });
    }

    return result.curatedPlaces || [];
  } catch (error) {
    console.error('OpenAI curation error:', error);
    throw new Error('Failed to curate interesting places');
  }
}

function sampleDiverseLocations(locations: any[], maxSamples: number): any[] {
  // Group by unique city/country combinations to get diverse sample
  const uniquePlaces = new Map<string, any>();
  
  locations.forEach(loc => {
    if (loc.city && loc.country) {
      const key = `${loc.city}-${loc.country}`;
      if (!uniquePlaces.has(key)) {
        uniquePlaces.set(key, loc);
      }
    }
  });
  
  // If we have fewer unique places than maxSamples, return all
  const uniqueArray = Array.from(uniquePlaces.values());
  if (uniqueArray.length <= maxSamples) {
    return uniqueArray;
  }
  
  // Sample evenly from the unique places
  const step = Math.floor(uniqueArray.length / maxSamples);
  const sampled = [];
  for (let i = 0; i < uniqueArray.length && sampled.length < maxSamples; i += step) {
    sampled.push(uniqueArray[i]);
  }
  
  return sampled;
}

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

  // Protected route: Get user's location points
  app.get("/api/locations", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const datasetId = req.query.datasetId as string;
      const locations = await storage.getUserLocationPoints(userId, datasetId);
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

      // Step 1: Ensure centroids exist for the date range
      console.log(`📊 Step 2/4 - Ensuring daily centroids exist for date range`);
      let centroidsCreated = 0;
      
      try {
        // Check if we need to create centroids for any datasets
        const datasets = await storage.getUserLocationDatasets(userId);
        
        if (datasets.length === 0) {
          return res.status(400).json({
            error: "No location datasets found. Please upload location data first."
          });
        }

        // Create centroids for all datasets (this will handle duplicates automatically)
        centroidsCreated = await storage.computeDailyCentroidsForAllDatasets(userId);
        console.log(`✅ Centroids ensured: ${centroidsCreated} centroids processed`);
      } catch (error) {
        console.error(`❌ Failed to ensure centroids for user ${userId}:`, error);
        return res.status(500).json({
          error: "Failed to compute daily centroids",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }

      // Step 2: Geocode missing locations in the date range
      console.log(`🌍 Step 3/4 - Geocoding missing locations in date range`);
      
      let ungeocodedCount = 0;
      try {
        ungeocodedCount = await storage.getUngeocodedCentroidsCountByDateRange(userId, startDate, endDate);
        
        if (ungeocodedCount > 0) {
          console.log(`Found ${ungeocodedCount} ungeocoded centroids in date range, starting geocoding...`);
          
          // Use the existing geocoding function for date ranges
          await geocodeDailyCentroidsByDateRange(userId, startDate, endDate);
          console.log(`✅ Geocoding completed for date range`);
        } else {
          console.log(`✅ No geocoding needed - all centroids in date range already geocoded`);
        }
      } catch (error) {
        console.error(`❌ Geocoding failed for user ${userId}:`, error);
        return res.status(500).json({
          error: "Failed to geocode locations",
          details: error instanceof Error ? error.message : "Unknown error"
        });
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
              countries: {},
              states: {},
              cities: {},
              curatedPlaces: [],
              dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0]
              }
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

          // Collect location data for OpenAI curation
          if (centroid.city && centroid.country) {
            locationStats.locations.push({
              city: centroid.city,
              state: centroid.state,
              country: centroid.country,
              lat: centroid.lat,
              lng: centroid.lng,
              address: centroid.address,
              visitDays: 1 // Each centroid represents one day
            });
          }
        });

        // Convert Maps to Objects for frontend compatibility
        const countriesObject = Object.fromEntries(locationStats.countries);
        const statesObject = Object.fromEntries(locationStats.states);  
        const citiesObject = Object.fromEntries(locationStats.cities);

        // Generate curated places using OpenAI
        let curatedPlaces: any[] = [];
        try {
          curatedPlaces = await curateInterestingPlaces(locationStats.locations);
          console.log(`🎯 Generated ${curatedPlaces.length} curated places for user ${userId}`);
        } catch (curationError) {
          console.error(`⚠️  OpenAI curation failed for user ${userId}:`, curationError);
          // Continue without curated places rather than failing the entire request
        }

        const analyticsResult = {
          success: true,
          pipeline: {
            centroidsCreated,
            geocoded: ungeocodedCount || 0,
            analyticsGenerated: true
          },
          analytics: {
            totalDays: totalDaysInRange,
            geocodedDays: geocodedCentroids.length,
            geocodingCoverage: Number(((geocodedCentroids.length / totalDaysInRange) * 100).toFixed(1)),
            countries: countriesObject,
            states: statesObject,
            cities: citiesObject,
            curatedPlaces,
            dateRange: {
              start: startDate.toISOString().split('T')[0],
              end: endDate.toISOString().split('T')[0]
            }
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

        // Prepare location data for OpenAI analysis
        locationStats.locations.push({
          city: centroid.city,
          state: centroid.state,
          country: centroid.country,
          lat: centroid.lat,
          lng: centroid.lng,
          address: centroid.address,
          visitDays: 1, // Each centroid represents one day
          date: centroid.date
        });
      });

      // Convert Maps to objects for JSON response
      const countriesObj = Object.fromEntries(locationStats.countries);
      const statesObj = Object.fromEntries(locationStats.states);
      const citiesObj = Object.fromEntries(locationStats.cities);

      // Use OpenAI to curate interesting places
      let curatedPlaces: any[] = [];
      let aiCurationStatus = 'success';
      try {
        curatedPlaces = await curateInterestingPlaces(locationStats.locations);
      } catch (openaiError: any) {
        console.error('OpenAI curation failed:', openaiError);
        aiCurationStatus = openaiError.code === 'insufficient_quota' ? 'quota_exceeded' : 'error';
        
        // Fallback: Create basic interesting places from unique cities with most visits
        const cityVisits = new Map<string, { count: number, location: any }>();
        
        locationStats.locations.forEach(loc => {
          if (loc.city && loc.country) {
            const key = `${loc.city}, ${loc.state || loc.country}`;
            if (!cityVisits.has(key)) {
              cityVisits.set(key, { count: 0, location: loc });
            }
            cityVisits.get(key)!.count++;
          }
        });

        // Get top 10 most visited unique places as fallback
        const sortedCities = Array.from(cityVisits.entries())
          .sort(([,a], [,b]) => b.count - a.count)
          .slice(0, 10);

        curatedPlaces = sortedCities.map(([cityName, data]) => ({
          city: data.location.city,
          state: data.location.state,
          country: data.location.country,
          visitDays: data.count,
          reason: `Visited ${data.count} time${data.count !== 1 ? 's' : ''} - ${cityName}`,
          latitude: data.location.lat,
          longitude: data.location.lng,
          googleMapsUrl: `https://www.google.com/maps/search/${data.location.lat},${data.location.lng}`
        }));
      }

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

  const httpServer = createServer(app);
  return httpServer;
}