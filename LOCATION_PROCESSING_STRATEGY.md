# Google Location History Processing Strategy

## Critical Architecture Rules ⚠️

### Data Source Separation (NEVER FORGET!)
- **❌ NEVER map activity/visit coordinates** - They are for time context and states visited reports ONLY
- **✅ ONLY map timelinePath GPS coordinates** - This is actual route data for mapping
- **❌ NO synthetic timestamp interpolation** - Use real timestamps only

### Data Structure Understanding

**Your JSON Structure:**
```json
[
  { "visit": { "placeLocation": "geo:32.705,-117.160" } },     // For states visited reports
  { "activity": { "start": "geo:32.707,-117.162" } },         // For travel analytics  
  { 
    "startTime": "2025-09-20T05:00:00.000Z",                  // Parent provides base time
    "timelinePath": [
      {
        "point": "geo:20.696314,-156.435062",                 // Child provides coordinates
        "durationMinutesOffsetFromStartTime": "97"            // Child provides offset
      }
    ]
  }
]
```

**For Mapping:** Extract ONLY timelinePath objects
- Parent: `startTime` (with timezone)
- Child: `point` coordinates + `durationMinutesOffsetFromStartTime`
- Calculate: `timestamp = startTime + offsetMinutes`

## 3-Phase Progressive Processing Architecture

### Phase 1: Initial Indexing (10-15 seconds)
**Goal:** Quick scan to build date ranges without processing all points

```javascript
// Web Worker scans file for timelinePath blocks
{
  "dateRanges": ["2009-11-15", "2025-09-20"],
  "dayIndex": {
    "2025-09-20": { count: 150, firstTime: "05:00", lastTime: "07:00" },
    "2025-09-19": { count: 200, firstTime: "08:00", lastTime: "23:30" }
  }
}
```

**Output:** Calendar shows available dates immediately

### Phase 2: On-Demand Processing (when user picks dates)
**Trigger:** User selects "September 15-20, 2025"

```javascript
// Process only selected date range
1. Find timelinePath objects with startTime in range
2. Calculate startTime + offsetMinutes for each point
3. Deduplicate points (1-minute buckets, 4-decimal coordinates)
4. Sample to 50-250 points for map rendering
5. Store in database for future requests
```

**Output:** Map with real GPS route data for selected days

### Phase 3: Progressive Caching (repeat requests)
**Database Storage:**
- Processed points stored per (datasetId, date)
- Future requests for same dates = instant from DB
- New date ranges = process and cache

## Database Strategy

### Tables Used
```sql
-- Existing: Store processed GPS points
location_points (dataset_id, lat, lng, timestamp, activity)

-- New: Track processing status  
processed_days (dataset_id, date, status, point_count, last_processed_at)

-- Existing: Geocoding cache
geocode_cache (lat_rounded, lng_rounded, city, state, country)
```

### Processing Rules
- **Idempotent upserts** keyed by (datasetId, date, time_bucket, lat4, lng4)
- **No timestamp interpolation** - use real timestamps only
- **Deduplication** - round coordinates to 4 decimals, group by 1-minute buckets

## Performance Optimizations

### Client-Side (Web Worker)
- **Chunked text scanning** - don't parse entire JSON during indexing
- **Structured cloning** for date index transfer
- **Lazy parsing** - only parse timelinePath objects when needed

### Server-Side  
- **Stream processing** when persisting to database
- **Remove timestamp interpolation** from current googleLocationIngest
- **Batch geocoding** with rate limiting

## Geocoding Integration Strategy

### Cache-First Approach
1. **Check cache** for rounded coordinates first
2. **Batch unique coordinates** per day/range
3. **Background geocoding** (GeoApify primary, OSM fallback)
4. **Progressive enrichment** - don't block map rendering

### Rate Limiting
- Respect API limits with request throttling
- Use existing geocoding cache system (386+ cached locations)
- Queue background requests for new coordinates

## User Experience Flow

### Upload Process
1. **File upload** → Start indexing in Web Worker
2. **Progress indicator** → "Scanning file for date ranges..."
3. **Calendar enabled** → Show available dates (10-15 seconds)
4. **User selects dates** → Process on-demand with spinner
5. **Map renders** → 50-250 points for selected days
6. **Geocoding enriches** → Progressive city/state detection

### Subsequent Usage
- **Cached days** → Instant loading from database
- **New date ranges** → Process and cache automatically
- **Offline capable** → All processed data available locally

## Implementation Priorities

### Phase 1: Date Indexing
- [ ] Implement DayIndexer Web Worker
- [ ] Wire FileUploader to use worker instead of server upload
- [ ] Update Calendar to show available dates from index

### Phase 2: On-Demand Processing  
- [ ] Add processed_days table tracking
- [ ] Remove timestamp interpolation from server code
- [ ] Implement POST /process?datasetId&dateRange endpoint
- [ ] Add GET /points?datasetId&date endpoint

### Phase 3: Geocoding Integration
- [ ] Add background geocoding queue
- [ ] Implement cache-first lookup system
- [ ] Surface geocoding status in UI

## Success Metrics
- **≤3 seconds** for initial file indexing
- **≤100ms** for cached date rendering  
- **50-250 points** per day (realistic GPS density)
- **No synthetic data** in processing pipeline

## Common Mistakes to Avoid
1. **Don't map visit/activity coordinates** - they're not GPS routes
2. **Don't process all data upfront** - use on-demand approach
3. **Don't interpolate timestamps** - use real timestamps only
4. **Don't block UI** - use Web Workers for heavy processing
5. **Don't forget geocoding cache** - check cache before API calls

---

*This strategy was developed after identifying performance issues with upfront processing and data source mixing. Refer to this document when implementing to avoid repeating architectural mistakes.*