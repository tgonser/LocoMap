// Location presence detection from Google location visit/activity data
// Separate from timelinePath route visualization to preserve existing functionality

import { DailyPresence } from "../shared/schema";
import { batchReverseGeocode } from "./geocodingService";

// Google location JSON types for visit/activity parsing
interface ModernExport {
  timelineObjects: Array<{
    placeVisit?: {
      location?: {
        latitudeE7?: number;
        longitudeE7?: number;
      };
      duration?: {
        startTimestamp?: string;
        endTimestamp?: string;
      };
    };
    activitySegment?: {
      startLocation?: {
        latitudeE7?: number;
        longitudeE7?: number;
      };
      endLocation?: {
        latitudeE7?: number;
        longitudeE7?: number;
      };
      duration?: {
        startTimestamp?: string;
        endTimestamp?: string;
      };
    };
  }>;
}

interface LocationSample {
  date: string; // YYYY-MM-DD
  lat: number;
  lng: number;
  durationMs: number;
  provenance: 'visit' | 'activity';
  timestamp: Date;
}

// Parse timestamp from Google location format
function parseToUTCDate(timestampStr: string): Date | null {
  try {
    if (timestampStr.endsWith('Z')) {
      return new Date(timestampStr);
    } else {
      return new Date(timestampStr + 'Z');
    }
  } catch {
    return null;
  }
}

// Generate consistent date key (YYYY-MM-DD) using local time
function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Extract visit and activity location samples from Google location JSON
 * Focuses on placeVisit (stationary periods) and activitySegment (movement periods)
 */
export function parseVisitsActivitiesModern(jsonData: any, year: number): LocationSample[] {
  const samples: LocationSample[] = [];
  
  console.log(`🏠 Parsing visits/activities for presence detection in ${year}...`);
  
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  
  // Check if this is old format (array of locations) or new format (timelineObjects)
  const isOldFormat = Array.isArray(jsonData) || (typeof jsonData === 'object' && Object.keys(jsonData)[0] === '0');
  
  if (isOldFormat) {
    console.log(`📍 Processing MOBILE DOWNLOAD with ${Array.isArray(jsonData) ? jsonData.length : Object.keys(jsonData).length} total items for ${year}`);
    
    // Convert object with numeric keys to array if needed
    const allItems = Array.isArray(jsonData) ? jsonData : Object.values(jsonData);
    
    // Find the boundary between activity/visit data and timelinePath data
    let boundaryIndex = allItems.length;
    console.log(`🔍 Scanning ${allItems.length} items to find activity/visit vs timelinePath boundary...`);
    
    // Sample items to detect the boundary (check every 1000th item for efficiency)
    for (let i = 0; i < allItems.length; i += 1000) {
      const item = allItems[i];
      if (item && typeof item === 'object') {
        // If we find timelinePath but no placeVisit/activitySegment, we've hit the boundary
        if (item.timelinePath && !item.placeVisit && !item.activitySegment) {
          boundaryIndex = i;
          console.log(`📍 Found boundary at index ${i} - timelinePath section starts here`);
          break;
        }
      }
    }
    
    const activityVisitSection = allItems.slice(0, boundaryIndex);
    console.log(`🏠 Analyzing first ${activityVisitSection.length} items for activity/visit data in ${year}`);
    
    // Group locations by day and sample representative points for presence detection
    const dailyGroups: { [date: string]: any[] } = {};
    
    activityVisitSection.forEach((item: any) => {
      // Parse placeVisit records (stationary periods - high value for presence)
      if (item.placeVisit) {
        const visit = item.placeVisit;
        if (visit.location?.latitudeE7 && visit.location?.longitudeE7 && 
            visit.duration?.startTimestamp && visit.duration?.endTimestamp) {
          
          const startTime = parseToUTCDate(visit.duration.startTimestamp);
          const endTime = parseToUTCDate(visit.duration.endTimestamp);
          
          if (startTime && endTime && startTime >= yearStart && startTime < yearEnd) {
            const date = getLocalDateKey(startTime);
            const durationMs = endTime.getTime() - startTime.getTime();
            
            if (!dailyGroups[date]) {
              dailyGroups[date] = [];
            }
            
            dailyGroups[date].push({
              lat: visit.location.latitudeE7 / 1e7,
              lng: visit.location.longitudeE7 / 1e7,
              timestamp: startTime,
              durationMs,
              accuracy: 20, // High accuracy for place visits
              type: 'visit'
            });
          }
        }
      }
      
      // Parse activitySegment records (movement periods - fallback for presence)
      if (item.activitySegment) {
        const activity = item.activitySegment;
        if (activity.duration?.startTimestamp && activity.duration?.endTimestamp) {
          
          const startTime = parseToUTCDate(activity.duration.startTimestamp);
          const endTime = parseToUTCDate(activity.duration.endTimestamp);
          
          if (startTime && endTime && startTime >= yearStart && startTime < yearEnd) {
            const date = getLocalDateKey(startTime);
            const durationMs = endTime.getTime() - startTime.getTime();
            
            // Use start location if available, otherwise end location
            let lat, lng;
            if (activity.startLocation?.latitudeE7 && activity.startLocation?.longitudeE7) {
              lat = activity.startLocation.latitudeE7 / 1e7;
              lng = activity.startLocation.longitudeE7 / 1e7;
            } else if (activity.endLocation?.latitudeE7 && activity.endLocation?.longitudeE7) {
              lat = activity.endLocation.latitudeE7 / 1e7;
              lng = activity.endLocation.longitudeE7 / 1e7;
            }
            
            if (lat && lng) {
              if (!dailyGroups[date]) {
                dailyGroups[date] = [];
              }
              
              dailyGroups[date].push({
                lat,
                lng,
                timestamp: startTime,
                durationMs,
                accuracy: 50, // Medium accuracy for activities
                type: 'activity'
              });
            }
          }
        }
      }
      
      // Legacy timelinePath parsing (skip - this is what route visualization uses)
      if (item.timelinePath && Array.isArray(item.timelinePath) && item.startTime) {
        const segmentStartTime = parseToUTCDate(item.startTime);
        if (!segmentStartTime) return;
        
        item.timelinePath.forEach((point: any) => {
          if (point.latE7 && point.lngE7) {
            let pointTimestamp = segmentStartTime;
            
            // Calculate actual point timestamp if time offset available
            if (point.time) {
              const pointTime = parseToUTCDate(point.time);
              if (pointTime) pointTimestamp = pointTime;
            } else if (point.durationMinutesOffsetFromStartTime !== undefined) {
              pointTimestamp = new Date(segmentStartTime.getTime() + point.durationMinutesOffsetFromStartTime * 60 * 1000);
            }
            
            if (pointTimestamp >= yearStart && pointTimestamp < yearEnd) {
              const date = getLocalDateKey(pointTimestamp);
              
              if (!dailyGroups[date]) {
                dailyGroups[date] = [];
              }
              
              dailyGroups[date].push({
                lat: point.latE7 / 1e7,
                lng: point.lngE7 / 1e7,
                timestamp: pointTimestamp,
                accuracy: 50 // Default good accuracy for timelinePath points
              });
            }
          }
        });
      }
      // Fallback: simple timestampMs format (if any exist)
      else if (item.timestampMs && item.latitudeE7 && item.longitudeE7) {
        const timestamp = new Date(parseInt(item.timestampMs));
        
        if (timestamp >= yearStart && timestamp < yearEnd) {
          const date = getLocalDateKey(timestamp);
          
          if (!dailyGroups[date]) {
            dailyGroups[date] = [];
          }
          
          dailyGroups[date].push({
            lat: item.latitudeE7 / 1e7,
            lng: item.longitudeE7 / 1e7,
            timestamp,
            accuracy: item.accuracy || 100
          });
        }
      }
    });
    
    // For each day, select the most representative location (highest accuracy/lowest value)
    Object.entries(dailyGroups).forEach(([date, dayLocations]) => {
      if (dayLocations.length > 0) {
        // Sort by accuracy (lower is better) and take the best point
        const bestLocation = dayLocations.sort((a, b) => a.accuracy - b.accuracy)[0];
        
        samples.push({
          date,
          lat: bestLocation.lat,
          lng: bestLocation.lng,
          durationMs: 24 * 60 * 60 * 1000, // Assume full day presence
          provenance: 'visit',
          timestamp: bestLocation.timestamp
        });
      }
    });
    
    console.log(`🏠 Extracted ${samples.length} daily location samples from old format for ${year}`);
    return samples;
  }
  
  // Handle new semantic format with timelineObjects
  const timelineObjects = jsonData.timelineObjects || [];
  
  if (!Array.isArray(timelineObjects)) {
    console.warn(`🚫 No valid timelineObjects found in JSON data for ${year}`);
    return samples;
  }
  
  console.log(`📍 Processing NEW FORMAT with ${timelineObjects.length} timeline objects for ${year}`);
  
  timelineObjects.forEach((obj: any) => {
    // Parse placeVisit records (stationary periods - high value for presence)
    if (obj.placeVisit) {
      const visit = obj.placeVisit;
      if (visit.location?.latitudeE7 && visit.location?.longitudeE7 && 
          visit.duration?.startTimestamp && visit.duration?.endTimestamp) {
        
        const startTime = parseToUTCDate(visit.duration.startTimestamp);
        const endTime = parseToUTCDate(visit.duration.endTimestamp);
        
        if (startTime && endTime && startTime >= yearStart && startTime < yearEnd) {
          const lat = visit.location.latitudeE7 / 1e7;
          const lng = visit.location.longitudeE7 / 1e7;
          const durationMs = endTime.getTime() - startTime.getTime();
          const date = getLocalDateKey(startTime);
          
          samples.push({
            date,
            lat,
            lng,
            durationMs,
            provenance: 'visit',
            timestamp: startTime
          });
        }
      }
    }
    
    // Parse activitySegment records (movement periods - fallback for presence)
    if (obj.activitySegment) {
      const activity = obj.activitySegment;
      if (activity.duration?.startTimestamp && activity.duration?.endTimestamp) {
        
        const startTime = parseToUTCDate(activity.duration.startTimestamp);
        const endTime = parseToUTCDate(activity.duration.endTimestamp);
        
        if (startTime && endTime && startTime >= yearStart && startTime < yearEnd) {
          const durationMs = endTime.getTime() - startTime.getTime();
          const date = getLocalDateKey(startTime);
          
          // Use start location if available, otherwise end location
          let lat: number | undefined, lng: number | undefined;
          
          if (activity.startLocation?.latitudeE7 && activity.startLocation?.longitudeE7) {
            lat = activity.startLocation.latitudeE7 / 1e7;
            lng = activity.startLocation.longitudeE7 / 1e7;
          } else if (activity.endLocation?.latitudeE7 && activity.endLocation?.longitudeE7) {
            lat = activity.endLocation.latitudeE7 / 1e7;
            lng = activity.endLocation.longitudeE7 / 1e7;
          }
          
          if (lat !== undefined && lng !== undefined) {
            samples.push({
              date,
              lat,
              lng,
              durationMs,
              provenance: 'activity',
              timestamp: startTime
            });
          }
        }
      }
    }
  });
  
  console.log(`🏠 Extracted ${samples.length} visit/activity samples`);
  return samples;
}

/**
 * Select up to maxPerDay representative samples per day
 * Prioritizes: 1) Longest placeVisits, 2) Spaced activities throughout day
 */
export function selectDailySamples(samples: LocationSample[], maxPerDay: number = 3): LocationSample[] {
  const samplesByDate = new Map<string, LocationSample[]>();
  
  // Group samples by date
  samples.forEach(sample => {
    if (!samplesByDate.has(sample.date)) {
      samplesByDate.set(sample.date, []);
    }
    samplesByDate.get(sample.date)!.push(sample);
  });
  
  const selectedSamples: LocationSample[] = [];
  
  samplesByDate.forEach((daySamples, date) => {
    // Sort by provenance priority (visits first) then by duration (longest first)
    daySamples.sort((a, b) => {
      if (a.provenance !== b.provenance) {
        return a.provenance === 'visit' ? -1 : 1; // visits first
      }
      return b.durationMs - a.durationMs; // longest duration first
    });
    
    // Take up to maxPerDay samples, prioritizing visits and long durations
    const selected = daySamples.slice(0, maxPerDay);
    selectedSamples.push(...selected);
  });
  
  console.log(`🏠 Selected ${selectedSamples.length} representative samples from ${samplesByDate.size} days`);
  return selectedSamples;
}

/**
 * Calculate distance between two coordinates using Haversine formula (returns miles)
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Resolve state/country for location samples using cache-first approach
 * Attempts to find cached results within radiusMiles, falls back to geocoding API
 */
export async function resolveSamples(
  samples: LocationSample[], 
  existingCache: Array<{lat: number, lng: number, state?: string, country: string}>,
  radiusMiles: number = 20
): Promise<Array<LocationSample & {state?: string, country: string, resolution: 'cache' | 'api'}>> {
  
  const resolved: Array<LocationSample & {state?: string, country: string, resolution: 'cache' | 'api'}> = [];
  const needsGeocoding: LocationSample[] = [];
  
  console.log(`🗺️ Resolving ${samples.length} samples using cache (${radiusMiles}mi radius) + API fallback`);
  
  // Try to resolve each sample from cache first
  for (const sample of samples) {
    let bestMatch: {state?: string, country: string, distance: number} | null = null;
    
    // Search cache for nearby locations
    for (const cached of existingCache) {
      const distance = calculateDistance(sample.lat, sample.lng, cached.lat, cached.lng);
      
      if (distance <= radiusMiles) {
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = {
            state: cached.state,
            country: cached.country,
            distance
          };
        }
      }
    }
    
    if (bestMatch) {
      // Found cached result within radius
      resolved.push({
        ...sample,
        state: bestMatch.state,
        country: bestMatch.country,
        resolution: 'cache'
      });
    } else {
      // Need to geocode this location
      needsGeocoding.push(sample);
    }
  }
  
  console.log(`🗺️ Cache hits: ${resolved.length}, API lookups needed: ${needsGeocoding.length}`);
  
  // Geocode remaining samples
  if (needsGeocoding.length > 0) {
    const coordinates = needsGeocoding.map(s => ({ lat: s.lat, lng: s.lng }));
    const geocodeResults = await batchReverseGeocode(coordinates);
    
    needsGeocoding.forEach((sample, index) => {
      const result = geocodeResults.results[index];
      if (result && result.country) {
        resolved.push({
          ...sample,
          state: result.state,
          country: result.country,
          resolution: 'api'
        });
      } else {
        // Fallback for failed geocoding
        resolved.push({
          ...sample,
          state: undefined,
          country: 'Unknown',
          resolution: 'api'
        });
      }
    });
  }
  
  return resolved;
}

/**
 * Build daily presence data by consolidating multiple samples per day
 * Uses majority vote for state/country, tie-breaks by longest duration
 * FIXED: Now creates records for ALL days in the date range, not just travel days
 */
export function buildDailyPresence(
  resolvedSamples: Array<LocationSample & {state?: string, country: string, resolution: 'cache' | 'api'}>,
  startDate: Date,
  endDate: Date
): DailyPresence[] {
  const presenceByDate = new Map<string, Array<LocationSample & {state?: string, country: string, resolution: 'cache' | 'api'}>>();
  
  // Group by date
  resolvedSamples.forEach(sample => {
    if (!presenceByDate.has(sample.date)) {
      presenceByDate.set(sample.date, []);
    }
    presenceByDate.get(sample.date)!.push(sample);
  });
  
  const dailyPresence: DailyPresence[] = [];
  
  // CRITICAL FIX: Generate ALL days in the requested range
  const currentDate = new Date(startDate);
  let lastKnownLocation: DailyPresence | null = null;
  
  // Handle edge case: find the first available location for leading empty days
  const firstSample = resolvedSamples.length > 0 ? resolvedSamples[0] : null;
  
  while (currentDate <= endDate) {
    const dateKey = getLocalDateKey(currentDate);
    const daySamples = presenceByDate.get(dateKey);
    
    if (daySamples && daySamples.length > 0) {
      // This day has actual samples - process normally
      const locationCounts = new Map<string, {count: number, totalDuration: number, sample: typeof daySamples[0]}>();
      
      daySamples.forEach(sample => {
        const key = `${sample.state || 'N/A'}_${sample.country}`;
        if (!locationCounts.has(key)) {
          locationCounts.set(key, {count: 0, totalDuration: 0, sample});
        }
        const entry = locationCounts.get(key)!;
        entry.count++;
        entry.totalDuration += sample.durationMs;
      });
      
      // Find best location by count, then by total duration
      let bestLocation: {count: number, totalDuration: number, sample: typeof daySamples[0]} | null = null;
      
      for (const location of Array.from(locationCounts.values())) {
        if (!bestLocation || 
            location.count > bestLocation.count ||
            (location.count === bestLocation.count && location.totalDuration > bestLocation.totalDuration)) {
          bestLocation = location;
        }
      }
      
      if (bestLocation) {
        const dayPresence: DailyPresence = {
          date: dateKey,
          lat: bestLocation.sample.lat,
          lng: bestLocation.sample.lng,
          state: bestLocation.sample.state,
          country: bestLocation.sample.country,
          provenance: bestLocation.sample.provenance,
          resolution: bestLocation.sample.resolution,
          sampleCount: daySamples.length
        };
        
        dailyPresence.push(dayPresence);
        lastKnownLocation = dayPresence; // Remember this location
      }
    } else if (lastKnownLocation) {
      // No samples for this day - carry forward the last known location
      dailyPresence.push({
        date: dateKey,
        lat: lastKnownLocation.lat,
        lng: lastKnownLocation.lng,
        state: lastKnownLocation.state,
        country: lastKnownLocation.country,
        provenance: 'carried_forward' as any, // Mark as carried forward
        resolution: lastKnownLocation.resolution,
        sampleCount: 0 // No samples for this day
      });
    } else if (firstSample) {
      // Leading days with no prior location - use first available sample
      dailyPresence.push({
        date: dateKey,
        lat: firstSample.lat,
        lng: firstSample.lng,
        state: firstSample.state,
        country: firstSample.country,
        provenance: 'estimated' as any, // Mark as estimated from first sample
        resolution: firstSample.resolution,
        sampleCount: 0 // No samples for this day
      });
    }
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  console.log(`🏠 Built daily presence for ${dailyPresence.length} days (covering complete date range)`);
  return dailyPresence;
}

/**
 * Main function: Generate daily presence data from Google location JSON
 * Uses visit/activity records to determine state/country presence per day
 */
export async function getDailyPresence(
  jsonData: ModernExport, 
  year: number,
  existingCache: Array<{lat: number, lng: number, state?: string, country: string}> = []
): Promise<DailyPresence[]> {
  
  console.log(`🏠 Starting presence detection for ${year}...`);
  
  // Step 1: Parse visits and activities
  const samples = parseVisitsActivitiesModern(jsonData, year);
  
  if (samples.length === 0) {
    console.log(`🏠 No visit/activity samples found for ${year}`);
    return [];
  }
  
  // Step 2: Select representative samples per day
  const selectedSamples = selectDailySamples(samples, 3);
  
  // Step 3: Resolve state/country using cache + API
  const resolvedSamples = await resolveSamples(selectedSamples, existingCache, 20);
  
  // Step 4: Build daily presence data (TODO: This function needs date range parameters for complete coverage)
  // For now, estimate the range from the samples - this is a limitation of the current interface
  const startDate = new Date(`${year}-01-01`);
  const endDate = new Date(`${year}-12-31`);
  const dailyPresence = buildDailyPresence(resolvedSamples, startDate, endDate);
  
  console.log(`🏠 Presence detection complete: ${dailyPresence.length} days with location presence`);
  return dailyPresence;
}