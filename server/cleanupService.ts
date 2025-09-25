import { db } from './db';
import { locationDatasets, datasetMergeEvents } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Configure uploads directory (supports persistent disk)
const UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads';

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format for security
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Clean up redundant source files after successful merge
 */
export async function cleanupAfterMerge(mergedDatasetId: string, userId: string): Promise<void> {
  console.log(`🧹 Starting post-merge cleanup for dataset ${mergedDatasetId}`);
  
  if (!isValidUUID(mergedDatasetId)) {
    console.error(`❌ Invalid dataset ID format: ${mergedDatasetId}`);
    return;
  }
  
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
    
    // 2. Find source datasets that were merged into this one using the new sourceDatasetId field
    const mergeEvents = await db.select()
      .from(datasetMergeEvents)
      .where(eq(datasetMergeEvents.datasetId, mergedDatasetId));
      
    const sourceDatasetIds = mergeEvents
      .map(event => event.sourceDatasetId)
      .filter(Boolean) as string[];
    
    // 3. Clean up source files (preserve metadata, remove raw content)
    for (const sourceId of sourceDatasetIds) {
      if (isValidUUID(sourceId)) {
        await cleanupRedundantDataset(sourceId, mergedDatasetId, userId);
      } else {
        console.warn(`⚠️  Skipping invalid source dataset ID: ${sourceId}`);
      }
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
 * Safely delete filesystem file if it exists
 */
export async function deleteFileIfExists(datasetId: string): Promise<void> {
  if (!isValidUUID(datasetId)) {
    console.error(`❌ Security: Invalid UUID format for file deletion: ${datasetId}`);
    return;
  }
  
  const fileName = `${datasetId}.json`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  
  try {
    // Security check: ensure the resolved path is within UPLOADS_DIR
    const resolvedPath = path.resolve(filePath);
    const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
    
    if (!resolvedPath.startsWith(resolvedUploadsDir)) {
      console.error(`❌ Security: File path outside uploads directory: ${filePath}`);
      return;
    }
    
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
 * Prevent duplicate uploads via persistent content hash
 */
export async function checkForDuplicateFile(fileContent: string, userId: string): Promise<string | null> {
  const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
  
  // Check if this exact content hash already exists for this user
  const existingDataset = await db.select()
    .from(locationDatasets)
    .where(and(
      eq(locationDatasets.userId, userId),
      eq(locationDatasets.contentHash, fileHash)
    ))
    .limit(1);
    
  return existingDataset.length > 0 ? existingDataset[0].id : null;
}

/**
 * Store content hash when creating a new dataset
 */
export async function storeContentHash(datasetId: string, fileContent: string, userId: string): Promise<void> {
  if (!isValidUUID(datasetId)) {
    console.error(`❌ Invalid dataset ID format: ${datasetId}`);
    return;
  }
  
  const fileHash = crypto.createHash('sha256').update(fileContent).digest('hex');
  
  try {
    await db.update(locationDatasets)
      .set({ contentHash: fileHash })
      .where(and(
        eq(locationDatasets.id, datasetId),
        eq(locationDatasets.userId, userId)
      ));
      
    console.log(`🔐 Stored content hash for dataset ${datasetId}`);
  } catch (error) {
    console.error(`❌ Failed to store content hash for dataset ${datasetId}:`, error);
  }
}