// Routes with Replit Auth integration and user-specific location data
import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import fs from 'fs';
import path from 'path';
import { storage } from "./storage";
import { db } from "./db";
import { yearlyReportCache, users, pageVisits, visitorStats, insertPageVisitSchema, type PageVisit, type VisitorStats } from "@shared/schema";
import { eq, and, or, sql, gte } from "drizzle-orm";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { parseGoogleLocationHistory, validateGoogleLocationHistory } from "./googleLocationParser";
import { indexGoogleLocationFile, type LocationFileIndex } from "./googleLocationIndexer";
import { buildParentIndex, processTimelinePathsForDateRange, type TimelinePathPoint } from "./timelineAssociation";
import crypto from 'crypto';

// Configure uploads directory (supports persistent disk)
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log(`📁 Created uploads directory: ${UPLOADS_DIR}`);
}

// New function to generate travel stops directly from timeline GPS data
function generateTravelStopsFromTimelinePoints(
  timelinePoints: TimelinePathPoint[], 
  datasetId: string,
  minDwellMinutes: number = 8,
  maxDistanceMeters: number = 300
): any[] {
  if (timelinePoints.length === 0) return [];
  
  console.log(`🔍 Clustering ${timelinePoints.length} timeline GPS points into travel stops (min dwell: ${minDwellMinutes}min, max distance: ${maxDistanceMeters}m)`);
  
  // Sort points by timestamp
  const sortedPoints = timelinePoints.sort((a, b) => a.timestampMs - b.timestampMs);
  
  const stops: any[] = [];
  let currentCluster: TimelinePathPoint[] = [];
  
  // Helper function to calculate distance in meters
  const calculateDistanceMeters = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };
  
  for (let i = 0; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];
    
    if (currentCluster.length === 0) {
      currentCluster = [point];
      continue;
    }
    
    // Use first point in cluster as stable reference (not moving centroid)
    const clusterOrigin = currentCluster[0];
    const distanceToCluster = calculateDistanceMeters(
      point.latitude, point.longitude,
      clusterOrigin.latitude, clusterOrigin.longitude
    );
    
    if (distanceToCluster <= maxDistanceMeters) {
      currentCluster.push(point);
    } else {
      // Process current cluster if it meets dwell time requirement
      const dwellMs = currentCluster[currentCluster.length - 1].timestampMs - currentCluster[0].timestampMs;
      const dwellMinutes = dwellMs / (1000 * 60);
      
      if (dwellMinutes >= minDwellMinutes && currentCluster.length >= 2) {
        // Calculate cluster center
        const avgLat = currentCluster.reduce((sum, p) => sum + p.latitude, 0) / currentCluster.length;
        const avgLng = currentCluster.reduce((sum, p) => sum + p.longitude, 0) / currentCluster.length;
        
        const stop = {
          id: `timeline_stop_${stops.length}`,
          lat: avgLat,
          lng: avgLng,
          start: new Date(currentCluster[0].timestampMs).toISOString(),
          end: new Date(currentCluster[currentCluster.length - 1].timestampMs).toISOString(),
          city: null, // Will be geocoded later if needed
          state: null,
          country: null,
          geocoded: false,
          datasetId: datasetId,
          dwellMinutes: Math.round(dwellMinutes),
          pointCount: currentCluster.length
        };
        
        stops.push(stop);
      }
      
      // Start new cluster
      currentCluster = [point];
    }
  }
  
  // Process final cluster
  if (currentCluster.length >= 2) {
    const dwellMs = currentCluster[currentCluster.length - 1].timestampMs - currentCluster[0].timestampMs;
    const dwellMinutes = dwellMs / (1000 * 60);
    
    if (dwellMinutes >= minDwellMinutes) {
      const avgLat = currentCluster.reduce((sum, p) => sum + p.latitude, 0) / currentCluster.length;
      const avgLng = currentCluster.reduce((sum, p) => sum + p.longitude, 0) / currentCluster.length;
      
      const stop = {
        id: `timeline_stop_${stops.length}`,
        lat: avgLat,
        lng: avgLng,
        start: new Date(currentCluster[0].timestampMs).toISOString(),
        end: new Date(currentCluster[currentCluster.length - 1].timestampMs).toISOString(),
        city: null,
        state: null,
        country: null,
        geocoded: false,
        datasetId: datasetId,
        dwellMinutes: Math.round(dwellMinutes),
        pointCount: currentCluster.length
      };
      
      stops.push(stop);
    }
  }
  
  console.log(`✅ Generated ${stops.length} travel stops from timeline data`);
  return stops;
}
import { batchReverseGeocode, deduplicateCoordinates, getAllCachedLocations } from "./geocodingService";
import { mergeTimelineDatasets, generateMergePreview, mergePointsForDateRange, calculateContentHash, extractDateRange, type MergePreview } from "./jsonMerger";
import { cleanupAfterMerge, cleanupAfterReplace, checkForDuplicateFile, storeContentHash } from "./cleanupService";
import { parseVisitsActivitiesModern, selectDailySamples, resolveSamples, buildDailyPresence } from "./presenceDetection";
import { GoogleLocationIngest } from "./googleLocationIngest";
import { z } from "zod";
import OpenAI from "openai";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { registerSchema, loginSchema, changePasswordSchema, setPasswordSchema } from "@shared/schema";
import { sendContactFormEmail } from "./emailService";

// JWT verification middleware  
function verifyJWT(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  
  if (!token) {
    return res.status(401).json({ message: "Access token required" });
  }

  const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!jwtSecret) {
    console.error("JWT_SECRET not configured");
    return res.status(500).json({ message: "Server configuration error" });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as any;
    // Create compatible user structure for existing code
    req.user = {
      claims: {
        sub: decoded.id,
        email: decoded.email,
        first_name: decoded.firstName || '',
        last_name: decoded.lastName || '',
        isApproved: decoded.isApproved,
        role: decoded.role
      }
    };
    req.isAuthenticated = () => true;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}

// Combined authentication middleware - supports both JWT and Replit OAuth
function combinedAuth(req: any, res: any, next: any) {
  // Try JWT first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return verifyJWT(req, res, next);
  }
  
  // Fall back to existing Replit auth
  return isAuthenticated(req, res, next);
}

// Approval status middleware - requires approved account
async function requireApproval(req: any, res: any, next: any) {
  // Skip approval check for admin routes and auth routes
  if (req.path.startsWith('/api/admin') || req.path.startsWith('/api/auth')) {
    return next();
  }
  
  const user = req.user;
  if (!user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  try {
    // Always check current approval status from database (don't trust JWT claims)
    const userId = user.claims?.sub || user.claims?.id;
    if (!userId) {
      return res.status(401).json({ message: "Invalid user token" });
    }

    const [currentUser] = await db.select({
      isApproved: users.isApproved,
      approvalStatus: users.approvalStatus,
      role: users.role
    }).from(users).where(eq(users.id, userId)).limit(1);

    if (!currentUser) {
      return res.status(401).json({ message: "User not found" });
    }

    // Update user claims with current database values
    if (user.claims) {
      user.claims.isApproved = currentUser.isApproved;
      user.claims.role = currentUser.role;
    }

    // Check approval status from database
    if (!currentUser.isApproved || currentUser.approvalStatus !== 'approved') {
      return res.status(403).json({ 
        message: "Account access has been revoked or is pending approval. Please contact the administrator.",
        status: currentUser.approvalStatus || "pending_approval"
      });
    }
    
    next();
  } catch (error) {
    console.error("Error checking user approval status:", error);
    return res.status(500).json({ message: "Error verifying account status" });
  }
}

// Admin role middleware
function requireAdmin(req: any, res: any, next: any) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  
  // Check admin role from JWT claims or user object
  const isAdmin = user.claims?.role === 'admin' || user.role === 'admin';
  if (!isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  
  next();
}

// Combined middleware for approved users
const requireApprovedUser = [combinedAuth, requireApproval];

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

// OpenAI client setup for interesting places feature - lazy initialization
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key not configured. Set OPENAI_API_KEY environment variable.");
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// JSON Location History merging utility functions
function parseGoogleTimestamp(timestamp: string | any): Date {
  if (typeof timestamp === 'string') {
    return new Date(timestamp);
  }
  // Handle GoogleTimestamp format with timestampMs
  if (timestamp && timestamp.timestampMs) {
    return new Date(parseInt(timestamp.timestampMs));
  }
  return new Date(timestamp);
}

function mergeLocationHistoryFiles(existingData: any, newData: any): any {
  console.log('🔀 Starting JSON merge following specific merge algorithm...');
  
  // Step 1: Read the new file to make sure it is the right format
  const existingObjects = existingData.timelineObjects || [];
  const newObjects = newData.timelineObjects || [];
  
  console.log(`📊 Existing file: ${existingObjects.length} timeline objects`);
  console.log(`📊 New file: ${newObjects.length} timeline objects`);
  
  // Validate format - must have timelineObjects
  if (!Array.isArray(existingObjects) || !Array.isArray(newObjects)) {
    console.error('❌ Invalid format - both files must have timelineObjects array');
    return existingData; // Keep existing if new file is invalid
  }
  
  if (existingObjects.length === 0) {
    console.log('📁 No existing timeline objects - using new file as-is');
    return newData;
  }
  
  if (newObjects.length === 0) {
    console.log('⚠️ New file has no timeline objects - keeping existing data');
    return existingData;
  }
  
  // Helper function to extract timestamp from timeline objects (comprehensive)
  const getTimeFromObject = (obj: any): number => {
    try {
      // Check activitySegment format (duration fields)
      if (obj.activitySegment) {
        if (obj.activitySegment.duration?.startTimestampMs) {
          return parseInt(obj.activitySegment.duration.startTimestampMs);
        }
        if (obj.activitySegment.duration?.endTimestampMs) {
          return parseInt(obj.activitySegment.duration.endTimestampMs);
        }
        const startTime = obj.activitySegment.startTime || obj.activitySegment.endTime;
        if (startTime) return new Date(startTime).getTime();
      }
      
      // Check placeVisit format (duration fields)
      if (obj.placeVisit) {
        if (obj.placeVisit.duration?.startTimestampMs) {
          return parseInt(obj.placeVisit.duration.startTimestampMs);
        }
        if (obj.placeVisit.duration?.endTimestampMs) {
          return parseInt(obj.placeVisit.duration.endTimestampMs);
        }
        if (obj.placeVisit.duration) {
          const startTime = obj.placeVisit.duration.startTimestamp || obj.placeVisit.duration.endTimestamp;
          if (startTime) return new Date(startTime).getTime();
        }
      }
      
      // Check timelinePath format
      if (obj.timelinePath && obj.startTime) {
        return new Date(obj.startTime).getTime();
      }
      
      // Check top-level timestamps
      if (obj.startTime) return new Date(obj.startTime).getTime();
      if (obj.endTime) return new Date(obj.endTime).getTime();
      if (obj.timestampMs) return parseInt(obj.timestampMs);
      
      return 0;
    } catch (error) {
      return 0;
    }
  };
  
  // Step 2: Find the last date in the existing file, and compare to the first date in the new file
  const existingTimes = existingObjects.map(getTimeFromObject).filter(t => t > 0);
  const newTimes = newObjects.map(getTimeFromObject).filter(t => t > 0);
  
  if (existingTimes.length === 0 || newTimes.length === 0) {
    console.log('⚠️ Could not extract dates for comparison - using simple concatenation');
    return {
      timelineObjects: [...existingObjects, ...newObjects]
    };
  }
  
  const lastExistingTime = Math.max(...existingTimes);
  const firstNewTime = Math.min(...newTimes);
  
  console.log(`📅 Last existing date: ${new Date(lastExistingTime).toISOString()}`);
  console.log(`📅 First new date: ${new Date(firstNewTime).toISOString()}`);
  
  // Step 3: Filter new objects to only those that come AFTER the last existing time (all types together)
  const newObjectsToAdd = newObjects.filter(obj => {
    const objTime = getTimeFromObject(obj);
    return objTime > lastExistingTime; // Only add objects after last existing timestamp
  });
  
  console.log(`📊 Existing objects: ${existingObjects.length} total`);
  console.log(`📊 New objects to add: ${newObjectsToAdd.length} (after ${new Date(lastExistingTime).toISOString()})`);
  
  // Step 4: If no new objects to add, return existing data unchanged
  if (newObjectsToAdd.length === 0) {
    console.log('⚠️ No new data after last existing timestamp - keeping existing data unchanged');
    return existingData;
  }
  
  // Step 5: Sort new objects chronologically and append to existing (preserves existing order, adds new in chronological order)
  const sortedNewObjects = newObjectsToAdd.sort((a, b) => getTimeFromObject(a) - getTimeFromObject(b));
  
  // Maintain chronological order: existing objects (in original order) + new objects (sorted chronologically)
  const allObjects = [
    ...existingObjects,     // Keep all existing objects in original order
    ...sortedNewObjects     // Append new objects in chronological order
  ];
  
  // Step 5: Create a new json file we can parse
  const mergedFile = {
    timelineObjects: allObjects
  };
  
  console.log(`✅ Merge complete: ${allObjects.length} total timeline objects in chronological order`);
  console.log(`📈 Date range: ${new Date(Math.min(...allObjects.map(getTimeFromObject).filter(t => t > 0))).toISOString()} to ${new Date(Math.max(...allObjects.map(getTimeFromObject).filter(t => t > 0))).toISOString()}`);
  
  return mergedFile;
}

// Google Places API helper for verified business information
async function searchGooglePlace(placeName: string, location: string): Promise<{
  website?: string;
  address?: string;
  rating?: number;
  userRatingsTotal?: number;
  placeId?: string;
  googleMapsUrl?: string;
} | null> {
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    console.warn("Google Places API key not configured - skipping place verification");
    return null;
  }

  try {
    const searchQuery = `${placeName} ${location}`;
    
    // Step 1: Find Place From Text to get place_id
    const findPlaceUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(searchQuery)}&inputtype=textquery&fields=place_id,name&key=${process.env.GOOGLE_PLACES_API_KEY}`;
    
    console.log(`🔍 Google Places Find Place query: "${searchQuery}"`);
    
    const findResponse = await fetch(findPlaceUrl);
    
    if (!findResponse.ok) {
      throw new Error(`Google Places Find Place API returned ${findResponse.status}: ${findResponse.statusText}`);
    }
    
    const findData = await findResponse.json();
    
    if (findData.status === 'OVER_QUERY_LIMIT') {
      console.warn(`Google Places API quota exceeded for "${searchQuery}"`);
      return null;
    }
    
    if (findData.status !== 'OK') {
      console.warn(`Google Places Find Place status: ${findData.status} for query "${searchQuery}"`);
      return null;
    }
    
    if (!findData.candidates || findData.candidates.length === 0) {
      console.log(`No Google Places results for "${searchQuery}"`);
      return null;
    }
    
    const placeId = findData.candidates[0].place_id;
    
    // Step 2: Get Place Details to retrieve website and other information
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website,formatted_address,rating,user_ratings_total,url,international_phone_number&key=${process.env.GOOGLE_PLACES_API_KEY}`;
    
    console.log(`🔍 Getting place details for place_id: ${placeId}`);
    
    const detailsResponse = await fetch(detailsUrl);
    
    if (!detailsResponse.ok) {
      throw new Error(`Google Places Details API returned ${detailsResponse.status}: ${detailsResponse.statusText}`);
    }
    
    const detailsData = await detailsResponse.json();
    
    if (detailsData.status !== 'OK') {
      console.warn(`Google Places Details status: ${detailsData.status} for place_id: ${placeId}`);
      return null;
    }
    
    const place = detailsData.result;
    
    return {
      website: place.website,
      address: place.formatted_address,
      rating: place.rating,
      userRatingsTotal: place.user_ratings_total,
      placeId: placeId,
      googleMapsUrl: place.url // Google Maps URL as fallback when no website
    };
    
  } catch (error) {
    console.error(`Error searching Google Places for "${placeName}":`, error);
    return null;
  }
}

// URL validation helper to filter out dead links and parking pages
async function validateBusinessUrls(places: Array<{description: string, location: string, websiteUrl: string}>): Promise<Array<{description: string, location: string, websiteUrl: string}>> {
  const validPlaces = [];
  
  for (const place of places) {
    try {
      
      // Quick HEAD request with longer timeout for slow business websites
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
      
      const response = await fetch(place.websiteUrl, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LocationAnalyzer/1.0)'
        }
      });
      
      clearTimeout(timeoutId);
      
      // Check for successful response
      if (response.ok && response.status < 400) {
        // Check if it's likely a real website (not a parking page)
        const contentType = response.headers.get('content-type') || '';
        const isHtml = contentType.includes('text/html');
        
        // Additional check: avoid common parking page indicators
        const url = response.url.toLowerCase();
        const isParkingPage = url.includes('godaddy') || 
                             url.includes('parked') || 
                             url.includes('forsale') || 
                             url.includes('domains') ||
                             url.includes('sedo.com');
        
        if (isHtml && !isParkingPage) {
          console.log(`✅ Valid URL: ${place.websiteUrl}`);
          validPlaces.push(place);
        } else {
          console.log(`❌ Parking page detected: ${place.websiteUrl}`);
        }
      } else {
        console.log(`❌ HTTP error ${response.status}: ${place.websiteUrl}`);
      }
      
    } catch (error) {
      // More selective about keeping failed URLs - many could be AI hallucinations
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const url = place.websiteUrl.toLowerCase();
      
      // Check if it looks like a made-up domain pattern
      const likelyFakePatterns = [
        /www\.\w+festival\.com$/,  // www.eventnamefestival.com
        /www\.\w+wine\w*\.com$/,   // www.camporealewinefestival.com
        /www\.\w+event\w*\.com$/,  // www.eventname.com
        /\w+\.\w+\.\w+\.\w+/       // too many subdomains
      ];
      
      const looksLikeFakeDomain = likelyFakePatterns.some(pattern => pattern.test(url));
      
      if (looksLikeFakeDomain) {
      } else if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
        validPlaces.push(place); // Keep it - probably just slow loading
      } else {
        console.log(`❌ URL validation failed: ${place.websiteUrl} - ${errorMsg}`);
      }
    }
  }
  
  return validPlaces;
}

// OpenAI curation removed for performance - analytics now return in under 2 seconds

// Configure multer for file uploads using disk storage to avoid memory issues
const upload = multer({ 
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
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

// Helper functions for yearly state/country report - optimized sampling approach

// Sample points by day to optimize geocoding (take 2-4 representative points per day)
function samplePointsByDay(points: any[], samplesPerDay: number = 4): any[] {
  // Group points by date
  const pointsByDate: { [date: string]: any[] } = {};
  
  points.forEach(point => {
    // Use local date components to avoid timezone shifts (matches frontend conventions)
    const date = `${point.timestamp.getFullYear()}-${String(point.timestamp.getMonth() + 1).padStart(2, '0')}-${String(point.timestamp.getDate()).padStart(2, '0')}`;
    if (!pointsByDate[date]) {
      pointsByDate[date] = [];
    }
    pointsByDate[date].push(point);
  });

  const sampledPoints: any[] = [];
  
  Object.entries(pointsByDate).forEach(([date, dayPoints]) => {
    if (dayPoints.length <= samplesPerDay) {
      // If we have fewer points than desired samples, take all
      sampledPoints.push(...dayPoints);
    } else {
      // Sample evenly throughout the day
      const interval = Math.floor(dayPoints.length / samplesPerDay);
      for (let i = 0; i < samplesPerDay; i++) {
        const index = i * interval;
        if (index < dayPoints.length) {
          sampledPoints.push(dayPoints[index]);
        }
      }
    }
  });

  return sampledPoints;
}

// Geocode only the sampled points using our existing geocoding service
async function geocodeSampledPoints(points: any[]): Promise<any[]> {
  if (points.length === 0) return [];

  // Prepare coordinates for geocoding
  const coordinates = points.map(point => ({ lat: point.lat, lng: point.lng }));
  
  // Use our existing batch geocoding service
  const geocodeResults = await batchReverseGeocode(coordinates);
  
  // Combine points with geocoding results (batchReverseGeocode returns BatchGeocodeResult with .results array)
  const geocodedPoints = points.map((point, index) => ({
    ...point,
    ...geocodeResults.results[index] // Add city, state, country from geocoding
  }));

  return geocodedPoints;
}

// Group geocoded samples by day and determine primary location
function groupSamplesByDay(geocodedPoints: any[]): { [date: string]: { state?: string; country: string; pointCount: number } } {
  const dailyLocations: { [date: string]: { state?: string; country: string; pointCount: number } } = {};
  
  // Group by date
  const pointsByDate: { [date: string]: any[] } = {};
  geocodedPoints.forEach(point => {
    // Use local date components to avoid timezone shifts (matches frontend conventions)
    const date = `${point.timestamp.getFullYear()}-${String(point.timestamp.getMonth() + 1).padStart(2, '0')}-${String(point.timestamp.getDate()).padStart(2, '0')}`;
    if (!pointsByDate[date]) {
      pointsByDate[date] = [];
    }
    pointsByDate[date].push(point);
  });

  // Determine primary location for each day
  Object.entries(pointsByDate).forEach(([date, dayPoints]) => {
    // Count frequency of each state/country combination
    const locationCounts: { [key: string]: { state?: string; country: string; count: number } } = {};
    
    dayPoints.forEach(point => {
      if (point.country) { // Only count points with geocoded data
        const key = `${point.state || 'NO_STATE'}_${point.country}`;
        if (!locationCounts[key]) {
          locationCounts[key] = { state: point.state, country: point.country, count: 0 };
        }
        locationCounts[key].count++;
      }
    });

    // Find the most frequent location for this day
    let primaryLocation = Object.values(locationCounts).reduce((max, current) => 
      current.count > max.count ? current : max, { count: 0, country: 'Unknown' });

    if (primaryLocation.count > 0) {
      dailyLocations[date] = {
        state: primaryLocation.state,
        country: primaryLocation.country,
        pointCount: dayPoints.length
      };
    }
  });

  return dailyLocations;
}

// Aggregate daily locations into state/country statistics with percentages
function aggregateStateCountryStats(dailyLocations: { [date: string]: { state?: string; country: string; pointCount: number } }, year: number): Array<{ 
  location: string; 
  days: number; 
  percentage: number; 
  type: 'us_state' | 'country' 
}> {
  const locationCounts: { [location: string]: { days: number; type: 'us_state' | 'country' } } = {};
  const totalDays = Object.keys(dailyLocations).length;

  // Count days for each state/country
  Object.values(dailyLocations).forEach(dayLocation => {
    if (dayLocation.state && dayLocation.country === 'United States') {
      // US state
      const location = dayLocation.state;
      if (!locationCounts[location]) {
        locationCounts[location] = { days: 0, type: 'us_state' };
      }
      locationCounts[location].days++;
    } else {
      // Non-US country
      const location = dayLocation.country;
      if (!locationCounts[location]) {
        locationCounts[location] = { days: 0, type: 'country' };
      }
      locationCounts[location].days++;
    }
  });

  // Convert to array with percentages and sort by days (descending)
  const results = Object.entries(locationCounts).map(([location, data]) => ({
    location,
    days: data.days,
    percentage: Math.round((data.days / totalDays) * 100 * 10) / 10, // Round to 1 decimal
    type: data.type
  }));

  // Sort by days spent (descending)
  results.sort((a, b) => b.days - a.days);

  return results;
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
      const geocodeResult = geocodeResults.results[i];
      
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
          const geocodeResult = geocodeResults.results[i];
          
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
          const geocodeResult = geocodeResults.results[i];
          
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

// Helper function to process timeline objects consistently
function processTimelineObjects(
  objects: any[], 
  sampleSize: number, 
  counters: {
    estimatedPoints: number;
    totalTimelinePath: number;
    badProbability: number;
    goodProbability: number;
    zeroDistance: number;
    goodDistance: number;
    badAccuracy: number;
    activityCounts: Record<string, number>;
    minTimestamp: Date | null;
    maxTimestamp: Date | null;
  }
) {
  const step = Math.ceil(objects.length / Math.min(objects.length, sampleSize));
  let processed = 0;
  
  for (let i = 0; i < objects.length; i += step) {
    const obj = objects[i];
    processed++;
    
    // Update date range helper
    const updateDateRange = (timestamp: Date) => {
      if (!counters.minTimestamp || timestamp < counters.minTimestamp) counters.minTimestamp = timestamp;
      if (!counters.maxTimestamp || timestamp > counters.maxTimestamp) counters.maxTimestamp = timestamp;
    };
    
    if (obj.activitySegment) {
      const segment = obj.activitySegment;
      counters.estimatedPoints++;
      
      if (segment.duration?.startTimestampMs) {
        updateDateRange(new Date(parseInt(segment.duration.startTimestampMs, 10)));
      }
      
      const activityType = segment.activityType?.toLowerCase() || 'unknown';
      counters.activityCounts[activityType] = (counters.activityCounts[activityType] || 0) + 1;
      
      const distance = parseFloat(segment.distance || '1.0');
      if (distance <= 1.0) counters.zeroDistance++; else counters.goodDistance++;
      
      if (segment.waypointPath?.waypoints) {
        counters.totalTimelinePath += segment.waypointPath.waypoints.length || 0;
      }
    }
    
    if (obj.placeVisit) {
      const visit = obj.placeVisit;
      counters.estimatedPoints++;
      counters.activityCounts['still'] = (counters.activityCounts['still'] || 0) + 1;
      
      if (visit.duration?.startTimestampMs) {
        updateDateRange(new Date(parseInt(visit.duration.startTimestampMs, 10)));
      }
    }
  }
  
  // Scale results based on sample size
  const scaleFactor = objects.length / processed;
  counters.estimatedPoints = Math.round(counters.estimatedPoints * scaleFactor);
  counters.totalTimelinePath = Math.round(counters.totalTimelinePath * scaleFactor);
  counters.zeroDistance = Math.round(counters.zeroDistance * scaleFactor);
  counters.goodDistance = Math.round(counters.goodDistance * scaleFactor);
  
  return scaleFactor;
}

// Fast streaming date scanner - extracts ONLY start/end dates without parsing JSON
async function scanDateRangeFromFile(filePath: string): Promise<{ startDate: string; endDate: string; sizeBytes: number }> {
  const fs = await import('fs');
  const { stat } = await import('fs/promises');
  
  console.log('⚡ Scanning file for date range using streaming approach...');
  
  let minMs: number | null = null;
  let maxMs: number | null = null;
  let buffer = '';
  
  // Timestamp extraction patterns - comprehensive coverage for all Google Location History formats
  const patterns = [
    /"timestampMs"\s*:\s*"(\d{10,})"/g,           // Numeric milliseconds
    /"startTimestampMs"\s*:\s*"(\d{10,})"/g,      // Semantic Location History start (CRITICAL)
    /"endTimestampMs"\s*:\s*"(\d{10,})"/g,        // Semantic Location History end (CRITICAL)
    /"startTimestamp"\s*:\s*"([^"]+)"/g,          // ISO start timestamps  
    /"endTimestamp"\s*:\s*"([^"]+)"/g,            // ISO end timestamps
    /"timestamp"\s*:\s*"([^"]+)"/g,               // Generic ISO timestamp
    /"time"\s*:\s*"([^"]+)"/g,                    // Legacy time
    /"startTime"\s*:\s*"([^"]+)"/g,               // Segment start time
    /"endTime"\s*:\s*"([^"]+)"/g                  // Segment end time
  ];
  
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
    
    stream.on('data', (chunk: string) => {
      // Combine with previous buffer to handle boundaries
      const text = buffer + chunk;
      
      // Extract timestamps using all patterns
      for (const pattern of patterns) {
        let match;
        pattern.lastIndex = 0; // Reset regex
        
        while ((match = pattern.exec(text)) !== null) {
          const timestampStr = match[1];
          let ms: number;
          
          // Parse based on format
          if (/^\d{10,}$/.test(timestampStr)) {
            // Numeric milliseconds
            ms = parseInt(timestampStr, 10);
          } else {
            // ISO timestamp - proper timezone detection (not fooled by date separators)
            const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestampStr);
            const isoStr = hasTimezone ? timestampStr : timestampStr + 'Z';
            ms = Date.parse(isoStr);
          }
          
          if (!isNaN(ms) && ms > 0) {
            if (minMs === null || ms < minMs) minMs = ms;
            if (maxMs === null || ms > maxMs) maxMs = ms;
          }
        }
      }
      
      // Keep last 1024 chars to handle boundary splits safely
      buffer = text.slice(-1024);
    });
    
    stream.on('end', async () => {
      try {
        const stats = await stat(filePath);
        
        if (minMs === null || maxMs === null) {
          reject(new Error('No valid timestamps found in file'));
          return;
        }
        
        // Convert to UTC dates and format as YYYY-MM-DD
        const startUTC = new Date(minMs);
        const endUTC = new Date(maxMs);
        
        const startDate = `${startUTC.getUTCFullYear()}-${String(startUTC.getUTCMonth() + 1).padStart(2, '0')}-${String(startUTC.getUTCDate()).padStart(2, '0')}`;
        const endDate = `${endUTC.getUTCFullYear()}-${String(endUTC.getUTCMonth() + 1).padStart(2, '0')}-${String(endUTC.getUTCDate()).padStart(2, '0')}`;
        
        console.log(`⚡ Fast scan complete: ${startDate} to ${endDate} (${Math.round(stats.size / 1024 / 1024)}MB)`);
        
        resolve({
          startDate,
          endDate,
          sizeBytes: stats.size
        });
      } catch (error) {
        reject(error);
      }
    });
    
    stream.on('error', reject);
  });
}

// Quick metadata extraction for smart upload - supports ALL formats (LEGACY - for small files only)
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
  
  // ARRAY FORMAT - Check for nested timeline objects first
  if (Array.isArray(jsonData)) {
    const sampleSize = Math.min(jsonData.length, 100);
    const step = Math.ceil(jsonData.length / sampleSize);
    
    // First pass: detect actual Google Location History format
    // Activity/Visit elements (first section) vs TimelinePath elements (second section)
    let hasActivityVisit = false;  // First section - for yearly reports
    let hasTimelinePath = false;   // Second section - for mapping/analysis (CRITICAL)
    
    // Sample from beginning (activity/visit) and end (timelinePath) of array
    // TimelinePath data comes AFTER activity/visit, not mixed by date
    const beginSample = Math.min(1000, jsonData.length);
    const endSample = Math.max(jsonData.length - 5000, Math.floor(jsonData.length * 0.5)); // Check last half more thoroughly
    
    // Check beginning for activity/visit
    for (let i = 0; i < Math.min(beginSample, 5000); i += step) {
      const element = jsonData[i];
      if (element?.activity || element?.visit) {
        hasActivityVisit = true;
      }
    }
    
    // Check end portion more thoroughly for activitySegment data (where mapping data actually lives)
    console.log(`🔍 Checking for activitySegment from index ${endSample} to ${jsonData.length}`);
    for (let i = endSample; i < jsonData.length; i++) {
      const element = jsonData[i];
      if (element?.activitySegment?.simplifiedRawPath?.points && Array.isArray(element.activitySegment.simplifiedRawPath.points)) {
        console.log(`✅ Found activitySegment.simplifiedRawPath at index ${i} with ${element.activitySegment.simplifiedRawPath.points.length} points`);
        hasTimelinePath = true;
        break; // Found one, that's enough
      }
      if (element?.activitySegment?.waypointPath?.waypoints && Array.isArray(element.activitySegment.waypointPath.waypoints)) {
        console.log(`✅ Found activitySegment.waypointPath at index ${i} with ${element.activitySegment.waypointPath.waypoints.length} waypoints`);
        hasTimelinePath = true;
        break; // Found one, that's enough
      }
      // Legacy fallback
      if (element?.timelinePath?.point && Array.isArray(element.timelinePath.point)) {
        console.log(`✅ Found legacy timelinePath at index ${i} with ${element.timelinePath.point.length} points`);
        hasTimelinePath = true;
        break; // Found one, that's enough
      }
    }
    
    console.log(`🔍 Google Location History format detected: activity/visit=${hasActivityVisit}, timelinePath=${hasTimelinePath} (mapping data)`);
    
    // Initialize counters object for helper function
    const counters = {
      estimatedPoints,
      totalTimelinePath,
      badProbability,
      goodProbability,
      zeroDistance,
      goodDistance,
      badAccuracy,
      activityCounts,
      minTimestamp,
      maxTimestamp
    };
    
    // Process ACTUAL Google Location History format
    if (hasActivityVisit || hasTimelinePath) {
      // GOOGLE LOCATION HISTORY: Two-section format
      const processingSampleSize = Math.min(jsonData.length, 1000);
      const processingStep = Math.ceil(jsonData.length / processingSampleSize);
      
      for (let i = 0; i < jsonData.length; i += processingStep) {
        const element = jsonData[i];
        totalElements++;
        
        // Handle activity/visit elements (first section - yearly reports)
        if (element?.activity || element?.visit) {
          estimatedPoints++;
          const timestamp = extractTimestamp(element);
          if (timestamp) updateDateRange(timestamp);
          
          if (element.activity) {
            const activityType = element.activity.topCandidate?.type?.toLowerCase() || 'unknown';
            activityCounts[activityType] = (activityCounts[activityType] || 0) + 1;
          } else {
            activityCounts['still'] = (activityCounts['still'] || 0) + 1;
          }
        }
        
        // Handle modern GPS route data (where Google actually stores route points now)
        else if (element?.activitySegment) {
          // Count GPS route points from simplifiedRawPath.points (primary source)
          if (element.activitySegment.simplifiedRawPath?.points && Array.isArray(element.activitySegment.simplifiedRawPath.points)) {
            const points = element.activitySegment.simplifiedRawPath.points;
            totalTimelinePath += points.length;
            estimatedPoints += points.length;
            
            // Extract timestamps from points for date range
            points.slice(0, 10).forEach(point => { // Sample first 10 points
              if (point?.timestampMs) {
                const timestamp = new Date(parseInt(point.timestampMs));
                updateDateRange(timestamp);
              }
            });
            
            activityCounts['route'] = (activityCounts['route'] || 0) + points.length;
          }
          
          // Count GPS route points from waypointPath.waypoints (additional source)
          if (element.activitySegment.waypointPath?.waypoints && Array.isArray(element.activitySegment.waypointPath.waypoints)) {
            const waypoints = element.activitySegment.waypointPath.waypoints;
            totalTimelinePath += waypoints.length;
            estimatedPoints += waypoints.length;
            
            activityCounts['route'] = (activityCounts['route'] || 0) + waypoints.length;
          }
          
          // Extract duration for date range
          if (element.activitySegment.duration?.startTimestamp) {
            const timestamp = new Date(element.activitySegment.duration.startTimestamp);
            updateDateRange(timestamp);
          }
        }
        
        // Handle timelinePath as array (mobile format - what you actually have!)
        else if (Array.isArray(element?.timelinePath)) {
          const timelineArray = element.timelinePath;
          totalTimelinePath += timelineArray.length;
          estimatedPoints += timelineArray.length;
          
          // Extract timestamps from timeline entries for date range
          timelineArray.slice(0, 10).forEach(entry => { // Sample first 10 entries
            if (element.startTime && entry.durationMinutesOffsetFromStartTime) {
              const startTime = new Date(element.startTime);
              const timestamp = new Date(startTime.getTime() + entry.durationMinutesOffsetFromStartTime * 60000);
              updateDateRange(timestamp);
            }
          });
          
          activityCounts['route'] = (activityCounts['route'] || 0) + timelineArray.length;
        }
        
        // Handle legacy timelinePath.point structure (older exports)  
        else if (element?.timelinePath?.point && Array.isArray(element.timelinePath.point)) {
          const points = element.timelinePath.point;
          totalTimelinePath += points.length;
          estimatedPoints += points.length;
          
          // Extract timestamps from points for date range
          points.slice(0, 10).forEach(point => { // Sample first 10 points
            if (point?.time) {
              const timestamp = new Date(point.time);
              updateDateRange(timestamp);
            }
          });
          
          activityCounts['route'] = (activityCounts['route'] || 0) + points.length;
        }
        
        // IGNORE placeVisit - those are for yearly state reports only
      }
      
      const scaleFactor = jsonData.length / (totalElements || 1);
      estimatedPoints = Math.round(estimatedPoints * scaleFactor);
      totalTimelinePath = Math.round(totalTimelinePath * scaleFactor);
      
      totalElements = jsonData.length;
    } else {
      // MOBILE LEGACY FORMAT: element.activity, element.visit
      const mobileSampleSize = Math.min(jsonData.length, 1000);
      const mobileStep = Math.ceil(jsonData.length / mobileSampleSize);
      
      for (let i = 0; i < jsonData.length; i += mobileStep) {
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
    
    // Extract values from counters object
    estimatedPoints = counters.estimatedPoints;
    totalTimelinePath = counters.totalTimelinePath;
    badProbability = counters.badProbability;
    goodProbability = counters.goodProbability;
    zeroDistance = counters.zeroDistance;
    goodDistance = counters.goodDistance;
    badAccuracy = counters.badAccuracy;
    minTimestamp = counters.minTimestamp;
    maxTimestamp = counters.maxTimestamp;
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

  // Auth routes - Username/password authentication
  
  // Register endpoint
  app.post('/api/auth/register', async (req, res) => {
    try {
      const validation = registerSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: validation.error.issues 
        });
      }

      const { username, email, password, firstName, lastName } = validation.data;

      // Check if user already exists (prevent user enumeration)
      const existingUser = await db.select().from(users).where(eq(users.username, username)).limit(1);
      const existingEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
      
      if (existingUser.length > 0 || existingEmail.length > 0) {
        return res.status(400).json({ message: "User with this username or email already exists" });
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const [newUser] = await db.insert(users).values({
        username,
        email,
        password: hashedPassword,
        firstName,
        lastName,
      }).returning();

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
      if (!jwtSecret) {
        console.error("JWT_SECRET not configured");
        return res.status(500).json({ message: "Server configuration error" });
      }
      
      const token = jwt.sign(
        { 
          id: newUser.id, 
          username: newUser.username, 
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          isApproved: newUser.isApproved,
          role: newUser.role
        },
        jwtSecret,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        message: "Registration successful. Account pending admin approval.",
        token,
        user: {
          id: newUser.id,
          username: newUser.username,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          isApproved: newUser.isApproved,
          approvalStatus: newUser.approvalStatus,
          role: newUser.role
        }
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Server error during registration" });
    }
  });

  // Login endpoint
  app.post('/api/auth/login', async (req, res) => {
    try {
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: validation.error.issues 
        });
      }

      const { username, password } = validation.data;

      // Find user by username OR email (username field can contain either)
      const [user] = await db.select().from(users).where(
        or(eq(users.username, username), eq(users.email, username))
      ).limit(1);
      if (!user || !user.password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Check password
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      // Generate JWT token
      const jwtSecret = process.env.JWT_SECRET || process.env.SESSION_SECRET;
      if (!jwtSecret) {
        console.error("JWT_SECRET not configured");
        return res.status(500).json({ message: "Server configuration error" });
      }
      
      const token = jwt.sign(
        { 
          id: user.id, 
          username: user.username, 
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isApproved: user.isApproved,
          role: user.role
        },
        jwtSecret,
        { expiresIn: '7d' }
      );

      res.json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isApproved: user.isApproved,
          approvalStatus: user.approvalStatus,
          role: user.role
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Server error during login" });
    }
  });

  // Change password endpoint
  app.post('/api/auth/change-password', combinedAuth, async (req, res) => {
    try {
      const validation = changePasswordSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: validation.error.issues 
        });
      }

      const { currentPassword, newPassword } = validation.data;
      const userId = req.user?.claims?.sub || req.user?.claims?.id;

      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get current user from database
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user has an existing password
      if (!user.password) {
        return res.status(400).json({ 
          message: "No password set for this account. Use the 'Set Password' option instead." 
        });
      }

      // Verify current password
      const validCurrentPassword = await bcrypt.compare(currentPassword, user.password);
      if (!validCurrentPassword) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      // Prevent using the same password
      const samePassword = await bcrypt.compare(newPassword, user.password);
      if (samePassword) {
        return res.status(400).json({ message: "New password must be different from current password" });
      }

      // Hash new password
      const saltRounds = 12;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password in database
      await db.update(users)
        .set({ 
          password: hashedNewPassword,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      res.json({
        message: "Password changed successfully"
      });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ message: "Server error during password change" });
    }
  });

  // Set password endpoint (for OAuth users who don't have passwords)
  app.post('/api/auth/set-password', combinedAuth, async (req, res) => {
    try {
      const validation = setPasswordSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Validation error", 
          errors: validation.error.issues 
        });
      }

      const { newPassword } = validation.data;
      const userId = req.user?.claims?.sub || req.user?.claims?.id;

      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Get current user from database
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user already has a password
      if (user.password) {
        return res.status(400).json({ 
          message: "Password already set for this account. Use the 'Change Password' option instead." 
        });
      }

      // Hash new password
      const saltRounds = 12;
      const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

      // Set password in database
      await db.update(users)
        .set({ 
          password: hashedNewPassword,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      res.json({
        message: "Password set successfully"
      });
    } catch (error) {
      console.error("Set password error:", error);
      res.status(500).json({ message: "Server error during password setup" });
    }
  });

  app.get('/api/auth/user', combinedAuth, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const user = await storage.getUser(claims.sub);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Return user data with role and approval information
      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        first_name: user.firstName, // Keep for backward compatibility
        last_name: user.lastName,   // Keep for backward compatibility
        role: user.role,
        isApproved: user.isApproved,
        approvalStatus: user.approvalStatus
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Check if user has password set
  app.get('/api/auth/has-password', combinedAuth, async (req, res) => {
    try {
      const userId = req.user?.claims?.sub || req.user?.claims?.id;
      if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const [user] = await db.select({
        hasPassword: sql<boolean>`CASE WHEN password IS NULL THEN false ELSE true END`
      }).from(users).where(eq(users.id, userId)).limit(1);

      res.json({
        hasPassword: user?.hasPassword || false
      });
    } catch (error) {
      console.error("Error checking password status:", error);
      res.status(500).json({ message: "Failed to check password status" });
    }
  });

  // Protected route: Quick index Google location history file (Phase 1)
  app.post("/api/index-location-history", requireApprovedUser, upload.single("file"), async (req: Request & { file?: Express.Multer.File }, res) => {
    const { claims } = getAuthenticatedUser(req);
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = claims.sub;
      const filePath = req.file.path;
      
      console.log(`📂 Indexing Google location file: ${req.file.originalname} (${req.file.size} bytes)`);
      
      // Read and parse the file
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
      } catch (parseError) {
        console.error("Error parsing JSON:", parseError);
        await fs.promises.unlink(filePath).catch(() => {}); // Clean up temp file
        return res.status(400).json({ error: "Invalid JSON file" });
      }
      
      // Normalize array-like objects with numeric keys back to arrays
      if (!Array.isArray(jsonData) && typeof jsonData === 'object' && jsonData) {
        const keys = Object.keys(jsonData);
        const isNumericKeyObject = keys.length > 0 && keys.every(key => !isNaN(Number(key)));
        
        if (isNumericKeyObject) {
          console.log(`🔧 Converting numeric-key object with ${keys.length} elements back to array`);
          const sortedKeys = keys.sort((a, b) => Number(a) - Number(b));
          jsonData = sortedKeys.map(key => jsonData[key]);
        }
      }
      
      // Quick indexing - extract structure and date ranges
      const index: LocationFileIndex = indexGoogleLocationFile(jsonData, req.file.size);
      
      // Validate that this file has usable data
      if (!index.structure.hasTimelinePath) {
        await fs.promises.unlink(filePath).catch(() => {}); // Clean up temp file
        return res.status(400).json({ 
          error: "File does not contain timelinePath data needed for mapping",
          analysis: index
        });
      }
      
      // Store file temporarily for potential processing later
      // In a real app, you might store this in cloud storage or keep the parsed JSON in memory/cache
      
      // Clean up temp file
      await fs.promises.unlink(filePath).catch(() => {});
      
      console.log(`✅ Index complete: ${index.structure.estimatedGpsPoints} GPS points from ${index.dateRange.startDate} to ${index.dateRange.endDate}`);
      
      res.json({
        success: true,
        analysis: index,
        message: `Found ${index.structure.totalTimelinePathObjects} timelinePath objects with ${index.structure.estimatedGpsPoints} GPS points`
      });
      
    } catch (error) {
      console.error("Error indexing location history:", error);
      res.status(500).json({ error: "Failed to index location history file" });
    }
  });

  // Protected route: Upload and parse Google location history (user-specific) 
  app.post("/api/upload-location-history", requireApprovedUser, upload.single("file"), async (req: Request & { file?: Express.Multer.File }, res) => {
    const { claims } = getAuthenticatedUser(req);
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const userId = claims.sub;
      const filePath = req.file.path; // Now using disk storage, we have a file path
      const uploadMode = req.body.mode || 'replace'; // Get merge/replace mode from form data
      
      // Read a small portion of the file for validation and metadata extraction
      let fileContent: string;
      try {
        fileContent = await fs.promises.readFile(filePath, 'utf8');
      } catch (readError) {
        console.error("Error reading uploaded file:", readError);
        await fs.promises.unlink(filePath).catch(() => {}); // Clean up temp file
        return res.status(400).json({ error: "Failed to read uploaded file" });
      }

      // 🔍 DUPLICATE PREVENTION: Check if this exact file has already been uploaded (EARLY CHECK)
      try {
        console.log(`🔍 Checking for duplicates: file size ${fileContent.length} chars`);
        const duplicateDatasetId = await checkForDuplicateFile(fileContent, userId);
        if (duplicateDatasetId) {
          console.log(`🚫 Duplicate file detected: matches existing dataset ${duplicateDatasetId}`);
          await fs.promises.unlink(filePath).catch(() => {}); // Clean up temp file
          return res.status(409).json({ 
            error: "This file has already been uploaded to your account",
            existingDatasetId: duplicateDatasetId,
            message: "The exact same file content already exists in your datasets. No upload needed."
          });
        } else {
          console.log(`✅ No duplicate found - proceeding with upload`);
        }
      } catch (duplicateCheckError) {
        console.warn('⚠️  Failed to check for duplicate file (continuing with upload):', duplicateCheckError);
      }
      
      let jsonData: any;
      
      try {
        jsonData = JSON.parse(fileContent);
        
        if (typeof jsonData === 'object') {
          const keys = Object.keys(jsonData);
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
                jsonData = { timelineObjects: arrayData };
              } else {
                jsonData = arrayData;
              }
            } else {
              jsonData = arrayData;
            }
          }
        }
        
        // Additional fix: If we have an array that looks like modern format, wrap it
        if (Array.isArray(jsonData) && jsonData.length > 0 && jsonData[0] && typeof jsonData[0] === 'object') {
          const firstItem = jsonData[0];
          if (firstItem.timelinePath || firstItem.activitySegment || firstItem.placeVisit) {
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


      // SMART UPLOAD: Use fast streaming scanner for large files, legacy analysis for small files
      const fileSizeMB = req.file.size / (1024 * 1024);
      let metadata;
      
      if (fileSizeMB > 10) {
        // Use fast streaming scanner for large files (no JSON parsing)
        console.log(`⚡ Using fast streaming scanner for large file (${fileSizeMB.toFixed(2)}MB)`);
        
        try {
          const scanResult = await scanDateRangeFromFile(filePath);
          metadata = {
            totalElements: Array.isArray(jsonData) ? jsonData.length : Object.keys(jsonData).length,
            estimatedPoints: 1000, // Placeholder - actual points determined by time-based association
            hasTimelinePath: true,  // Assume true for large files
            dateRange: {
              startDate: scanResult.startDate,
              endDate: scanResult.endDate
            },
            dataQuality: { goodProbability: 1000 }, // Placeholder for large files
            activityBreakdown: {} // Placeholder for large files
          };
        } catch (scanError) {
          console.error('Fast scan failed:', scanError);
          return res.status(400).json({ 
            error: `Failed to extract date range: ${scanError instanceof Error ? scanError.message : 'Unknown error'}` 
          });
        }
      } else {
        // Use legacy analysis for small files
        console.log('🔍 Using legacy metadata extraction for small file...');
        metadata = await extractQuickMetadata(jsonData);
        
        if (!metadata || metadata.totalElements === 0) {
          return res.status(400).json({ 
            error: "No location data found in the file" 
          });
        }
      }

      // Handle merge vs replace logic
      let dataset: any;
      let finalJsonData = jsonData;
      
      // Extract date ranges for feedback (used in both merge and replace modes)
      const newDataDateRange = extractDateRange(jsonData.timelineObjects || []);
      
      // Initialize merge statistics variables
      let originalCount = 0;
      let newCount = 0;
      let finalCount = 0;
      let addedObjects = 0;
      let duplicatesRemoved = 0;
      let existingDataDateRange: any = null;
      
      if (uploadMode === 'merge') {
        console.log('🔀 Merge mode selected - looking for existing dataset to merge with...');
        
        // Get user's existing datasets to merge with (use the most recent one)
        const existingDatasets = await storage.getUserLocationDatasets(userId);
        
        if (existingDatasets.length === 0) {
          return res.status(400).json({ 
            error: "No existing dataset found to merge with. Please upload your first file using 'Replace' mode." 
          });
        }
        
        const targetDataset = existingDatasets[0]; // Use most recent dataset
        dataset = targetDataset;
        
        console.log(`🎯 Target dataset for merge: ${targetDataset.id} (${targetDataset.filename})`);
        
        // Load existing raw data
        const existingRawContent = await storage.getRawFile(targetDataset.id, userId);
        if (!existingRawContent) {
          return res.status(400).json({ 
            error: "Could not load existing dataset content for merging" 
          });
        }
        
        // Parse existing data (handle FILE: prefix for large files)
        let existingJsonData: any;
        if (existingRawContent.startsWith('FILE:')) {
          const existingFilePath = existingRawContent.substring(5);
          try {
            const existingFileContent = await fs.promises.readFile(existingFilePath, 'utf8');
            existingJsonData = JSON.parse(existingFileContent);
          } catch (error) {
            return res.status(500).json({ 
              error: "Failed to read existing dataset file for merging" 
            });
          }
        } else {
          try {
            existingJsonData = JSON.parse(existingRawContent);
          } catch (error) {
            return res.status(500).json({ 
              error: "Failed to parse existing dataset content for merging" 
            });
          }
        }
        
        // Extract existing data date range for merge feedback
        const existingDataDateRange = extractDateRange(existingJsonData.timelineObjects || []);
        
        console.log(`📅 New data date range: ${newDataDateRange?.start || 'unknown'} to ${newDataDateRange?.end || 'unknown'}`);
        console.log(`📅 Existing data date range: ${existingDataDateRange?.start || 'unknown'} to ${existingDataDateRange?.end || 'unknown'}`);
        
        // Create a backup before merging
        const backupRawContent = existingRawContent;
        
        // Perform the merge using the proper merge function
        console.log('🔄 Using safe merge with deduplication...');
        const mergeResult = mergeTimelineDatasets([
          { id: targetDataset.id, filename: targetDataset.filename, rawContent: existingRawContent },
          { id: 'new_upload', filename: req.file.originalname, rawContent: JSON.stringify(jsonData) }
        ]);
        
        finalJsonData = {
          timelineObjects: mergeResult.timelineObjects
        };
        
        // Sanity check: merged data should have at least as much as existing
        const existingCount = existingJsonData.timelineObjects?.length || 0;
        const mergedCount = finalJsonData.timelineObjects?.length || 0;
        
        if (mergedCount < existingCount) {
          console.error(`🚨 MERGE SANITY CHECK FAILED: Merged count (${mergedCount}) < Existing count (${existingCount})`);
          return res.status(400).json({ 
            error: `Merge would lose data! Existing: ${existingCount} objects, Merged: ${mergedCount} objects. Aborting to prevent data loss.` 
          });
        }
        
        // Calculate merge statistics for user feedback
        originalCount = existingJsonData.timelineObjects?.length || 0;
        newCount = jsonData.timelineObjects?.length || 0;
        finalCount = finalJsonData.timelineObjects?.length || 0;
        addedObjects = finalCount - originalCount;
        duplicatesRemoved = newCount - addedObjects;
        
        console.log(`📊 Merge stats: ${originalCount} existing + ${newCount} new = ${finalCount} total (${addedObjects} added, ${duplicatesRemoved} duplicates removed)`);
        
        // Record merge event for audit trail with source dataset ID
        try {
          await storage.createMergeEvent({
            datasetId: dataset.id,
            sourceDatasetId: 'new_upload', // Will be cleaned up to actual dataset ID if needed
            addedObjects,
            duplicatesRemoved,
            newDataStart: newDataDateRange?.start ? new Date(newDataDateRange.start) : null,
            newDataEnd: newDataDateRange?.end ? new Date(newDataDateRange.end) : null,
            sourceFilename: req.file.originalname,
          });
          
          // Update dataset merge statistics
          const currentMergeCount = (dataset.mergeCount || 0) + 1;
          await storage.updateDatasetMergeStats(dataset.id, {
            mergeCount: currentMergeCount,
            lastMergeAt: new Date(),
            firstDataAt: existingDataDateRange?.start ? new Date(existingDataDateRange.start) : dataset.firstDataAt,
            lastDataAt: newDataDateRange?.end ? new Date(newDataDateRange.end) : dataset.lastDataAt,
            totalSources: currentMergeCount + 1, // Original file + number of merges
            lastMergeAdded: addedObjects,
            lastMergeDuplicates: duplicatesRemoved,
            fileSize: Math.round(Buffer.byteLength(JSON.stringify(finalJsonData))),
            totalPoints: finalCount,
          });
          
          console.log(`✅ Merge event recorded: dataset ${dataset.id} now has ${currentMergeCount} merges`);
          
          // 🧹 AUTO-CLEANUP: Remove redundant source file after successful merge
          try {
            await cleanupAfterMerge(dataset.id, userId);
          } catch (cleanupError) {
            console.error('⚠️  Failed to cleanup after merge (continuing with upload):', cleanupError);
          }
        } catch (mergeEventError) {
          console.error('❌ Failed to record merge event:', mergeEventError);
          // Continue with upload - don't fail the whole operation for tracking issues
        }
        
        // Recalculate metadata for the merged result
        if (fileSizeMB > 10) {
          // For large merged files, create temporary file to scan
          const tempMergedPath = filePath + '_merged';
          await fs.promises.writeFile(tempMergedPath, JSON.stringify(finalJsonData));
          try {
            const scanResult = await scanDateRangeFromFile(tempMergedPath);
            metadata = {
              totalElements: finalJsonData.timelineObjects?.length || 0,
              estimatedPoints: metadata.estimatedPoints * 2, // Rough estimate for merged data
              hasTimelinePath: true,
              dateRange: {
                startDate: scanResult.startDate,
                endDate: scanResult.endDate
              },
              dataQuality: { goodProbability: metadata.estimatedPoints * 2 },
              activityBreakdown: {}
            };
          } catch (error) {
            console.error('Failed to scan merged file:', error);
            // Fallback to basic metadata
            metadata = {
              totalElements: finalJsonData.timelineObjects?.length || 0,
              estimatedPoints: metadata.estimatedPoints * 2,
              hasTimelinePath: true,
              dateRange: metadata.dateRange,
              dataQuality: metadata.dataQuality,
              activityBreakdown: metadata.activityBreakdown
            };
          }
          await fs.promises.unlink(tempMergedPath).catch(() => {}); // Clean up temp file
        } else {
          // Re-extract metadata from merged small file
          metadata = await extractQuickMetadata(finalJsonData);
        }
        
        console.log(`✅ Merge complete: ${finalJsonData.timelineObjects?.length || 0} total timeline objects`);
        
      } else {
        // Replace mode - create new dataset and clean up old ones
        console.log('🔄 Replace mode selected - creating new dataset and cleaning up old data...');
        
        // Get existing datasets for cleanup later
        const existingDatasets = await storage.getUserLocationDatasets(userId);
        console.log(`📊 Found ${existingDatasets.length} existing datasets to replace`);
        
        dataset = await storage.createLocationDataset({
          userId,
          filename: req.file.originalname || 'location-history.json',
          fileSize: req.file.size || Buffer.byteLength(JSON.stringify(jsonData)),
          totalPoints: metadata.estimatedPoints,
          deduplicatedPoints: 0, // Will be set during processing
        });
        
        // Store existing dataset IDs for cleanup after successful upload
        dataset._existingDatasetsForCleanup = existingDatasets.map(d => d.id);
      }

      // Store final data (original or merged) to file system or database
      const finalFileSizeMB = Buffer.byteLength(JSON.stringify(finalJsonData)) / (1024 * 1024);
      
      if (finalFileSizeMB > 10) {
        // For large files, store to disk with file path reference
        console.log(`📁 Large file (${finalFileSizeMB.toFixed(2)}MB) - storing file path instead of raw content`);
        
        const fs = await import('fs/promises');
        const path = await import('path');
        
        // Ensure uploads directory exists
        const uploadsDir = UPLOADS_DIR;
        await fs.mkdir(uploadsDir, { recursive: true });
        
        const fileName = `${dataset.id}.json`;
        const persistentPath = path.join(uploadsDir, fileName);
        
        // Write final data (merged or original) to persistent location
        await fs.writeFile(persistentPath, JSON.stringify(finalJsonData));
        
        // Clean up temporary uploaded file
        await fs.unlink(req.file.path).catch(() => {});
        
        // Store file path reference in database
        await storage.storeRawFile(dataset.id, userId, `FILE:${persistentPath}`);
        
        console.log(`✅ Final data stored at: ${persistentPath}`);
      } else {
        // For smaller files, store JSON directly in database
        const jsonString = JSON.stringify(finalJsonData);
        console.log(`💾 Small file (${finalFileSizeMB.toFixed(2)}MB) - storing in database`);
        await storage.storeRawFile(dataset.id, userId, jsonString);
        
        // Clean up temporary uploaded file
        await fs.promises.unlink(req.file.path).catch(() => {});
      }

      // 🔐 CONTENT HASH: Store hash for duplicate detection
      try {
        await storeContentHash(dataset.id, JSON.stringify(finalJsonData), userId);
      } catch (hashError: any) {
        console.log('🔍 Hash error details:', {
          code: hashError?.code,
          constraint: hashError?.constraint,
          message: hashError?.message,
          errorType: typeof hashError
        });
        
        // If this is a duplicate constraint violation, return an error instead of continuing
        if (hashError?.code === '23505' && hashError?.constraint === 'unique_user_content_hash') {
          console.log('🚫 Duplicate content detected during hash storage - cleaning up and rejecting upload');
          
          // Clean up the dataset we just created since it's a duplicate
          try {
            await storage.deleteDataset(dataset.id, userId);
            await deleteFileIfExists(dataset.id);
          } catch (cleanupError) {
            console.warn('⚠️  Failed to cleanup duplicate dataset:', cleanupError);
          }
          
          return res.status(409).json({
            error: "This file has already been uploaded to your account",
            message: "The exact same file content already exists in your datasets. No upload needed.",
            duplicate: true
          });
        }
        
        console.warn('⚠️  Failed to store content hash (continuing with upload):', hashError);
      }

      // 🧹 AUTO-CLEANUP: Clean up old datasets after successful replace
      if (uploadMode === 'replace' && dataset._existingDatasetsForCleanup && dataset._existingDatasetsForCleanup.length > 0) {
        console.log(`🧹 Replace mode cleanup: removing ${dataset._existingDatasetsForCleanup.length} old datasets`);
        try {
          for (const oldDatasetId of dataset._existingDatasetsForCleanup) {
            await cleanupAfterReplace(dataset.id, oldDatasetId, userId);
          }
          console.log(`✅ Replace mode cleanup completed`);
        } catch (cleanupError) {
          console.error('⚠️  Failed to cleanup after replace (upload was successful):', cleanupError);
        }
      }

      res.json({
        success: true,
        message: uploadMode === 'merge' 
          ? `Added location data for ${newDataDateRange?.start || 'unknown date'} to ${newDataDateRange?.end || 'unknown date'}. Added ${addedObjects} new timeline objects (${duplicatesRemoved} duplicates removed).` 
          : `File uploaded successfully: ${req.file.originalname}`,
        datasetId: dataset.id,
        status: 'uploaded_not_processed',
        mode: uploadMode,
        mergeStats: uploadMode === 'merge' ? {
          newDataDateRange,
          existingDataDateRange,
          originalCount,
          newCount,
          finalCount,
          addedObjects,
          duplicatesRemoved
        } : undefined,
        metadata: {
          filename: req.file.originalname,
          fileSize: Math.round(finalFileSizeMB) + 'MB',
          totalElements: metadata?.totalElements || 0,
          estimatedPoints: metadata?.estimatedPoints || 0,
          dateRange: metadata?.dateRange || { startDate: '', endDate: '' },
          dataQuality: metadata?.dataQuality || { goodProbability: 0 },
          activityBreakdown: metadata?.activityBreakdown || {}
        }
      });

      console.log(`📁 File uploaded (metadata extracted): ${req.file.originalname} - ${metadata?.estimatedPoints || 0} estimated points, quality: ${metadata?.dataQuality?.goodProbability || 'unknown'}/${metadata?.totalElements || 0} good probability`);

    } catch (error) {
      console.error("Error processing location history:", error);
      res.status(500).json({ error: "Failed to process location history file" });
    }
  });

  // 🎯 CRITICAL: Process stored raw JSON files into location points using enhanced parser
  app.post("/api/datasets/:datasetId/process", requireApprovedUser, async (req, res) => {
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
              jsonData = arrayData;
            }
          } else {
            jsonData = arrayData;
          }
        }
      }

      // 🚀 STREAMING: Use GoogleLocationIngest to process efficiently without stack overflow
      console.log(`⚡ Using streaming ingestion to avoid memory issues`);
      
      // Write raw content to temporary file for streaming processing
      const tempFilePath = path.join(UPLOADS_DIR, `process-${datasetId}-${Date.now()}.json`);
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

        // Mark dataset as processed with robust error handling
        try {
          await storage.updateDatasetProcessed(datasetId, result.processed);
          
          // Verify the update actually worked
          const verifyDataset = await storage.getLocationDataset(datasetId, userId);
          if (!verifyDataset?.processedAt) {
            console.error(`CRITICAL: Status update failed - processedAt is still null after update!`);
            throw new Error("Failed to update dataset processed status - verification failed");
          }
          console.log(`✅ Verification successful: dataset.processedAt = ${verifyDataset.processedAt}`);
          
        } catch (statusError) {
          console.error(`❌ CRITICAL: Failed to update dataset processed status:`, statusError);
          // Still return success since the data was processed, but log the status issue
          console.warn(`⚠️ Data processing succeeded (${result.processed.toLocaleString()} points) but status update failed`);
          // Re-throw to ensure proper error handling
          throw new Error(`Data processed successfully but failed to update status: ${statusError instanceof Error ? statusError.message : 'Unknown error'}`);
        }

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

  // Protected route: Process location points for specific date range using time-based association (Phase 2)
  app.post("/api/process-date-range", requireApprovedUser, async (req, res) => {
    const { claims } = getAuthenticatedUser(req);
    try {
      const { datasetId, startDate, endDate } = req.body;
      
      if (!datasetId || !startDate || !endDate) {
        return res.status(400).json({ error: "datasetId, startDate, and endDate are required" });
      }
      
      const userId = claims.sub;
      
      // Get the dataset to ensure it belongs to the user
      const dataset = await storage.getLocationDataset(datasetId, userId);
      if (!dataset) {
        return res.status(404).json({ error: "Dataset not found" });
      }
      
      console.log(`🔗 Processing date range ${startDate} to ${endDate} for dataset ${datasetId}`);
      
      // Read the stored JSON file
      let jsonData: any;
      try {
        // Get the raw file content - either file path or direct JSON content
        const rawContent = await storage.getRawFile(datasetId, userId);
        if (!rawContent) {
          return res.status(400).json({ error: "No raw content found for dataset" });
        }
        
        // Check if it's a file path (starts with FILE:) or direct JSON content
        if (rawContent.startsWith('FILE:')) {
          const filePath = rawContent.substring(5); // Remove 'FILE:' prefix
          console.log(`📁 Reading file from: ${filePath}`);
          const fileContent = await fs.promises.readFile(filePath, 'utf8');
          jsonData = JSON.parse(fileContent);
        } else {
          // Direct JSON content
          console.log('📄 Using direct JSON content');
          jsonData = JSON.parse(rawContent);
        }
      } catch (error) {
        console.error('Error reading dataset file:', error);
        return res.status(500).json({ error: 'Failed to read dataset file' });
      }
      
      // Phase 1: Build parent index (TIME CONTEXT from visit/activity containers)
      console.log('📊 Building parent time index...');
      const parentIndex = buildParentIndex(jsonData);
      
      // Phase 2: Process timelinePath data for date range (GPS POINTS + TIME ASSOCIATION) 
      console.log('🔗 Processing GPS data with time-based association...');
      const gpsPoints: TimelinePathPoint[] = processTimelinePathsForDateRange(
        jsonData,
        parentIndex,
        startDate,
        endDate
      );
      
      console.log(`✅ Processed ${gpsPoints.length} GPS points with proper time association`);
      
      // Convert to the format expected by the frontend
      const locationPoints = gpsPoints.map(point => ({
        id: `${point.parentId}_${point.timestampMs}`,
        lat: point.latitude,
        lng: point.longitude,
        timestamp: new Date(point.timestampMs),
        activity: point.parentType === 'activity' ? 'route' : 'visit',
        userId,
        datasetId
      }));
      
      // TODO: Store processed points in database for caching (Phase 3)
      // await storage.saveLocationPoints(locationPoints);
      
      res.json({
        success: true,
        points: locationPoints.length,
        message: `Processed ${locationPoints.length} GPS points with time-based association`,
        data: locationPoints
      });
      
    } catch (error) {
      console.error('Error processing date range:', error);
      res.status(500).json({ error: 'Failed to process date range' });
    }
  });

  // Protected route: Get user's location points with optional date range filtering (legacy)
  app.get("/api/locations", requireApprovedUser, async (req, res) => {
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
  app.get("/api/datasets", requireApprovedUser, async (req, res) => {
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

  // Protected route: Download user's dataset as JSON backup
  app.get("/api/datasets/:id/download", requireApprovedUser, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const datasetId = req.params.id;

      // Verify dataset belongs to user
      const datasets = await storage.getUserLocationDatasets(userId);
      const dataset = datasets.find(d => d.id === datasetId);
      
      if (!dataset) {
        return res.status(404).json({ error: "Dataset not found" });
      }

      // Get the raw JSON content
      const rawContent = await storage.getRawFile(datasetId, userId);
      
      if (!rawContent) {
        return res.status(404).json({ error: "Dataset file not found" });
      }

      // Set headers for file download
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${dataset.filename}"`);
      
      // Send the raw JSON content
      res.send(rawContent);
    } catch (error) {
      console.error("Error downloading dataset:", error);
      res.status(500).json({ error: "Failed to download dataset" });
    }
  });

  // Protected route: Get user's unique locations (for analytics)
  app.get("/api/locations/unique", requireApprovedUser, async (req, res) => {
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
  app.get("/api/locations/stats", requireApprovedUser, async (req, res) => {
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

  // Reprocess dataset - clear location points and reset processed status
  app.post("/api/datasets/:datasetId/reprocess", requireApprovedUser, async (req, res) => {
    const { datasetId } = req.params;
    console.log(`🔄 REPROCESS START - Dataset ID: ${datasetId}`);
    
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      console.log(`👤 User ID: ${userId}`);

      // Check if dataset exists and belongs to user
      const dataset = await storage.getLocationDataset(datasetId, userId);
      if (!dataset) {
        console.log(`❌ Dataset not found: ${datasetId}`);
        return res.status(404).json({ error: "Dataset not found" });
      }

      console.log(`📁 Found dataset: ${dataset.filename}`);

      // Clear existing location points for this dataset
      console.log(`🗑️ Deleting location points for dataset ${datasetId}`);
      await storage.deleteLocationPointsByDataset(datasetId, userId);
      console.log(`✅ Location points deleted`);

      // Reset dataset processed status to allow reprocessing
      console.log(`🔄 Resetting processed status for dataset ${datasetId}`);
      await storage.resetDatasetProcessed(datasetId);
      console.log(`✅ Processed status reset`);

      const successResponse = { success: true, message: `Dataset ${dataset.filename} cleared and ready for reprocessing` };
      console.log(`✅ REPROCESS SUCCESS - Sending response:`, successResponse);
      res.json(successResponse);
    } catch (error) {
      console.error("❌ REPROCESS ERROR:", error);
      const errorResponse = { error: "Failed to prepare dataset for reprocessing" };
      console.log(`❌ REPROCESS ERROR RESPONSE:`, errorResponse);
      res.status(500).json(errorResponse);
    }
  });

  // Delete a specific dataset
  app.delete("/api/datasets/:datasetId", requireApprovedUser, async (req, res) => {
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

  // Dataset merging endpoints
  
  // Generate merge preview for multiple datasets
  app.post("/api/datasets/merge-preview", requireApprovedUser, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const { datasetIds } = req.body;

      if (!datasetIds || !Array.isArray(datasetIds) || datasetIds.length < 2) {
        return res.status(400).json({ error: "At least 2 dataset IDs required for merging" });
      }

      // Get datasets and their raw content
      const datasets = [];
      for (const datasetId of datasetIds) {
        const dataset = await storage.getLocationDataset(datasetId, userId);
        if (!dataset) {
          return res.status(404).json({ error: `Dataset ${datasetId} not found` });
        }

        const rawContent = await storage.getRawFile(datasetId, userId);
        if (!rawContent) {
          return res.status(404).json({ error: `Raw content for dataset ${datasetId} not found` });
        }

        datasets.push({
          id: datasetId,
          filename: dataset.filename,
          rawContent
        });
      }

      // Generate merge preview
      const preview = generateMergePreview(datasets);

      res.json({ success: true, preview });
    } catch (error) {
      console.error("Error generating merge preview:", error);
      res.status(500).json({ error: "Failed to generate merge preview" });
    }
  });

  // Get timeline points from multiple datasets (combined)
  app.get("/api/timeline/points", requireApprovedUser, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;
      const { start, end, datasetIds, combine } = req.query;

      if (!start || !end) {
        return res.status(400).json({ error: "Start and end dates are required" });
      }

      let datasets = [];

      if (combine === 'all') {
        // Get all user datasets
        const allDatasets = await storage.getUserLocationDatasets(userId);
        for (const dataset of allDatasets) {
          const rawContent = await storage.getRawFile(dataset.id, userId);
          if (rawContent) {
            datasets.push({
              id: dataset.id,
              rawContent
            });
          }
        }
      } else if (datasetIds) {
        // Get specific datasets
        const ids = Array.isArray(datasetIds) ? datasetIds : [datasetIds];
        for (const datasetId of ids) {
          const dataset = await storage.getLocationDataset(datasetId, userId);
          if (!dataset) {
            return res.status(404).json({ error: `Dataset ${datasetId} not found` });
          }

          const rawContent = await storage.getRawFile(datasetId, userId);
          if (rawContent) {
            datasets.push({
              id: datasetId,
              rawContent
            });
          }
        }
      } else {
        return res.status(400).json({ error: "Either combine=all or datasetIds parameter required" });
      }

      if (datasets.length === 0) {
        return res.json({ success: true, data: [] });
      }

      // Merge and deduplicate points for date range
      const points = mergePointsForDateRange(datasets, start as string, end as string);

      // Convert to the format expected by the frontend
      const formattedPoints = points.map(point => ({
        id: `${point.parentId}_${point.timestampMs}`,
        lat: point.latitude,
        lng: point.longitude,
        timestamp: new Date(point.timestampMs).toISOString(),
        activity: 'route',
        datasetId: point.parentId.split('_')[0] // Extract dataset ID from prefixed parent ID
      }));

      res.json({ success: true, data: formattedPoints });
    } catch (error) {
      console.error("Error getting merged timeline points:", error);
      res.status(500).json({ error: "Failed to get timeline points" });
    }
  });

  // Protected route: Clear user's location data
  app.delete("/api/locations", requireApprovedUser, async (req, res) => {
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
  app.post("/api/analytics/backfill-centroids", requireApprovedUser, async (req, res) => {
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
  app.get("/api/analytics/geocoding-queue-status", requireApprovedUser, async (req, res) => {
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
  app.get("/api/analytics/debug/:year", requireApprovedUser, async (req, res) => {
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
  app.get("/api/analytics/geocoding-status", requireApprovedUser, async (req, res) => {
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
  app.get("/api/analytics/ungeocoded-summary", requireApprovedUser, async (req, res) => {
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

  // Visit/activity-based yearly state/country report endpoint (COMPLETE REPLACEMENT)
  app.get("/api/yearly-state-report", requireApprovedUser, async (req, res) => {
    try {
      const user = getAuthenticatedUser(req);
      const userId = user.claims.sub;
      
      const year = parseInt(req.query.year as string);
      if (!year || year < 2000 || year > new Date().getFullYear()) {
        return res.status(400).json({ error: "Valid year parameter required" });
      }
      
      const refresh = req.query.refresh === 'true';
      if (refresh) {
        console.log(`🔄 Force refresh requested for year ${year}`);
      }

      // Try to get cached report first (unless refresh is requested)
      if (!refresh) {
        try {
          const cachedReport = await db.select()
            .from(yearlyReportCache)
            .where(and(
              eq(yearlyReportCache.userId, userId),
              eq(yearlyReportCache.year, year),
              eq(yearlyReportCache.reportType, 'state_country')
            ))
            .limit(1);

          if (cachedReport.length > 0) {
            const cached = cachedReport[0];
            console.log(`📋 Returning cached yearly report for ${year} (generated: ${cached.generatedAt})`);
            return res.json(cached.reportData);
          }
        } catch (cacheError) {
          console.log(`📋 Cache lookup failed (table may not exist yet): ${cacheError}`);
          // Continue with fresh generation
        }
      }

      console.log(`🏠 Generating fresh visit/activity-based yearly report for ${year}`);

      // Calculate date range for the requested year
      const startDate = new Date(year, 0, 1); // January 1st
      let endDate = new Date(year + 1, 0, 1); // January 1st of next year
      
      // For current year, limit to today to avoid future dates
      const currentYear = new Date().getFullYear();
      if (year === currentYear) {
        const today = new Date();
        endDate = new Date(today.getTime() + 24 * 60 * 60 * 1000); // End of today
      }

      // Get user's location datasets and raw files (contains semantic data)
      const allDatasets = await storage.getUserLocationDatasets(userId);
      
      // Smart dataset selection: prioritize merged datasets over source files
      const datasets = allDatasets.filter(dataset => {
        // Prefer merged datasets (those with merge_count > 0)
        if (dataset.mergeCount && dataset.mergeCount > 0) {
          console.log(`📦 Using merged dataset ${dataset.id} (${dataset.totalSources} sources merged)`);
          return true;
        }
        
        // For non-merged datasets, only use if no merged datasets exist
        const hasMergedDatasets = allDatasets.some(d => d.mergeCount && d.mergeCount > 0);
        if (!hasMergedDatasets) {
          console.log(`📦 Using original dataset ${dataset.id} (no merged datasets found)`);
          return true;
        }
        
        // Skip source files that were likely merged into other datasets
        console.log(`⏭️  Skipping source dataset ${dataset.id} (merged datasets available)`);
        return false;
      });
      
      console.log(`📊 Selected ${datasets.length} of ${allDatasets.length} datasets for processing`);
      
      const semanticData: Array<{id: string, jsonData: any}> = [];
      for (const dataset of datasets) {
        try {
          console.log(`📖 Reading dataset ${dataset.id} (${dataset.filename})`);
          const rawContent = await storage.getRawFile(dataset.id, userId);
          if (rawContent) {
            const jsonData = JSON.parse(rawContent);
            semanticData.push({ id: dataset.id, jsonData });
          }
        } catch (parseError) {
          console.warn(`❌ Failed to parse dataset ${dataset.id}: ${parseError.message}`);
        }
      }
      
      if (!semanticData || semanticData.length === 0) {
        // Add cache-busting headers to ensure fresh data
        res.set({
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        
        return res.json({
          year,
          totalDays: 0,
          stateCountryData: [],
          summary: "No visit/activity data found for this year",
          processingStats: {
            totalPoints: 0,
            sampledPoints: 0,
            geocodedSamples: 0,
            daysWithData: 0
          }
        });
      }

      console.log(`🏛️ Found ${semanticData.length} semantic data files for ${year}`);

      // Step 1: Parse visits/activities for the target year
      let allSamples: any[] = [];
      for (const data of semanticData) {
        try {
          const samples = parseVisitsActivitiesModern(data.jsonData, year);
          allSamples.push(...samples);
        } catch (parseError) {
          console.warn(`Failed to parse semantic data file ${data.id}:`, parseError);
        }
      }

      console.log(`🔍 Parsed ${allSamples.length} visit/activity samples for ${year}`);

      // FALLBACK: If presence detection found 0 samples, use the existing working parser
      if (allSamples.length === 0) {
        console.log(`🔄 Presence detection found 0 samples, falling back to existing route parser for ${year}`);
        
        for (const data of semanticData) {
          try {
            // Use the existing parser that works with your data format
            const routePoints = parseGoogleLocationHistory(data.jsonData);
            
            // Filter to target year and group by day
            const yearStart = new Date(year, 0, 1);
            const yearEnd = new Date(year + 1, 0, 1);
            const dailyGroups: { [date: string]: any[] } = {};
            
            routePoints.forEach(point => {
              if (point.timestamp >= yearStart && point.timestamp < yearEnd) {
                const date = `${point.timestamp.getFullYear()}-${String(point.timestamp.getMonth() + 1).padStart(2, '0')}-${String(point.timestamp.getDate()).padStart(2, '0')}`;
                
                if (!dailyGroups[date]) {
                  dailyGroups[date] = [];
                }
                dailyGroups[date].push(point);
              }
            });
            
            // Select 2-3 representative points per day
            Object.entries(dailyGroups).forEach(([date, dayPoints]) => {
              if (dayPoints.length > 0) {
                // Select evenly spaced points (start, middle, end if enough points)
                const indices = dayPoints.length === 1 ? [0] : 
                                dayPoints.length === 2 ? [0, 1] :
                                [0, Math.floor(dayPoints.length / 2), dayPoints.length - 1];
                
                indices.forEach(i => {
                  const point = dayPoints[i];
                  allSamples.push({
                    date,
                    lat: point.lat,
                    lng: point.lng,
                    durationMs: 8 * 60 * 60 * 1000, // 8 hours estimated presence
                    provenance: 'visit',
                    timestamp: point.timestamp
                  });
                });
              }
            });
            
            console.log(`🔄 Extracted ${Object.keys(dailyGroups).length} days from fallback parser`);
          } catch (parseError) {
            console.warn(`Failed to parse with fallback parser for dataset ${data.id}:`, parseError);
          }
        }
      }

      if (allSamples.length === 0) {
        res.set({
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        
        return res.json({
          year,
          totalDays: 0,
          stateCountryData: [],
          summary: "No valid location data found for this year",
          processingStats: {
            totalPoints: 0,
            sampledPoints: 0,
            geocodedSamples: 0,
            daysWithData: 0
          }
        });
      }

      // Step 2: Select daily samples (max 3 per day)
      const selectedSamples = selectDailySamples(allSamples, 3);
      console.log(`📊 Selected ${selectedSamples.length} samples (max 3 per day)`);

      // Step 3: Build cache array for 20-mile radius lookup
      const cacheArray = await getAllCachedLocations();
      console.log(`💾 Loaded ${cacheArray.length} cached locations for radius lookup`);

      // Step 4: Resolve samples with cache-first approach
      const resolvedSamples = await resolveSamples(selectedSamples, cacheArray, 20);
      console.log(`🗺️ Resolved ${resolvedSamples.length} samples with state/country data`);

      // Step 5: Build daily presence records (FIXED: pass date range for complete coverage)
      const dailyPresence = buildDailyPresence(resolvedSamples, startDate, endDate);
      console.log(`📅 Built ${dailyPresence.length} daily presence records`);

      // Step 6: Aggregate state/country statistics
      const stateCountryStats: any[] = [];
      const stateCounts: { [key: string]: number } = {};
      const countryCounts: { [key: string]: number } = {};

      dailyPresence.forEach(day => {
        if (day.country === 'United States' && day.state) {
          stateCounts[day.state] = (stateCounts[day.state] || 0) + 1;
        } else if (day.country) {
          countryCounts[day.country] = (countryCounts[day.country] || 0) + 1;
        }
      });

      const totalDays = dailyPresence.length;

      // Add US states to stats
      Object.entries(stateCounts).forEach(([state, days]) => {
        stateCountryStats.push({
          location: state,
          type: 'us_state',
          days,
          percentage: Math.round((days / totalDays) * 100 * 10) / 10
        });
      });

      // Add countries to stats (excluding US if we have state data)
      Object.entries(countryCounts).forEach(([country, days]) => {
        if (country !== 'United States' || Object.keys(stateCounts).length === 0) {
          stateCountryStats.push({
            location: country,
            type: 'country',
            days,
            percentage: Math.round((days / totalDays) * 100 * 10) / 10
          });
        }
      });

      // Sort by days descending
      stateCountryStats.sort((a, b) => b.days - a.days);

      // Add cache-busting headers to ensure fresh data
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      // Calculate actual date range from the data
      let dateRange;
      if (dailyPresence.length > 0) {
        const dates = dailyPresence.map(day => day.date).sort();
        dateRange = {
          start: dates[0],
          end: dates[dates.length - 1]
        };
      } else {
        // Fallback to full year if no data
        dateRange = {
          start: `${year}-01-01`,
          end: `${year}-12-31`
        };
      }

      // Prepare report data for response and caching
      const reportData = {
        year,
        totalDays: dailyPresence.length,
        dateRange,
        stateCountryData: stateCountryStats,
        processingStats: {
          totalPoints: allSamples.length,
          sampledPoints: selectedSamples.length,
          geocodedSamples: resolvedSamples.length,
          daysWithData: dailyPresence.length
        }
      };

      // Cache the generated report for future requests
      try {
        await db.insert(yearlyReportCache)
          .values({
            userId,
            year,
            reportType: 'state_country',
            reportData,
            cacheVersion: 'v1'
          })
          .onConflictDoUpdate({
            target: [yearlyReportCache.userId, yearlyReportCache.year, yearlyReportCache.reportType],
            set: {
              reportData,
              generatedAt: new Date(),
              cacheVersion: 'v1'
            }
          });
        console.log(`📋 Cached yearly report for ${year} (${dailyPresence.length} days, ${resolvedSamples.length} geocoded samples)`);
      } catch (cacheError) {
        console.log(`📋 Failed to cache yearly report (table may not exist yet): ${cacheError}`);
        // Continue anyway - caching is optional
      }

      res.json(reportData);

    } catch (error) {
      console.error("Error generating visit/activity-based yearly report:", error);
      res.status(500).json({ error: "Failed to generate yearly report" });
    }
  });

  // NEW: Date-range specific geocoding endpoint for better user experience
  app.post("/api/analytics/geocode-date-range", requireApprovedUser, async (req, res) => {
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
  // Server-Sent Events endpoint for real-time progress updates
  app.get('/api/progress/:taskId', requireApprovedUser, (req, res) => {
    const { taskId } = req.params;
    
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', taskId })}\n\n`);

    // Store the connection for this task
    if (!(global as any).progressConnections) {
      (global as any).progressConnections = new Map();
    }
    (global as any).progressConnections.set(taskId, res);

    // Clean up on client disconnect
    req.on('close', () => {
      (global as any).progressConnections.delete(taskId);
    });

    req.on('error', () => {
      (global as any).progressConnections.delete(taskId);
    });
  });

  // Helper function to emit progress events
  const emitProgress = (taskId: string, data: any) => {
    if ((global as any).progressConnections?.has(taskId)) {
      const res = (global as any).progressConnections.get(taskId);
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        console.error(`Failed to emit progress for task ${taskId}:`, error);
        (global as any).progressConnections.delete(taskId);
      }
    }
  };

  app.post('/api/waypoints/compute', requireApprovedUser, async (req, res) => {
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
  app.post('/api/analytics/run', requireApprovedUser, async (req, res) => {
    try {
      const { claims } = getAuthenticatedUser(req);
      const userId = claims.sub;

      // Input validation with zod
      const dateRangeSchema = z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be in YYYY-MM-DD format"),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be in YYYY-MM-DD format"),
        taskId: z.string().optional() // Optional task ID for progress tracking
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

      const { startDate: startDateStr, endDate: endDateStr, taskId } = validatedInput;
      
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
          console.log(`⚠️  No geocoded centroids found for user ${userId} in date range - proceeding with waypoint-only analytics`);
          // Don't return early - continue to waypoint computation to detect stops from route data
        }

        // Group locations by country/state/city and calculate city jumps
        const locationStats = {
          countries: new Map<string, number>(),
          states: new Map<string, number>(),
          cities: new Map<string, number>()
        };

        // Sort ALL centroids chronologically for complete travel chain analysis
        const sortedCentroids = allCentroids.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // FIXED: Don't pre-populate from database centroids - let waypoint analysis handle all location counting
        // This ensures Montenegro and other waypoint-detected countries are properly included
        console.log(`🎯 Skipping database centroid aggregation - using waypoint-based location analysis only`);

        // ========== CONTINUOUS CITY JUMPS CHAIN (FIXES BROKEN TRAVEL SEQUENCES) ==========
        // FIXED: Generate travel stops directly from timeline JSON data instead of database
        console.log(`🔄 Generating travel stops from timeline JSON data for date range...`);
        
        // Get user's datasets
        const datasets = await storage.getUserLocationDatasets(userId);
        if (datasets.length === 0) {
          console.log(`❌ No datasets found for user ${userId}`);
          return res.status(400).json({ error: "No location data found" });
        }
        
        const primaryDataset = datasets[0]; // Use first dataset
        
        // Read and parse the raw JSON file
        console.log(`📁 Reading timeline JSON file for dataset ${primaryDataset.id}`);
        const rawContent = await storage.getRawFile(primaryDataset.id, userId);
        if (!rawContent) {
          console.log(`❌ No raw content found for dataset ${primaryDataset.id}`);
          return res.status(400).json({ error: "No location data found" });
        }
        const jsonData = JSON.parse(rawContent);
        console.log(`✅ File read successfully: ${(rawContent.length / 1024 / 1024).toFixed(2)}MB`);

        // Build parent index for timeline association
        console.log('🔍 Building parent time index from activitySegment/placeVisit objects...');
        const parentIndex = buildParentIndex(jsonData);
        
        // Get timeline GPS points for the date range
        const timelinePoints = processTimelinePathsForDateRange(
          jsonData, 
          parentIndex, 
          startDate.toISOString().split('T')[0], 
          endDate.toISOString().split('T')[0]
        );
        
        console.log(`📍 Generated ${timelinePoints.length} timeline GPS points for travel stop detection`);
        
        // Generate travel stops from timeline GPS points using clustering algorithm
        // Use larger clustering radius (500m) to capture airport/transit areas and shorter stops
        let travelStops = generateTravelStopsFromTimelinePoints(
          timelinePoints, 
          primaryDataset.id,
          5,    // Reduce minimum dwell to 5 minutes for transit stops
          500   // Increase clustering radius to 500m for airports/large transit areas
        );
        console.log(`🎯 Generated ${travelStops.length} travel stops from timeline data (5min dwell, 500m radius)`);
        
        // CRITICAL: Geocode the travel stops to get city names for city jumps
        console.log(`🌍 Geocoding ${travelStops.length} travel stops to resolve city names...`);
        
        // Extract coordinates for batch geocoding
        const coordinates = travelStops.map(stop => ({
          lat: stop.lat,
          lng: stop.lng
        }));
        
        // Deduplicate coordinates to avoid redundant API calls
        const uniqueCoordinates = deduplicateCoordinates(coordinates);
        console.log(`🔍 Deduplicated to ${uniqueCoordinates.length} unique coordinates for geocoding`);
        
        // Batch reverse geocode all unique coordinates
        const geocodingResponse = await batchReverseGeocode(uniqueCoordinates);
        const geocodingResults = geocodingResponse.results;
        console.log(`✅ Geocoded ${geocodingResults.length} locations`);
        
        // Map geocoding results back to travel stops
        travelStops = travelStops.map(stop => {
          const coordKey = `${stop.lat.toFixed(4)},${stop.lng.toFixed(4)}`;
          
          // Find geocoding result for this coordinate
          const resultIndex = uniqueCoordinates.findIndex(coord => {
            const uniqueKey = `${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`;
            return uniqueKey === coordKey;
          });
          
          const geocodingResult = resultIndex !== -1 ? geocodingResults[resultIndex] : null;
          
          if (geocodingResult && geocodingResult.country) {
            return {
              ...stop,
              city: geocodingResult.city,
              state: geocodingResult.state,
              country: geocodingResult.country,
              geocoded: true
            };
          }
          
          return stop; // Keep as non-geocoded if no result
        });
        
        const geocodedStops = travelStops.filter(stop => stop.geocoded);
        console.log(`🎯 Successfully geocoded ${geocodedStops.length}/${travelStops.length} travel stops with city names`);
        
        console.log(`🔄 Building continuous city jumps from ${travelStops.length} travel stops...`);
        
        // Helper function to normalize city keys for comparison
        const normalizeCityKey = (stop: any) => {
          const city = (stop.city || '').toLowerCase().trim();
          const state = (stop.state || '').toLowerCase().trim(); 
          const country = (stop.country || '').toLowerCase().trim();
          return `${city}|${state}|${country}`;
        };
        
        // Helper function to calculate straight-line distance between two points (fallback only)
        const calculateStraightLineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
          const R = 3959; // Earth's radius in miles
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLng = (lng2 - lng1) * Math.PI / 180;
          const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                    Math.sin(dLng/2) * Math.sin(dLng/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return R * c;
        };
        
        // Build continuous city jumps from chronological travel stops
        const continuousCityJumps: any[] = [];
        let totalTravelDistance = 0;
        
        // FIXED: Only include geocoded travel stops for city jumps (must have city names)
        const geocodedStopsOnly = travelStops
          .filter(stop => stop.geocoded && stop.city) // Only stops with city names
          .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
          
        console.log(`🗺️ Processing ${geocodedStopsOnly.length} geocoded travel stops for city jumps chain (filtered from ${travelStops.length} total)`);
        
        // Helper function to detect if two stops represent different locations
        const isDifferentLocation = (stop1: any, stop2: any): boolean => {
          // If both have geocoded city data, use city comparison
          if (stop1.geocoded && stop2.geocoded && stop1.city && stop2.city) {
            return normalizeCityKey(stop1) !== normalizeCityKey(stop2);
          }
          
          // If neither has city data, use coordinate-based detection (50+ mile threshold)
          if ((!stop1.city && !stop2.city) || (!stop1.geocoded && !stop2.geocoded)) {
            const distance = calculateStraightLineDistance(stop1.lat, stop1.lng, stop2.lat, stop2.lng);
            return distance > 50; // Consider it a "jump" if more than 50 miles apart
          }
          
          // Mixed case: one geocoded, one not - use coordinates with lower threshold  
          const distance = calculateStraightLineDistance(stop1.lat, stop1.lng, stop2.lat, stop2.lng);
          return distance > 25; // Lower threshold when mixing geocoded/non-geocoded
        };
        
        // Walk through geocoded stops sequentially, emitting jumps when location changes significantly
        if (geocodedStopsOnly.length > 1) {
          let previousStop = geocodedStopsOnly[0];
          
          for (let i = 1; i < geocodedStopsOnly.length; i++) {
            const currentStop = geocodedStopsOnly[i];
            
            // Check if we've moved to a significantly different location
            if (isDifferentLocation(currentStop, previousStop)) {
              // Calculate actual route distance using GPS coordinates from the primary dataset
              let distance = 0;
              try {
                // Get the dataset ID from the current stops (they should all be from the same dataset)
                const datasetId = currentStop.datasetId || previousStop.datasetId;
                
                if (datasetId) {
                  // Create temporary stop objects for the route distance calculation
                  const fromStopObj = {
                    id: previousStop.id,
                    lat: previousStop.lat,
                    lng: previousStop.lng,
                    end: new Date(previousStop.end),
                    city: previousStop.city
                  };
                  const toStopObj = {
                    id: currentStop.id,
                    lat: currentStop.lat,
                    lng: currentStop.lng,
                    start: new Date(currentStop.start),
                    city: currentStop.city
                  };
                  
                  // Use the new route distance calculation
                  distance = await (storage as any).calculateActualRouteDistanceFromJSON(
                    fromStopObj, toStopObj, userId, datasetId
                  );
                  
                  console.log(`🛤️ Route ${previousStop.city || 'Unknown'} → ${currentStop.city || 'Unknown'}: ${distance.toFixed(1)} miles (actual route)`);
                } else {
                  console.log(`⚠️ No dataset ID found, using straight-line distance`);
                  distance = calculateStraightLineDistance(
                    previousStop.lat, previousStop.lng, 
                    currentStop.lat, currentStop.lng
                  );
                }
              } catch (error) {
                console.error(`❌ Error calculating route distance, falling back to straight-line: ${error}`);
                distance = calculateStraightLineDistance(
                  previousStop.lat, previousStop.lng, 
                  currentStop.lat, currentStop.lng
                );
              }
              
              // FIXED: Create meaningful jump entry even for non-geocoded stops
              const getLocationName = (stop: any) => {
                if (stop.city) return stop.city;
                if (stop.state) return `Somewhere in ${stop.state}`;
                if (stop.country) return `Somewhere in ${stop.country}`;
                return `Location (${stop.lat.toFixed(3)}, ${stop.lng.toFixed(3)})`;
              };
              
              const jump = {
                fromCity: getLocationName(previousStop),
                fromState: previousStop.state,
                fromCountry: previousStop.country || 'Unknown',
                toCity: getLocationName(currentStop), 
                toState: currentStop.state,
                toCountry: currentStop.country || 'Unknown',
                date: currentStop.start, // Use start time of destination stop
                distance: Math.round(distance * 10) / 10, // Round to 1 decimal
                mode: currentStop.geocoded && previousStop.geocoded ? 'travel' : 'estimated', // Mark non-geocoded as estimated
                geocoded: currentStop.geocoded && previousStop.geocoded // Track geocoding status
              };
              
              continuousCityJumps.push(jump);
              totalTravelDistance += distance;
              previousStop = currentStop; // Update previous for next iteration
            }
          }
        }
        
        // Prepare city jumps data with continuous chain
        const cityJumpsData = {
          cityJumps: continuousCityJumps,
          totalTravelDistance: Math.round(totalTravelDistance * 10) / 10,
          totalJumps: continuousCityJumps.length
        };

        console.log(`🎯 Continuous City Jumps: ${continuousCityJumps.length} jumps, ${Math.round(totalTravelDistance)} miles total travel`);

        // ========== CALCULATE DAYS PER LOCATION FROM TRAVEL STOPS ==========
        // Use the same travel stops to calculate which location dominated each day
        console.log(`📅 Calculating location days from ${travelStops.length} travel stops over ${totalDaysInRange} days`);
        
        let lastKnownLocation = null; // Carry forward for days without geocoded data
        
        // For each calendar day, determine which location the user spent the most time in
        for (let dayOffset = 0; dayOffset < totalDaysInRange; dayOffset++) {
          const currentDay = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const dayStart = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate());
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
          
          console.log(`🔍 [DAY ${dayOffset + 1}] Analyzing ${currentDay.toISOString().split('T')[0]}`);
          
          // Find stops that overlap with this day and calculate minutes spent in each location
          const locationMinutes = new Map();
          
          for (const stop of travelStops) {
            const stopStart = new Date(stop.start);
            const stopEnd = new Date(stop.end);
            
            // Calculate overlap between stop and this day
            const overlapStart = new Date(Math.max(dayStart.getTime(), stopStart.getTime()));
            const overlapEnd = new Date(Math.min(dayEnd.getTime(), stopEnd.getTime()));
            
            if (overlapStart < overlapEnd) {
              const overlapMinutes = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60);
              
              // Only count geocoded stops with known locations
              if (stop.geocoded && stop.country) {
                const locationKey = `${stop.country}|${stop.state || ''}|${stop.city || ''}`;
                locationMinutes.set(locationKey, (locationMinutes.get(locationKey) || 0) + overlapMinutes);
                console.log(`    📍 Found ${stop.country} stop: ${overlapMinutes.toFixed(1)} minutes`);
              }
            }
          }
          
          let countryToCount = null;
          let stateToCount = null;
          let cityToCount = null;
          
          // FIXED: Assign this day to the location where the most time was spent
          if (locationMinutes.size > 0) {
            const dominantLocation = Array.from(locationMinutes.entries())
              .reduce((max, [location, minutes]) => minutes > max[1] ? [location, minutes] : max);
            
            const [country, state, city] = dominantLocation[0].split('|');
            
            // Use the dominant location for this day
            countryToCount = country;
            stateToCount = state;
            cityToCount = city;
            
            // Remember this location for potential carry-forward
            lastKnownLocation = { country, state, city };
            
          } else if (lastKnownLocation) {
            // FIXED: No geocoded data for this day - carry forward last known location
            countryToCount = lastKnownLocation.country;
            stateToCount = lastKnownLocation.state;
            cityToCount = lastKnownLocation.city;
            
          } else {
            // FIXED: First days with no data - use any available stop from this day (even non-geocoded)
            const anyStopThisDay = travelStops.find(stop => {
              const stopStart = new Date(stop.start);
              const stopEnd = new Date(stop.end);
              const overlapStart = new Date(Math.max(dayStart.getTime(), stopStart.getTime()));
              const overlapEnd = new Date(Math.min(dayEnd.getTime(), stopEnd.getTime()));
              return overlapStart < overlapEnd;
            });
            
            if (anyStopThisDay && anyStopThisDay.country) {
              countryToCount = anyStopThisDay.country;
              stateToCount = anyStopThisDay.state;
              cityToCount = anyStopThisDay.city;
              lastKnownLocation = { country: countryToCount, state: stateToCount, city: cityToCount };
            } else {
              // Fallback to United States if no location data at all
              countryToCount = 'United States';
              stateToCount = null;
              cityToCount = null;
              lastKnownLocation = { country: countryToCount, state: stateToCount, city: cityToCount };
            }
          }
          
          // FIXED: Always count every day (no more skipped days)
          console.log(`    ✅ Day assigned to: ${countryToCount || 'None'}`);
          if (countryToCount) {
            locationStats.countries.set(countryToCount, (locationStats.countries.get(countryToCount) || 0) + 1);
            
            if (countryToCount === 'United States' && stateToCount) {
              locationStats.states.set(stateToCount, (locationStats.states.get(stateToCount) || 0) + 1);
            }
            
            if (cityToCount) {
              const cityKey = stateToCount ? `${cityToCount}, ${stateToCount}` : `${cityToCount}, ${countryToCount}`;
              locationStats.cities.set(cityKey, (locationStats.cities.get(cityKey) || 0) + 1);
            }
          }
        }
        
        // Verify day counts are correct (should sum to totalDaysInRange)
        const totalCountryDays = Array.from(locationStats.countries.values()).reduce((sum, count) => sum + count, 0);
        const totalStateDays = Array.from(locationStats.states.values()).reduce((sum, count) => sum + count, 0);
        
        console.log(`📊 Location days calculated: ${locationStats.countries.size} countries (${totalCountryDays}/${totalDaysInRange} days), ${locationStats.states.size} states (${totalStateDays} days), ${locationStats.cities.size} cities`);

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

        // Always emit completion event for frontend progress tracking
        const progressTaskId = taskId || `analytics_${userId}_${Date.now()}`;
        emitProgress(progressTaskId, {
          type: 'completed',
          message: 'Analytics computation complete'
        });

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
  app.post('/api/analytics/geocoded-places', requireApprovedUser, async (req, res) => {
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
  app.post('/api/interesting-places', requireApprovedUser, async (req, res) => {
    try {
      const user = getAuthenticatedUser(req);
      const userId = user.claims.sub;
      
      console.log(`🎯 Interesting places request for user ${userId}`);
      
      // Validate request body
      const requestSchema = z.object({
        cities: z.record(z.string(), z.number()).optional().default({}),
        dateRange: z.object({
          start: z.string(),
          end: z.string()
        }).optional()
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
      
      const { cities, dateRange } = validatedInput;
      
      if (Object.keys(cities).length === 0) {
        return res.json({
          places: [],
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          message: "No cities provided"
        });
      }
      
      // Calculate analysis period for dynamic result count
      let daysAnalyzed = 1;
      if (dateRange) {
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        daysAnalyzed = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      
      // Calculate result count based on analysis period:
      // 5 days or fewer: 2 items
      // 6-15 days: 3 items  
      // 16-30 days: 5 items
      // 31-60 days: 10 items
      // 61+ days: 15 items
      let targetResults;
      if (daysAnalyzed <= 5) {
        targetResults = 2;
      } else if (daysAnalyzed <= 15) {
        targetResults = 3;
      } else if (daysAnalyzed <= 30) {
        targetResults = 5;
      } else if (daysAnalyzed <= 60) {
        targetResults = 10;
      } else {
        targetResults = 15;
      }
      
      // Get top cities for AI input, ensuring geographic distribution
      const sortedCities = Object.entries(cities).sort(([,a], [,b]) => b - a);
      const topCities = sortedCities.slice(0, 10).map(([city, count]) => `${city} (visited ${count} days)`);
      
      console.log(`🚀 Generating ${targetResults} AI recommendations for ${topCities.length} cities (${daysAnalyzed} days analyzed - target: ${targetResults} results)`);
      
      // STEP 1: Get place names only from OpenAI (no URLs to avoid hallucination)
      const prompt = `You are a knowledgeable local guide who specializes in diverse recommendations spanning businesses, history, culture, and unique experiences. Focus on actionable recommendations across different geographic areas.

CRITICAL: Return ONLY place names and descriptions. Do NOT include any URLs, websites, phone numbers, or links in your response.

AVOID: Generic or overly broad recommendations. Be specific and actionable.
PRIORITIZE: Independent businesses, historical sites with visitor facilities, cultural landmarks, famous people connections, local events.

Based on these visited cities:
${topCities.join('\n')}

Find exactly ${targetResults} diverse recommendations distributed across different geographic areas from the cities above. Include a good cross-section from these categories:

BUSINESS & EXPERIENCES:
- Independent lodges, unique accommodations, glamping
- Local guides, outfitters, fishing/hunting guides
- Distinctive restaurants, bakeries, food experiences
- Scenic spots with visitor facilities

HISTORICAL & CULTURAL:
- Historical battle sites, landmarks with visitor centers
- Birthplaces or homes of famous people (with museums/tours)
- Sites of significant historical events
- Cultural festivals, annual events the area is known for
- Architectural landmarks or cultural institutions

GEOGRAPHIC DISTRIBUTION: Spread recommendations across different cities/areas from the list above, not concentrated in one location.

EXAMPLE for Sun Valley/Ketchum area:
- Name: "Galena Lodge", Description: "Offers year-round activities including cross-country skiing in winter and mountain biking in summer with on-site dining"
- Name: "Ernest Hemingway Memorial", Description: "Memorial and gravesite in Ketchum cemetery honors the famous writer who spent his final years here"  
- Name: "Redfish Lake Lodge", Description: "Provides lakeside dining and rustic cabin accommodations in the Sawtooth Mountains"
- Name: "Sun Valley Film Festival", Description: "Showcases independent films annually each fall with screenings and celebrity appearances"

For each place, provide:
- **name**: The exact business name, landmark name, or event name (no generic descriptions)
- **description**: One sentence about what makes it special and what you can do there (be specific and actionable)
- **location**: The specific city or general area from the visited locations
- **category**: Choose ONE from: "restaurant", "accommodation", "historical", "cultural", "outdoor", "event", "shopping", "entertainment"

Return your response as a JSON object with this exact structure:
{
  "places": [
    {
      "name": "Exact Place Name or Business Name",
      "description": "One sentence about what makes this place special and what you can do there",
      "location": "City/Location Name",
      "category": "restaurant"
    }
  ]
}`;

      try {
        // Call OpenAI API with GPT-4o mini for cost efficiency
        const openai = getOpenAIClient();
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
          max_tokens: 2000,
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
            name: z.string(),
            description: z.string(),
            location: z.string()
          })).min(1).max(15)
        });
        
        let validatedPlaces;
        try {
          validatedPlaces = placesSchema.parse(parsedResponse);
        } catch (validationError) {
          console.error(`❌ AI response validation failed for user ${userId}:`, validationError);
          throw new Error("AI response doesn't match expected format");
        }
        
        console.log(`🎉 Successfully generated ${validatedPlaces.places.length} interesting places for user ${userId}`);
        
        // STEP 2: Get real business information from Google Places API
        const placesWithVerifiedInfo = await Promise.all(
          validatedPlaces.places.map(async (place, index) => {
            try {
              console.log(`🔍 Looking up "${place.name}" in ${place.location} via Google Places API`);
              
              const placeDetails = await searchGooglePlace(place.name, place.location);
              
              if (placeDetails) {
                // Use business website if available, otherwise use Google Maps URL
                const finalWebsite = placeDetails.website || placeDetails.googleMapsUrl;
                const hasBusinessWebsite = !!placeDetails.website;
                
                console.log(`✅ Found verified info for "${place.name}": ${hasBusinessWebsite ? 'Business website' : 'Google Maps URL'} - ${finalWebsite || 'No URL'}`);
                
                return {
                  ...place,
                  website: finalWebsite,
                  address: placeDetails.address,
                  rating: placeDetails.rating,
                  userRatingsTotal: placeDetails.userRatingsTotal,
                  placeId: placeDetails.placeId,
                  googleMapsUrl: placeDetails.googleMapsUrl,
                  verified: true,
                  hasBusinessWebsite
                };
              } else {
                console.log(`⚠️ No Google Places results for "${place.name}" - using search fallback`);
                const searchQuery = `${place.name} ${place.location}`;
                const websiteUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
                return {
                  ...place,
                  website: websiteUrl,
                  verified: false,
                  hasBusinessWebsite: false
                };
              }
            } catch (error) {
              console.error(`❌ Error looking up "${place.name}":`, error);
              // Fallback to Google search
              const searchQuery = `${place.name} ${place.location}`;
              const websiteUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
              return {
                ...place,
                website: websiteUrl,
                verified: false
              };
            }
          })
        );
        
        const verifiedCount = placesWithVerifiedInfo.filter(p => p.verified).length;
        const businessWebsiteCount = placesWithVerifiedInfo.filter(p => p.hasBusinessWebsite).length;
        const googleMapsCount = placesWithVerifiedInfo.filter(p => p.verified && !p.hasBusinessWebsite).length;
        const searchFallbackCount = placesWithVerifiedInfo.length - verifiedCount;
        
        console.log(`✅ Enhanced ${placesWithVerifiedInfo.length} places: ${businessWebsiteCount} with business websites, ${googleMapsCount} with Google Maps URLs, ${searchFallbackCount} using search fallback`);
        
        // Return successful response with verified information
        res.json({
          places: placesWithVerifiedInfo,
          tokenUsage,
          model: "gpt-4o-mini",
          verificationStats: {
            total: placesWithVerifiedInfo.length,
            verified: verifiedCount,
            businessWebsites: businessWebsiteCount,
            googleMapsUrls: googleMapsCount,
            searchFallback: searchFallbackCount
          }
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

  // ========== ADMIN ROUTES ==========
  
  // Get pending users for approval
  app.get('/api/admin/pending-users', [combinedAuth, requireAdmin], async (req, res) => {
    try {
      const pendingUsers = await db.select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        approvalStatus: users.approvalStatus,
        createdAt: users.createdAt
      }).from(users).where(eq(users.approvalStatus, 'pending')).orderBy(users.createdAt);

      res.json({
        users: pendingUsers,
        count: pendingUsers.length
      });
    } catch (error) {
      console.error("Error fetching pending users:", error);
      res.status(500).json({ message: "Failed to fetch pending users" });
    }
  });

  // Get approved users for management
  app.get('/api/admin/approved-users', [combinedAuth, requireAdmin], async (req, res) => {
    try {
      const approvedUsers = await db.select({
        id: users.id,
        username: users.username,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        approvalStatus: users.approvalStatus,
        approvedBy: users.approvedBy,
        approvedAt: users.approvedAt,
        createdAt: users.createdAt,
        role: users.role
      }).from(users).where(eq(users.approvalStatus, 'approved')).orderBy(users.approvedAt);

      res.json({
        users: approvedUsers,
        count: approvedUsers.length
      });
    } catch (error) {
      console.error("Error fetching approved users:", error);
      res.status(500).json({ message: "Failed to fetch approved users" });
    }
  });

  // Approve, reject, or revoke user approval
  app.patch('/api/admin/users/:userId/approval', [combinedAuth, requireAdmin], async (req, res) => {
    try {
      const { userId } = req.params;
      const { action, reason } = req.body; // action: 'approve', 'reject', or 'revoke'
      const adminUserId = req.user.claims?.sub || req.user.claims?.id;

      if (!['approve', 'reject', 'revoke'].includes(action)) {
        return res.status(400).json({ message: "Invalid action. Use 'approve', 'reject', or 'revoke'" });
      }

      // Security check: Prevent self-revocation and admin revocation
      if (action === 'revoke') {
        if (userId === adminUserId) {
          return res.status(403).json({ message: "Cannot revoke your own access" });
        }

        // Check if target user is an admin
        const [targetUser] = await db.select({
          role: users.role,
          email: users.email
        }).from(users).where(eq(users.id, userId)).limit(1);

        if (!targetUser) {
          return res.status(404).json({ message: "User not found" });
        }

        if (targetUser.role === 'admin') {
          return res.status(403).json({ message: "Cannot revoke access for admin users" });
        }
      }

      const updateData: any = {
        approvedBy: adminUserId,
        approvedAt: new Date(),
        updatedAt: new Date()
      };

      if (action === 'approve') {
        updateData.isApproved = true;
        updateData.approvalStatus = 'approved';
        updateData.rejectedReason = null; // Clear any previous rejection reason
      } else if (action === 'reject') {
        updateData.isApproved = false;
        updateData.approvalStatus = 'rejected';
        updateData.rejectedReason = reason || 'No reason provided';
      } else if (action === 'revoke') {
        updateData.isApproved = false;
        updateData.approvalStatus = 'pending';
        updateData.rejectedReason = reason || 'Access revoked by administrator';
        updateData.approvedBy = null;
        updateData.approvedAt = null;
      }

      const [updatedUser] = await db.update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          username: users.username,
          email: users.email,
          approvalStatus: users.approvalStatus,
          isApproved: users.isApproved
        });

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        message: `User ${action}d successfully`,
        user: updatedUser
      });
    } catch (error) {
      console.error("Error updating user approval:", error);
      res.status(500).json({ message: "Failed to update user approval status" });
    }
  });

  // Get admin user stats
  app.get('/api/admin/stats', [combinedAuth, requireAdmin], async (req, res) => {
    try {
      const allUsers = await db.select({
        approvalStatus: users.approvalStatus,
        role: users.role
      }).from(users);

      const stats = {
        total: allUsers.length,
        pending: allUsers.filter(u => u.approvalStatus === 'pending').length,
        approved: allUsers.filter(u => u.approvalStatus === 'approved').length,
        rejected: allUsers.filter(u => u.approvalStatus === 'rejected').length,
        admins: allUsers.filter(u => u.role === 'admin').length
      };

      res.json(stats);
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ message: "Failed to fetch admin stats" });
    }
  });

  // ========== PUBLIC ROUTES (No Authentication Required) ==========
  
  // Contact form submission - public endpoint
  app.post('/api/contact', async (req, res) => {
    try {
      // Validate request body
      const contactSchema = z.object({
        name: z.string().min(2, 'Name must be at least 2 characters'),
        email: z.string().email('Please enter a valid email address'),
        message: z.string().min(10, 'Message must be at least 10 characters'),
      });

      const { name, email, message } = contactSchema.parse(req.body);

      // Send email using SendGrid
      const emailSent = await sendContactFormEmail(name, email, message);

      if (emailSent) {
        res.json({ 
          success: true, 
          message: 'Message sent successfully!' 
        });
      } else {
        console.error('Failed to send contact form email');
        res.status(500).json({ 
          success: false, 
          message: 'Failed to send message. Please try again later.' 
        });
      }

    } catch (error) {
      console.error('Contact form submission error:', error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid form data',
          errors: error.errors.map(e => e.message)
        });
      }

      res.status(500).json({ 
        success: false,
        message: 'Server error. Please try again later.' 
      });
    }
  });

  // ========== VISITOR TRACKING ENDPOINTS ==========
  
  // Hash IP address for privacy-preserving tracking
  function hashIP(ip: string): string {
    return crypto.createHash('sha256').update(ip + 'salt').digest('hex');
  }

  // Record page visit (called by frontend on route changes)
  app.post('/api/track/visit', async (req, res) => {
    try {
      const { path, referrer } = req.body;
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || '';
      
      await db.insert(pageVisits).values({
        path: path || '/',
        ipHash: hashIP(ip),
        userAgent: userAgent.slice(0, 500), // Limit length
        referrer: referrer || null,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error recording page visit:", error);
      res.status(500).json({ message: "Failed to record visit" });
    }
  });

  // Get visitor statistics (admin only)
  app.get('/api/admin/visitor-stats', [combinedAuth, requireAdmin], async (req, res) => {
    try {
      const { days = 30 } = req.query;
      const daysCount = Math.min(parseInt(days as string) || 30, 365);
      
      // Get recent page visits
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysCount);
      
      const recentVisits = await db.select({
        date: sql`DATE(${pageVisits.timestamp})`,
        visits: sql`COUNT(*)`,
        uniqueVisitors: sql`COUNT(DISTINCT ${pageVisits.ipHash})`
      })
      .from(pageVisits)
      .where(gte(pageVisits.timestamp, cutoffDate))
      .groupBy(sql`DATE(${pageVisits.timestamp})`)
      .orderBy(sql`DATE(${pageVisits.timestamp}) DESC`);

      // Get top pages
      const topPages = await db.select({
        path: pageVisits.path,
        visits: sql`COUNT(*)`,
        uniqueVisitors: sql`COUNT(DISTINCT ${pageVisits.ipHash})`
      })
      .from(pageVisits)
      .where(gte(pageVisits.timestamp, cutoffDate))
      .groupBy(pageVisits.path)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

      // Get total counts
      const [totalStats] = await db.select({
        totalVisits: sql`COUNT(*)`,
        uniqueVisitors: sql`COUNT(DISTINCT ${pageVisits.ipHash})`
      }).from(pageVisits);

      res.json({
        totalVisits: totalStats.totalVisits || 0,
        uniqueVisitors: totalStats.uniqueVisitors || 0,
        recentVisits,
        topPages,
        period: `${daysCount} days`
      });
    } catch (error) {
      console.error("Error fetching visitor stats:", error);
      res.status(500).json({ message: "Failed to fetch visitor statistics" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}