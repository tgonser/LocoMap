// Mobile format is an array of timeline elements - flexible interface for various structures
interface GoogleLocationHistoryMobileArray extends Array<{
  endTime?: string;
  startTime?: string;
  visit?: {
    hierarchyLevel?: string;
    topCandidate?: {
      probability?: string;
      placeID?: string;
      placeLocation?: string; // "geo:lat,lng" format
    };
    placeLocation?: string;
    timelinePath?: {
      points?: Array<{
        point?: string;
        durationMinutesOffsetFromStartTime?: string;
      }>;
    };
    points?: Array<{
      point?: string;
      durationMinutesOffsetFromStartTime?: string;
    }>;
  };
  activity?: {
    start?: string; // "geo:lat,lng" format
    end?: string; // "geo:lat,lng" format
    topCandidate?: {
      type?: string;
      probability?: string;
    };
    distanceMeters?: string;
  };
  point?: string; // Format: "geo:lat,lng"
  durationMinutesOffsetFromStartTime?: string;
  [key: string]: any; // Allow for other unknown properties
}> {}

interface GoogleLocationHistoryNew {
  timelineObjects?: Array<{
    activitySegment?: {
      startLocation?: {
        latitudeE7: number;
        longitudeE7: number;
      };
      endLocation?: {
        latitudeE7: number;
        longitudeE7: number;
      };
      duration?: {
        startTimestamp: string;
        endTimestamp: string;
      };
      activityType?: string;
      // Enhanced: Include detailed path data similar to mobile format
      waypointPath?: {
        waypoints?: Array<{
          latE7: number;
          lngE7: number;
        }>;
      };
      simplifiedRawPath?: {
        points?: Array<{
          latE7: number;
          lngE7: number;
          timestampMs: string;
        }>;
      };
    };
    placeVisit?: {
      location?: {
        latitudeE7: number;
        longitudeE7: number;
        address?: string;
      };
      duration?: {
        startTimestamp: string;
        endTimestamp: string;
      };
      // Enhanced: Include path data for place visits
      childVisits?: Array<{
        location?: {
          latitudeE7: number;
          longitudeE7: number;
        };
        duration?: {
          startTimestamp: string;
          endTimestamp: string;
        };
      }>;
    };
    [key: string]: any; // Allow for other unknown properties like path data
  }>;
}

interface GoogleLocationHistoryOld {
  locations?: Array<{
    timestampMs: string;
    latitudeE7: number;
    longitudeE7: number;
    accuracy?: number;
    activity?: Array<{
      timestampMs: string;
      activity: Array<{
        type: string;
        confidence: number;
      }>;
    }>;
  }>;
}

export interface ParsedLocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  activity?: string;
}

// Unified timestamp parser - ensures consistent UTC interpretation everywhere
function parseToUTCDate(timestamp: string): Date | null {
  // Robust timezone detection: check for trailing offset/UTC markers
  const hasTimezoneInfo = /(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp);
  const normalized = hasTimezoneInfo ? timestamp : timestamp + 'Z';
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms);
}

// Helper function to get UTC milliseconds (for comparisons)
function toUTCMillis(timestamp: string): number | null {
  const date = parseToUTCDate(timestamp);
  return date ? date.getTime() : null;
}

// Interface for activity/visit segments with UTC boundaries  
interface ActivitySegment {
  type: 'activity' | 'visit';
  data: any;
  startTimeUTC: number;
  endTimeUTC: number;
  activityType: string;
}

// Modern Google Location History parser based on timelineObjects schema
function parseModernTimelineObjects(jsonData: any): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  console.log(`🎯 Starting modern timeline parser`);

  // Extract timelineObjects array (may be at root or in timelineObjects field)
  const timelineObjects = jsonData.timelineObjects || (Array.isArray(jsonData) ? jsonData : []);
  
  if (!Array.isArray(timelineObjects)) {
    console.warn('⚠️ No timelineObjects array found in modern format');
    return results;
  }

  console.log(`📍 Found ${timelineObjects.length} timeline objects`);

  // PHASE 1: Extract segments (activitySegment and placeVisit)
  interface ModernSegment {
    kind: 'activity' | 'visit';
    startUTC: number;
    endUTC: number;
    obj: any;
    activityType: string;
  }

  const segments: ModernSegment[] = [];

  timelineObjects.forEach((obj, index) => {
    // Handle activitySegment
    if (obj.activitySegment) {
      const seg = obj.activitySegment;
      const duration = seg.duration || {};
      const startTime = duration.startTimestamp;
      const endTime = duration.endTimestamp;
      
      if (startTime && endTime) {
        const startUTC = parseToUTCDate(startTime)?.getTime();
        const endUTC = parseToUTCDate(endTime)?.getTime();
        
        if (startUTC && endUTC && endUTC >= startUTC) {
          const activityType = seg.activities?.[0]?.activityType || seg.activityType || 'unknown';
          segments.push({
            kind: 'activity',
            startUTC,
            endUTC,
            obj: seg,
            activityType: activityType.toLowerCase()
          });
          
          console.log(`🚗 Activity: ${activityType} (${new Date(startUTC).toISOString()} - ${new Date(endUTC).toISOString()})`);
        }
      }
    }

    // Handle placeVisit
    if (obj.placeVisit) {
      const seg = obj.placeVisit;
      const duration = seg.duration || {};
      const startTime = duration.startTimestamp;
      const endTime = duration.endTimestamp;
      
      if (startTime && endTime) {
        const startUTC = parseToUTCDate(startTime)?.getTime();
        const endUTC = parseToUTCDate(endTime)?.getTime();
        
        if (startUTC && endUTC && endUTC >= startUTC) {
          segments.push({
            kind: 'visit',
            startUTC,
            endUTC,
            obj: seg,
            activityType: 'still'
          });
          
          console.log(`📍 Visit: ${new Date(startUTC).toISOString()} - ${new Date(endUTC).toISOString()}`);
          
          // Extract place location if available
          const location = seg.location;
          if (location && location.latitudeE7 && location.longitudeE7) {
            const lat = location.latitudeE7 / 1e7;
            const lng = location.longitudeE7 / 1e7;
            
            results.push({
              lat,
              lng,
              timestamp: new Date(startUTC),
              activity: 'still'
            });

            if (endUTC !== startUTC) {
              results.push({
                lat,
                lng,
                timestamp: new Date(endUTC),
                activity: 'still'
              });
            }
          }
        }
      }
    }
  });

  // Sort segments by start time
  segments.sort((a, b) => a.startUTC - b.startUTC);
  console.log(`✅ Extracted ${segments.length} segments`);

  // PHASE 2: Extract timeline path points and associate with segments
  const timelinePoints: Array<{lat: number, lng: number, tUTC: number, carrier: any}> = [];

  timelineObjects.forEach((obj) => {
    const timelinePath = obj.timelinePath;
    if (!timelinePath?.point || !Array.isArray(timelinePath.point)) {
      return;
    }

    timelinePath.point.forEach((point: any) => {
      const latE7 = point.latE7;
      const lngE7 = point.lngE7;
      const timeStr = point.time;

      if (typeof latE7 === 'number' && typeof lngE7 === 'number' && timeStr) {
        const lat = latE7 / 1e7;
        const lng = lngE7 / 1e7;
        const pointDate = parseToUTCDate(timeStr);
        
        if (pointDate) {
          timelinePoints.push({
            lat,
            lng,
            tUTC: pointDate.getTime(),
            carrier: obj
          });
        }
      }
    });
  });

  // Sort points by time
  timelinePoints.sort((a, b) => a.tUTC - b.tUTC);
  console.log(`🎯 Extracted ${timelinePoints.length} timeline path points`);

  // PHASE 3: Associate points with segments using UTC windowing
  timelinePoints.forEach((point) => {
    let bestSegment: ModernSegment | null = null;
    let smallestWindow = Infinity;

    // Find segments that contain this point
    for (const segment of segments) {
      if (point.tUTC >= segment.startUTC && point.tUTC <= segment.endUTC) {
        const windowSize = segment.endUTC - segment.startUTC;
        if (windowSize < smallestWindow) {
          smallestWindow = windowSize;
          bestSegment = segment;
        }
      }
    }

    if (bestSegment) {
      results.push({
        lat: point.lat,
        lng: point.lng,
        timestamp: new Date(point.tUTC),
        activity: bestSegment.activityType
      });
    } else {
      // Unassigned point - use generic 'route' activity
      results.push({
        lat: point.lat,
        lng: point.lng,
        timestamp: new Date(point.tUTC),
        activity: 'route'
      });
    }
  });

  console.log(`🎯 Modern parser extracted ${results.length} total points`);
  return results;
}

// Fallback parser for legacy mobile array format
function parseLegacyMobileArrayFormat(jsonData: GoogleLocationHistoryMobileArray): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  
  console.log(`🎯 Starting two-phase UTC matching for ${jsonData.length} elements`);

  // PHASE 1: Collect all activities/visits with UTC boundaries
  const activitySegments: ActivitySegment[] = [];
  const standaloneTimelinePaths: Array<{ element: any, index: number }> = [];
  
  jsonData.forEach((element, i) => {
    // Collect visit segments
    if (element.visit && element.startTime && element.endTime) {
      const startTimeUTC = toUTCMillis(element.startTime);
      const endTimeUTC = toUTCMillis(element.endTime);
      
      if (!startTimeUTC || !endTimeUTC) {
        console.warn(`⚠️ Invalid visit timestamps: ${element.startTime} to ${element.endTime}`);
        return;
      }
      
      activitySegments.push({
        type: 'visit',
        data: element.visit,
        startTimeUTC,
        endTimeUTC,
        activityType: 'still'
      });
      
      // Extract visit location points
      const placeLocation = element.visit.topCandidate?.placeLocation || element.visit.placeLocation;
      if (placeLocation) {
        const coords = parseGeoString(placeLocation);
        if (coords) {
          const startDate = parseToUTCDate(element.startTime);
          const endDate = element.endTime !== element.startTime ? parseToUTCDate(element.endTime) : null;
          
          if (startDate) {
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: startDate,
              activity: 'still'
            });
          }
          
          // Add end point if different
          if (endDate) {
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: endDate,
              activity: 'still'
            });
          }
        }
      }
      
      // Extract nested timeline paths from visits
      const nestedPoints = element.visit.timelinePath?.points || element.visit.points;
      if (Array.isArray(nestedPoints)) {
        const baseDate = parseToUTCDate(element.startTime);
        if (!baseDate) {
          console.warn(`⚠️ Invalid visit startTime: ${element.startTime}`);
          return;
        }
        nestedPoints.forEach((pathPoint: any) => {
          if (pathPoint.point) {
            const coords = parseGeoString(pathPoint.point);
            if (coords) {
              let timestamp = baseDate;
              if (pathPoint.durationMinutesOffsetFromStartTime) {
                const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
                if (!isNaN(offsetMinutes)) {
                  timestamp = new Date(baseDate.getTime() + offsetMinutes * 60 * 1000);
                }
              }
              results.push({
                lat: coords.lat,
                lng: coords.lng,
                timestamp: timestamp,
                activity: 'still'
              });
            }
          }
        });
      }
    }
    
    // Collect activity segments
    if (element.activity && element.startTime && element.endTime) {
      const startTimeUTC = toUTCMillis(element.startTime);
      const endTimeUTC = toUTCMillis(element.endTime);
      
      if (!startTimeUTC || !endTimeUTC) {
        console.warn(`⚠️ Invalid activity timestamps: ${element.startTime} to ${element.endTime}`);
        return;
      }
      
      const activityType = element.activity.topCandidate?.type?.toLowerCase() || 'unknown';
      
      activitySegments.push({
        type: 'activity',
        data: element.activity,
        startTimeUTC,
        endTimeUTC,
        activityType
      });
      
      // Extract activity start/end points
      if (element.activity.start) {
        const coords = parseGeoString(element.activity.start);
        if (coords) {
          const startDate = parseToUTCDate(element.startTime);
          if (startDate) {
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: startDate,
              activity: activityType
            });
          }
        }
      }
      
      // Add activity end point
      if (element.activity.end && element.endTime !== element.startTime) {
        const coords = parseGeoString(element.activity.end);
        if (coords) {
          const endDate = parseToUTCDate(element.endTime);
          if (endDate) {
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: endDate,
              activity: activityType
            });
          }
        }
      }
      
      // Extract nested timeline paths from activities
      if ((element as any).timelinePath?.points) {
        const baseDate = parseToUTCDate(element.startTime);
        if (!baseDate) {
          console.warn(`⚠️ Invalid activity startTime: ${element.startTime}`);
          return;
        }
        
        (element as any).timelinePath.points.forEach((pathPoint: any) => {
          if (pathPoint.point) {
            const coords = parseGeoString(pathPoint.point);
            if (coords) {
              let timestamp = baseDate;
              if (pathPoint.durationMinutesOffsetFromStartTime) {
                const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
                if (!isNaN(offsetMinutes)) {
                  timestamp = new Date(baseDate.getTime() + offsetMinutes * 60 * 1000);
                }
              }
              results.push({
                lat: coords.lat,
                lng: coords.lng,
                timestamp: timestamp,
                activity: activityType
              });
            }
          }
        });
      }
    }
    
    // Collect standalone timeline paths for Phase 2
    if (element.timelinePath?.points && Array.isArray(element.timelinePath.points) && !element.activity && !element.visit) {
      standaloneTimelinePaths.push({ element, index: i });
      console.log(`📍 Found standalone timelinePath with ${element.timelinePath.points.length} points at element ${i}`);
    }
  });

  console.log(`✅ Phase 1: Found ${activitySegments.length} segments, ${standaloneTimelinePaths.length} standalone paths`);

  // PHASE 2: Match standalone timeline paths using UTC temporal boundaries
  standaloneTimelinePaths.forEach(({ element, index }) => {
    let matchedSegment: ActivitySegment | null = null;
    
    // Find the nearest surrounding activity segments by index position
    const nearbySegments = activitySegments.filter(segment => Math.abs(segment.startTimeUTC - Date.now()) > 0);
    
    // Try to find a segment by looking at surrounding JSON elements
    let surroundingElement: any = null;
    for (let offset = 1; offset <= 10; offset++) {
      const beforeIndex = index - offset;
      const afterIndex = index + offset;
      
      if (beforeIndex >= 0 && jsonData[beforeIndex]?.startTime && jsonData[beforeIndex]?.endTime) {
        surroundingElement = jsonData[beforeIndex];
        break;
      }
      if (afterIndex < jsonData.length && jsonData[afterIndex]?.startTime && jsonData[afterIndex]?.endTime) {
        surroundingElement = jsonData[afterIndex];
        break;
      }
    }
    
    // Match to activity segment if surrounding element found
    if (surroundingElement) {
      const surroundingStartUTC = toUTCMillis(surroundingElement.startTime);
      const surroundingEndUTC = toUTCMillis(surroundingElement.endTime);
      
      matchedSegment = activitySegments.find(segment => 
        segment.startTimeUTC === surroundingStartUTC && segment.endTimeUTC === surroundingEndUTC
      ) || null;
      
      if (matchedSegment) {
        console.log(`✅ Matched timelinePath to ${matchedSegment.activityType} via surrounding element at index ${index}`);
      }
    }
    
    // Extract path points with proper timestamp derivation
    const pathPoints = element.timelinePath.points || [];
    const activityType = matchedSegment?.activityType || 'route';
    
    pathPoints.forEach((pathPoint: any) => {
      if (pathPoint.point) {
        const coords = parseGeoString(pathPoint.point);
        if (coords) {
          let timestamp: Date | null = null;
          
          // Use offset-based timestamp calculation if we have a matched segment
          if (matchedSegment && pathPoint.durationMinutesOffsetFromStartTime) {
            const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
            if (!isNaN(offsetMinutes)) {
              const derivedUTC = matchedSegment.startTimeUTC + offsetMinutes * 60 * 1000;
              
              // Clamp derived time within segment bounds
              if (derivedUTC >= matchedSegment.startTimeUTC && derivedUTC <= matchedSegment.endTimeUTC) {
                timestamp = new Date(derivedUTC);
              }
            }
          }
          
          // Skip points without valid timestamps rather than using Date.now()
          if (timestamp) {
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: timestamp,
              activity: activityType
            });
          } else {
            console.warn(`⚠️ Skipped point without valid timestamp at standalone timelinePath ${index}`);
          }
        }
      }
    });
  });

  console.log(`🎯 UTC matching extracted ${results.length} total points`);
  return results;
}

// Helper function to parse "geo:lat,lng" strings into coordinates (robust version)
function parseGeoString(geoString: string): {lat: number, lng: number} | null {
  if (!geoString || typeof geoString !== 'string') return null;
  
  // Use regex to handle case variations, whitespace, and URI params
  const match = geoString.match(/^geo:\s*([-+\d.]+)\s*,\s*([-+\d.]+)/i);
  if (!match) return null;
  
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  
  if (isNaN(lat) || isNaN(lng)) return null;
  
  return { lat, lng };
}

// Parse the actual mobile format (array of timeline objects)
function parseMobileArrayFormat(jsonData: GoogleLocationHistoryMobileArray): ParsedLocationPoint[] {
  const results: ParsedLocationPoint[] = [];
  let lastKnownTimestamp: Date | null = null;
  
  
  for (let i = 0; i < jsonData.length; i++) {
    const element = jsonData[i];
    
    
    // Handle visit elements with start/end times (independent of activity parsing)
    if (element.visit && (element.startTime || element.endTime)) {
      // Look for placeLocation in topCandidate or visit directly
      const placeLocation = element.visit.topCandidate?.placeLocation || element.visit.placeLocation;
      
      
      if (placeLocation) {
        const coords = parseGeoString(placeLocation);
        
        if (coords) {
          // Add start point
          if (element.startTime) {
            const timestamp = normalizeTimestamp(element.startTime);
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: timestamp,
              activity: 'still' // Visits are typically stationary
            });
            lastKnownTimestamp = timestamp;
          }
          
          // Add end point if different
          if (element.endTime && element.endTime !== element.startTime) {
            const timestamp = normalizeTimestamp(element.endTime);
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: timestamp,
              activity: 'still'
            });
            lastKnownTimestamp = timestamp;
          }
        }
      }
      
      // Look for nested path points in visit (timelinePath.points or just points)
      const nestedPoints = element.visit.timelinePath?.points || element.visit.points;
      if (Array.isArray(nestedPoints) && element.startTime) {
        const baseTimestamp = normalizeTimestamp(element.startTime);
        
        for (const pathPoint of nestedPoints) {
          if (pathPoint.point) {
            const coords = parseGeoString(pathPoint.point);
            if (coords) {
              let timestamp = baseTimestamp;
              
              // Calculate timestamp based on duration offset
              if (pathPoint.durationMinutesOffsetFromStartTime) {
                const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
                if (!isNaN(offsetMinutes)) {
                  timestamp = new Date(baseTimestamp.getTime() + offsetMinutes * 60 * 1000);
                }
              }
              
              results.push({
                lat: coords.lat,
                lng: coords.lng,
                timestamp: timestamp,
                activity: 'walking'
              });
            }
          }
        }
      }
    }
    
    // Look for timelinePath at element level (connected to activity elements) - CRITICAL FIX  
    if (element.activity && (element as any).timelinePath?.points && element.startTime) {
      const activityNestedPoints = (element as any).timelinePath.points;
      const baseTimestamp = normalizeTimestamp(element.startTime);
      
      for (const pathPoint of activityNestedPoints) {
        if (pathPoint.point) {
          const coords = parseGeoString(pathPoint.point);
          if (coords) {
            let timestamp = baseTimestamp;
            
            // Calculate timestamp based on duration offset
            if (pathPoint.durationMinutesOffsetFromStartTime) {
              const offsetMinutes = parseInt(pathPoint.durationMinutesOffsetFromStartTime);
              if (!isNaN(offsetMinutes)) {
                timestamp = new Date(baseTimestamp.getTime() + offsetMinutes * 60 * 1000);
              }
            }
            
            results.push({
              lat: coords.lat,
              lng: coords.lng,
              timestamp: timestamp,
              activity: element.activity.topCandidate?.type?.toLowerCase() || 'walking'
            });
          }
        }
      }
    }
    
    // Handle activity elements with start/end geo coordinates (independent parsing)
    if (element.activity && (element.startTime || element.endTime)) {
      const activity = element.activity;
      const activityType = activity.topCandidate?.type?.toLowerCase() || 'unknown';
      
      if (i < 5) console.log(`Activity ${i}: start="${activity.start}", end="${activity.end}"`);
      
      // Add start point
      if (element.startTime && activity.start) {
        const coords = parseGeoString(activity.start);
        if (i < 5) console.log(`Activity ${i}: start coords=`, coords);
        
        if (coords) {
          const timestamp = normalizeTimestamp(element.startTime);
          results.push({
            lat: coords.lat,
            lng: coords.lng,
            timestamp: timestamp,
            activity: activityType
          });
          lastKnownTimestamp = timestamp;
          if (i < 5) console.log(`Activity ${i}: Added start point`);
        }
      }
      
      // Add end point
      if (element.endTime && activity.end) {
        const coords = parseGeoString(activity.end);
        if (i < 5) console.log(`Activity ${i}: end coords=`, coords);
        
        if (coords) {
          const timestamp = normalizeTimestamp(element.endTime);
          results.push({
            lat: coords.lat,
            lng: coords.lng,
            timestamp: timestamp,
            activity: activityType
          });
          lastKnownTimestamp = timestamp;
          if (i < 5) console.log(`Activity ${i}: Added end point`);
        }
      }
    }
    
    // Handle timeline path points with geo coordinates (independent parsing)
    if (element.point && element.point.startsWith('geo:')) {
      try {
        const coords = element.point.replace('geo:', '').split(',');
        if (coords.length === 2) {
          const lat = parseFloat(coords[0]);
          const lng = parseFloat(coords[1]);
          
          if (!isNaN(lat) && !isNaN(lng)) {
            // Calculate timestamp based on duration offset from previous element
            let timestamp: Date;
            if (lastKnownTimestamp && element.durationMinutesOffsetFromStartTime) {
              const offsetMinutes = parseInt(element.durationMinutesOffsetFromStartTime);
              if (!isNaN(offsetMinutes)) {
                timestamp = new Date(lastKnownTimestamp.getTime() + offsetMinutes * 60 * 1000);
              } else {
                timestamp = lastKnownTimestamp;
              }
            } else {
              // Fallback to current time if no base timestamp available
              timestamp = new Date();
            }
            
            results.push({
              lat: lat,
              lng: lng,
              timestamp: timestamp,
              activity: 'walking'
            });
          }
        }
      } catch (error) {
        console.warn('Failed to parse geo point:', element.point, error);
      }
    }
    
    // 🎯 CRITICAL: Collect standalone timelinePath for proper UTC matching (Phase 1)
    if (element.timelinePath?.points && Array.isArray(element.timelinePath.points) && !element.activity && !element.visit) {
      console.log(`📍 Found standalone timelinePath with ${element.timelinePath.points.length} points at element ${i} - will match to activities using UTC boundaries`);
      // Note: This will be processed in Phase 2 after all activities are collected
    }
    
    // Log unhandled elements only if none of the above handled it
    if (i < 3 && !element.visit && !element.activity && !element.point && !element.timelinePath) {
      console.log(`Unhandled element type ${i}:`, Object.keys(element));
    }
  }
  
  // Debug: Count points by source for troubleshooting  
  const visitPoints = results.filter(r => r.activity === 'still').length;
  const visitTimelinePoints = results.filter(r => r.activity === 'walking').length; 
  const activityPoints = results.filter(r => r.activity && r.activity !== 'still' && r.activity !== 'walking' && r.activity !== 'route').length;
  const routePoints = results.filter(r => r.activity === 'route').length;
  
  console.log(`=== PARSING RESULTS ===`);
  console.log(`Visit points: ${visitPoints}`);
  console.log(`Visit timelinePath points: ${visitTimelinePoints}`); 
  console.log(`Activity points: ${activityPoints}`);
  console.log(`🎯 Route points (standalone timelinePath): ${routePoints}`);
  console.log(`Total parsed: ${results.length} location points from mobile format`);
  console.log(`======================`);
  
  return results;
}

export function parseGoogleLocationHistory(jsonData: any): ParsedLocationPoint[] {
  console.log('🔥 PARSER DEBUG: parseGoogleLocationHistory called with data size:', Array.isArray(jsonData) ? jsonData.length : 'not array');
  const results: ParsedLocationPoint[] = [];

  // Handle new mobile format (array of timeline objects)
  if (Array.isArray(jsonData) && jsonData.length > 0 && 
      (jsonData[0].visit || jsonData[0].point || jsonData[0].endTime || jsonData[0].startTime)) {
    console.log('🔍 Detected mobile Google location array format');
    console.log(`📊 Processing ${jsonData.length} elements in mobile array format`);
    
    // Debug: Check first few elements to understand structure
    console.log('🔬 Sample element structure analysis:');
    for (let i = 0; i < Math.min(3, jsonData.length); i++) {
      const element = jsonData[i];
      console.log(`Element ${i} keys:`, Object.keys(element));
      if (element.visit?.timelinePath?.points) {
        console.log(`  - Found visit.timelinePath.points: ${element.visit.timelinePath.points.length} points`);
      }
      if (element.activity && (element as any).timelinePath?.points) {
        console.log(`  - Found activity.timelinePath.points: ${(element as any).timelinePath.points.length} points`);
      }
    }
    
    const mobileResults = parseLegacyMobileArrayFormat(jsonData as GoogleLocationHistoryMobileArray);
    console.log(`✅ Mobile parser extracted ${mobileResults.length} total points`);
    results.push(...mobileResults);
  }
  
  // Handle new format (timelineObjects)
  else if (jsonData.timelineObjects) {
    console.log('Detected Google timelineObjects format');
    const data = jsonData as GoogleLocationHistoryNew;
    
    data.timelineObjects?.forEach(obj => {
      // Handle activity segments
      if (obj.activitySegment) {
        const segment = obj.activitySegment;
        const activityType = segment.activityType?.toLowerCase() || 'unknown';
        
        // Start location
        if (segment.startLocation && segment.duration?.startTimestamp) {
          results.push({
            lat: segment.startLocation.latitudeE7 / 1e7,
            lng: segment.startLocation.longitudeE7 / 1e7,
            timestamp: new Date(segment.duration.startTimestamp),
            activity: activityType
          });
        }
        
        // Enhanced: Extract detailed waypoint path data
        if (segment.waypointPath?.waypoints && segment.duration?.startTimestamp) {
          const baseTimestamp = new Date(segment.duration.startTimestamp);
          const endTimestamp = new Date(segment.duration.endTimestamp || segment.duration.startTimestamp);
          const totalDuration = endTimestamp.getTime() - baseTimestamp.getTime();
          
          segment.waypointPath.waypoints.forEach((waypoint, index) => {
            // Distribute waypoint timestamps evenly across the activity duration
            const timeRatio = segment.waypointPath!.waypoints!.length > 1 
              ? index / (segment.waypointPath!.waypoints!.length - 1)
              : 0;
            const waypointTimestamp = new Date(baseTimestamp.getTime() + totalDuration * timeRatio);
            
            results.push({
              lat: waypoint.latE7 / 1e7,
              lng: waypoint.lngE7 / 1e7,
              timestamp: waypointTimestamp,
              activity: activityType
            });
          });
        }
        
        // Enhanced: Extract simplified raw path points
        if (segment.simplifiedRawPath?.points) {
          segment.simplifiedRawPath.points.forEach(point => {
            // Guard against invalid timestamps
            const timestampMs = point.timestampMs ? parseInt(point.timestampMs) : null;
            if (timestampMs && !isNaN(timestampMs)) {
              results.push({
                lat: point.latE7 / 1e7,
                lng: point.lngE7 / 1e7,
                timestamp: new Date(timestampMs),
                activity: activityType
              });
            }
          });
        }
        
        // End location
        if (segment.endLocation && segment.duration?.endTimestamp) {
          results.push({
            lat: segment.endLocation.latitudeE7 / 1e7,
            lng: segment.endLocation.longitudeE7 / 1e7,
            timestamp: new Date(segment.duration.endTimestamp),
            activity: activityType
          });
        }
      }
      
      // Handle place visits
      if (obj.placeVisit?.location && obj.placeVisit.duration?.startTimestamp) {
        results.push({
          lat: obj.placeVisit.location.latitudeE7 / 1e7,
          lng: obj.placeVisit.location.longitudeE7 / 1e7,
          timestamp: new Date(obj.placeVisit.duration.startTimestamp),
          activity: 'still' // Place visits are typically stationary
        });
        
        // Enhanced: Extract child visits (sub-locations within a place)
        if (obj.placeVisit.childVisits) {
          obj.placeVisit.childVisits.forEach(childVisit => {
            if (childVisit.location && childVisit.duration?.startTimestamp) {
              results.push({
                lat: childVisit.location.latitudeE7 / 1e7,
                lng: childVisit.location.longitudeE7 / 1e7,
                timestamp: new Date(childVisit.duration.startTimestamp),
                activity: 'still'
              });
            }
          });
        }
      }
      
      // Enhanced: Check for any other potential path data in unknown properties
      Object.keys(obj).forEach(key => {
        if (key !== 'activitySegment' && key !== 'placeVisit' && obj[key]) {
          const unknownObj = obj[key] as any;
          
          // Look for path-like structures with coordinates
          if (unknownObj.points && Array.isArray(unknownObj.points)) {
            unknownObj.points.forEach((point: any) => {
              if (point.latE7 && point.lngE7) {
                const timestamp = point.timestampMs 
                  ? new Date(parseInt(point.timestampMs))
                  : new Date(); // Fallback timestamp
                  
                results.push({
                  lat: point.latE7 / 1e7,
                  lng: point.lngE7 / 1e7,
                  timestamp: timestamp,
                  activity: 'unknown'
                });
              }
            });
          }
        }
      });
    });
  }
  
  // Handle old format (locations array)
  else if (jsonData.locations) {
    const data = jsonData as GoogleLocationHistoryOld;
    
    data.locations?.forEach(location => {
      // Get the most confident activity if available
      let activity = 'unknown';
      if (location.activity && location.activity.length > 0) {
        const activities = location.activity[0].activity;
        if (activities && activities.length > 0) {
          const mostConfident = activities.reduce((prev, current) => 
            (current.confidence > prev.confidence) ? current : prev
          );
          activity = mostConfident.type.toLowerCase();
        }
      }
      
      results.push({
        lat: location.latitudeE7 / 1e7,
        lng: location.longitudeE7 / 1e7,
        timestamp: new Date(parseInt(location.timestampMs)),
        accuracy: location.accuracy,
        activity: activity
      });
    });
  }

  // Sort by timestamp and remove duplicates
  const sorted = results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Remove near-duplicate points (within 10 seconds and similar coordinates)
  const deduplicated: ParsedLocationPoint[] = [];
  for (const point of sorted) {
    const last = deduplicated[deduplicated.length - 1];
    if (!last || 
        Math.abs(point.timestamp.getTime() - last.timestamp.getTime()) > 10000 ||
        Math.abs(point.lat - last.lat) > 0.0001 ||
        Math.abs(point.lng - last.lng) > 0.0001) {
      deduplicated.push(point);
    }
  }
  
  console.log(`Parsed ${results.length} total points, deduplicated to ${deduplicated.length} points`);
  return deduplicated;
}

export function validateGoogleLocationHistory(jsonData: any): boolean {
  if (!jsonData || typeof jsonData !== 'object') {
    return false;
  }
  
  // Check for new mobile format (array of timeline objects)
  if (Array.isArray(jsonData) && jsonData.length > 0 && 
      (jsonData[0].visit || jsonData[0].point || jsonData[0].endTime || jsonData[0].startTime)) {
    return true;
  }
  
  // Check for new format
  if (jsonData.timelineObjects && Array.isArray(jsonData.timelineObjects)) {
    return true;
  }
  
  // Check for old format
  if (jsonData.locations && Array.isArray(jsonData.locations)) {
    return true;
  }
  
  return false;
}