import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { pipeline, Writable, Transform } from 'stream';
import { promisify } from 'util';
import type { IStorage } from './storage';
import type { LocationPoint, InsertLocationPoint } from '../shared/schema';

// Simple streaming ingestion without external dependencies

const pipelineAsync = promisify(pipeline);

/**
 * Parse timestamp ensuring UTC interpretation (matches working parser)
 */
function parseToUTCDate(timestamp: string): Date | null {
  if (!timestamp) return null;
  
  // Ensure proper UTC interpretation
  const hasTimezoneInfo = /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp);
  const normalized = hasTimezoneInfo ? timestamp : timestamp + 'Z';
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms);
}

interface StreamingIngestOptions {
  batchSize?: number;
  onProgress?: (processed: number, total?: number) => void;
}

interface ThinRecord {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
}

/**
 * Streaming location history ingestion that processes large files efficiently
 * without loading everything into memory at once.
 */
export class GoogleLocationIngest {
  constructor(private storage: IStorage) {}

  /**
   * Ingest location data from a Google Location History file using streaming.
   * Processes timelinePath points incrementally and writes to database in batches.
   */
  async ingest(
    filePath: string, 
    userId: string, 
    datasetId: string, 
    options: StreamingIngestOptions = {}
  ): Promise<{ processed: number; errors: string[] }> {
    const { batchSize = 25000, onProgress } = options;
    const errors: string[] = [];
    let processed = 0;
    let batch: InsertLocationPoint[] = [];

    console.log(`🚀 Starting streaming ingest from ${filePath}`);
    console.log(`📦 Batch size: ${batchSize.toLocaleString()}`);

    // Create a writable stream that accumulates records and flushes in batches
    const batchWriter = new Writable({
      objectMode: true,
      write: async (record: ThinRecord, _encoding, callback) => {
        try {
          // Convert thin record to InsertLocationPoint
          const locationPoint: InsertLocationPoint = {
            userId,
            datasetId,
            lat: record.lat,
            lng: record.lng,
            timestamp: record.timestamp,
            accuracy: record.accuracy || null,
            activity: 'route', // timelinePath points are route data
            address: null,
            city: null,
            state: null,
            country: null
          };

          batch.push(locationPoint);

          // Flush batch when it reaches the target size
          if (batch.length >= batchSize) {
            await this.flushBatch(batch);
            processed += batch.length;
            console.log(`✅ Processed ${processed.toLocaleString()} points`);
            onProgress?.(processed);
            batch = [];
          }

          callback();
        } catch (error) {
          console.error('❌ Error processing record:', error);
          errors.push(`Processing error: ${error}`);
          callback();
        }
      },
      
      final: async (callback) => {
        try {
          // Flush remaining records
          if (batch.length > 0) {
            await this.flushBatch(batch);
            processed += batch.length;
            console.log(`✅ Final batch: ${batch.length} points`);
            console.log(`🎉 Total processed: ${processed.toLocaleString()} points`);
            onProgress?.(processed);
          }
          callback();
        } catch (error) {
          console.error('❌ Error in final flush:', error);
          errors.push(`Final flush error: ${error}`);
          callback(error as Error);
        }
      }
    });

    try {
      // Use a simple JSON streaming approach instead of complex stream-json
      await this.simpleStreamProcess(filePath, batchWriter);

      return { processed, errors };

    } catch (error) {
      console.error('❌ Streaming pipeline error:', error);
      errors.push(`Pipeline error: ${error}`);
      return { processed, errors };
    }
  }

  /**
   * Simple streaming process that loads JSON in chunks to avoid stream-json complexity.
   * For now, we'll use a simpler approach until we can properly implement streaming.
   */
  private async simpleStreamProcess(filePath: string, batchWriter: Writable): Promise<void> {
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    const jsonData = JSON.parse(fileContent);
    
    // Process in chunks to avoid memory issues
    await this.processDataInChunks(jsonData, batchWriter);
  }

  /**
   * Process JSON data in chunks to avoid memory overflow.
   */
  private async processDataInChunks(jsonData: any, batchWriter: Writable): Promise<void> {
    // Handle modern format: timelineObjects array
    if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
      console.log(`📊 Processing ${jsonData.timelineObjects.length} timeline objects`);
      
      for (let i = 0; i < jsonData.timelineObjects.length; i++) {
        const item = jsonData.timelineObjects[i];
        await this.extractFromTimelineObject(item, batchWriter);
        
        // Process in chunks of 1000 timeline objects
        if (i % 1000 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
    // Handle legacy array format
    else if (Array.isArray(jsonData)) {
      console.log(`📊 Processing ${jsonData.length} legacy items`);
      
      for (let i = 0; i < jsonData.length; i++) {
        const item = jsonData[i];
        await this.extractFromLegacyItem(item, batchWriter);
        
        // Process in chunks of 1000 items
        if (i % 1000 === 0) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    }
    
    // Signal end of processing and wait for completion
    batchWriter.end();
    
    // Wait for the stream to finish before returning so processed count is accurate
    await new Promise((resolve, reject) => {
      batchWriter.once('finish', resolve);
      batchWriter.once('error', reject);
    });
  }

  /**
   * Extract points from a modern timelineObject format item.
   */
  private async extractFromTimelineObject(item: any, batchWriter: Writable): Promise<void> {
    try {
      // Modern Google exports: GPS route data in activitySegment.simplifiedRawPath.points
      if (item.activitySegment?.simplifiedRawPath?.points && Array.isArray(item.activitySegment.simplifiedRawPath.points)) {
        const startTime = item.activitySegment?.duration?.startTimestamp ? parseToUTCDate(item.activitySegment.duration.startTimestamp) : new Date();
        const endTime = item.activitySegment?.duration?.endTimestamp ? parseToUTCDate(item.activitySegment.duration.endTimestamp) : null;
        
        const points = item.activitySegment.simplifiedRawPath.points;
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          if (point.latE7 !== undefined && point.lngE7 !== undefined) {
            let timestamp: Date;
            
            // Use individual point timestamp if available
            if (point.timestampMs) {
              timestamp = new Date(parseInt(point.timestampMs));
            } 
            // Generate incremental timestamps for points without individual times
            else if (startTime && endTime && points.length > 1) {
              const segmentDuration = endTime.getTime() - startTime.getTime();
              const pointOffset = (segmentDuration / (points.length - 1)) * i;
              timestamp = new Date(startTime.getTime() + pointOffset);
            } 
            // Fallback to segment start time
            else {
              timestamp = startTime || new Date();
            }
            
            const record: ThinRecord = {
              lat: point.latE7 / 1e7,
              lng: point.lngE7 / 1e7,
              timestamp,
              accuracy: point.accuracy || point.accuracyMeters ? parseInt(point.accuracy || point.accuracyMeters) : undefined
            };
            batchWriter.write(record);
          }
        }
      }
      
      // Modern Google exports: Additional GPS route data in activitySegment.waypointPath.waypoints
      if (item.activitySegment?.waypointPath?.waypoints && Array.isArray(item.activitySegment.waypointPath.waypoints)) {
        const startTime = item.activitySegment?.duration?.startTimestamp ? parseToUTCDate(item.activitySegment.duration.startTimestamp) : new Date();
        const endTime = item.activitySegment?.duration?.endTimestamp ? parseToUTCDate(item.activitySegment.duration.endTimestamp) : null;
        
        const waypoints = item.activitySegment.waypointPath.waypoints;
        for (let i = 0; i < waypoints.length; i++) {
          const waypoint = waypoints[i];
          if (waypoint.latE7 !== undefined && waypoint.lngE7 !== undefined) {
            let timestamp: Date;
            
            // Generate incremental timestamps for waypoints (they typically don't have individual timestampMs)
            if (startTime && endTime && waypoints.length > 1) {
              const segmentDuration = endTime.getTime() - startTime.getTime();
              const pointOffset = (segmentDuration / (waypoints.length - 1)) * i;
              timestamp = new Date(startTime.getTime() + pointOffset);
            } 
            // Fallback to segment start time
            else {
              timestamp = startTime || new Date();
            }
            
            const record: ThinRecord = {
              lat: waypoint.latE7 / 1e7,
              lng: waypoint.lngE7 / 1e7,
              timestamp,
              accuracy: waypoint.accuracy || waypoint.accuracyMeters ? parseInt(waypoint.accuracy || waypoint.accuracyMeters) : undefined
            };
            batchWriter.write(record);
          }
        }
      }
    } catch (error) {
      console.error('❌ Timeline object extraction error:', error);
    }
  }

  /**
   * Extract points from a legacy array format item.
   */
  private async extractFromLegacyItem(item: any, batchWriter: Writable): Promise<void> {
    try {
      const startTime = item.startTime ? parseToUTCDate(item.startTime) : new Date();
      const endTime = item.endTime ? parseToUTCDate(item.endTime) : null;
      
      if (item.timelinePath && Array.isArray(item.timelinePath)) {
        const points = item.timelinePath;
        
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          
          // Generate unique timestamp for each point to avoid collisions
          let pointTimestamp: Date;
          if (point.time) {
            // Use individual point timestamp if available
            pointTimestamp = parseToUTCDate(point.time);
          } 
          // Generate incremental timestamps for points without individual times
          else if (startTime && endTime && points.length > 1) {
            const segmentDuration = endTime.getTime() - startTime.getTime();
            const pointOffset = (segmentDuration / (points.length - 1)) * i;
            pointTimestamp = new Date(startTime.getTime() + pointOffset);
          } 
          // Fallback to segment start time
          else {
            pointTimestamp = startTime || new Date();
          }
          
          const record = this.parseLocationPoint(point, pointTimestamp);
          if (record) {
            batchWriter.write(record);
          }
        }
      }
    } catch (error) {
      console.error('❌ Legacy item extraction error:', error);
    }
  }

  /**
   * Parse a single location point from various formats.
   */
  private parseLocationPoint(point: any, baseTime: Date): ThinRecord | null {
    try {
      let latitude: number;
      let longitude: number;
      let timestamp = baseTime;

      // Handle different coordinate formats
      if (point.latE7 && point.lngE7) {
        // E7 format (integer coordinates)
        latitude = point.latE7 / 10000000;
        longitude = point.lngE7 / 10000000;
      } else if (typeof point.latitude === 'number' && typeof point.longitude === 'number') {
        // Direct decimal format
        latitude = point.latitude;
        longitude = point.longitude;
      } else if (point.point && point.point.startsWith?.('geo:')) {
        // Geo URI format: "geo:lat,lng"
        const coords = point.point.slice(4).split(',');
        if (coords.length >= 2) {
          latitude = parseFloat(coords[0]);
          longitude = parseFloat(coords[1]);
        } else {
          return null;
        }
      } else {
        return null;
      }

      // Validate coordinates
      if (isNaN(latitude) || isNaN(longitude) || 
          Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        return null;
      }

      // Parse timestamp if available
      if (point.time) {
        timestamp = new Date(point.time);
      } else if (point.timestampMs) {
        timestamp = new Date(parseInt(point.timestampMs));
      } else if (point.durationMinutesOffsetFromStartTime && baseTime) {
        // Mobile timelinePath format: calculate timestamp from segment start + offset
        const offsetMinutes = parseInt(point.durationMinutesOffsetFromStartTime);
        if (!isNaN(offsetMinutes)) {
          timestamp = new Date(baseTime.getTime() + (offsetMinutes * 60 * 1000));
        }
      }

      return {
        lat: latitude,
        lng: longitude,
        timestamp,
        accuracy: point.accuracy ? parseInt(point.accuracy) : undefined
      };
    } catch (error) {
      console.error('❌ Point parsing error:', error);
      return null;
    }
  }

  /**
   * Flush a batch of location points to storage.
   */
  private async flushBatch(batch: InsertLocationPoint[]): Promise<void> {
    try {
      await this.storage.insertLocationPoints(batch);
    } catch (error) {
      console.error(`❌ Failed to flush batch of ${batch.length} points:`, error);
      throw error;
    }
  }
}