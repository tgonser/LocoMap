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
}

function MapViewController({ filteredLocations, selectedPoint, viewMode }: MapViewControllerProps) {
  const map = useMap();
  const isNavigatingRef = useRef(false);

  useEffect(() => {
    // Use pre-filtered locations from parent component

    if (filteredLocations.length === 0) {
      return; // Keep current view if no locations
    }

    // If user is actively navigating timeline points, don't interfere with zoom level
    if (isNavigatingRef.current) {
      return;
    }

    // Handle single location case
    if (filteredLocations.length === 1) {
      const location = filteredLocations[0];
      map.setView([location.lat, location.lng], 16, {
        animate: true,
        duration: 0.8
      });
      return;
    }

    // Handle multiple locations - calculate bounds (only on initial load)
    const bounds = new LatLngBounds([]);
    filteredLocations.forEach(location => {
      bounds.extend([location.lat, location.lng]);
    });

    // Fit bounds with padding and constraints
    map.fitBounds(bounds, {
      padding: [20, 20], // Add 20px padding on all sides
      maxZoom: 17, // Don't zoom in too close for multiple locations
      animate: true,
      duration: 0.8
    });

  }, [map, filteredLocations]);

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
  dateRange
}: MapDisplayProps) {
  // View mode state management
  const [viewMode, setViewMode] = useState<MapViewMode>('single');
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
      // Multi-day view: show all locations within date range
      if (!dateRange) return locations;
      
      return locations.filter(loc => {
        const locDate = getLocalDateOnly(loc.timestamp);
        const startDate = getLocalDateOnly(dateRange.start);
        const endDate = getLocalDateOnly(dateRange.end);
        return locDate >= startDate && locDate <= endDate;
      });
    }
  }, [locations, selectedDate, viewMode, dateRange]);

  // Aggregate locations by day for multi-day view using consistent date normalization
  const dayAggregatedData = useMemo(() => {
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
      .map(([dateKey, points]) => {
        // Sort a copy to avoid mutating the original array
        const sortedPoints = [...points].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        
        // Parse date key back to Date object using consistent method
        const [year, month, day] = dateKey.split('-').map(Number);
        const dateObj = new Date(year, month - 1, day); // month is 0-indexed
        
        return {
          date: dateKey, // Already in YYYY-MM-DD format
          dateObj,
          points: sortedPoints,
          firstPoint: sortedPoints[0],
          lastPoint: sortedPoints[sortedPoints.length - 1],
          totalPoints: sortedPoints.length,
          startTime: sortedPoints[0].timestamp,
          endTime: sortedPoints[sortedPoints.length - 1].timestamp
        } as DayData;
      })
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
  }, [filteredLocations, viewMode]);

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

  const { segments: pathSegments, gaps: pathGaps } = createCleanPathSegments(filteredLocations);

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
    console.error('Invalid map center coordinates:', mapCenter);
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
      <div className="absolute top-4 left-4 z-[1000] flex gap-2">
        <Button 
          variant={viewMode === 'single' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setViewMode('single')}
          data-testid="button-single-day"
        >
          Single Day
        </Button>
        <Button 
          variant={viewMode === 'multi' ? 'default' : 'outline'} 
          size="sm"
          onClick={() => setViewMode('multi')}
          data-testid="button-multi-day"
          disabled={!dateRange}
        >
          View All Range
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
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
            tileSize={256}
            zoomOffset={0}
          />
          
          {/* Draw clean path segments (GPS-tracked routes) */}
          {pathSegments.map((segment, segmentIndex) => (
            <Polyline
              key={`segment-${segmentIndex}`}
              positions={segment}
              color="#3b82f6"
              weight={3}
              opacity={0.9}
              smoothFactor={1.0}
            />
          ))}
          
          {/* Draw dotted lines for gaps (inferred travel) */}
          {pathGaps.map((gap, gapIndex) => (
            <Polyline
              key={`gap-${gapIndex}`}
              positions={gap}
              color="#6b7280"
              weight={2}
              opacity={0.6}
              dashArray="8,12"
              smoothFactor={1.0}
            />
          ))}
          
          {/* Auto-pan and auto-zoom controller */}
          <MapViewController 
            filteredLocations={filteredLocations}
            selectedPoint={selectedPoint}
            viewMode={viewMode}
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

      {/* Calendar Overlay */}
      {onDateChange && selectedDate && (
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