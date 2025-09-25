import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import { Icon, LatLngBounds } from 'leaflet';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import CalendarOverlay from './CalendarOverlay';

// Fix for default markers in react-leaflet
delete (Icon.Default.prototype as any)._getIconUrl;
Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Create a special highlight marker icon
const highlightIcon = new Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" fill="none">
      <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 7.8 12.5 28.5 12.5 28.5s12.5-20.7 12.5-28.5C25 5.6 19.4 0 12.5 0z" fill="#ff4444" stroke="#fff" stroke-width="2"/>
      <circle cx="12.5" cy="12.5" r="6" fill="#fff"/>
      <circle cx="12.5" cy="12.5" r="3" fill="#ff4444"/>
    </svg>
  `),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  shadowSize: [41, 41],
  shadowAnchor: [12, 41]
});

interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  activity?: string;
}

// View modes for map display
type MapViewMode = 'single' | 'multi';

// Day aggregation for multi-day view
interface DayData {
  date: string; // YYYY-MM-DD format
  dateObj: Date;
  points: LocationPoint[];
  firstPoint: LocationPoint;
  lastPoint: LocationPoint;
  totalPoints: number;
  startTime: Date;
  endTime: Date;
}

// Component to handle auto-pan and auto-zoom functionality
interface MapViewControllerProps {
  filteredLocations: LocationPoint[]; // Use pre-filtered locations from parent
  selectedPoint?: { lat: number; lng: number } | null;
  viewMode: MapViewMode;
  dayGroupedLocations?: { date: string; points: LocationPoint[] }[];
}

function MapViewController({ filteredLocations, selectedPoint, viewMode, dayGroupedLocations = [] }: MapViewControllerProps) {
  const map = useMap();
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    // In multi-day mode, use all day locations for bounds
    const locationsForBounds = viewMode === 'multi' && dayGroupedLocations.length > 0
      ? dayGroupedLocations.flatMap(day => day.points)
      : filteredLocations;

    if (locationsForBounds.length === 0) {
      return; // Keep current view if no locations
    }

    // If user is actively navigating timeline points, don't interfere with zoom level
    if (isNavigatingRef.current) {
      return;
    }

    // Handle single location case
    if (locationsForBounds.length === 1) {
      const location = locationsForBounds[0];
      map.setView([location.lat, location.lng], 16, {
        animate: true,
        duration: 0.8
      });
      return;
    }

    // Handle multiple locations - calculate bounds
    const bounds = new LatLngBounds([]);
    locationsForBounds.forEach(location => {
      bounds.extend([location.lat, location.lng]);
    });

    // Fit bounds with padding and constraints
    map.fitBounds(bounds, {
      padding: [20, 20], // Add 20px padding on all sides
      maxZoom: viewMode === 'multi' ? 15 : 17, // Zoom out more for multi-day view
      animate: true,
      duration: 0.8
    });

  }, [map, filteredLocations, viewMode, dayGroupedLocations]);

  // Reset navigation mode when view mode or filter changes
  useEffect(() => {
    isNavigatingRef.current = false;
  }, [filteredLocations, viewMode]);

  // Handle individual point selection with smooth animation
  useEffect(() => {
    if (selectedPoint) {
      // User is now actively navigating timeline points
      isNavigatingRef.current = true;
      
      map.panTo([selectedPoint.lat, selectedPoint.lng], {
        animate: true,
        duration: 1.0
      });
    }
  }, [selectedPoint, map]);

  return null; // This component doesn't render anything
}

interface MapDisplayProps {
  locations: LocationPoint[];
  selectedDate?: Date;
  onDateChange?: (date: Date) => void;
  availableDates?: Date[];
  locationCountByDate?: Record<string, number>;
  center?: [number, number];
  zoom?: number;
  className?: string;
  selectedPoint?: { lat: number; lng: number } | null;
  dateRange?: { start: Date; end: Date }; // For multi-day view
}

export default function MapDisplay({ 
  locations, 
  selectedDate, 
  onDateChange,
  availableDates = [],
  locationCountByDate = {},
  center = [37.7749, -122.4194], // San Francisco default
  zoom = 13,
  className,
  selectedPoint,
  dateRange,
}: MapDisplayProps) {
  // View mode state management
  const [viewMode, setViewMode] = useState<MapViewMode>('single');
  
  // Auto-switch view mode based on dateRange prop
  useEffect(() => {
    setViewMode(dateRange ? 'multi' : 'single');
  }, [dateRange]);
  
  // Map reference for programmatic control
  const mapRef = useRef<any>(null);
  
  // Internal selected point state for day fly-to functionality
  const [internalSelectedPoint, setInternalSelectedPoint] = useState<{ lat: number; lng: number } | null>(null);
  
  // Helper function for consistent local date normalization
  const getLocalDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getLocalDateOnly = (date: Date): Date => {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };

  // Filter locations based on view mode - memoized to prevent bounds recalculation
  const filteredLocations = useMemo(() => {
    if (viewMode === 'single') {
      return selectedDate 
        ? locations.filter(loc => 
            getLocalDateKey(loc.timestamp) === getLocalDateKey(selectedDate)
          )
        : locations;
    } else {
      // Multi-day view: show ALL locations within date range (not just selected day)
      if (!dateRange) return locations;
      
      return locations.filter(loc => {
        const locDate = getLocalDateOnly(loc.timestamp);
        const startDate = getLocalDateOnly(dateRange.start);
        const endDate = getLocalDateOnly(dateRange.end);
        return locDate >= startDate && locDate <= endDate;
      });
    }
  }, [locations, selectedDate, viewMode, dateRange]); // Removed selectedDate dependency for multi-day

  // Simple day grouping for multi-day polyline rendering
  const dayGroupedLocations = useMemo(() => {
    if (viewMode === 'single') return [];
    
    const dayMap = new Map<string, LocationPoint[]>();
    
    filteredLocations.forEach(location => {
      const dateKey = getLocalDateKey(location.timestamp);
      if (!dayMap.has(dateKey)) {
        dayMap.set(dateKey, []);
      }
      dayMap.get(dateKey)!.push(location);
    });
    
    return Array.from(dayMap.entries())
      .map(([dateKey, points]) => ({
        date: dateKey,
        points: [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredLocations, viewMode, getLocalDateKey]);


  // Create clean path segments for realistic track visualization
  const createCleanPathSegments = (locations: LocationPoint[]): {
    segments: [number, number][][];
    gaps: [[number, number], [number, number]][];
  } => {
    if (locations.length < 2) return { segments: [], gaps: [] };
    
    // Sort chronologically and filter for accuracy (defensive copy to avoid mutation)
    const sortedLocations = [...locations]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .filter(loc => {
        // Be more permissive with timelinePath points - allow up to 200m accuracy
        // TimelinePath points are invaluable for route definition as user noted
        return loc.accuracy ? loc.accuracy <= 200 : true;
      });

    if (sortedLocations.length < 2) return { segments: [], gaps: [] };

    // Smart filtering: Remove points that don't add value
    const smartFilteredLocations = [];
    let lastAcceptedPoint = null;
    
    for (const location of sortedLocations) {
      if (!lastAcceptedPoint) {
        // Always keep first point
        smartFilteredLocations.push(location);
        lastAcceptedPoint = location;
        continue;
      }
      
      // Calculate distance between points (improved accuracy with latitude correction)
      const latDiff = location.lat - lastAcceptedPoint.lat;
      const lngDiff = (location.lng - lastAcceptedPoint.lng) * Math.cos((location.lat * Math.PI) / 180);
      const distanceMeters = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111000; // Meter conversion with lat correction
      
      // Calculate time difference in minutes
      const timeDiffMinutes = (location.timestamp.getTime() - lastAcceptedPoint.timestamp.getTime()) / (1000 * 60);
      
      // Filter out points that don't add value:
      // - Only remove points that are truly redundant (very close AND very recent)
      // Changed from OR to AND to be much less aggressive
      const isRedundant = distanceMeters < 20 && timeDiffMinutes < 2;
      
      if (!isRedundant) {
        smartFilteredLocations.push(location);
        lastAcceptedPoint = location;
      }
    }
    
    if (smartFilteredLocations.length < 2) return { segments: [], gaps: [] };

    const segments: [number, number][][] = [];
    const gaps: [[number, number], [number, number]][] = [];
    let currentSegment: [number, number][] = [];
    
    for (let i = 0; i < smartFilteredLocations.length; i++) {
      const current = smartFilteredLocations[i];
      const coords: [number, number] = [current.lat, current.lng];
      
      if (i === 0) {
        currentSegment = [coords];
        continue;
      }
      
      const previous = smartFilteredLocations[i - 1];
      const timeDiffMinutes = (current.timestamp.getTime() - previous.timestamp.getTime()) / (1000 * 60);
      
      // Use proper distance calculation
      const distanceMeters = haversineDistanceMeters(previous.lat, previous.lng, current.lat, current.lng);
      const distanceKm = distanceMeters / 1000;
      
      // Calculate implied speed between points
      const speedKmh = timeDiffMinutes > 0 ? (distanceKm / (timeDiffMinutes / 60)) : 0;
      
      // NO FILTERING - Just connect all points in chronological order
      // User wants to see actual travel sequence (driving, flying, walking, etc.)
      const isGap = false; // Connect everything sequentially
      
      if (isGap && currentSegment.length > 1) {
        // End current segment and start new one
        segments.push([...currentSegment]);
        // Add gap connection from end of last segment to start of new segment
        const lastPoint = currentSegment[currentSegment.length - 1];
        gaps.push([lastPoint, coords]);
        currentSegment = [coords];
      } else {
        // Continue current segment
        currentSegment.push(coords);
      }
    }
    
    // Add final segment if it has multiple points
    if (currentSegment.length > 1) {
      segments.push(currentSegment);
    }
    
    return { segments, gaps };
  };


  // Unified distance calculation using proper haversine formula
  const haversineDistanceMeters = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Color scheme for different days in multi-day view
  const getDayColor = (dayIndex: number): string => {
    const colors = [
      '#3b82f6', // blue
      '#ef4444', // red
      '#10b981', // green
      '#f59e0b', // amber
      '#8b5cf6', // violet
      '#06b6d4', // cyan
      '#f97316', // orange
      '#84cc16', // lime
      '#ec4899', // pink
      '#6366f1', // indigo
    ];
    return colors[dayIndex % colors.length];
  };

  // Generate polyline data based on view mode
  const polylineData = useMemo(() => {
    if (viewMode === 'single') {
      // Single day view: use existing logic with blue color
      const { segments, gaps } = createCleanPathSegments(filteredLocations);
      return {
        daySegments: [{ segments, gaps, color: '#3b82f6', date: selectedDate?.toDateString() || 'single' }],
        dayMarkers: []
      };
    } else {
      // Multi-day view: create separate segments for each day
      const daySegments = dayGroupedLocations.map((dayData, index) => {
        const { segments, gaps } = createCleanPathSegments(dayData.points);
        return {
          segments,
          gaps,
          color: getDayColor(index),
          date: dayData.date,
          dayData
        };
      });
      
      // Create day start markers for multi-day view
      const dayMarkers = dayGroupedLocations.map((dayData, index) => ({
        position: [dayData.points[0].lat, dayData.points[0].lng] as [number, number],
        color: getDayColor(index),
        date: dayData.date,
        dayData
      }));
      
      return { daySegments, dayMarkers };
    }
  }, [viewMode, filteredLocations, dayGroupedLocations, selectedDate]);

  const { daySegments, dayMarkers } = polylineData;

  // Use first location as center if available, ensure valid coordinates
  const mapCenter = filteredLocations.length > 0 
    ? [filteredLocations[0].lat, filteredLocations[0].lng] as [number, number]
    : center;

  // Validate coordinates to prevent rendering issues
  const isValidCenter = mapCenter[0] !== undefined && 
                       mapCenter[1] !== undefined && 
                       !isNaN(mapCenter[0]) && 
                       !isNaN(mapCenter[1]) &&
                       mapCenter[0] >= -90 && mapCenter[0] <= 90 &&
                       mapCenter[1] >= -180 && mapCenter[1] <= 180;

  if (!isValidCenter) {
    return (
      <Card className={`h-full relative ${className}`}>
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <p className="text-destructive">Invalid map coordinates</p>
            <p className="text-sm text-muted-foreground">Center: [{mapCenter[0]}, {mapCenter[1]}]</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`h-full relative ${className}`}>
      {/* View Mode Toggle Controls */}
      <div className="absolute top-4 left-4 z-[1000] flex gap-1">
        <Button 
          variant={viewMode === 'single' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setViewMode('single')}
          data-testid="button-single-day"
          className="text-xs px-2 py-1 h-7"
        >
          Single Day
        </Button>
        <Button 
          variant={viewMode === 'multi' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setViewMode('multi')}
          data-testid="button-multi-day"
          disabled={!dateRange}
          className="text-xs px-2 py-1 h-7"
        >
          View All
        </Button>
      </div>
      
      <div className="h-full rounded-lg" style={{ minHeight: '400px' }}>
        <MapContainer
          center={mapCenter}
          zoom={zoom}
          style={{ height: '100%', width: '100%', minHeight: '400px' }}
          data-testid="map-container"
          scrollWheelZoom={true}
          zoomControl={true}
          attributionControl={true}
          preferCanvas={false}
          whenReady={() => {
            // Scroll wheel zoom should be enabled by default with scrollWheelZoom={true}
          }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
            tileSize={256}
            zoomOffset={0}
          />
          
          {/* Draw path segments grouped by day */}
          {daySegments.flatMap((daySegment, dayIndex) => [
            // Draw clean path segments (GPS-tracked routes) for this day
            ...daySegment.segments.map((segment, segmentIndex) => (
              <Polyline
                key={`day-${dayIndex}-segment-${segmentIndex}`}
                positions={segment}
                color={daySegment.color}
                weight={3}
                opacity={0.9}
                smoothFactor={1.0}
                data-testid={`polyline-day-${daySegment.date}`}
              />
            )),
            // Draw dotted lines for gaps (inferred travel) for this day
            ...daySegment.gaps.map((gap, gapIndex) => (
              <Polyline
                key={`day-${dayIndex}-gap-${gapIndex}`}
                positions={gap}
                color={daySegment.color}
                weight={2}
                opacity={0.4}
                dashArray="8,12"
                smoothFactor={1.0}
              />
            ))
          ])}
          
          {/* Day start markers for multi-day view */}
          {viewMode === 'multi' && dayMarkers.map((marker, markerIndex) => (
            <Marker
              key={`day-marker-${marker.date}`}
              position={marker.position}
              data-testid={`marker-daystart-${marker.date}`}
              icon={new Icon({
                iconUrl: `data:image/svg+xml;base64,${btoa(`
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 41" fill="none">
                    <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 7.8 12.5 28.5 12.5 28.5s12.5-20.7 12.5-28.5C25 5.6 19.4 0 12.5 0z" fill="${marker.color}" stroke="#fff" stroke-width="2"/>
                    <circle cx="12.5" cy="12.5" r="6" fill="#fff"/>
                    <text x="12.5" y="17" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="${marker.color}">${markerIndex + 1}</text>
                  </svg>
                `)}`,
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
              })}
            >
              <Popup>
                <div className="text-sm">
                  <strong>Day {markerIndex + 1}: {new Date(marker.date).toLocaleDateString()}</strong><br/>
                  Start: {marker.dayData.points[0].timestamp.toLocaleTimeString()}<br/>
                  Points: {marker.dayData.points.length}<br/>
                  Lat: {marker.position[0].toFixed(6)}<br/>
                  Lng: {marker.position[1].toFixed(6)}
                </div>
              </Popup>
            </Marker>
          ))}
          
          {/* Auto-pan and auto-zoom controller */}
          <MapViewController 
            filteredLocations={filteredLocations}
            selectedPoint={selectedPoint || internalSelectedPoint}
            viewMode={viewMode}
            dayGroupedLocations={dayGroupedLocations}
          />
          
          {/* Highlight marker for clicked timeline points */}
          {selectedPoint && (
            <Marker 
              position={[selectedPoint.lat, selectedPoint.lng]}
              icon={highlightIcon}
              data-testid="highlight-marker"
            >
              <Popup>
                <div className="text-sm">
                  <strong>Selected Point</strong><br/>
                  Lat: {selectedPoint.lat.toFixed(6)}<br/>
                  Lng: {selectedPoint.lng.toFixed(6)}
                </div>
              </Popup>
            </Marker>
          )}
          
          {/* No markers - just clean lines as requested */}
        </MapContainer>
      </div>

      {/* Calendar Overlay for single-day view */}
      {viewMode === 'single' && onDateChange && selectedDate && (
        <CalendarOverlay
          selectedDate={selectedDate}
          onDateChange={onDateChange}
          availableDates={availableDates}
          locationCountByDate={locationCountByDate}
        />
      )}
      
      
      {filteredLocations.length === 0 && selectedDate && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-lg z-[5]">
          <div className="text-center">
            <p className="text-muted-foreground">No locations for {selectedDate.toLocaleDateString()}</p>
            <p className="text-sm text-muted-foreground mt-1">Try selecting a different date from the calendar</p>
          </div>
        </div>
      )}
    </Card>
  );
}