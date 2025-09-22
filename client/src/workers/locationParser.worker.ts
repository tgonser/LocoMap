/**
 * Web Worker for client-side Google Location History parsing
 * Processes 53MB JSON files in 1-3 seconds without blocking UI
 */

export interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  activity: string;
}

export interface DayIndex {
  [date: string]: LocationPoint[]; // yyyy-mm-dd -> points
}

export interface ParseResult {
  availableDates: string[];
  locationCountByDate: { [date: string]: number };
  totalPoints: number;
}

export interface WorkerMessage {
  type: 'parse' | 'getDay';
  data: any;
}

export interface WorkerResponse {
  type: 'parseComplete' | 'dayData' | 'error' | 'progress';
  data: any;
}

// Global storage for parsed data
let dayIndex: DayIndex = {};
let totalPoints = 0;

// Parse Google Location History JSON and build date index
function parseLocationData(jsonData: any): ParseResult {
  console.log('🚀 Starting client-side location parsing...');
  const startTime = Date.now();
  
  const results: LocationPoint[] = [];
  dayIndex = {};
  
  // Handle modern timelineObjects format
  if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    console.log(`📊 Processing ${jsonData.timelineObjects.length} timeline objects`);
    
    jsonData.timelineObjects.forEach((obj: any, index: number) => {
      // Progress reporting
      if (index > 0 && index % 5000 === 0) {
        self.postMessage({
          type: 'progress',
          data: { processed: index, total: jsonData.timelineObjects.length, points: results.length }
        } as WorkerResponse);
      }
      
      // Extract GPS points from activitySegment.simplifiedRawPath.points
      if (obj.activitySegment?.simplifiedRawPath?.points && Array.isArray(obj.activitySegment.simplifiedRawPath.points)) {
        const points = obj.activitySegment.simplifiedRawPath.points;
        
        points.forEach((point: any) => {
          if (point.latE7 !== undefined && point.lngE7 !== undefined) {
            const lat = point.latE7 / 1e7;
            const lng = point.lngE7 / 1e7;
            
            // Use real timestamp from Google data - no interpolation
            let timestamp: Date | null = null;
            if (point.timestampMs) {
              timestamp = new Date(parseInt(point.timestampMs));
            }
            
            if (timestamp && !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
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
      
      // Extract GPS points from activitySegment.waypointPath.waypoints
      if (obj.activitySegment?.waypointPath?.waypoints && Array.isArray(obj.activitySegment.waypointPath.waypoints)) {
        const waypoints = obj.activitySegment.waypointPath.waypoints;
        
        waypoints.forEach((waypoint: any) => {
          if (waypoint.latE7 !== undefined && waypoint.lngE7 !== undefined) {
            const lat = waypoint.latE7 / 1e7;
            const lng = waypoint.lngE7 / 1e7;
            
            // Use real timestamp from Google data - no interpolation
            let timestamp: Date | null = null;
            if (waypoint.timestampMs) {
              timestamp = new Date(parseInt(waypoint.timestampMs));
            }
            
            if (timestamp && !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
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
    });
  }
  
  // Handle legacy array format
  else if (Array.isArray(jsonData)) {
    console.log(`📊 Processing ${jsonData.length} legacy timeline items`);
    
    jsonData.forEach((item: any, index: number) => {
      // Progress reporting
      if (index > 0 && index % 5000 === 0) {
        self.postMessage({
          type: 'progress',
          data: { processed: index, total: jsonData.length, points: results.length }
        } as WorkerResponse);
      }
      
      // Process timelinePath points
      if (item.timelinePath && Array.isArray(item.timelinePath)) {
        const segmentStartTime = item.startTime ? new Date(item.startTime) : null;
        
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
                
                // Use real offset timestamp from Google data
                if (segmentStartTime && pathPoint.durationMinutesOffsetFromStartTime) {
                  const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime, 10);
                  if (!isNaN(offsetMinutes)) {
                    timestamp = new Date(segmentStartTime.getTime() + (offsetMinutes * 60 * 1000));
                  }
                }
              }
            }
          }
          
          // Add valid points
          if (lat !== undefined && lng !== undefined && timestamp && !isNaN(lat) && !isNaN(lng)) {
            if (lat !== 0 || lng !== 0) {
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
    });
  }
  
  // Build date index for fast calendar navigation
  console.log(`📅 Building date index for ${results.length} points...`);
  const locationCountByDate: { [date: string]: number } = {};
  
  results.forEach(point => {
    const dateKey = point.timestamp.toISOString().split('T')[0]; // yyyy-mm-dd
    
    if (!dayIndex[dateKey]) {
      dayIndex[dateKey] = [];
    }
    dayIndex[dateKey].push(point);
    locationCountByDate[dateKey] = (locationCountByDate[dateKey] || 0) + 1;
  });
  
  const availableDates = Object.keys(dayIndex).sort();
  totalPoints = results.length;
  
  const duration = Date.now() - startTime;
  console.log(`✅ Client-side parsing complete: ${totalPoints} points across ${availableDates.length} days in ${duration}ms`);
  
  return {
    availableDates,
    locationCountByDate,
    totalPoints
  };
}

// Web Worker message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data;
  
  try {
    switch (type) {
      case 'parse':
        // Parse the JSON file
        const jsonData = data.jsonData;
        const result = parseLocationData(jsonData);
        
        self.postMessage({
          type: 'parseComplete',
          data: result
        } as WorkerResponse);
        break;
        
      case 'getDay':
        // Return points for a specific day
        const dateKey = data.date; // yyyy-mm-dd
        const dayPoints = dayIndex[dateKey] || [];
        
        self.postMessage({
          type: 'dayData',
          data: { date: dateKey, points: dayPoints }
        } as WorkerResponse);
        break;
        
      default:
        console.warn('Unknown worker message type:', type);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      data: { message: error.message, stack: error.stack }
    } as WorkerResponse);
  }
};

// Export for TypeScript
export {};