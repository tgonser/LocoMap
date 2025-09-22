/**
 * Quick indexing of Google Location History files
 * Phase 1: Extract date ranges and structure info without full processing
 */

export interface LocationFileIndex {
  dateRange: {
    startDate: string;  // yyyy-mm-dd
    endDate: string;    // yyyy-mm-dd
  };
  structure: {
    hasTimelinePath: boolean;
    hasVisits: boolean;
    hasActivities: boolean;
    totalTimelinePathObjects: number;
    totalTimelinePathPoints: number;
    estimatedGpsPoints: number;
  };
  fileInfo: {
    sizeBytes: number;
    processingTimeMs: number;
    format: 'legacy_array' | 'modern_timeline_objects' | 'unknown';
  };
  sampleDates: { [date: string]: number }; // date -> point count estimate
}

/**
 * Parse date from various Google timestamp formats
 */
function parseGoogleDate(dateString: string): Date | null {
  if (!dateString) return null;
  
  try {
    // Handle various Google timestamp formats
    let normalized = dateString;
    
    // Convert timezone offset format: 2009-11-14T17:49:29.000-08:00
    if (normalized.includes('-') && normalized.match(/[+-]\d{2}:\d{2}$/)) {
      return new Date(normalized);
    }
    
    // Handle Z format: 2025-09-20T05:00:00.000Z
    if (normalized.endsWith('Z')) {
      return new Date(normalized);
    }
    
    // Add Z if missing timezone info
    if (!normalized.includes('+') && !normalized.includes('Z')) {
      normalized += 'Z';
    }
    
    return new Date(normalized);
  } catch (error) {
    console.warn('Failed to parse date:', dateString);
    return null;
  }
}

/**
 * Extract date in yyyy-mm-dd format
 */
function extractDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Quick scan of JSON file to extract structure and date ranges
 * This runs in 10-15 seconds instead of full processing
 */
export function indexGoogleLocationFile(jsonData: any): LocationFileIndex {
  const startTime = Date.now();
  console.log('🔍 Starting quick indexing of Google Location file...');
  
  const index: LocationFileIndex = {
    dateRange: { startDate: '', endDate: '' },
    structure: {
      hasTimelinePath: false,
      hasVisits: false,
      hasActivities: false,
      totalTimelinePathObjects: 0,
      totalTimelinePathPoints: 0,
      estimatedGpsPoints: 0
    },
    fileInfo: {
      sizeBytes: JSON.stringify(jsonData).length,
      processingTimeMs: 0,
      format: 'unknown'
    },
    sampleDates: {}
  };
  
  let earliestDate: Date | null = null;
  let latestDate: Date | null = null;
  let processedCount = 0;
  
  // Determine file format and process accordingly
  if (Array.isArray(jsonData)) {
    index.fileInfo.format = 'legacy_array';
    console.log(`📊 Processing legacy array format with ${jsonData.length} elements`);
    
    // Scan through array elements
    for (let i = 0; i < jsonData.length; i++) {
      const element = jsonData[i];
      processedCount++;
      
      // Progress logging every 5000 elements
      if (processedCount % 5000 === 0) {
        console.log(`📈 Indexed ${processedCount}/${jsonData.length} elements...`);
      }
      
      // Check for visits
      if (element.visit) {
        index.structure.hasVisits = true;
      }
      
      // Check for activities  
      if (element.activity) {
        index.structure.hasActivities = true;
      }
      
      // Check for timelinePath - this is what we map!
      if (element.timelinePath && Array.isArray(element.timelinePath)) {
        index.structure.hasTimelinePath = true;
        index.structure.totalTimelinePathObjects++;
        index.structure.totalTimelinePathPoints += element.timelinePath.length;
        
        // Extract dates from startTime/endTime
        const startDate = parseGoogleDate(element.startTime);
        const endDate = parseGoogleDate(element.endTime);
        
        if (startDate) {
          if (!earliestDate || startDate < earliestDate) earliestDate = startDate;
          if (!latestDate || startDate > latestDate) latestDate = startDate;
          
          // Sample date tracking for calendar
          const dateKey = extractDateKey(startDate);
          index.sampleDates[dateKey] = (index.sampleDates[dateKey] || 0) + element.timelinePath.length;
        }
        
        if (endDate) {
          if (!earliestDate || endDate < earliestDate) earliestDate = endDate;
          if (!latestDate || endDate > latestDate) latestDate = endDate;
        }
      }
    }
  } 
  else if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    index.fileInfo.format = 'modern_timeline_objects';
    console.log(`📊 Processing modern timeline objects format with ${jsonData.timelineObjects.length} objects`);
    
    // Scan through timeline objects
    for (let i = 0; i < jsonData.timelineObjects.length; i++) {
      const obj = jsonData.timelineObjects[i];
      processedCount++;
      
      // Progress logging every 5000 objects
      if (processedCount % 5000 === 0) {
        console.log(`📈 Indexed ${processedCount}/${jsonData.timelineObjects.length} objects...`);
      }
      
      // Check for visits
      if (obj.placeVisit) {
        index.structure.hasVisits = true;
      }
      
      // Check for activities and GPS data
      if (obj.activitySegment) {
        index.structure.hasActivities = true;
        
        // Count GPS points from simplifiedRawPath
        if (obj.activitySegment.simplifiedRawPath?.points) {
          index.structure.hasTimelinePath = true;
          index.structure.totalTimelinePathObjects++;
          index.structure.totalTimelinePathPoints += obj.activitySegment.simplifiedRawPath.points.length;
          
          // Extract dates from duration timestamps
          const startDate = parseGoogleDate(obj.activitySegment.duration?.startTimestamp);
          const endDate = parseGoogleDate(obj.activitySegment.duration?.endTimestamp);
          
          if (startDate) {
            if (!earliestDate || startDate < earliestDate) earliestDate = startDate;
            if (!latestDate || startDate > latestDate) latestDate = startDate;
            
            // Sample date tracking
            const dateKey = extractDateKey(startDate);
            index.sampleDates[dateKey] = (index.sampleDates[dateKey] || 0) + obj.activitySegment.simplifiedRawPath.points.length;
          }
          
          if (endDate) {
            if (!earliestDate || endDate < earliestDate) earliestDate = endDate;
            if (!latestDate || endDate > latestDate) latestDate = endDate;
          }
        }
        
        // Count GPS points from waypointPath
        if (obj.activitySegment.waypointPath?.waypoints) {
          index.structure.totalTimelinePathPoints += obj.activitySegment.waypointPath.waypoints.length;
          
          const dateKey = earliestDate ? extractDateKey(earliestDate) : '2025-01-01';
          index.sampleDates[dateKey] = (index.sampleDates[dateKey] || 0) + obj.activitySegment.waypointPath.waypoints.length;
        }
      }
    }
  }
  
  // Set date range
  if (earliestDate && latestDate) {
    index.dateRange.startDate = extractDateKey(earliestDate);
    index.dateRange.endDate = extractDateKey(latestDate);
  }
  
  // Estimate total GPS points (conservative estimate)
  index.structure.estimatedGpsPoints = index.structure.totalTimelinePathPoints;
  
  // Final processing time
  index.fileInfo.processingTimeMs = Date.now() - startTime;
  
  console.log(`✅ Indexing complete in ${index.fileInfo.processingTimeMs}ms`);
  console.log(`📅 Date range: ${index.dateRange.startDate} to ${index.dateRange.endDate}`);
  console.log(`📍 Found ${index.structure.totalTimelinePathObjects} timelinePath objects with ${index.structure.totalTimelinePathPoints} GPS points`);
  console.log(`🏠 Structure: visits=${index.structure.hasVisits}, activities=${index.structure.hasActivities}, timelinePath=${index.structure.hasTimelinePath}`);
  
  return index;
}