// Routes with Replit Auth integration and user-specific location data
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { parseGoogleLocationHistory, validateGoogleLocationHistory } from "./googleLocationParser";
import { batchReverseGeocode, deduplicateCoordinates } from "./geocodingService";

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
    console.log(`Starting background geocoding for user ${userId}, dataset ${datasetId}`);
    
    const locations = await storage.getUserLocationPoints(userId, datasetId);
    
    // Filter locations that don't have city information yet
    const locationsToGeocode = locations.filter(loc => !loc.city);
    
    if (locationsToGeocode.length === 0) {
      console.log(`All locations for user ${userId} already have city information`);
      return;
    }
    
    console.log(`Starting geocoding for ${locationsToGeocode.length} user locations`);
    
    // Deduplicate coordinates to reduce API calls
    const coordinates = locationsToGeocode.map(loc => ({ lat: loc.lat, lng: loc.lng }));
    const uniqueCoords = deduplicateCoordinates(coordinates);
    
    console.log(`Reduced ${coordinates.length} coordinates to ${uniqueCoords.length} unique locations for user ${userId}`);
    
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
    
    console.log(`Geocoding completed successfully for user ${userId}`);
  } catch (error) {
    console.error(`Geocoding process failed for user ${userId}:`, error);
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
    console.log("Upload request received from user:", claims.sub);
    try {
      if (!req.file) {
        console.log("No file in request");
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = claims.sub;
      console.log("File received, size:", req.file.buffer.length);
      
      let fileContent: string;
      try {
        fileContent = req.file.buffer.toString("utf8");
        console.log("File converted to string successfully");
      } catch (stringError) {
        console.error("Error converting file to string:", stringError);
        return res.status(400).json({ error: "File conversion failed" });
      }
      
      let jsonData;
      
      console.log("File info:", {
        size: req.file.buffer.length,
        sizeInMB: Math.round(req.file.buffer.length / (1024 * 1024)),
        filename: req.file.originalname,
        user: userId
      });
      
      try {
        jsonData = JSON.parse(fileContent);
        console.log("JSON parsing successful");
      } catch (parseError: any) {
        console.error("JSON parse error:", parseError);
        return res.status(400).json({ 
          error: `JSON parsing failed: ${parseError?.message || 'Unknown error'}. File size: ${Math.round(req.file.buffer.length / (1024 * 1024))}MB` 
        });
      }

      console.log("About to validate with validateGoogleLocationHistory...");
      const isValid = validateGoogleLocationHistory(jsonData);
      console.log("Validation result:", isValid);

      if (!isValid) {
        const errorMsg = Array.isArray(jsonData) 
          ? `Invalid Google location history format. Array with ${jsonData.length} elements detected, but validation failed.`
          : `Invalid Google location history format. Found keys: ${Object.keys(jsonData).join(', ')}. Expected 'timelineObjects', 'locations', or mobile array format.`;
        
        console.log("Validation failed, returning error:", errorMsg);
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

      // Start background geocoding for user's new data (restored analytics pipeline)
      geocodeUserLocationPoints(userId, dataset.id).catch(error => {
        console.error(`Background geocoding failed for user ${userId}:`, error);
      });

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

  // Protected route: Get user's location statistics 
  app.get("/api/locations/stats", isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const locations = await storage.getUserLocationPoints(userId);
      
      if (locations.length === 0) {
        return res.json({
          totalPoints: 0,
          dateRange: null,
          cities: [],
          states: [],
          countries: [],
          activities: [],
          dailyStats: []
        });
      }

      // Calculate statistics from user's location data
      const timestamps = locations.map(p => p.timestamp.getTime());
      const dateRange = {
        start: new Date(Math.min(...timestamps)),
        end: new Date(Math.max(...timestamps))
      };

      // Calculate city, state, country counts
      const cityData = new Map<string, { count: number; state?: string; country?: string }>();
      const stateData = new Map<string, { count: number; country?: string }>();
      const countryCounts = new Map<string, number>();
      const activityCounts = new Map<string, number>();

      locations.forEach(point => {
        if (point.city) {
          const key = point.city;
          if (!cityData.has(key)) {
            cityData.set(key, { count: 0, state: point.state || undefined, country: point.country || undefined });
          }
          cityData.get(key)!.count++;
        }

        if (point.state) {
          const key = point.state;
          if (!stateData.has(key)) {
            stateData.set(key, { count: 0, country: point.country || undefined });
          }
          stateData.get(key)!.count++;
        }

        if (point.country) {
          countryCounts.set(point.country, (countryCounts.get(point.country) || 0) + 1);
        }

        if (point.activity) {
          activityCounts.set(point.activity, (activityCounts.get(point.activity) || 0) + 1);
        }
      });

      // Calculate daily statistics
      const dailyData = new Map<string, { points: number; citiesSet: Set<string> }>();
      locations.forEach(point => {
        const dateKey = point.timestamp.toDateString();
        if (!dailyData.has(dateKey)) {
          dailyData.set(dateKey, { points: 0, citiesSet: new Set() });
        }
        const dayData = dailyData.get(dateKey)!;
        dayData.points++;
        if (point.city) {
          dayData.citiesSet.add(point.city);
        }
      });

      const stats = {
        totalPoints: locations.length,
        dateRange,
        cities: Array.from(cityData.entries())
          .map(([name, data]) => ({ name, count: data.count, state: data.state, country: data.country }))
          .sort((a, b) => b.count - a.count),
        states: Array.from(stateData.entries())
          .map(([name, data]) => ({ name, count: data.count, country: data.country }))
          .sort((a, b) => b.count - a.count),
        countries: Array.from(countryCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        activities: Array.from(activityCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        dailyStats: Array.from(dailyData.entries())
          .map(([date, data]) => ({ date, points: data.points, cities: data.citiesSet.size }))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      };

      res.json(stats);
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

  const httpServer = createServer(app);
  return httpServer;
}