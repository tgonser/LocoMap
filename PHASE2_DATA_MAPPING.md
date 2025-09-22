# Phase 2: Data Structure Mapping for Date Range Processing

## When User Selects Date Range (e.g., "August 1-30, 2025")

### Step 1: Find TIME Context (Visit/Activity Objects)
**Purpose:** Get temporal context and states visited (not for mapping!)

```json
// Look for objects with startTime/endTime in date range
{
  "endTime": "2025-08-15T17:06:26.000-07:00",
  "startTime": "2025-08-15T16:08:34.000-07:00", 
  "visit": {
    "topCandidate": {
      "placeLocation": "geo:47.638273,-122.191286"  // ❌ DON'T MAP THIS
    }
  }
}

// OR

{
  "endTime": "2025-08-15T16:08:34.000-07:00",
  "startTime": "2025-08-15T14:27:48.000-07:00",
  "activity": {
    "start": "geo:32.707917,-117.162824",  // ❌ DON'T MAP THIS  
    "end": "geo:47.637830,-122.191200"    // ❌ DON'T MAP THIS
  }
}
```

**Extract from visit/activity:**
- ✅ **Time ranges** for context
- ✅ **Place information** for states visited reports
- ✅ **Activity types** for travel analytics
- ❌ **Coordinates** for mapping (these are endpoints, not routes!)

### Step 2: Find POINTS Data (timelinePath Objects) 
**Purpose:** Get actual GPS coordinates for mapping

```json
// Look for objects with timelinePath in date range
{
  "endTime": "2025-08-15T07:00:00.000Z",
  "startTime": "2025-08-15T05:00:00.000Z",    // Parent provides base time
  "timelinePath": [
    {
      "point": "geo:20.696314,-156.435062",   // ✅ MAP THESE!
      "durationMinutesOffsetFromStartTime": "97"
    },
    {
      "point": "geo:20.655313,-156.442544",   // ✅ MAP THESE!
      "durationMinutesOffsetFromStartTime": "99"
    }
  ]
}
```

**Extract from timelinePath:**
- ✅ **Parent startTime** (2025-08-15T05:00:00.000Z)
- ✅ **Child coordinates** (geo:20.696314,-156.435062)
- ✅ **Child offsets** (97 minutes)
- ✅ **Calculate timestamps** (startTime + 97 minutes = 06:37:00Z)

### Step 3: Processing Algorithm

```javascript
// Phase 2: Process selected date range
function processDateRange(jsonData, startDate, endDate) {
  const results = {
    timeContext: [],     // From visit/activity objects
    gpsPoints: []        // From timelinePath objects
  };
  
  jsonData.forEach(element => {
    const elementStart = parseDate(element.startTime);
    const elementEnd = parseDate(element.endTime);
    
    // Check if element overlaps with selected date range
    if (isInDateRange(elementStart, elementEnd, startDate, endDate)) {
      
      // Extract TIME context (not for mapping)
      if (element.visit || element.activity) {
        results.timeContext.push({
          startTime: elementStart,
          endTime: elementEnd,
          type: element.visit ? 'visit' : 'activity',
          location: element.visit?.topCandidate?.placeLocation || 
                   element.activity?.start,
          // Use for states visited reports, not mapping
        });
      }
      
      // Extract GPS POINTS (for mapping)
      if (element.timelinePath && Array.isArray(element.timelinePath)) {
        element.timelinePath.forEach(pathPoint => {
          const coords = parseGeoString(pathPoint.point);
          const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
          const timestamp = new Date(elementStart.getTime() + (offsetMinutes * 60 * 1000));
          
          results.gpsPoints.push({
            lat: coords.lat,
            lng: coords.lng,
            timestamp: timestamp,
            activity: 'route'
          });
        });
      }
    }
  });
  
  return results;
}
```

### Step 4: Database Storage Strategy

```sql
-- Store processed GPS points (from timelinePath only)
INSERT INTO location_points (dataset_id, lat, lng, timestamp, activity)
VALUES (?, ?, ?, ?, 'route');

-- Store temporal context (from visit/activity)
INSERT INTO presence_data (dataset_id, start_time, end_time, type, place_location)
VALUES (?, ?, ?, ?, ?);

-- Track processing status
INSERT INTO processed_days (dataset_id, date, status, point_count, last_processed_at)
VALUES (?, ?, 'completed', ?, NOW());
```

### Step 5: Map Rendering

```javascript
// Only use GPS points from timelinePath for map display
const mapPoints = results.gpsPoints.map(point => ({
  lat: point.lat,
  lng: point.lng,
  timestamp: point.timestamp
}));

// Render 50-250 points on map
renderMap(mapPoints);

// Use time context for analytics (separate from map)
generateStatesVisitedReport(results.timeContext);
```

## Key Architecture Rules

### ❌ Never Map These Coordinates:
- `visit.topCandidate.placeLocation` - Place endpoints
- `activity.start` / `activity.end` - Travel endpoints
- Any coordinates from visit/activity objects

### ✅ Always Map These Coordinates:
- `timelinePath[].point` - Actual GPS route data
- Calculate timestamp: `parent.startTime + child.durationMinutesOffsetFromStartTime`

### Data Source Separation:
- **visit/activity** = Time context + states visited reports
- **timelinePath** = GPS coordinates + map visualization

This separation prevents the "mixing coordinates from different sources" architectural mistake we identified earlier.