import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { parseGoogleLocationHistory, validateGoogleLocationHistory } from "./googleLocationParser";
import { batchReverseGeocode, deduplicateCoordinates } from "./geocodingService";
import { insertLocationPointSchema } from "@shared/schema";
import { z } from "zod";

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit for large Google location history files
});

// Background geocoding function
async function geocodeLocationPoints() {
  try {
    const locations = await storage.getLocationPoints();
    
    // Filter locations that don't have city information yet
    const locationsToGeocode = locations.filter(loc => !loc.city);
    
    if (locationsToGeocode.length === 0) {
      console.log('All locations already have city information');
      return;
    }
    
    console.log(`Starting geocoding for ${locationsToGeocode.length} locations`);
    
    // Deduplicate coordinates to reduce API calls
    const coordinates = locationsToGeocode.map(loc => ({ lat: loc.lat, lng: loc.lng }));
    const uniqueCoords = deduplicateCoordinates(coordinates);
    
    console.log(`Reduced ${coordinates.length} coordinates to ${uniqueCoords.length} unique locations`);
    
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
        await storage.updateLocationPoint(location.id, {
          city: geocodeResult.city || null,
          state: geocodeResult.state || null,
          country: geocodeResult.country || null,
          address: geocodeResult.address || null
        });
      }
    }
    
    console.log('Geocoding completed successfully');
  } catch (error) {
    console.error('Geocoding process failed:', error);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Upload and parse Google location history
  app.post("/api/upload-location-history", upload.single("file"), async (req: Request & { file?: Express.Multer.File }, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileContent = req.file.buffer.toString("utf8");
      let jsonData;
      
      try {
        jsonData = JSON.parse(fileContent);
      } catch (parseError) {
        console.error("JSON parse error:", parseError);
        return res.status(400).json({ error: "Invalid JSON file - parsing failed" });
      }

      // Debug: log the structure of the uploaded file
      console.log("File structure:", {
        hasTimelineObjects: jsonData.timelineObjects !== undefined,
        timelineObjectsIsArray: Array.isArray(jsonData.timelineObjects),
        timelineObjectsLength: jsonData.timelineObjects?.length,
        hasLocations: jsonData.locations !== undefined,
        locationsIsArray: Array.isArray(jsonData.locations),
        locationsLength: jsonData.locations?.length,
        topLevelKeys: Object.keys(jsonData)
      });

      if (!validateGoogleLocationHistory(jsonData)) {
        return res.status(400).json({ 
          error: `Invalid Google location history format. Found keys: ${Object.keys(jsonData).join(', ')}. Expected 'timelineObjects' or 'locations' array.` 
        });
      }

      // Parse the location data
      const parsedLocations = parseGoogleLocationHistory(jsonData);
      
      if (parsedLocations.length === 0) {
        return res.status(400).json({ 
          error: "No location data found in the file" 
        });
      }

      // Clear existing data before importing new
      await storage.clearLocationPoints();

      // Convert to database format
      const locationPoints = parsedLocations.map(location => ({
        lat: location.lat,
        lng: location.lng,
        timestamp: location.timestamp,
        accuracy: location.accuracy || null,
        activity: location.activity || null,
        address: null,
        city: null,
        state: null,
        country: null,
        userId: null
      }));

      // Store in database first
      const savedPoints = await storage.createLocationPoints(locationPoints);

      res.json({
        success: true,
        message: `Successfully imported ${savedPoints.length} location points`,
        pointCount: savedPoints.length,
        dateRange: {
          start: new Date(Math.min(...parsedLocations.map(l => l.timestamp.getTime()))),
          end: new Date(Math.max(...parsedLocations.map(l => l.timestamp.getTime())))
        }
      });

      // Start geocoding in background (don't wait for response)
      geocodeLocationPoints().catch(error => {
        console.error('Background geocoding failed:', error);
      });

    } catch (error) {
      console.error("Error processing location history:", error);
      res.status(500).json({ error: "Failed to process location history file" });
    }
  });

  // Get all location points
  app.get("/api/locations", async (req, res) => {
    try {
      const locations = await storage.getLocationPoints();
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // Get locations by date range
  app.get("/api/locations/date-range", async (req, res) => {
    try {
      const { start, end } = req.query;
      
      if (!start || !end) {
        return res.status(400).json({ error: "Start and end dates are required" });
      }

      const startDate = new Date(start as string);
      const endDate = new Date(end as string);
      
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format" });
      }

      const locations = await storage.getLocationPointsByDateRange(startDate, endDate);
      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations by date range:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // Get location statistics
  app.get("/api/locations/stats", async (req, res) => {
    try {
      const stats = await storage.getLocationStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching location stats:", error);
      res.status(500).json({ error: "Failed to fetch location statistics" });
    }
  });

  // Clear all location data
  app.delete("/api/locations", async (req, res) => {
    try {
      await storage.clearLocationPoints();
      res.json({ success: true, message: "All location data cleared" });
    } catch (error) {
      console.error("Error clearing locations:", error);
      res.status(500).json({ error: "Failed to clear location data" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
