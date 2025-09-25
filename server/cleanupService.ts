import { db } from './db.js';
import { locationDatasets, datasetMergeEvents } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Configure uploads directory (supports persistent disk)
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

/**
 * Clean up redundant source files after successful merge
 */
export async function cleanupAfterMerge(mergedDatasetId: string, userId: string): Promise<void> {
  console.log(`🧹 Starting post-merge cleanup for dataset ${mergedDatasetId}`);
  
  try {
    // 1. Get the merged dataset info
    const mergedDataset = await db.select()
      .from(locationDatasets)
      .where(and(
        eq(locationDatasets.id, mergedDatasetId),
        eq(locationDatasets.userId, userId)
      ))
      .limit(1);
      
    if (mergedDataset.length === 0 || mergedDataset[0].mergeCount === 0) {
      console.log(`⚠️  No merge cleanup needed for dataset ${mergedDatasetId}`);
      return;
    }
    
    // 2. Find source datasets that were merged into this one
    const mergeEvents = await db.select()
      .from(datasetMergeEvents)
      .where(eq(datasetMergeEvents.datasetId, mergedDatasetId));
      
    const sourceDatasetIds = mergeEvents
      .map(event => event.sourceFilename)
      .filter(Boolean) as string[];
    
    // 3. Clean up source files (preserve metadata, remove raw content)
    for (const sourceId of sourceDatasetIds) {
      await cleanupRedundantDataset(sourceId, mergedDatasetId, userId);
    }
    
    console.log(`✅ Post-merge cleanup completed for ${sourceDatasetIds.length} source files`);
  } catch (error) {
    console.error(`❌ Failed to complete post-merge cleanup for ${mergedDatasetId}:`, error);
  }
}

/**
 * Clean up when replacing an existing file
 */
export async function cleanupAfterReplace(newDatasetId: string, oldDatasetId: string, userId: string): Promise<void> {
  console.log(`🧹 Starting post-replace cleanup: ${oldDatasetId} → ${newDatasetId}`);
  
  try {
    // Mark old dataset as superseded and clean up raw content
    await cleanupRedundantDataset(oldDatasetId, newDatasetId, userId);
    
    console.log(`✅ Post-replace cleanup completed`);
  } catch (error) {
    console.error(`❌ Failed to complete post-replace cleanup:`, error);
  }
}

/**
 * Generic function to clean up a redundant dataset
 */
export async function cleanupRedundantDataset(redundantId: string, replacementId: string, userId: string): Promise<void> {
  try {
    // 1. Update database: null raw content, mark as superseded
    await db.update(locationDatasets)
      .set({
        rawContent: null,
        filename: sql`${locationDatasets.filename} || ' [superseded]'`
      })
      .where(and(
        eq(locationDatasets.id, redundantId),
        eq(locationDatasets.userId, userId)
      ));
    
    // 2. Delete filesystem file if it exists
    await deleteFileIfExists(redundantId);
    
    console.log(`🗑️ Cleaned up redundant dataset ${redundantId} (replaced by ${replacementId})`);
  } catch (error) {
    console.error(`❌ Failed to cleanup dataset ${redundantId}:`, error);
  }
}

/**
 * Delete filesystem file if it exists
 */
export async function deleteFileIfExists(datasetId: string): Promise<void> {
  const filePath = path.join(UPLOADS_DIR, `${datasetId}.json`);
  try {
    await fs.promises.unlink(filePath);
    console.log(`🗑️ Deleted file: ${filePath}`);
  } catch (error: any) {
    // File doesn't exist or already deleted - that's fine
    if (error.code !== 'ENOENT') {
      console.warn(`⚠️  Failed to delete file ${filePath}:`, error);
    }
  }
}

/**
 * Prevent duplicate uploads via file content comparison
 */
export async function checkForDuplicateFile(fileContent: string, userId: string): Promise<string | null> {
  const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
  
  // Get all user's datasets and check raw content hash
  const userDatasets = await db.select()
    .from(locationDatasets)
    .where(and(
      eq(locationDatasets.userId, userId),
      sql`${locationDatasets.rawContent} IS NOT NULL`
    ));
    
  for (const dataset of userDatasets) {
    if (dataset.rawContent) {
      const existingHash = crypto.createHash('sha256').update(dataset.rawContent).digest('hex');
      if (existingHash === fileHash) {
        return dataset.id;
      }
    }
  }
    
  return null;
}