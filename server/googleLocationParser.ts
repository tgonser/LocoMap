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

// Main parser function - handles only modern timelineObjects format
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
  else {
    console.warn('❌ Unsupported format - expected timelineObjects array');
    console.log('This parser only supports the modern Google Location History export format');
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

// Validation function for modern format
export function validateGoogleLocationHistory(jsonData: any): boolean {
  if (!jsonData) return false;

  // Only validate modern format with timelineObjects
  if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    return jsonData.timelineObjects.length > 0;
  }

  return false;
}