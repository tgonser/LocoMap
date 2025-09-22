/**
 * Time-based association system for Google Location History
 * Associates timelinePath GPS data with visit/activity parents by time overlap
 */

export interface ParentContainer {
  id: string;
  type: 'activity' | 'visit';
  startMs: number;
  endMs: number;
  startTime: string;
  endTime: string;
  metadata?: any;
}

export interface ParentIndex {
  activities: ParentContainer[];
  visits: ParentContainer[];
}

export interface TimelinePathPoint {
  latitude: number;
  longitude: number;
  timestampMs: number;
  offsetMinutes: number;
  parentId: string;
  parentType: 'activity' | 'visit';
}

/**
 * Parse Google timestamp to epoch milliseconds (handles both ISO strings and ms-epoch strings)
 */
function parseGoogleTimestamp(timestamp: string | number): number | null {
  if (!timestamp) return null;
  
  try {
    // Handle ms-epoch strings (like "1631234567890")
    if (typeof timestamp === 'string' && /^\d+$/.test(timestamp)) {
      return parseInt(timestamp);
    }
    
    // Handle numeric ms-epoch
    if (typeof timestamp === 'number') {
      return timestamp;
    }
    
    // Handle ISO strings
    return new Date(timestamp).getTime();
  } catch (error) {
    console.warn('Failed to parse timestamp:', timestamp);
    return null;
  }
}

/**
 * Build time-indexed lookup of all visit/activity containers
 * Pass 1: Extract TIME CONTEXT from Semantic Location History format
 */
export function buildParentIndex(jsonData: any): ParentIndex {
  console.log('🔍 Building parent time index from activitySegment/placeVisit objects...');
  
  const activities: ParentContainer[] = [];
  const visits: ParentContainer[] = [];
  let processedCount = 0;
  
  // Handle modern Semantic Location History format
  let elementsToProcess = [];
  if (Array.isArray(jsonData)) {
    elementsToProcess = jsonData;
  } else if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    elementsToProcess = jsonData.timelineObjects;
  }
  
  for (let i = 0; i < elementsToProcess.length; i++) {
    const element = elementsToProcess[i];
    processedCount++;
    
    // Progress logging for large files
    if (processedCount % 10000 === 0) {
      console.log(`📈 Indexed ${processedCount} elements for parent containers...`);
    }
    
    // Handle activitySegment (movement/routes)
    if (element.activitySegment) {
      const activity = element.activitySegment;
      const startMs = parseGoogleTimestamp(activity.duration?.startTimestampMs || activity.startTime);
      const endMs = parseGoogleTimestamp(activity.duration?.endTimestampMs || activity.endTime);
      
      if (startMs && endMs) {
        activities.push({
          id: `activity_${i}`,
          type: 'activity',
          startMs,
          endMs,
          startTime: activity.duration?.startTimestampMs || activity.startTime,
          endTime: activity.duration?.endTimestampMs || activity.endTime,
          metadata: activity
        });
      }
    }
    
    // Handle placeVisit (stops/locations)
    if (element.placeVisit) {
      const visit = element.placeVisit;
      const startMs = parseGoogleTimestamp(
        visit.duration?.startTimestampMs || 
        visit.startTime || 
        visit.startTimestamp
      );
      const endMs = parseGoogleTimestamp(
        visit.duration?.endTimestampMs || 
        visit.endTime || 
        visit.endTimestamp
      );
      
      if (startMs && endMs) {
        visits.push({
          id: `visit_${i}`,
          type: 'visit',
          startMs,
          endMs,
          startTime: visit.duration?.startTimestampMs || visit.startTime,
          endTime: visit.duration?.endTimestampMs || visit.endTime,
          metadata: visit
        });
      } else {
        console.warn(`Skipped placeVisit ${i}: missing valid timestamps`);
      }
    }
    
    // Handle legacy format fallback
    if (!element.activitySegment && !element.placeVisit) {
      const startMs = parseGoogleTimestamp(element.startTime);
      const endMs = parseGoogleTimestamp(element.endTime);
      
      if (startMs && endMs) {
        if (element.activity) {
          activities.push({
            id: `activity_${i}`,
            type: 'activity',
            startMs,
            endMs,
            startTime: element.startTime,
            endTime: element.endTime,
            metadata: element.activity
          });
        }
        
        if (element.visit) {
          visits.push({
            id: `visit_${i}`,
            type: 'visit',
            startMs,
            endMs,
            startTime: element.startTime,
            endTime: element.endTime,
            metadata: element.visit
          });
        }
      }
    }
  }
  
  // Sort by start time for efficient binary search
  activities.sort((a, b) => a.startMs - b.startMs);
  visits.sort((a, b) => a.startMs - b.startMs);
  
  console.log(`✅ Built parent index: ${activities.length} activities, ${visits.length} visits`);
  
  return { activities, visits };
}

/**
 * Find the best-matching parent container for a timelinePath object
 * Prefers activity over visit when both overlap
 */
export function findOwningParent(
  index: ParentIndex, 
  pathStartMs: number, 
  pathEndMs: number
): ParentContainer | null {
  
  // Helper function to find overlapping containers via binary search + scan
  function findOverlapping(containers: ParentContainer[]): ParentContainer[] {
    if (containers.length === 0) return [];
    
    // Binary search for first container that starts >= pathStartMs
    let left = 0;
    let right = containers.length;
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (containers[mid].startMs >= pathStartMs) {
        right = mid;
      } else {
        left = mid + 1;
      }
    }
    
    // Scan backward for containers that end >= pathStartMs (could overlap)
    let scanStart = left;
    while (scanStart > 0 && containers[scanStart - 1].endMs >= pathStartMs) {
      scanStart--;
    }
    
    // Scan forward for all overlapping containers
    const overlapping: ParentContainer[] = [];
    for (let i = scanStart; i < containers.length; i++) {
      const container = containers[i];
      
      // Stop if container starts after path ends
      if (container.startMs > pathEndMs) break;
      
      // Check for actual overlap: max(startA, startB) < min(endA, endB)
      const overlapStart = Math.max(container.startMs, pathStartMs);
      const overlapEnd = Math.min(container.endMs, pathEndMs);
      
      if (overlapStart < overlapEnd) {
        overlapping.push(container);
      }
    }
    
    return overlapping;
  }
  
  // Check activities first (prefer for routes/movement)
  const overlappingActivities = findOverlapping(index.activities);
  if (overlappingActivities.length > 0) {
    // Return the one with maximum overlap
    let bestActivity = overlappingActivities[0];
    let maxOverlap = Math.min(bestActivity.endMs, pathEndMs) - Math.max(bestActivity.startMs, pathStartMs);
    
    for (const activity of overlappingActivities) {
      const overlap = Math.min(activity.endMs, pathEndMs) - Math.max(activity.startMs, pathStartMs);
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestActivity = activity;
      }
    }
    
    return bestActivity;
  }
  
  // Fallback to visits
  const overlappingVisits = findOverlapping(index.visits);
  if (overlappingVisits.length > 0) {
    // Return the one with maximum overlap
    let bestVisit = overlappingVisits[0];
    let maxOverlap = Math.min(bestVisit.endMs, pathEndMs) - Math.max(bestVisit.startMs, pathStartMs);
    
    for (const visit of overlappingVisits) {
      const overlap = Math.min(visit.endMs, pathEndMs) - Math.max(visit.startMs, pathStartMs);
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestVisit = visit;
      }
    }
    
    return bestVisit;
  }
  
  return null;
}

/**
 * Normalize GPS points from various Google Location History formats
 */
function normalizePoints(
  points: any[], 
  parentStartMs: number, 
  parentEndMs: number
): Array<{ lat: number; lng: number; timestampMs: number; offsetMinutes: number }> {
  const normalizedPoints: Array<{ lat: number; lng: number; timestampMs: number; offsetMinutes: number }> = [];
  
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    
    // Parse coordinates
    let lat: number | null = null;
    let lng: number | null = null;
    
    // Handle latE7/lngE7 format (modern Semantic Location History)
    if (point.latE7 !== undefined && point.lngE7 !== undefined) {
      lat = point.latE7 / 1e7;
      lng = point.lngE7 / 1e7;
    }
    // Handle geo string format (legacy)
    else if (typeof point === 'string' && point.startsWith('geo:')) {
      const coords = point.substring(4).split(',');
      if (coords.length === 2) {
        lat = parseFloat(coords[0]);
        lng = parseFloat(coords[1]);
      }
    }
    // Handle point object with geo string
    else if (point.point && typeof point.point === 'string' && point.point.startsWith('geo:')) {
      const coords = point.point.substring(4).split(',');
      if (coords.length === 2) {
        lat = parseFloat(coords[0]);
        lng = parseFloat(coords[1]);
      }
    }
    
    // Validate coordinates
    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      continue;
    }
    
    // Parse timestamp with proper precedence and validation
    let timestampMs: number;
    let offsetMinutes: number | undefined;
    
    // 1. Try timestampMs field first (most common in modern exports)
    if (point.timestampMs) {
      const parsedTimestamp = parseGoogleTimestamp(point.timestampMs);
      if (parsedTimestamp && parsedTimestamp > 946684800000) { // After Jan 1, 2000
        timestampMs = parsedTimestamp;
        offsetMinutes = Math.round((timestampMs - parentStartMs) / (60 * 1000));
      } else {
        // Fallback to offset calculation
        offsetMinutes = 0;
        timestampMs = parentStartMs;
      }
    }
    // 2. Try timestamp field (ISO format)
    else if (point.timestamp) {
      const parsedTimestamp = parseGoogleTimestamp(point.timestamp);
      if (parsedTimestamp && parsedTimestamp > 946684800000) { // After Jan 1, 2000
        timestampMs = parsedTimestamp;
        offsetMinutes = Math.round((timestampMs - parentStartMs) / (60 * 1000));
      } else {
        offsetMinutes = 0;
        timestampMs = parentStartMs;
      }
    }
    // 3. Try durationMinutesOffsetFromStart (explicit offset)
    else if (point.durationMinutesOffsetFromStart !== undefined) {
      offsetMinutes = point.durationMinutesOffsetFromStart;
      timestampMs = parentStartMs + (offsetMinutes * 60 * 1000);
    }
    // 4. Handle point.time carefully (could be timestamp OR minutes offset)
    else if (point.time !== undefined) {
      const timeValue = point.time;
      
      // Check if it looks like a timestamp (ISO string or large number)
      if (typeof timeValue === 'string' && (timeValue.includes('-') || timeValue.includes('T') || timeValue.includes('Z'))) {
        // Treat as ISO timestamp
        const parsedTimestamp = parseGoogleTimestamp(timeValue);
        if (parsedTimestamp && parsedTimestamp > 946684800000) {
          timestampMs = parsedTimestamp;
          offsetMinutes = Math.round((timestampMs - parentStartMs) / (60 * 1000));
        } else {
          offsetMinutes = 0;
          timestampMs = parentStartMs;
        }
      } else {
        // Treat as minutes offset (legacy format)
        offsetMinutes = parseInt(timeValue.toString()) || 0;
        timestampMs = parentStartMs + (offsetMinutes * 60 * 1000);
      }
    }
    // 5. Fallback: interpolate timestamp across parent duration
    else {
      const progress = points.length > 1 ? i / (points.length - 1) : 0;
      timestampMs = parentStartMs + (progress * (parentEndMs - parentStartMs));
      offsetMinutes = Math.round((timestampMs - parentStartMs) / (60 * 1000));
    }
    
    normalizedPoints.push({
      lat,
      lng,
      timestampMs,
      offsetMinutes: offsetMinutes || 0
    });
  }
  
  return normalizedPoints;
}

/**
 * Process timelinePath objects and associate them with parent containers
 * Pass 2: ASSOCIATE timelinePath GPS data with TIME CONTEXT
 */
export function processTimelinePathsForDateRange(
  jsonData: any,
  parentIndex: ParentIndex,
  startDate: string,
  endDate: string
): TimelinePathPoint[] {
  console.log(`🔗 Associating GPS path data for ${startDate} to ${endDate}...`);
  
  const startDateMs = new Date(startDate + 'T00:00:00Z').getTime();
  const endDateMs = new Date(endDate + 'T23:59:59Z').getTime();
  const points: TimelinePathPoint[] = [];
  let processedPaths = 0;
  let associatedPaths = 0;
  
  // Handle both legacy array and modern timelineObjects formats
  let elementsToProcess = [];
  if (Array.isArray(jsonData)) {
    elementsToProcess = jsonData;
  } else if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    elementsToProcess = jsonData.timelineObjects;
  }
  
  for (let i = 0; i < elementsToProcess.length; i++) {
    const element = elementsToProcess[i];
    
    // Process GPS route data from activitySegment (modern format - contains timelinePath-style GPS data)
    if (element.activitySegment) {
      const activity = element.activitySegment;
      const pathStartMs = parseGoogleTimestamp(activity.duration?.startTimestampMs || activity.startTime);
      const pathEndMs = parseGoogleTimestamp(activity.duration?.endTimestampMs || activity.endTime);
      
      if (!pathStartMs || !pathEndMs) continue;
      
      // Skip if outside requested date range
      if (pathEndMs < startDateMs || pathStartMs > endDateMs) continue;
      
      // Find the owning parent container
      const parent = findOwningParent(parentIndex, pathStartMs, pathEndMs);
      if (!parent) continue;
      
      // Process GPS route data (timelinePath-style data stored in activitySegment)
      let gpsPointsProcessed = false;
      
      // 1. simplifiedRawPath (most common timelinePath-style GPS data)
      if (activity.simplifiedRawPath?.points && activity.simplifiedRawPath.points.length > 0) {
        processedPaths++;
        associatedPaths++;
        gpsPointsProcessed = true;
        
        const normalizedPoints = normalizePoints(
          activity.simplifiedRawPath.points,
          parent.startMs,
          parent.endMs
        );
        
        for (const point of normalizedPoints) {
          // Skip if point is outside date range
          if (point.timestampMs < startDateMs || point.timestampMs > endDateMs) continue;
          
          points.push({
            latitude: point.lat,
            longitude: point.lng,
            timestampMs: point.timestampMs,
            offsetMinutes: point.offsetMinutes,
            parentId: parent.id,
            parentType: parent.type
          });
        }
      }
      
      // 2. rawPath (detailed GPS route data)
      if (!gpsPointsProcessed && activity.rawPath?.points && activity.rawPath.points.length > 0) {
        processedPaths++;
        associatedPaths++;
        gpsPointsProcessed = true;
        
        const normalizedPoints = normalizePoints(
          activity.rawPath.points,
          parent.startMs,
          parent.endMs
        );
        
        for (const point of normalizedPoints) {
          // Skip if point is outside date range
          if (point.timestampMs < startDateMs || point.timestampMs > endDateMs) continue;
          
          points.push({
            latitude: point.lat,
            longitude: point.lng,
            timestampMs: point.timestampMs,
            offsetMinutes: point.offsetMinutes,
            parentId: parent.id,
            parentType: parent.type
          });
        }
      }
      
      // 3. waypointPath (route waypoints)
      if (!gpsPointsProcessed && activity.waypointPath?.waypoints && activity.waypointPath.waypoints.length > 0) {
        processedPaths++;
        associatedPaths++;
        gpsPointsProcessed = true;
        
        const normalizedPoints = normalizePoints(
          activity.waypointPath.waypoints,
          parent.startMs,
          parent.endMs
        );
        
        for (const point of normalizedPoints) {
          // Skip if point is outside date range
          if (point.timestampMs < startDateMs || point.timestampMs > endDateMs) continue;
          
          points.push({
            latitude: point.lat,
            longitude: point.lng,
            timestampMs: point.timestampMs,
            offsetMinutes: point.offsetMinutes,
            parentId: parent.id,
            parentType: parent.type
          });
        }
      }
      
      // NOTE: We do NOT process activity.startLocation or activity.endLocation 
      // Those are inferred activity coordinates, not GPS route data
    }
    
    // Process legacy timelinePath format (explicit timelinePath elements)
    if (element.timelinePath && Array.isArray(element.timelinePath) && element.timelinePath.length > 0) {
      processedPaths++;
      
      const pathStartMs = parseGoogleTimestamp(element.startTime);
      const pathEndMs = parseGoogleTimestamp(element.endTime);
      
      if (!pathStartMs || !pathEndMs) continue;
      
      // Skip if outside requested date range
      if (pathEndMs < startDateMs || pathStartMs > endDateMs) continue;
      
      // Find the owning parent (visit/activity)
      const parent = findOwningParent(parentIndex, pathStartMs, pathEndMs);
      if (!parent) continue;
      
      associatedPaths++;
      
      // Process GPS points using normalized approach
      const normalizedPoints = normalizePoints(
        element.timelinePath,
        parent.startMs,
        parent.endMs
      );
      
      for (const point of normalizedPoints) {
        // Skip if point is outside date range
        if (point.timestampMs < startDateMs || point.timestampMs > endDateMs) continue;
        
        points.push({
          latitude: point.lat,
          longitude: point.lng,
          timestampMs: point.timestampMs,
          offsetMinutes: point.offsetMinutes,
          parentId: parent.id,
          parentType: parent.type
        });
      }
    }
  }
  
  console.log(`✅ Processed ${processedPaths} GPS path objects, associated ${associatedPaths} with parents`);
  console.log(`📍 Generated ${points.length} GPS points with proper timestamps`);
  
  return points;
}