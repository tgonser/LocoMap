import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import { storage } from "./storage";
import { parseGoogleLocationHistory, validateGoogleLocationHistory } from "./googleLocationParser";
import { insertLocationPointSchema } from "@shared/schema";
import { z } from "zod";

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

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
        return res.status(400).json({ error: "Invalid JSON file" });
      }

      if (!validateGoogleLocationHistory(jsonData)) {
        return res.status(400).json({ 
          error: "Invalid Google location history format. Please upload a valid location history JSON file." 
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

      // Store in database
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
