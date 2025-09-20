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

// Parse modern Google Location History timelineObjects format
function parseModernFormat(jsonData: ModernExport): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  console.log(`🎯 Starting modern format parser for ${jsonData.timelineObjects.length} timeline objects`);

  // PHASE 1: Extract segments from activitySegment and placeVisit
  const segments: Segment[] = [];
  
  jsonData.timelineObjects.forEach((obj) => {
    // Handle activitySegment
    if (obj.activitySegment) {
      const seg = obj.activitySegment;
      const duration = seg.duration;
      
      if (duration?.startTimestamp && duration?.endTimestamp) {
        const startUTC = toUTCMillis(duration.startTimestamp);
        const endUTC = toUTCMillis(duration.endTimestamp);
        
        if (startUTC !== null && endUTC !== null && endUTC >= startUTC) {
          // Get activity type from topCandidate.type, not activities array
          const activityType = seg.activity?.topCandidate?.type?.toLowerCase() || 
                              seg.activityType?.toLowerCase() || 'unknown';
          
          segments.push({
            kind: 'activity',
            startUTC,
            endUTC,
            activityType,
            raw: seg
          });
          
          console.log(`🚗 Activity: ${activityType} (${new Date(startUTC).toISOString()})`);
        }
      }
    }
    
    // Handle placeVisit
    if (obj.placeVisit) {
      const visit = obj.placeVisit;
      const duration = visit.duration;
      
      if (duration?.startTimestamp && duration?.endTimestamp) {
        const startUTC = toUTCMillis(duration.startTimestamp);
        const endUTC = toUTCMillis(duration.endTimestamp);
        
        if (startUTC !== null && endUTC !== null && endUTC >= startUTC) {
          segments.push({
            kind: 'visit',
            startUTC,
            endUTC,
            activityType: 'still',
            raw: visit
          });
          
          console.log(`📍 Visit: ${new Date(startUTC).toISOString()}`);
          
          // Add place visit location as a single point
          const location = visit.location;
          if (location?.latitudeE7 !== undefined && location?.longitudeE7 !== undefined) {
            const lat = location.latitudeE7 / 1e7;
            const lng = location.longitudeE7 / 1e7;
            
            results.push({
              lat,
              lng,
              timestamp: new Date(startUTC),
              activity: 'still'
            });
          }
        }
      }
    }
  });

  // Sort segments by start time for efficient lookup
  segments.sort((a, b) => a.startUTC - b.startUTC);
  console.log(`✅ Extracted ${segments.length} segments`);

  // PHASE 2: Extract timeline path points from timelinePath.point[]
  const pathPoints: Array<{lat: number, lng: number, tUTC: number}> = [];
  
  jsonData.timelineObjects.forEach((obj) => {
    // Handle timelinePath.point[] with latE7, lngE7, time (ISO)
    if (obj.timelinePath?.point && Array.isArray(obj.timelinePath.point)) {
      obj.timelinePath.point.forEach((point) => {
        if (point.latE7 !== undefined && point.lngE7 !== undefined && point.time) {
          const lat = point.latE7 / 1e7;
          const lng = point.lngE7 / 1e7;
          const timestamp = parseToUTCDate(point.time); // Use proper UTC parsing
          
          if (timestamp) {
            pathPoints.push({
              lat,
              lng,
              tUTC: timestamp.getTime()
            });
          }
        }
      });
    }
  });

  // Sort path points by time
  pathPoints.sort((a, b) => a.tUTC - b.tUTC);
  console.log(`🎯 Extracted ${pathPoints.length} timeline path points`);

  // PHASE 3: Associate path points with segments, avoiding double counting in visit windows
  pathPoints.forEach((point) => {
    let bestSegment: Segment | null = null;
    let smallestWindow = Infinity;

    // Find segments that contain this point
    for (const segment of segments) {
      if (point.tUTC >= segment.startUTC && point.tUTC <= segment.endUTC) {
        const windowSize = segment.endUTC - segment.startUTC;
        if (windowSize < smallestWindow) {
          smallestWindow = windowSize;
          bestSegment = segment;
        }
      }
    }

    // Skip path points within visit windows to avoid double counting with place markers
    if (bestSegment && bestSegment.kind === 'visit') {
      return; // Skip this point - we already added the place visit marker
    }

    // Add point with appropriate activity type
    const activityType = bestSegment ? bestSegment.activityType : 'route';
    
    results.push({
      lat: point.lat,
      lng: point.lng,
      timestamp: new Date(point.tUTC),
      activity: activityType
    });
  });

  console.log(`🎯 Modern parser extracted ${results.length} total points`);
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