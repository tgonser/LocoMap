// Mobile format is an array of timeline elements - flexible interface for various structures
export interface GoogleLocationHistoryMobileElement {
  visit?: {
    topCandidate?: {
      placeLocation?: string;
    };
    placeLocation?: string;
    timelinePath?: {
      points?: Array<{
        point?: string;
        durationMinutesOffsetFromStartTime?: string;
      }>;
    };
    points?: Array<{
      point?: string;
      durationMinutesOffsetFromStartTime?: string;
    }>;
  };
  activity?: {
    topCandidate?: {
      type?: string;
    };
    start?: string;
    end?: string;
  };
  startTime?: string;
  endTime?: string;
  point?: string;
  durationMinutesOffsetFromStartTime?: string;
  timelinePath?: {
    points?: Array<{
      point?: string;
      time?: string;
      durationMinutesOffsetFromStartTime?: string;
    }>;
  };
  // Modern mobile format
  activitySegment?: {
    duration?: {
      startTimestamp?: string;
      endTimestamp?: string;
    };
    activities?: Array<{ activityType?: string }>;
    activityType?: string;
    waypointPath?: {
      waypoints?: Array<{
        latE7?: number;
        lngE7?: number;
        timestamp?: string;
      }>;
    };
  };
  placeVisit?: {
    duration?: {
      startTimestamp?: string;
      endTimestamp?: string;
    };
    location?: {
      latitudeE7?: number;
      longitudeE7?: number;
    };
  };
}

export type GoogleLocationHistoryMobileArray = GoogleLocationHistoryMobileElement[];

// Old format - array of location objects
export interface GoogleLocationHistoryOld {
  locations: Array<{
    timestampMs: string;
    latitudeE7: number;
    longitudeE7: number;
    accuracy?: number;
    velocity?: number;
    heading?: number;
    altitude?: number;
    verticalAccuracy?: number;
    activity?: Array<{
      timestampMs: string;
      activity: Array<{
        type: string;
        confidence: number;
      }>;
    }>;
  }>;
}

export interface ParsedLocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  activity?: string;
}

// Unified timestamp parser - ensures consistent UTC interpretation everywhere
function parseToUTCDate(timestamp: string): Date | null {
  // Robust timezone detection: check for trailing offset/UTC markers
  const hasTimezoneInfo = /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp);
  const normalized = hasTimezoneInfo ? timestamp : timestamp + 'Z';
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms);
}

// Helper function to get UTC milliseconds (for comparisons)
function toUTCMillis(timestamp: string): number | null {
  const date = parseToUTCDate(timestamp);
  return date ? date.getTime() : null;
}

// Helper function to parse "geo:lat,lng" strings into coordinates (robust version)
function parseGeoString(geoString: string): {lat: number, lng: number} | null {
  if (!geoString || typeof geoString !== 'string') return null;
  
  // Use regex to handle case variations, whitespace, and URI params
  const match = geoString.match(/^geo:\s*([-+\d.]+)\s*,\s*([-+\d.]+)/i);
  if (!match) return null;
  
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  
  if (isNaN(lat) || isNaN(lng)) return null;
  
  return { lat, lng };
}

// Mobile export parser for timelineObjects format - implements 3-phase UTC matching
function parseMobileArrayFormat(jsonData: GoogleLocationHistoryMobileArray): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  console.log(`🎯 Starting mobile timelineObjects parser for ${jsonData.length} elements`);

  // PHASE 1: Extract segments from activitySegment and placeVisit
  interface MobileSegment {
    kind: 'activity' | 'visit';
    startUTC: number;
    endUTC: number;
    activityType: string;
    obj: any;
  }
  
  const segments: MobileSegment[] = [];
  
  jsonData.forEach((element, index) => {
    // Check for activitySegment structure (modern mobile format)
    if (element.activitySegment) {
      const seg = element.activitySegment;
      const duration = seg.duration || {};
      const startTime = duration.startTimestamp;
      const endTime = duration.endTimestamp;
      
      if (startTime && endTime) {
        const startUTC = toUTCMillis(startTime);
        const endUTC = toUTCMillis(endTime);
        
        if (startUTC && endUTC && endUTC >= startUTC) {
          const activityType = seg.activities?.[0]?.activityType || seg.activityType || 'unknown';
          segments.push({
            kind: 'activity',
            startUTC,
            endUTC,
            activityType: activityType.toLowerCase(),
            obj: seg
          });
          console.log(`🚗 Activity: ${activityType} (${new Date(startUTC).toISOString()})`);
        }
      }
    }
    
    // Check for placeVisit structure (modern mobile format)
    if (element.placeVisit) {
      const seg = element.placeVisit;
      const duration = seg.duration || {};
      const startTime = duration.startTimestamp;
      const endTime = duration.endTimestamp;
      
      if (startTime && endTime) {
        const startUTC = toUTCMillis(startTime);
        const endUTC = toUTCMillis(endTime);
        
        if (startUTC && endUTC && endUTC >= startUTC) {
          segments.push({
            kind: 'visit',
            startUTC,
            endUTC,
            activityType: 'still',
            obj: seg
          });
          console.log(`📍 Visit: ${new Date(startUTC).toISOString()}`);
          
          // Extract place location if available
          const location = seg.location;
          if (location && location.latitudeE7 && location.longitudeE7) {
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
    
    // Handle legacy visit/activity structure for backwards compatibility  
    if (element.visit && element.startTime && element.endTime) {
      const startUTC = toUTCMillis(element.startTime);
      const endUTC = toUTCMillis(element.endTime);
      
      if (startUTC && endUTC) {
        segments.push({
          kind: 'visit',
          startUTC,
          endUTC,
          activityType: 'still',
          obj: element.visit
        });
        
        // Extract visit place if available
        const placeLocation = element.visit.topCandidate?.placeLocation || element.visit.placeLocation;
        if (placeLocation) {
          const coords = parseGeoString(placeLocation);
          if (coords) {
            const startDate = parseToUTCDate(element.startTime);
            if (startDate) {
              results.push({
                lat: coords.lat,
                lng: coords.lng,
                timestamp: startDate,
                activity: 'still'
              });
            }
          }
        }
      }
    }
    
    if (element.activity && element.startTime && element.endTime) {
      const startUTC = toUTCMillis(element.startTime);
      const endUTC = toUTCMillis(element.endTime);
      
      if (startUTC && endUTC) {
        const activityType = element.activity.topCandidate?.type?.toLowerCase() || 'unknown';
        segments.push({
          kind: 'activity',
          startUTC,
          endUTC,
          activityType,
          obj: element.activity
        });
        
        // Extract activity start point
        if (element.activity.start) {
          const coords = parseGeoString(element.activity.start);
          if (coords) {
            const startDate = parseToUTCDate(element.startTime);
            if (startDate) {
              results.push({
                lat: coords.lat,
                lng: coords.lng,
                timestamp: startDate,
                activity: activityType
              });
            }
          }
        }
      }
    }
  });

  // Sort segments by start time
  segments.sort((a, b) => a.startUTC - b.startUTC);
  console.log(`✅ Extracted ${segments.length} segments`);

  // PHASE 2: Extract timeline path points
  const timelinePoints: Array<{lat: number, lng: number, tUTC: number, carrier: any}> = [];
  
  jsonData.forEach((element) => {
    // Modern mobile format: timelinePath.point with latE7/lngE7
    if (element.timelinePath?.point && Array.isArray(element.timelinePath.point)) {
      element.timelinePath.point.forEach((point: any) => {
        const latE7 = point.latE7;
        const lngE7 = point.lngE7;
        const timeStr = point.time;

        if (typeof latE7 === 'number' && typeof lngE7 === 'number' && timeStr) {
          const lat = latE7 / 1e7;
          const lng = lngE7 / 1e7;
          const pointDate = parseToUTCDate(timeStr);
          
          if (pointDate) {
            timelinePoints.push({
              lat,
              lng,
              tUTC: pointDate.getTime(),
              carrier: element
            });
          }
        }
      });
    }
    
    // Legacy format: nested timeline paths in visit/activity
    if (element.visit?.timelinePath?.points) {
      const baseDate = parseToUTCDate(element.startTime);
      if (baseDate) {
        element.visit.timelinePath.points.forEach((pathPoint: any) => {
          if (pathPoint.point) {
            const coords = parseGeoString(pathPoint.point);
            if (coords) {
              let timestamp = baseDate;
              if (pathPoint.durationMinutesOffsetFromStartTime) {
                const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
                if (!isNaN(offsetMinutes)) {
                  timestamp = new Date(baseDate.getTime() + offsetMinutes * 60 * 1000);
                }
              }
              timelinePoints.push({
                lat: coords.lat,
                lng: coords.lng,
                tUTC: timestamp.getTime(),
                carrier: element
              });
            }
          }
        });
      }
    }
    
    if (element.activity && (element as any).timelinePath?.points) {
      const baseDate = parseToUTCDate(element.startTime);
      if (baseDate) {
        (element as any).timelinePath.points.forEach((pathPoint: any) => {
          if (pathPoint.point) {
            const coords = parseGeoString(pathPoint.point);
            if (coords) {
              let timestamp = baseDate;
              if (pathPoint.durationMinutesOffsetFromStartTime) {
                const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
                if (!isNaN(offsetMinutes)) {
                  timestamp = new Date(baseDate.getTime() + offsetMinutes * 60 * 1000);
                }
              }
              timelinePoints.push({
                lat: coords.lat,
                lng: coords.lng,
                tUTC: timestamp.getTime(),
                carrier: element
              });
            }
          }
        });
      }
    }
  });

  // Sort points by time
  timelinePoints.sort((a, b) => a.tUTC - b.tUTC);
  console.log(`🎯 Extracted ${timelinePoints.length} timeline path points`);

  // PHASE 3: Associate points with segments using UTC windowing
  timelinePoints.forEach((point) => {
    let bestSegment: MobileSegment | null = null;
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

    if (bestSegment) {
      results.push({
        lat: point.lat,
        lng: point.lng,
        timestamp: new Date(point.tUTC),
        activity: bestSegment.activityType
      });
    } else {
      // Unassigned point - use generic 'route' activity
      results.push({
        lat: point.lat,
        lng: point.lng,
        timestamp: new Date(point.tUTC),
        activity: 'route'
      });
    }
  });

  console.log(`🎯 Mobile parser extracted ${results.length} total points`);
  return results;
}

// Parse old format with locations array
function parseOldFormat(jsonData: GoogleLocationHistoryOld): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  if (!jsonData.locations || !Array.isArray(jsonData.locations)) {
    console.warn('No locations array found in old format');
    return results;
  }

  console.log(`📊 Processing ${jsonData.locations.length} location points from old format`);

  for (const location of jsonData.locations) {
    if (location.latitudeE7 && location.longitudeE7 && location.timestampMs) {
      const lat = location.latitudeE7 / 1e7;
      const lng = location.longitudeE7 / 1e7;
      const timestamp = new Date(parseInt(location.timestampMs));
      
      // Extract activity if available
      let activity = 'unknown';
      if (location.activity && location.activity.length > 0) {
        const activities = location.activity[0]?.activity || [];
        if (activities.length > 0) {
          activity = activities[0].type?.toLowerCase() || 'unknown';
        }
      }

      results.push({
        lat,
        lng,
        timestamp,
        accuracy: location.accuracy,
        activity
      });
    }
  }

  console.log(`✅ Old format parser extracted ${results.length} location points`);
  return results;
}

// Main orchestrator function - detects format and delegates to appropriate parser
export function parseGoogleLocationHistory(jsonData: any): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];

  if (!jsonData) {
    console.warn('No data provided to parser');
    return results;
  }

  console.log('🔍 Analyzing Google Location History format...');

  // Handle old format (has locations array)
  if (jsonData.locations && Array.isArray(jsonData.locations)) {
    console.log('🔍 Detected old Google Location History format (locations array)');
    const oldResults = parseOldFormat(jsonData as GoogleLocationHistoryOld);
    results.push(...oldResults);
  }
  
  // Handle mobile format (array of timeline objects)
  else if (Array.isArray(jsonData) && jsonData.length > 0 && 
           (jsonData[0].visit || jsonData[0].point || jsonData[0].endTime || jsonData[0].startTime || 
            jsonData[0].activitySegment || jsonData[0].placeVisit || jsonData[0].timelinePath)) {
    console.log('🔍 Detected mobile Google location array format');
    console.log(`📊 Processing ${jsonData.length} elements in mobile array format`);
    
    const mobileResults = parseMobileArrayFormat(jsonData as GoogleLocationHistoryMobileArray);
    console.log(`✅ Mobile parser extracted ${mobileResults.length} total points`);
    results.push(...mobileResults);
  }
  
  else {
    console.warn('❌ Unknown or unsupported Google Location History format');
    console.log('Expected: locations array (old format) or timeline objects array (mobile format)');
    return results;
  }

  // Apply deduplication
  console.log(`🔄 Applying deduplication to ${results.length} points...`);
  
  const deduplicated = results.filter((point, index) => {
    // Check if this point is a duplicate of any previous point
    for (let i = 0; i < index; i++) {
      const other = results[i];
      const latDiff = Math.abs(point.lat - other.lat);
      const lngDiff = Math.abs(point.lng - other.lng);
      const timeDiff = Math.abs(point.timestamp.getTime() - other.timestamp.getTime());
      
      // Consider points duplicates if they're very close in space and time
      if (latDiff < 0.0001 && lngDiff < 0.0001 && timeDiff < 60000) { // 60 seconds
        return false; // This is a duplicate
      }
    }
    return true; // This is not a duplicate
  });

  const removedCount = results.length - deduplicated.length;
  if (removedCount > 0) {
    console.log(`🧹 Removed ${removedCount} duplicate points`);
  }

  console.log(`✅ Parsing complete: ${deduplicated.length} unique location points extracted`);
  return deduplicated;
}

// Validation function
export function validateGoogleLocationHistory(jsonData: any): boolean {
  if (!jsonData) return false;

  // Check for old format
  if (jsonData.locations && Array.isArray(jsonData.locations)) {
    return jsonData.locations.length > 0;
  }

  // Check for mobile format
  if (Array.isArray(jsonData) && jsonData.length > 0) {
    const firstElement = jsonData[0];
    return !!(firstElement.visit || firstElement.point || firstElement.endTime || 
              firstElement.startTime || firstElement.activitySegment || 
              firstElement.placeVisit || firstElement.timelinePath);
  }

  return false;
}