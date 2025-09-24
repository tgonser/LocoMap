/**
 * JSON File Merger for Google Location History
 * Safely combines multiple timeline JSON files with smart deduplication
 */

import crypto from 'crypto';
import { buildParentIndex, processTimelinePathsForDateRange, type ParentIndex, type TimelinePathPoint } from './timelineAssociation.js';

export interface MergedDataset {
  timelineObjects: any[];
  metadata: {
    sourceDatasets: string[];
    totalObjects: number;
    dateRange: { start: string; end: string };
    mergedAt: string;
  };
}

export interface MergePreview {
  totalObjects: number;
  dateRange: { start: string; end: string };
  sourceDatasets: Array<{
    id: string;
    filename: string;
    objectCount: number;
    dateRange: { start: string; end: string };
  }>;
  duplicatesRemoved: number;
  overlappingDays: number;
}

/**
 * Create a stable hash for timeline objects to detect duplicates
 */
function createTimelineObjectHash(obj: any): string {
  let hashInput = '';
  
  if (obj.activitySegment) {
    const activity = obj.activitySegment;
    const startMs = activity.duration?.startTimestampMs || activity.startTime;
    const endMs = activity.duration?.endTimestampMs || activity.endTime;
    
    // Create hash from time range and activity type
    hashInput = `activity:${startMs}:${endMs}:${activity.activityType || 'unknown'}`;
    
    // Add location data if available
    if (activity.startLocation) {
      hashInput += `:${Math.round(activity.startLocation.latitudeE7 / 1000)}:${Math.round(activity.startLocation.longitudeE7 / 1000)}`;
    }
  } else if (obj.placeVisit) {
    const visit = obj.placeVisit;
    const startMs = visit.duration?.startTimestampMs || visit.startTime;
    const endMs = visit.duration?.endTimestampMs || visit.endTime;
    
    // Create hash from time range and location
    hashInput = `visit:${startMs}:${endMs}`;
    
    if (visit.location) {
      hashInput += `:${Math.round(visit.location.latitudeE7 / 1000)}:${Math.round(visit.location.longitudeE7 / 1000)}`;
    }
  } else if (obj.timelinePath) {
    // For standalone timelinePath objects
    const startTime = obj.startTime;
    const endTime = obj.endTime;
    hashInput = `timeline:${startTime}:${endTime}:${obj.timelinePath.length}`;
  } else {
    // Fallback for unknown objects
    hashInput = JSON.stringify(obj);
  }
  
  return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
}

/**
 * Extract date range from timeline objects
 */
function extractDateRange(timelineObjects: any[]): { start: string; end: string } {
  if (timelineObjects.length === 0) {
    return { start: '', end: '' };
  }
  
  let earliestMs = Infinity;
  let latestMs = -Infinity;
  
  for (const obj of timelineObjects) {
    let startMs: number | null = null;
    let endMs: number | null = null;
    
    if (obj.activitySegment) {
      startMs = obj.activitySegment.duration?.startTimestampMs ? 
        parseInt(obj.activitySegment.duration.startTimestampMs) : null;
      endMs = obj.activitySegment.duration?.endTimestampMs ? 
        parseInt(obj.activitySegment.duration.endTimestampMs) : null;
    } else if (obj.placeVisit) {
      startMs = obj.placeVisit.duration?.startTimestampMs ? 
        parseInt(obj.placeVisit.duration.startTimestampMs) : null;
      endMs = obj.placeVisit.duration?.endTimestampMs ? 
        parseInt(obj.placeVisit.duration.endTimestampMs) : null;
    } else if (obj.startTime && obj.endTime) {
      startMs = new Date(obj.startTime).getTime();
      endMs = new Date(obj.endTime).getTime();
    }
    
    if (startMs && !isNaN(startMs)) {
      earliestMs = Math.min(earliestMs, startMs);
    }
    if (endMs && !isNaN(endMs)) {
      latestMs = Math.max(latestMs, endMs);
    }
  }
  
  const start = earliestMs !== Infinity ? new Date(earliestMs).toISOString().split('T')[0] : '';
  const end = latestMs !== -Infinity ? new Date(latestMs).toISOString().split('T')[0] : '';
  
  return { start, end };
}

/**
 * Merge multiple timeline JSON datasets with smart deduplication
 */
export function mergeTimelineDatasets(datasets: Array<{ id: string; filename: string; rawContent: string }>): MergedDataset {
  console.log(`🔄 Merging ${datasets.length} timeline datasets...`);
  
  const allTimelineObjects: any[] = [];
  const seenHashes = new Set<string>();
  let duplicatesRemoved = 0;
  
  // Process each dataset
  for (const dataset of datasets) {
    console.log(`📂 Processing dataset: ${dataset.filename}`);
    
    try {
      const jsonData = JSON.parse(dataset.rawContent);
      let objects: any[] = [];
      
      // Extract timeline objects from various formats
      if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
        objects = jsonData.timelineObjects;
      } else if (Array.isArray(jsonData)) {
        objects = jsonData;
      } else {
        console.warn(`Skipping dataset ${dataset.filename}: no timeline objects found`);
        continue;
      }
      
      console.log(`📊 Found ${objects.length} timeline objects in ${dataset.filename}`);
      
      // Add unique objects with deduplication
      for (const obj of objects) {
        const hash = createTimelineObjectHash(obj);
        
        if (seenHashes.has(hash)) {
          duplicatesRemoved++;
          continue;
        }
        
        seenHashes.add(hash);
        allTimelineObjects.push(obj);
      }
      
    } catch (error) {
      console.error(`❌ Failed to parse dataset ${dataset.filename}:`, error);
      continue;
    }
  }
  
  // Sort by chronological order
  allTimelineObjects.sort((a, b) => {
    const getStartTime = (obj: any): number => {
      if (obj.activitySegment?.duration?.startTimestampMs) {
        return parseInt(obj.activitySegment.duration.startTimestampMs);
      }
      if (obj.placeVisit?.duration?.startTimestampMs) {
        return parseInt(obj.placeVisit.duration.startTimestampMs);
      }
      if (obj.startTime) {
        return new Date(obj.startTime).getTime();
      }
      return 0;
    };
    
    return getStartTime(a) - getStartTime(b);
  });
  
  const dateRange = extractDateRange(allTimelineObjects);
  
  console.log(`✅ Merged complete: ${allTimelineObjects.length} objects (${duplicatesRemoved} duplicates removed)`);
  console.log(`📅 Date range: ${dateRange.start} to ${dateRange.end}`);
  
  return {
    timelineObjects: allTimelineObjects,
    metadata: {
      sourceDatasets: datasets.map(d => d.id),
      totalObjects: allTimelineObjects.length,
      dateRange,
      mergedAt: new Date().toISOString()
    }
  };
}

/**
 * Generate merge preview without actually merging
 */
export function generateMergePreview(datasets: Array<{ id: string; filename: string; rawContent: string }>): MergePreview {
  console.log(`🔍 Generating merge preview for ${datasets.length} datasets...`);
  
  const sourceInfo = [];
  const allHashes = new Set<string>();
  let totalObjects = 0;
  let duplicatesRemoved = 0;
  let globalStartMs = Infinity;
  let globalEndMs = -Infinity;
  
  for (const dataset of datasets) {
    try {
      const jsonData = JSON.parse(dataset.rawContent);
      let objects: any[] = [];
      
      if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
        objects = jsonData.timelineObjects;
      } else if (Array.isArray(jsonData)) {
        objects = jsonData;
      }
      
      const dateRange = extractDateRange(objects);
      sourceInfo.push({
        id: dataset.id,
        filename: dataset.filename,
        objectCount: objects.length,
        dateRange
      });
      
      // Track global date range
      if (dateRange.start) {
        const startMs = new Date(dateRange.start).getTime();
        globalStartMs = Math.min(globalStartMs, startMs);
      }
      if (dateRange.end) {
        const endMs = new Date(dateRange.end).getTime();
        globalEndMs = Math.max(globalEndMs, endMs);
      }
      
      // Count duplicates
      for (const obj of objects) {
        const hash = createTimelineObjectHash(obj);
        if (allHashes.has(hash)) {
          duplicatesRemoved++;
        } else {
          allHashes.add(hash);
          totalObjects++;
        }
      }
      
    } catch (error) {
      console.error(`❌ Failed to preview dataset ${dataset.filename}:`, error);
    }
  }
  
  const globalDateRange = {
    start: globalStartMs !== Infinity ? new Date(globalStartMs).toISOString().split('T')[0] : '',
    end: globalEndMs !== -Infinity ? new Date(globalEndMs).toISOString().split('T')[0] : ''
  };
  
  // Calculate overlapping days (simplified estimation)
  const overlappingDays = sourceInfo.length > 1 ? Math.max(0, duplicatesRemoved / 100) : 0;
  
  return {
    totalObjects,
    dateRange: globalDateRange,
    sourceDatasets: sourceInfo,
    duplicatesRemoved,
    overlappingDays: Math.round(overlappingDays)
  };
}

/**
 * Merge and deduplicate GPS points from multiple datasets for a date range
 */
export function mergePointsForDateRange(
  datasets: Array<{ id: string; rawContent: string }>,
  startDate: string,
  endDate: string
): TimelinePathPoint[] {
  console.log(`🔗 Merging GPS points from ${datasets.length} datasets for ${startDate} to ${endDate}...`);
  
  const allPoints: TimelinePathPoint[] = [];
  const pointHashes = new Set<string>();
  let duplicatesRemoved = 0;
  
  for (const dataset of datasets) {
    try {
      const jsonData = JSON.parse(dataset.rawContent);
      
      // Build parent index for this dataset
      const parentIndex = buildParentIndex(jsonData);
      
      // Extract points for date range
      const points = processTimelinePathsForDateRange(jsonData, parentIndex, startDate, endDate);
      
      // Deduplicate points using timestamp + coordinates
      for (const point of points) {
        // Create hash from timestamp + rounded coordinates
        const pointHash = crypto.createHash('sha256')
          .update(`${point.timestampMs}:${Math.round(point.latitude * 10000)}:${Math.round(point.longitude * 10000)}`)
          .digest('hex')
          .substring(0, 16);
        
        if (pointHashes.has(pointHash)) {
          duplicatesRemoved++;
          continue;
        }
        
        pointHashes.add(pointHash);
        allPoints.push({
          ...point,
          parentId: `${dataset.id}_${point.parentId}` // Prefix with dataset ID
        });
      }
      
    } catch (error) {
      console.error(`❌ Failed to extract points from dataset ${dataset.id}:`, error);
    }
  }
  
  // Sort points chronologically
  allPoints.sort((a, b) => a.timestampMs - b.timestampMs);
  
  console.log(`✅ Merged ${allPoints.length} GPS points (${duplicatesRemoved} duplicates removed)`);
  
  return allPoints;
}

/**
 * Calculate content hash for duplicate detection
 */
export function calculateContentHash(rawContent: string): string {
  return crypto.createHash('sha256').update(rawContent).digest('hex');
}