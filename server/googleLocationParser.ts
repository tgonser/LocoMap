interface GoogleLocationHistoryMobile {
  visits?: Array<{
    location?: {
      latitudeE7: number;
      longitudeE7: number;
      address?: string;
    };
    duration?: {
      startTimestamp: string;
      endTimestamp: string;
    };
    activityType?: string;
  }>;
  timelinePath?: Array<{
    location?: {
      latitudeE7: number;
      longitudeE7: number;
    };
    timestamp: string;
    accuracy?: number;
    activity?: string;
  }>;
}

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

// Parse the new mobile format with visits and timelinePath
function parseMobileFormat(jsonData: GoogleLocationHistoryMobile): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  // Parse visits (with UTC offsets like -06:00)
  if (jsonData.visits && Array.isArray(jsonData.visits)) {
    console.log(`Parsing ${jsonData.visits.length} visits`);
    for (const visit of jsonData.visits) {
      if (visit.location && visit.duration) {
        // Add start point
        if (visit.duration.startTimestamp) {
          results.push({
            lat: visit.location.latitudeE7 / 1e7,
            lng: visit.location.longitudeE7 / 1e7,
            timestamp: normalizeTimestamp(visit.duration.startTimestamp),
            activity: visit.activityType?.toLowerCase() || 'still'
          });
        }
        
        // Add end point if different from start
        if (visit.duration.endTimestamp && visit.duration.endTimestamp !== visit.duration.startTimestamp) {
          results.push({
            lat: visit.location.latitudeE7 / 1e7,
            lng: visit.location.longitudeE7 / 1e7,
            timestamp: normalizeTimestamp(visit.duration.endTimestamp),
            activity: visit.activityType?.toLowerCase() || 'still'
          });
        }
      }
    }
  }
  
  // Parse timelinePath elements (with Z UTC format)
  if (jsonData.timelinePath && Array.isArray(jsonData.timelinePath)) {
    console.log(`Parsing ${jsonData.timelinePath.length} timeline path points`);
    for (const pathPoint of jsonData.timelinePath) {
      if (pathPoint.location && pathPoint.timestamp) {
        results.push({
          lat: pathPoint.location.latitudeE7 / 1e7,
          lng: pathPoint.location.longitudeE7 / 1e7,
          timestamp: normalizeTimestamp(pathPoint.timestamp),
          accuracy: pathPoint.accuracy,
          activity: pathPoint.activity?.toLowerCase() || 'walking'
        });
      }
    }
  }
  
  return results;
}

export function parseGoogleLocationHistory(jsonData: any): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];

  // Handle new mobile format (visits + timelinePath)
  if ((jsonData.visits && Array.isArray(jsonData.visits)) || 
      (jsonData.timelinePath && Array.isArray(jsonData.timelinePath))) {
    console.log('Detected mobile Google location format');
    const mobileResults = parseMobileFormat(jsonData as GoogleLocationHistoryMobile);
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
  
  // Check for new mobile format (visits + timelinePath)
  if ((jsonData.visits && Array.isArray(jsonData.visits)) || 
      (jsonData.timelinePath && Array.isArray(jsonData.timelinePath))) {
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