// Modern Google Location History parser - handles timelineObjects format only

// Helper function for consistent local date key generation
function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type ISO = string;

interface ActivityTopCandidate { type?: string }
interface Activity { topCandidate?: ActivityTopCandidate }

interface Duration { startTimestamp?: ISO; endTimestamp?: ISO }

interface Waypoint { latE7: number; lngE7: number; }
interface WaypointPath { waypoints?: Waypoint[] }

interface RawPathPoint { latE7: number; lngE7: number; timestampMs?: string }
interface SimplifiedRawPath { points?: RawPathPoint[] }

interface TimelinePoint { latE7: number; lngE7: number; time?: ISO }
interface TimelinePath { point?: TimelinePoint[] }

interface ActivitySegment {
  startLocation?: { latitudeE7: number; longitudeE7: number };
  endLocation?:   { latitudeE7: number; longitudeE7: number };
  duration?: Duration;
  activity?: Activity;
  activityType?: string;
  waypointPath?: WaypointPath;
  simplifiedRawPath?: SimplifiedRawPath;
}

interface PlaceLocation {
  latitudeE7: number;
  longitudeE7: number;
  address?: string;
}

interface PlaceVisit {
  location?: PlaceLocation;
  duration?: Duration;
}

interface TimelineObject {
  activitySegment?: ActivitySegment;
  placeVisit?: PlaceVisit;
  timelinePath?: TimelinePath;
}

interface ModernExport { timelineObjects: TimelineObject[] }

export interface ParsedLocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  activity?: string;
}

interface Segment {
  kind: 'activity' | 'visit';
  startUTC: number;
  endUTC: number;
  activityType: string;
  raw: ActivitySegment | PlaceVisit;
}

// UTC timestamp parser - handles ISO strings properly
function parseToUTCDate(timestamp: string): Date | null {
  if (!timestamp) return null;
  
  // Ensure proper UTC interpretation
  const hasTimezoneInfo = /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp);
  const normalized = hasTimezoneInfo ? timestamp : timestamp + 'Z';
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms);
}

// Helper to get UTC milliseconds for comparisons
function toUTCMillis(timestamp: string): number | null {
  const date = parseToUTCDate(timestamp);
  return date ? date.getTime() : null;
}

// Parse modern Google Location History timelineObjects format - timelinePath points only
function parseModernFormat(jsonData: ModernExport): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  console.log(`🎯 Starting timelinePath-only parser for ${jsonData.timelineObjects.length} timeline objects`);

  // Extract ONLY timelinePath.point[] elements - ignore visits and activities
  jsonData.timelineObjects.forEach((obj) => {
    // Handle timelinePath.point[] with latE7, lngE7, time (ISO)
    if (obj.timelinePath?.point && Array.isArray(obj.timelinePath.point)) {
      obj.timelinePath.point.forEach((point) => {
        if (point.latE7 !== undefined && point.lngE7 !== undefined && point.time) {
          const lat = point.latE7 / 1e7;
          const lng = point.lngE7 / 1e7;
          const timestamp = parseToUTCDate(point.time);
          
          if (timestamp) {
            results.push({
              lat,
              lng,
              timestamp,
              activity: 'route'  // Simple activity type for all timeline points
            });
          }
        }
      });
    }
  });

  // Sort by timestamp for chronological order
  results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  console.log(`🎯 TimelinePath parser extracted ${results.length} total points`);
  
  // Apply deduplication as designed
  return applyDeduplication(results);
}


// Apply efficient deduplication for large datasets
function applyDeduplication(points: ParsedLocationPoint[]): ParsedLocationPoint[] {
  console.log(`🔄 Applying deduplication to ${points.length} points...`);
  
  let deduplicated: ParsedLocationPoint[];
  
  if (points.length > 100000) {
    // For large datasets, use Map-based deduplication to avoid stack overflow
    console.log(`⚡ Using efficient deduplication for ${points.length} points`);
    const seen = new Map<string, boolean>();
    deduplicated = points.filter(point => {
      // Create a key from rounded coordinates and time
      const roundedLat = Math.round(point.lat * 10000) / 10000; // 4 decimal places
      const roundedLng = Math.round(point.lng * 10000) / 10000;
      const timeKey = Math.floor(point.timestamp.getTime() / 60000); // 1-minute buckets
      const key = `${roundedLat},${roundedLng},${timeKey}`;
      
      if (seen.has(key)) {
        return false; // Duplicate
      }
      seen.set(key, true);
      return true;
    });
  } else {
    // For smaller datasets, use the original O(n²) method
    deduplicated = points.filter((point, index) => {
      for (let i = 0; i < index; i++) {
        const other = points[i];
        const latDiff = Math.abs(point.lat - other.lat);
        const lngDiff = Math.abs(point.lng - other.lng);
        const timeDiff = Math.abs(point.timestamp.getTime() - other.timestamp.getTime());
        
        if (latDiff < 0.0001 && lngDiff < 0.0001 && timeDiff < 60000) {
          return false;
        }
      }
      return true;
    });
  }

  const removedCount = points.length - deduplicated.length;
  if (removedCount > 0) {
    console.log(`🧹 Removed ${removedCount} duplicate points`);
  }

  console.log(`✅ Deduplication complete: ${deduplicated.length} unique location points`);
  return deduplicated;
}

// Parse legacy array format - extract ONLY timelinePath data, ignore visits/activities
function parseLegacyArrayFormat(jsonData: any): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  // Convert object with numeric keys to array if needed
  let dataArray: any[] = [];
  if (Array.isArray(jsonData)) {
    dataArray = jsonData;
  } else if (typeof jsonData === 'object') {
    const keys = Object.keys(jsonData).filter(key => !isNaN(Number(key))).sort((a, b) => Number(a) - Number(b));
    dataArray = keys.map(key => jsonData[key]);
  }

  console.log(`🔍 Processing legacy array with ${dataArray.length} elements, extracting ONLY timelinePath data`);
  
  dataArray.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    
    // ONLY extract timelinePath data, ignore all visits and activities
    if (item.timelinePath && Array.isArray(item.timelinePath)) {
      console.log(`📍 Found timelinePath with ${item.timelinePath.length} points`);
      
      // Parse startTime for this timelinePath segment
      let segmentStartTime: Date | undefined;
      if (item.startTime) {
        segmentStartTime = parseToUTCDate(item.startTime) || undefined;
      }
      
      // Process each point in the timelinePath
      item.timelinePath.forEach((pathPoint: any) => {
        if (!pathPoint || typeof pathPoint !== 'object') return;
        
        let lat: number | undefined;
        let lng: number | undefined;
        let timestamp: Date | undefined;
        
        // Parse geo string: "geo:lat,lng"  
        if (typeof pathPoint.point === 'string' && pathPoint.point.startsWith('geo:')) {
          const coords = pathPoint.point.replace('geo:', '').split(',');
          if (coords.length === 2) {
            const parsedLat = parseFloat(coords[0]);
            const parsedLng = parseFloat(coords[1]);
            
            if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
              lat = parsedLat;
              lng = parsedLng;
              
              // Calculate timestamp using segment start + duration offset
              if (segmentStartTime && pathPoint.durationMinutesOffsetFromStartTime) {
                const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime, 10);
                if (!isNaN(offsetMinutes)) {
                  timestamp = new Date(segmentStartTime.getTime() + (offsetMinutes * 60 * 1000));
                }
              }
            }
          }
        }
        
        // Add valid timelinePath points only
        if (lat !== undefined && lng !== undefined && timestamp && !isNaN(lat) && !isNaN(lng)) {
          if (lat !== 0 || lng !== 0) {  // Skip equator/prime meridian points
            results.push({
              lat,
              lng,
              timestamp,
              activity: 'route'
            });
          }
        }
      });
    }
    
    // Progress logging for large datasets
    if (index > 0 && index % 10000 === 0) {
      console.log(`📊 Processed ${index}/${dataArray.length} elements, found ${results.length} timelinePath points`);
    }
  });

  console.log(`✅ Legacy parser extracted ${results.length} total points`);
  return results;
}

// Main parser function - handles both modern timelineObjects and legacy array formats
export function parseGoogleLocationHistory(jsonData: any): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];

  if (!jsonData) {
    console.warn('No data provided to parser');
    return results;
  }

  console.log('🔍 Analyzing Google Location History format...');

  // Handle modern format with timelineObjects
  if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    console.log('🔍 Detected modern Google Location History format (timelineObjects)');
    const modernResults = parseModernFormat(jsonData as ModernExport);
    results.push(...modernResults);
  }
  // Handle legacy array formats or numeric-key objects
  else if (Array.isArray(jsonData) || (typeof jsonData === 'object' && Object.keys(jsonData).some(key => !isNaN(Number(key))))) {
    console.log('📊 Detected legacy array format - processing as location points');
    const legacyResults = parseLegacyArrayFormat(jsonData);
    
    // For large arrays, skip deduplication to avoid stack overflow
    if (legacyResults.length > 100000) {
      console.log(`⚡ Skipping deduplication for ${legacyResults.length} points to avoid stack overflow`);
      console.log(`✅ Parsing complete: ${legacyResults.length} location points extracted`);
      return legacyResults;
    } else {
      results.push(...legacyResults);
    }
  }
  else {
    console.warn('❌ Unsupported format - expected timelineObjects array or legacy location array');
    console.log('Found keys:', typeof jsonData === 'object' ? Object.keys(jsonData).slice(0, 10).join(', ') : typeof jsonData);
    return results;
  }

  // Apply deduplication
  return applyDeduplication(results);
}

// Validation function - handles both modern timelineObjects and legacy array formats
export function validateGoogleLocationHistory(jsonData: any): boolean {
  if (!jsonData) return false;

  // Handle modern timelineObjects format
  if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    console.log(`✅ Modern timelineObjects format with ${jsonData.timelineObjects.length} objects`);
    return jsonData.timelineObjects.length > 0;
  }
  
  // Handle array format - check for nested timeline objects
  if (Array.isArray(jsonData)) {
    // Sample first few elements to detect format
    const sampleSize = Math.min(jsonData.length, 100);
    let hasNestedTimelineObjects = false;
    let hasDirectTimeline = false;
    let hasMobileFormat = false;
    
    for (let i = 0; i < sampleSize; i++) {
      const element = jsonData[i];
      if (element?.timelineObjects && Array.isArray(element.timelineObjects) && element.timelineObjects.length > 0) {
        hasNestedTimelineObjects = true;
      }
      if (element?.activitySegment || element?.placeVisit) {
        hasDirectTimeline = true;
      }
      if (element?.activity || element?.visit) {
        hasMobileFormat = true;
      }
    }
    
    if (hasNestedTimelineObjects || hasDirectTimeline) {
      console.log(`✅ Semantic Location History format (timelineObjects within array) with ${jsonData.length} elements`);
      return jsonData.length > 0;
    } else if (hasMobileFormat) {
      console.log(`✅ Legacy mobile array format with ${jsonData.length} elements`);
      return jsonData.length > 0;
    } else {
      console.log(`✅ Generic array format with ${jsonData.length} elements`);
      return jsonData.length > 0;
    }
  }
  
  // Handle large arrays that get parsed as objects with numeric keys
  if (typeof jsonData === 'object') {
    const keys = Object.keys(jsonData);
    const isNumericKeyObject = keys.length > 0 && keys.every(key => !isNaN(Number(key)));
    
    if (isNumericKeyObject) {
      console.log(`✅ Legacy array-like object with ${keys.length} elements`);
      return keys.length > 0;
    }
  }

  console.log(`❌ Invalid format - expected timelineObjects array or legacy location array`);
  return false;
}