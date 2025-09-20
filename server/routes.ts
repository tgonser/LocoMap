// Routes with Replit Auth integration and user-specific location data
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import fs from 'fs';
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { parseGoogleLocationHistory, validateGoogleLocationHistory } from "./googleLocationParser";
import { batchReverseGeocode, deduplicateCoordinates } from "./geocodingService";
import { GoogleLocationIngest } from "./googleLocationIngest";
import { z } from "zod";
import OpenAI from "openai";

// Distance calculation utility using Haversine formula (returns miles)
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles (use 6371 for kilometers)
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// OpenAI client setup for interesting places feature
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// OpenAI curation removed for performance - analytics now return in under 2 seconds

// Configure multer for file uploads using disk storage to avoid memory issues
const upload = multer({ 
  storage: multer.diskStorage({
    destination: '/tmp/uploads/',
    filename: (_req, file, cb) => {
      // Generate unique filename with timestamp
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
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

// Quick metadata extraction for smart upload - supports ALL formats
async function extractQuickMetadata(jsonData: any) {
  console.log('📊 Analyzing file structure and data quality...');
  
  let totalElements = 0;
  let estimatedPoints = 0;
  let minTimestamp: Date | null = null;
  let maxTimestamp: Date | null = null;
  
  // Data quality counters
  let badProbability = 0;
  let goodProbability = 0;
  let zeroDistance = 0;
  let goodDistance = 0;
  let badAccuracy = 0;
  let totalTimelinePath = 0;
  
  // Activity breakdown
  const activityCounts: Record<string, number> = {};
  
  // Helper to extract timestamp from various formats
  const extractTimestamp = (element: any): Date | null => {
    if (element.startTime) return new Date(element.startTime);
    if (element.endTime) return new Date(element.endTime);
    if (element.duration?.startTimestampMs) return new Date(parseInt(element.duration.startTimestampMs, 10));
    if (element.duration?.endTimestampMs) return new Date(parseInt(element.duration.endTimestampMs, 10));
    if (element.timestampMs) return new Date(parseInt(element.timestampMs, 10));
    return null;
  };
  
  // Helper to update date range
  const updateDateRange = (timestamp: Date) => {
    if (!minTimestamp || timestamp < minTimestamp) minTimestamp = timestamp;
    if (!maxTimestamp || timestamp > maxTimestamp) maxTimestamp = timestamp;
  };
  
  // MOBILE ARRAY FORMAT (element.activity, element.visit)
  if (Array.isArray(jsonData)) {
    const sampleSize = Math.min(jsonData.length, 1000);
    const step = Math.ceil(jsonData.length / sampleSize);
    
    for (let i = 0; i < jsonData.length; i += step) {
      const element = jsonData[i];
      totalElements++;
      
      const timestamp = extractTimestamp(element);
      if (timestamp) updateDateRange(timestamp);
      
      if (element.activity) {
        const activityType = element.activity.topCandidate?.type?.toLowerCase() || 'unknown';
        activityCounts[activityType] = (activityCounts[activityType] || 0) + 1;
        estimatedPoints++;
        
        const probability = parseFloat(element.activity.topCandidate?.probability || '1.0');
        if (probability <= 0.1) badProbability++; else goodProbability++;
        
        const distance = parseFloat(element.activity.distanceMeters || '1.0');
        if (distance <= 1.0) zeroDistance++; else goodDistance++;
        
        if ((element as any).timelinePath?.points) {
          totalTimelinePath += (element as any).timelinePath.points.length || 0;
        }
      }
      
      if (element.visit) {
        estimatedPoints++;
        activityCounts['still'] = (activityCounts['still'] || 0) + 1;
        
        if (element.visit.timelinePath?.points) {
          totalTimelinePath += element.visit.timelinePath.points.length || 0;
        }
      }
    }
    
    const scaleFactor = jsonData.length / totalElements;
    estimatedPoints = Math.round(estimatedPoints * scaleFactor);
    totalTimelinePath = Math.round(totalTimelinePath * scaleFactor);
    badProbability = Math.round(badProbability * scaleFactor);
    goodProbability = Math.round(goodProbability * scaleFactor);
    zeroDistance = Math.round(zeroDistance * scaleFactor);
    goodDistance = Math.round(goodDistance * scaleFactor);
    
    totalElements = jsonData.length; // Use actual count
  }
  
  // TIMELINEOBJECTS FORMAT (timelineObjects.activitySegment/placeVisit)
  else if (jsonData.timelineObjects) {
    const objects = jsonData.timelineObjects;
    const sampleSize = Math.min(objects.length, 1000);
    const step = Math.ceil(objects.length / sampleSize);
    
    for (let i = 0; i < objects.length; i += step) {
      const obj = objects[i];
      totalElements++;
      
      if (obj.activitySegment) {
        const segment = obj.activitySegment;
        estimatedPoints++;
        
        if (segment.duration?.startTimestampMs) {
          updateDateRange(new Date(parseInt(segment.duration.startTimestampMs, 10)));
        }
        
        const activityType = segment.activityType?.toLowerCase() || 'unknown';
        activityCounts[activityType] = (activityCounts[activityType] || 0) + 1;
        
        const distance = parseFloat(segment.distance || '1.0');
        if (distance <= 1.0) zeroDistance++; else goodDistance++;
        
        if (segment.waypointPath?.waypoints) {
          totalTimelinePath += segment.waypointPath.waypoints.length || 0;
        }
      }
      
      if (obj.placeVisit) {
        const visit = obj.placeVisit;
        estimatedPoints++;
        activityCounts['still'] = (activityCounts['still'] || 0) + 1;
        
        if (visit.duration?.startTimestampMs) {
          updateDateRange(new Date(parseInt(visit.duration.startTimestampMs, 10)));
        }
      }
    }
    
    const scaleFactor = objects.length / totalElements;
    estimatedPoints = Math.round(estimatedPoints * scaleFactor);
    totalTimelinePath = Math.round(totalTimelinePath * scaleFactor);
    zeroDistance = Math.round(zeroDistance * scaleFactor);
    goodDistance = Math.round(goodDistance * scaleFactor);
    
    totalElements = objects.length;
  }
  
  // LOCATIONS FORMAT (locations[].timestampMs)
  else if (jsonData.locations && Array.isArray(jsonData.locations)) {
    const locations = jsonData.locations;
    const sampleSize = Math.min(locations.length, 1000);
    const step = Math.ceil(locations.length / sampleSize);
    
    for (let i = 0; i < locations.length; i += step) {
      const location = locations[i];
      totalElements++;
      estimatedPoints++;
      
      if (location.timestampMs) {
        updateDateRange(new Date(parseInt(location.timestampMs, 10)));
      }
      
      const accuracy = parseFloat(location.accuracy || '50');
      if (accuracy > 200) badAccuracy++;
      
      activityCounts['location'] = (activityCounts['location'] || 0) + 1;
    }
    
    const scaleFactor = locations.length / totalElements;
    estimatedPoints = Math.round(estimatedPoints * scaleFactor);
    
    totalElements = locations.length;
  }
  
  else {
    console.log('❌ Unrecognized Google Location History format');
    return null;
  }
  
  console.log(`📈 Quick analysis: ${totalElements} elements, ~${estimatedPoints} estimated points, ~${totalTimelinePath} timelinePath points`);
  console.log(`📉 Quality: ${badProbability} bad probability, ${zeroDistance} zero distance, ${badAccuracy} bad accuracy`);
  
  return {
    totalElements,
    estimatedPoints,
    dateRange: {
      start: minTimestamp && minTimestamp instanceof Date ? minTimestamp.toISOString() : null,
      end: maxTimestamp && maxTimestamp instanceof Date ? maxTimestamp.toISOString() : null
    },
    dataQuality: {
      badProbability,
      goodProbability,
      zeroDistance,
      goodDistance,
      badAccuracy,
      totalTimelinePath
    },
    activityBreakdown: activityCounts
  };
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
      const filePath = req.file.path; // Now using disk storage, we have a file path
      
      // Read a small portion of the file for validation and metadata extraction
      let fileContent: string;
      try {
        fileContent = await fs.promises.readFile(filePath, 'utf8');
      } catch (readError) {
        console.error("Error reading uploaded file:", readError);
        await fs.promises.unlink(filePath).catch(() => {}); // Clean up temp file
        return res.status(400).json({ error: "Failed to read uploaded file" });
      }
      
      let jsonData: any;
      
      try {
        jsonData = JSON.parse(fileContent);
        
        // Debug: Log the parsed structure before validation
        console.log(`🔍 Upload parsed - Type: ${typeof jsonData}, Array: ${Array.isArray(jsonData)}`);
        if (typeof jsonData === 'object') {
          const keys = Object.keys(jsonData);
          console.log(`🔍 Object keys count: ${keys.length}`);
          if (keys.length <= 10) {
            console.log(`🔍 First few keys: ${keys.slice(0, 10).join(', ')}`);
          }
          console.log(`🔍 Has timelineObjects: ${!!jsonData.timelineObjects}`);
        }
        
        // Fix: Normalize array-like objects with numeric keys back to arrays
        if (!Array.isArray(jsonData) && typeof jsonData === 'object' && jsonData) {
          const keys = Object.keys(jsonData);
          const isNumericKeyObject = keys.length > 0 && keys.every(key => !isNaN(Number(key)));
          
          if (isNumericKeyObject) {
            console.log(`🔧 Converting numeric-key object with ${keys.length} elements back to array`);
            const sortedKeys = keys.sort((a, b) => Number(a) - Number(b));
            const arrayData = sortedKeys.map(key => jsonData[key]);
            
            // Check if this looks like a modern format that got coerced
            if (arrayData.length > 0 && arrayData[0] && typeof arrayData[0] === 'object') {
              const firstItem = arrayData[0];
              console.log(`🔍 First item keys: ${Object.keys(firstItem).join(', ')}`);
              
              // Modern format indicators - these are timelineObjects elements
              const hasModernIndicators = firstItem.timelinePath || firstItem.activitySegment || firstItem.placeVisit ||
                // Modern visit format (has startTime/endTime with visit)
                (firstItem.startTime && firstItem.endTime && firstItem.visit) ||
                // Modern activity segment format
                (firstItem.startTime && firstItem.endTime && firstItem.activitySegment);
              
              if (hasModernIndicators) {
                console.log(`✅ Restored modern timelineObjects format from coerced object`);
                jsonData = { timelineObjects: arrayData };
              } else {
                console.log(`📊 Detected legacy array format (no modern format indicators)`);
                jsonData = arrayData;
              }
            } else {
              console.log(`📊 Converting to array format`);
              jsonData = arrayData;
            }
          }
        }
        
        // Additional fix: If we have an array that looks like modern format, wrap it
        if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0] && typeof jsonData[0] === 'object') {
          const firstItem = jsonData[0];
          console.log(`🔍 Array first item keys: ${Object.keys(firstItem).join(', ')}`);
          
          if (firstItem.timelinePath || firstItem.activitySegment || firstItem.placeVisit) {
            console.log(`✅ Detected array of timelineObjects - wrapping in proper format`);
            jsonData = { timelineObjects: jsonData };
          }
        }
        
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

      // SMART UPLOAD: Quick metadata extraction only - NO PROCESSING
      console.log('🔍 Starting smart metadata extraction...');
      
      // Quick scan for metadata without full parsing
      const metadata = await extractQuickMetadata(jsonData);
      
      if (!metadata || metadata.totalElements === 0) {
        return res.status(400).json({ 
          error: "No location data found in the file" 
        });
      }

      // Create dataset record - UNPROCESSED with metadata
      const dataset = await storage.createLocationDataset({
        userId,
        filename: req.file.originalname || 'location-history.json',
        fileSize: req.file.buffer.length,
        totalPoints: metadata.estimatedPoints,
        deduplicatedPoints: 0, // Will be set during processing
      });

      // Store raw file content for later processing (smart upload!)
      await storage.storeRawFile(dataset.id, userId, JSON.stringify(jsonData));

      res.json({
        success: true,
        message: `File uploaded successfully: ${req.file.originalname}`,
        datasetId: dataset.id,
        status: 'uploaded_not_processed',
        metadata: {
          filename: req.file.originalname,
          fileSize: Math.round(req.file.buffer.length / (1024 * 1024)) + 'MB',
          totalElements: metadata.totalElements,
          estimatedPoints: metadata.estimatedPoints,
          dateRange: metadata.dateRange,
          dataQuality: metadata.dataQuality,
          activityBreakdown: metadata.activityBreakdown
        }
      });

      console.log(`📁 File uploaded (metadata extracted): ${req.file.originalname} - ${metadata.estimatedPoints} estimated points, quality: ${metadata.dataQuality.goodProbability}/${metadata.totalElements} good probability`);

    } catch (error) {
      console.error("Error processing location history:", error);
      res.status(500).json({ error: "Failed to process location history file" });
    }
  });

  // 🎯 CRITICAL: Process stored raw JSON files into location points using enhanced parser
  app.post("/api/datasets/:datasetId/process", isAuthenticated, async (req, res) => {
    const { claims } = getAuthenticatedUser(req);
    const userId = claims.sub;
    const { datasetId } = req.params;

    try {
      console.log(`🚀 Processing dataset ${datasetId} for user ${userId}`);

      // Get the dataset to verify ownership
      const dataset = await storage.getLocationDataset(datasetId, userId);
      if (!dataset) {
        return res.status(404).json({ error: "Dataset not found" });
      }

      // Check if already processed
      if (dataset.processedAt) {
        console.log(`⚠️ Dataset ${datasetId} already processed at ${dataset.processedAt}`);
        return res.status(400).json({ 
          error: "Dataset already processed",
          processedAt: dataset.processedAt
        });
      }

      // Get raw JSON content
      console.log(`📁 Retrieving raw content for dataset ${datasetId}`);
      const rawContent = await storage.getRawFile(datasetId, userId);
      if (!rawContent) {
        return res.status(400).json({ error: "No raw content found for dataset" });
      }

      // Parse raw JSON
      let jsonData;
      try {
        jsonData = JSON.parse(rawContent);
      } catch (parseError) {
        console.error("Error parsing stored JSON:", parseError);
        return res.status(500).json({ error: "Failed to parse stored JSON content" });
      }

      // 🔧 Apply the same normalization logic as during upload
      // Fix: Normalize array-like objects with numeric keys back to arrays
      if (!Array.isArray(jsonData) && typeof jsonData === 'object' && jsonData) {
        const keys = Object.keys(jsonData);
        const isNumericKeyObject = keys.length > 0 && keys.every(key => !isNaN(Number(key)));
        
        if (isNumericKeyObject) {
          console.log(`🔧 Processing: Converting numeric-key object with ${keys.length} elements back to array`);
          const sortedKeys = keys.sort((a, b) => Number(a) - Number(b));
          const arrayData = sortedKeys.map(key => jsonData[key]);
          
          // Check if this looks like a modern format that got coerced
          if (arrayData.length > 0 && arrayData[0] && typeof arrayData[0] === 'object') {
            const firstItem = arrayData[0];
            console.log(`🔍 Processing first item keys: ${Object.keys(firstItem).join(', ')}`);
            
            // Modern format indicators - these are timelineObjects elements
            const hasModernIndicators = firstItem.timelinePath || firstItem.activitySegment || firstItem.placeVisit ||
              // Modern visit format (has startTime/endTime with visit)
              (firstItem.startTime && firstItem.endTime && firstItem.visit) ||
              // Modern activity segment format
              (firstItem.startTime && firstItem.endTime && firstItem.activitySegment);
            
            if (hasModernIndicators) {
              console.log(`✅ Processing: Restored modern timelineObjects format from coerced object`);
              jsonData = { timelineObjects: arrayData };
            } else {
              console.log(`📊 Processing: Detected legacy array format (no modern format indicators)`);
              jsonData = arrayData;
            }
          } else {
            console.log(`📊 Processing: Converting to array format`);
            jsonData = arrayData;
          }
        }
      }

      // 🚀 STREAMING: Use GoogleLocationIngest to process efficiently without stack overflow
      console.log(`⚡ Using streaming ingestion to avoid memory issues`);
      
      // Write raw content to temporary file for streaming processing
      const tempFilePath = `/tmp/uploads/process-${datasetId}-${Date.now()}.json`;
      await fs.promises.writeFile(tempFilePath, rawContent, 'utf8');

      try {
        // Use streaming ingestion to process the large file efficiently
        const ingest = new GoogleLocationIngest(storage);
        
        const result = await ingest.ingest(tempFilePath, userId, datasetId, {
          batchSize: 25000,
          onProgress: (processed) => {
            if (processed % 50000 === 0) { // Log every 50k points
              console.log(`📊 Progress: ${processed.toLocaleString()} points processed`);
            }
          }
        });

        if (result.errors.length > 0) {
          console.warn(`⚠️ Processing completed with ${result.errors.length} errors:`, result.errors.slice(0, 3));
        }

        if (result.processed === 0) {
          console.log(`❌ No location points extracted from dataset ${datasetId}`);
          return res.status(400).json({ error: "No valid location points found in the data" });
        }

        // Mark dataset as processed
        await storage.updateDatasetProcessed(datasetId, result.processed);

        console.log(`🎉 Successfully processed dataset ${datasetId}: ${result.processed.toLocaleString()} points`);

        res.json({
          success: true,
          message: `Successfully processed ${result.processed.toLocaleString()} location points`,
          pointsProcessed: result.processed,
          datasetId: datasetId,
          errors: result.errors.length > 0 ? result.errors.slice(0, 3) : undefined
        });

      } finally {
        // Clean up temporary file
        await fs.promises.unlink(tempFilePath).catch(err => {
          console.warn(`Failed to clean up temp file ${tempFilePath}:`, err);
        });
      }

    } catch (error) {
      console.error(`❌ Error processing dataset ${datasetId}:`, error);
      res.status(500).json({ 
        error: "Failed to process dataset",
        details: error instanceof Error ? error.message : "Unknown error"
      });
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

  // Delete a specific dataset
  app.delete("/api/datasets/:datasetId", isAuthenticated, async (req, res) => {
    console.log(`🚨 DELETE ROUTE HIT: ${req.params.datasetId}`);
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const { datasetId } = req.params;

      // Check if dataset exists and belongs to user
      const dataset = await storage.getLocationDataset(datasetId, userId);
      if (!dataset) {
        return res.status(404).json({ error: "Dataset not found" });
      }

      console.log(`🗑️ Deleting dataset ${datasetId} (${dataset.filename}) for user ${userId}`);

      // Delete associated location points first
      await storage.deleteLocationPointsByDataset(datasetId, userId);

      // Delete the dataset
      await storage.deleteLocationDataset(datasetId, userId);

      console.log(`✅ Successfully deleted dataset ${datasetId}`);
      res.json({ success: true, message: `Dataset ${dataset.filename} deleted successfully` });
    } catch (error) {
      console.error("Error deleting dataset:", error);
      res.status(500).json({ error: "Failed to delete dataset" });
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

  // ================== WAYPOINT-BASED ANALYTICS ENDPOINTS ==================

  // NEW: Waypoint computation pipeline endpoint
  // NEW: Date-range-first waypoint computation API
  app.post('/api/waypoints/compute', isAuthenticated, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;

      // Input validation for date-range-first processing
      const waypointSchema = z.object({
        datasetId: z.string().min(1, "Dataset ID is required"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD format"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be YYYY-MM-DD format"),
        minDwellMinutes: z.number().min(1).max(60).default(8),
        maxDistanceMeters: z.number().min(50).max(500).default(300)
      });

      let validatedInput;
      try {
        validatedInput = waypointSchema.parse(req.body);
      } catch (validationError) {
        console.log(`❌ Waypoint computation validation failed for user ${userId}:`, validationError);
        return res.status(400).json({ 
          error: "Invalid parameters for waypoint computation",
          details: validationError instanceof z.ZodError ? validationError.errors : undefined
        });
      }

      const { datasetId, startDate: startDateStr, endDate: endDateStr, minDwellMinutes, maxDistanceMeters } = validatedInput;
      
      // Convert to Date objects
      const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDate = new Date(`${endDateStr}T23:59:59.999Z`);
      
      if (startDate >= endDate) {
        return res.status(400).json({ error: "startDate must be before endDate" });
      }

      // Verify dataset belongs to user
      const dataset = await storage.getLocationDataset(datasetId, userId);
      if (!dataset) {
        return res.status(404).json({ 
          error: "Dataset not found or access denied" 
        });
      }

      console.log(`🚀 Starting DATE-RANGE waypoint computation for user ${userId}:`, {
        dataset: datasetId,
        dateRange: `${startDateStr} to ${endDateStr}`,
        processing: "date-range-first (new architecture)"
      });
      const startTime = Date.now();

      // Run date-range-bounded waypoint computation (NEW APPROACH)
      const result = await storage.computeWaypointAnalyticsByDateRange(userId, datasetId, startDate, endDate, minDwellMinutes, maxDistanceMeters);

      const processingTime = (Date.now() - startTime) / 1000;

      console.log(`✅ Waypoint computation completed in ${processingTime.toFixed(1)}s: ${result.stopsCreated} stops, ${result.segmentsCreated} segments`);

      res.json({
        success: true,
        pipeline: {
          datasetId,
          stopsCreated: result.stopsCreated,
          segmentsCreated: result.segmentsCreated,
          processingTimeSeconds: Math.round(processingTime * 10) / 10,
          parameters: {
            minDwellMinutes,
            maxDistanceMeters
          }
        },
        message: `Waypoint computation completed: ${result.stopsCreated} stops and ${result.segmentsCreated} travel segments created`,
        next: "Use /api/analytics/run with date range to see accurate city jumps from waypoints"
      });

    } catch (error) {
      console.error(`❌ Waypoint computation failed:`, error);
      res.status(500).json({ 
        error: "Failed to compute waypoints",
        details: error instanceof Error ? error.message : "Unknown error"
      });
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

      // Step 1: SKIP centroid computation - we're using waypoints now
      console.log(`🚀 Step 2/4 - SKIPPING daily centroids (waypoint-based analytics)`);
      let centroidsCreated = 0;
      
      try {
        // Check if we have datasets (basic validation)
        const datasets = await storage.getUserLocationDatasets(userId);
        
        if (datasets.length === 0) {
          return res.status(400).json({
            error: "No location datasets found. Please upload location data first."
          });
        }

        console.log(`✅ SKIPPED: Centroid computation (using waypoint-based analytics instead)`);
      } catch (error) {
        console.error(`❌ Failed to check datasets for user ${userId}:`, error);
        return res.status(500).json({
          error: "Failed to check user datasets",
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
        // Get ALL daily centroids (geocoded + ungeocoded) for complete travel distance calculation
        const geocodedCentroids = await storage.getGeocodedDailyCentroidsByDateRange(userId, startDate, endDate);
        const ungeocodedCentroids = await storage.getUngeocodedDailyCentroidsByDateRange(userId, startDate, endDate);
        
        // Combine all centroids for complete travel chain analysis
        const allCentroids = [...geocodedCentroids, ...ungeocodedCentroids];
        
        // Calculate expected total days in the date range (fixed off-by-one error)
        const totalDaysInRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
        
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
              cityJumps: {
                cityJumps: [],
                totalTravelDistance: 0,
                totalJumps: 0
              },
              curatedPlaces: [],
              dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0]
              },
              note: ungeocodedCount > 0 ? `${ungeocodedCount} locations are being geocoded in the background. Re-run analytics in a few minutes for complete data.` : undefined
            }
          });
        }

        // Group locations by country/state/city and calculate city jumps
        const locationStats = {
          countries: new Map<string, number>(),
          states: new Map<string, number>(),
          cities: new Map<string, number>()
        };

        // Sort ALL centroids chronologically for complete travel chain analysis
        const sortedCentroids = allCentroids.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // Use only geocoded centroids for city/state/country statistics
        const sortedGeocodedCentroids = geocodedCentroids.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // Calculate country, state, and city statistics (only from geocoded centroids)
        sortedGeocodedCentroids.forEach(centroid => {
          if (centroid.country) {
            locationStats.countries.set(centroid.country, (locationStats.countries.get(centroid.country) || 0) + 1);
          }
          
          if (centroid.state && centroid.country === 'United States') {
            locationStats.states.set(centroid.state, (locationStats.states.get(centroid.state) || 0) + 1);
          }
          
          if (centroid.city) {
            // Create city key with state/country for disambiguation
            const cityKey = centroid.state ? `${centroid.city}, ${centroid.state}` : `${centroid.city}, ${centroid.country}`;
            locationStats.cities.set(cityKey, (locationStats.cities.get(cityKey) || 0) + 1);
          }
        });

        // ========== WAYPOINT-BASED CITY JUMPS (REPLACES CENTROID APPROACH) ==========
        // Get accurate city jumps from actual travel stops and segments
        let waypointCityJumps = await storage.getWaypointCityJumpsByDateRange(userId, startDate, endDate);
        
        // NEW: Use date-range-first waypoint computation (replaces dataset-wide processing)
        if (waypointCityJumps.length === 0) {
          console.log(`🔄 No waypoints found for date range - computing using NEW date-range-first approach...`);
          
          // Get user's datasets and compute waypoints for ONLY the selected date range
          const datasets = await storage.getUserLocationDatasets(userId);
          if (datasets.length > 0) {
            const primaryDataset = datasets[0]; // Use first dataset
            try {
              // Use NEW date-range-bounded computation (processes only selected range)
              const waypointResult = await storage.computeWaypointAnalyticsByDateRange(
                userId, 
                primaryDataset.id, 
                startDate, 
                endDate
              );
              console.log(`✅ Auto-computed waypoints for DATE RANGE: ${waypointResult.stopsCreated} stops, ${waypointResult.segmentsCreated} segments`);
              
              // Re-fetch waypoint city jumps after computation
              waypointCityJumps = await storage.getWaypointCityJumpsByDateRange(userId, startDate, endDate);
              console.log(`🎯 Found ${waypointCityJumps.length} city jumps after date-range computation`);
            } catch (waypointError) {
              console.error(`❌ Failed to compute waypoints for date range:`, waypointError);
              // Fall back to empty results
              waypointCityJumps = [];
            }
          }
        }
        
        // Calculate total travel distance from waypoint segments (preserves accuracy)
        const totalTravelDistance = waypointCityJumps.reduce((sum, jump) => sum + jump.distance, 0);

        // Prepare city jumps data with waypoint-based results
        const cityJumpsData = {
          cityJumps: waypointCityJumps,
          totalTravelDistance: Math.round(totalTravelDistance * 10) / 10,
          totalJumps: waypointCityJumps.length
        };

        console.log(`🎯 Waypoint Analytics: ${waypointCityJumps.length} city jumps, ${Math.round(totalTravelDistance)} miles total travel`);

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
            cityJumps: cityJumpsData,
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
      
      // Calculate expected total days in the date range (fixed off-by-one error)
      const totalDaysInRange = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
      
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