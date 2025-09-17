// Temporary test script to compute daily centroids for existing data
import { storage } from './server/storage.js';

async function testDailyCentroidPipeline() {
  try {
    const userId = '47712170';
    const datasetId = 'e0c9a0d6-8445-4460-898c-6972ff1b2075';
    
    console.log(`Starting daily centroid computation for user ${userId}, dataset ${datasetId}`);
    
    // Compute and upsert daily centroids
    const centroidsCreated = await storage.computeAndUpsertDailyCentroids(userId, datasetId);
    console.log(`Created ${centroidsCreated} daily centroids`);
    
    // Get ungeocoded centroids
    const ungeocoded = await storage.getUngeocodedDailyCentroids(userId);
    console.log(`Found ${ungeocoded.length} centroids needing geocoding`);
    
    // Test the analytics endpoint with a sample date range
    const startDate = new Date('2023-01-01');
    const endDate = new Date('2024-12-31');
    
    const stats = await storage.getLocationStatsByDateRange(userId, startDate, endDate);
    console.log('Analytics results:', JSON.stringify(stats, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error in test:', error);
    process.exit(1);
  }
}

testDailyCentroidPipeline();