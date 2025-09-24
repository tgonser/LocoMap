// Debug why parseVisitsActivitiesModern finds only 2-3 samples when thousands exist
import { readFileSync } from 'fs';

function parseToUTCDate(timestampStr) {
  try {
    const date = new Date(timestampStr);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

function getLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// My current parseVisitsActivitiesModern logic
function debugParseLogic(jsonData, year) {
  const samples = [];
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  
  const timelineObjects = jsonData.timelineObjects || [];
  
  console.log(`🔍 Debugging parse logic for ${year}:`);
  console.log(`  Year range: ${yearStart.toISOString()} to ${yearEnd.toISOString()}`);
  
  let visitAttempts = 0;
  let visitSuccess = 0;
  let activityAttempts = 0;
  let activitySuccess = 0;
  
  let debugCounter = 0;
  
  timelineObjects.forEach((obj, i) => {
    // Debug first few objects in detail
    if (debugCounter < 5 && (obj.visit || obj.activity)) {
      console.log(`\n  Debug object ${i}:`);
      console.log(`    Has visit: ${!!obj.visit}, Has activity: ${!!obj.activity}`);
      console.log(`    Has startTime: ${!!obj.startTime}, Has endTime: ${!!obj.endTime}`);
      console.log(`    StartTime: ${obj.startTime}`);
      console.log(`    EndTime: ${obj.endTime}`);
      
      if (obj.visit) {
        console.log(`    Visit structure:`, {
          hasTopCandidate: !!obj.visit.topCandidate,
          hasPlaceLocation: !!obj.visit.topCandidate?.placeLocation,
          placeLocation: obj.visit.topCandidate?.placeLocation
        });
      }
      
      if (obj.activity) {
        console.log(`    Activity structure:`, {
          hasStart: !!obj.activity.start,
          hasEnd: !!obj.activity.end,
          start: obj.activity.start,
          end: obj.activity.end
        });
      }
      
      debugCounter++;
    }
    
    // Parse visits - trace the exact logic
    const visit = obj.visit;
    if (visit && obj.startTime && obj.endTime) {
      visitAttempts++;
      
      if (visit.topCandidate?.placeLocation) {
        const startTime = parseToUTCDate(obj.startTime);
        const endTime = parseToUTCDate(obj.endTime);
        
        if (startTime && endTime) {
          const inRange = startTime >= yearStart && startTime < yearEnd;
          
          if (debugCounter <= 5) {
            console.log(`    Visit date check: ${startTime.toISOString()} in range? ${inRange}`);
          }
          
          if (inRange) {
            const geoMatch = visit.topCandidate.placeLocation.match(/geo:([^,]+),([^,]+)/);
            if (geoMatch) {
              visitSuccess++;
              
              const lat = parseFloat(geoMatch[1]);
              const lng = parseFloat(geoMatch[2]);
              const durationMs = endTime.getTime() - startTime.getTime();
              const date = getLocalDateKey(startTime);
              
              samples.push({
                date,
                lat,
                lng,
                durationMs,
                provenance: 'visit',
                timestamp: startTime
              });
            }
          }
        }
      }
    }
    
    // Parse activities - trace the exact logic
    const activity = obj.activity;
    if (activity && obj.startTime && obj.endTime) {
      activityAttempts++;
      
      if (activity.start) {
        const startTime = parseToUTCDate(obj.startTime);
        const endTime = parseToUTCDate(obj.endTime);
        
        if (startTime && endTime) {
          const inRange = startTime >= yearStart && startTime < yearEnd;
          
          if (debugCounter <= 5) {
            console.log(`    Activity date check: ${startTime.toISOString()} in range? ${inRange}`);
          }
          
          if (inRange) {
            const geoMatch = activity.start.match(/geo:([^,]+),([^,]+)/);
            if (geoMatch) {
              activitySuccess++;
              
              const lat = parseFloat(geoMatch[1]);
              const lng = parseFloat(geoMatch[2]);
              const durationMs = endTime.getTime() - startTime.getTime();
              const date = getLocalDateKey(startTime);
              
              samples.push({
                date,
                lat,
                lng,
                durationMs,
                provenance: 'activity',
                timestamp: startTime
              });
            }
          }
        }
      }
    }
  });
  
  console.log(`\n  📊 PARSING RESULTS:`);
  console.log(`    Visit attempts: ${visitAttempts}, Success: ${visitSuccess}`);
  console.log(`    Activity attempts: ${activityAttempts}, Success: ${activitySuccess}`);
  console.log(`    Total samples found: ${samples.length}`);
  
  return samples;
}

// Test the debug logic
try {
  console.log('🚨 DEBUGGING PARSE LOGIC BUG...\n');
  const rawJson = readFileSync('./uploads/922dd57a-63c6-4052-bcac-0cfcf0df35a2.json', 'utf8');
  const jsonData = JSON.parse(rawJson);
  
  console.log('Testing 2024...');
  const samples2024 = debugParseLogic(jsonData, 2024);
  
  console.log('\n' + '='.repeat(50));
  console.log('Testing 2025...');  
  const samples2025 = debugParseLogic(jsonData, 2025);
  
  console.log('\n' + '='.repeat(50));
  console.log('🎯 FINAL COMPARISON:');
  console.log(`  Expected (from date investigation): 5007 (2024) + 3921 (2025) = 8928`);
  console.log(`  Actual (from parsing logic): ${samples2024.length} (2024) + ${samples2025.length} (2025) = ${samples2024.length + samples2025.length}`);
  
  if (samples2024.length + samples2025.length < 100) {
    console.log('\n❌ SEVERE PARSING BUG CONFIRMED!');
    console.log('   The parsing logic is failing to extract available data.');
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
}