// Modern Google Location History parser - handles timelineObjects format only

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
  return results;
}

// Parse legacy array format (direct location objects)
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

  console.log(`🔍 Processing legacy array with ${dataArray.length} elements`);
  
  dataArray.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    
    // Handle different legacy location formats
    let lat: number | undefined;
    let lng: number | undefined; 
    let timestamp: Date | undefined;
    
    // Format 1: latitudeE7/longitudeE7 with timestampMs
    if (item.latitudeE7 !== undefined && item.longitudeE7 !== undefined) {
      lat = item.latitudeE7 / 1e7;
      lng = item.longitudeE7 / 1e7;
      
      if (item.timestampMs) {
        const ms = parseInt(item.timestampMs, 10);
        timestamp = !isNaN(ms) ? new Date(ms) : undefined;
      }
    }
    // Format 2: Direct lat/lng with timestamp
    else if (typeof item.latitude === 'number' && typeof item.longitude === 'number') {
      lat = item.latitude;
      lng = item.longitude;
      
      if (item.timestamp) {
        const parsed = parseToUTCDate(item.timestamp);
        timestamp = parsed || undefined;
      }
    }
    // Format 3: locations array element
    else if (item.locations && Array.isArray(item.locations) && item.locations.length > 0) {
      const loc = item.locations[0];
      if (loc.latitudeE7 !== undefined && loc.longitudeE7 !== undefined) {
        lat = loc.latitudeE7 / 1e7;
        lng = loc.longitudeE7 / 1e7;
        
        if (loc.timestampMs) {
          const ms = parseInt(loc.timestampMs, 10);
          timestamp = !isNaN(ms) ? new Date(ms) : undefined;
        }
      }
    }
    
    // Add valid points only
    if (lat !== undefined && lng !== undefined && timestamp && !isNaN(lat) && !isNaN(lng)) {
      // Skip equator/prime meridian points (usually GPS errors)
      if (lat !== 0 || lng !== 0) {
        results.push({
          lat,
          lng,
          timestamp,
          activity: 'route'
        });
      }
    }
    
    // Progress logging for large datasets
    if (index > 0 && index % 10000 === 0) {
      console.log(`📊 Processed ${index}/${dataArray.length} elements, found ${results.length} valid points`);
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
    results.push(...legacyResults);
  }
  else {
    console.warn('❌ Unsupported format - expected timelineObjects array or legacy location array');
    console.log('Found keys:', typeof jsonData === 'object' ? Object.keys(jsonData).slice(0, 10).join(', ') : typeof jsonData);
    return results;
  }

  // Apply basic deduplication
  console.log(`🔄 Applying deduplication to ${results.length} points...`);
  
  const deduplicated = results.filter((point, index) => {
    // Check if this point is a duplicate of any previous point
    for (let i = 0; i < index; i++) {
      const other = results[i];
      const latDiff = Math.abs(point.lat - other.lat);
      const lngDiff = Math.abs(point.lng - other.lng);
      const timeDiff = Math.abs(point.timestamp.getTime() - other.timestamp.getTime());
      
      // Consider points duplicates if very close in space and time
      if (latDiff < 0.0001 && lngDiff < 0.0001 && timeDiff < 60000) { // 60 seconds
        return false;
      }
    }
    return true;
  });

  const removedCount = results.length - deduplicated.length;
  if (removedCount > 0) {
    console.log(`🧹 Removed ${removedCount} duplicate points`);
  }

  console.log(`✅ Parsing complete: ${deduplicated.length} unique location points extracted`);
  return deduplicated;
}

// Validation function - handles both modern timelineObjects and legacy array formats
export function validateGoogleLocationHistory(jsonData: any): boolean {
  if (!jsonData) return false;

  // Handle modern timelineObjects format
  if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    console.log(`✅ Modern timelineObjects format with ${jsonData.timelineObjects.length} objects`);
    return jsonData.timelineObjects.length > 0;
  }
  
  // Handle legacy array format (direct array or object with numeric keys)
  if (Array.isArray(jsonData)) {
    console.log(`✅ Legacy array format with ${jsonData.length} elements`);
    return jsonData.length > 0;
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