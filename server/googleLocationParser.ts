// Mobile format is an array of timeline elements - flexible interface for various structures
interface GoogleLocationHistoryMobileArray extends Array<{
  endTime?: string;
  startTime?: string;
  visit?: {
    hierarchyLevel?: string;
    topCandidate?: {
      probability?: number;
      placeId?: string;
      location?: {
        lat?: number;
        lng?: number;
        latitudeE7?: number;
        longitudeE7?: number;
      };
      lat?: number;
      lng?: number;
      latitudeE7?: number;
      longitudeE7?: number;
    };
    lat?: number;
    lng?: number;
    latitudeE7?: number;
    longitudeE7?: number;
  };
  point?: string; // Format: "geo:lat,lng"
  durationMinutesOffsetFromStartTime?: string;
  [key: string]: any; // Allow for other unknown properties
}> {}

interface GoogleLocationHistoryNew {
  timelineObjects?: Array<{
    activitySegment?: {
      startLocation?: {
        latitudeE7: number;
        longitudeE7: number;
      };
      endLocation?: {
        latitudeE7: number;
        longitudeE7: number;
      };
      duration?: {
        startTimestamp: string;
        endTimestamp: string;
      };
      activityType?: string;
    };
    placeVisit?: {
      location?: {
        latitudeE7: number;
        longitudeE7: number;
        address?: string;
      };
      duration?: {
        startTimestamp: string;
        endTimestamp: string;
      };
    };
  }>;
}

interface GoogleLocationHistoryOld {
  locations?: Array<{
    timestampMs: string;
    latitudeE7: number;
    longitudeE7: number;
    accuracy?: number;
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

// Helper function to normalize timestamps with different timezone formats
function normalizeTimestamp(timestamp: string): Date {
  // Handle both UTC offsets (-06:00) and Z format
  try {
    return new Date(timestamp);
  } catch (error) {
    console.warn('Invalid timestamp format:', timestamp);
    return new Date();
  }
}

// Parse the actual mobile format (array of timeline objects)
function parseMobileArrayFormat(jsonData: GoogleLocationHistoryMobileArray): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  let lastKnownTimestamp: Date | null = null;
  
  console.log(`Parsing ${jsonData.length} mobile timeline elements`);
  
  for (let i = 0; i < jsonData.length; i++) {
    const element = jsonData[i];
    
    // Debug first few elements to understand the structure
    if (i < 5) {
      console.log(`Element ${i}:`, JSON.stringify(element, null, 2));
    }
    
    // Handle visit elements with start/end times
    if (element.visit && (element.startTime || element.endTime)) {
      // Look for location data in various possible places
      let location: any = null;
      
      // Check topCandidate.location
      if (element.visit.topCandidate?.location) {
        location = element.visit.topCandidate.location;
      }
      // Check if coordinates are stored differently
      else if (element.visit.topCandidate && (element.visit.topCandidate.lat || element.visit.topCandidate.latitudeE7)) {
        location = element.visit.topCandidate;
      }
      // Check visit directly
      else if (element.visit.lat || element.visit.latitudeE7) {
        location = element.visit;
      }
      
      if (location) {
        // Handle different coordinate formats
        let lat: number | null = null;
        let lng: number | null = null;
        
        // Standard lat/lng (use proper type checks to handle 0 coordinates)
        if (typeof location.lat === 'number' && typeof location.lng === 'number') {
          lat = location.lat;
          lng = location.lng;
        }
        // E7 format (Google's standard)
        else if (typeof location.latitudeE7 === 'number' && typeof location.longitudeE7 === 'number') {
          lat = location.latitudeE7 / 1e7;
          lng = location.longitudeE7 / 1e7;
        }
        
        if (lat !== null && lng !== null) {
          // Add start point
          if (element.startTime) {
            const timestamp = normalizeTimestamp(element.startTime);
            results.push({
              lat: lat,
              lng: lng,
              timestamp: timestamp,
              activity: 'still' // Visits are typically stationary
            });
            lastKnownTimestamp = timestamp;
          }
          
          // Add end point if different
          if (element.endTime && element.endTime !== element.startTime) {
            const timestamp = normalizeTimestamp(element.endTime);
            results.push({
              lat: lat,
              lng: lng,
              timestamp: timestamp,
              activity: 'still'
            });
            lastKnownTimestamp = timestamp;
          }
        }
      }
    }
    
    // Handle timeline path points with geo coordinates
    else if (element.point && element.point.startsWith('geo:')) {
      try {
        const coords = element.point.replace('geo:', '').split(',');
        if (coords.length === 2) {
          const lat = parseFloat(coords[0]);
          const lng = parseFloat(coords[1]);
          
          if (!isNaN(lat) && !isNaN(lng)) {
            // Calculate timestamp based on duration offset from previous element
            let timestamp: Date;
            if (lastKnownTimestamp && element.durationMinutesOffsetFromStartTime) {
              const offsetMinutes = parseInt(element.durationMinutesOffsetFromStartTime);
              if (!isNaN(offsetMinutes)) {
                timestamp = new Date(lastKnownTimestamp.getTime() + offsetMinutes * 60 * 1000);
              } else {
                timestamp = lastKnownTimestamp;
              }
            } else {
              // Fallback to current time if no base timestamp available
              timestamp = new Date();
            }
            
            results.push({
              lat: lat,
              lng: lng,
              timestamp: timestamp,
              activity: 'walking'
            });
          }
        }
      } catch (error) {
        console.warn('Failed to parse geo point:', element.point, error);
      }
    }
    
    // Handle any other location formats we might have missed
    else if (i < 10) {
      console.log(`Unhandled element type ${i}:`, Object.keys(element));
    }
  }
  
  console.log(`Successfully parsed ${results.length} location points from mobile format`);
  return results;
}

export function parseGoogleLocationHistory(jsonData: any): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];

  // Handle new mobile format (array of timeline objects)
  if (Array.isArray(jsonData) && jsonData.length > 0 && 
      (jsonData[0].visit || jsonData[0].point || jsonData[0].endTime || jsonData[0].startTime)) {
    console.log('Detected mobile Google location array format');
    const mobileResults = parseMobileArrayFormat(jsonData as GoogleLocationHistoryMobileArray);
    results.push(...mobileResults);
  }
  
  // Handle new format (timelineObjects)
  else if (jsonData.timelineObjects) {
    const data = jsonData as GoogleLocationHistoryNew;
    
    data.timelineObjects?.forEach(obj => {
      // Handle activity segments
      if (obj.activitySegment) {
        const segment = obj.activitySegment;
        
        // Start location
        if (segment.startLocation && segment.duration?.startTimestamp) {
          results.push({
            lat: segment.startLocation.latitudeE7 / 1e7,
            lng: segment.startLocation.longitudeE7 / 1e7,
            timestamp: new Date(segment.duration.startTimestamp),
            activity: segment.activityType?.toLowerCase() || 'unknown'
          });
        }
        
        // End location
        if (segment.endLocation && segment.duration?.endTimestamp) {
          results.push({
            lat: segment.endLocation.latitudeE7 / 1e7,
            lng: segment.endLocation.longitudeE7 / 1e7,
            timestamp: new Date(segment.duration.endTimestamp),
            activity: segment.activityType?.toLowerCase() || 'unknown'
          });
        }
      }
      
      // Handle place visits
      if (obj.placeVisit?.location && obj.placeVisit.duration?.startTimestamp) {
        results.push({
          lat: obj.placeVisit.location.latitudeE7 / 1e7,
          lng: obj.placeVisit.location.longitudeE7 / 1e7,
          timestamp: new Date(obj.placeVisit.duration.startTimestamp),
          activity: 'still' // Place visits are typically stationary
        });
      }
    });
  }
  
  // Handle old format (locations array)
  else if (jsonData.locations) {
    const data = jsonData as GoogleLocationHistoryOld;
    
    data.locations?.forEach(location => {
      // Get the most confident activity if available
      let activity = 'unknown';
      if (location.activity && location.activity.length > 0) {
        const activities = location.activity[0].activity;
        if (activities && activities.length > 0) {
          const mostConfident = activities.reduce((prev, current) => 
            (current.confidence > prev.confidence) ? current : prev
          );
          activity = mostConfident.type.toLowerCase();
        }
      }
      
      results.push({
        lat: location.latitudeE7 / 1e7,
        lng: location.longitudeE7 / 1e7,
        timestamp: new Date(parseInt(location.timestampMs)),
        accuracy: location.accuracy,
        activity: activity
      });
    });
  }

  // Sort by timestamp and remove duplicates
  const sorted = results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Remove near-duplicate points (within 10 seconds and similar coordinates)
  const deduplicated: ParsedLocationPoint[] = [];
  for (const point of sorted) {
    const last = deduplicated[deduplicated.length - 1];
    if (!last || 
        Math.abs(point.timestamp.getTime() - last.timestamp.getTime()) > 10000 ||
        Math.abs(point.lat - last.lat) > 0.0001 ||
        Math.abs(point.lng - last.lng) > 0.0001) {
      deduplicated.push(point);
    }
  }
  
  console.log(`Parsed ${results.length} total points, deduplicated to ${deduplicated.length} points`);
  return deduplicated;
}

export function validateGoogleLocationHistory(jsonData: any): boolean {
  if (!jsonData || typeof jsonData !== 'object') {
    return false;
  }
  
  // Check for new mobile format (array of timeline objects)
  if (Array.isArray(jsonData) && jsonData.length > 0 && 
      (jsonData[0].visit || jsonData[0].point || jsonData[0].endTime || jsonData[0].startTime)) {
    return true;
  }
  
  // Check for new format
  if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    return true;
  }
  
  // Check for old format
  if (jsonData.locations && Array.isArray(jsonData.locations)) {
    return true;
  }
  
  return false;
}