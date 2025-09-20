import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from 'react-leaflet';
import { Icon, LatLngBounds } from 'leaflet';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import CalendarOverlay from './CalendarOverlay';

// Fix for default markers in react-leaflet
delete (Icon.Default.prototype as any)._getIconUrl;
Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface LocationPoint {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  activity?: string;
}

// Component to handle auto-pan and auto-zoom functionality
interface MapViewControllerProps {
  locations: LocationPoint[];
  selectedDate?: Date;
}

function MapViewController({ locations, selectedDate }: MapViewControllerProps) {
  const map = useMap();

  useEffect(() => {
    // Filter locations by selected date
    const filteredLocations = selectedDate 
      ? locations.filter(loc => 
          loc.timestamp.toDateString() === selectedDate.toDateString()
        )
      : locations;

    if (filteredLocations.length === 0) {
      return; // Keep current view if no locations
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

    // Handle multiple locations - calculate bounds
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

  }, [map, locations, selectedDate]);

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
}

export default function MapDisplay({ 
  locations, 
  selectedDate, 
  onDateChange,
  availableDates = [],
  locationCountByDate = {},
  center = [37.7749, -122.4194], // San Francisco default
  zoom = 13,
  className 
}: MapDisplayProps) {
  // Filter locations by selected date if provided
  const filteredLocations = selectedDate 
    ? locations.filter(loc => 
        loc.timestamp.toDateString() === selectedDate.toDateString()
      )
    : locations;

  // Create clean path segments for realistic track visualization
  const createCleanPathSegments = (locations: LocationPoint[]): [number, number][][] => {
    if (locations.length < 2) return [];
    
    // Sort chronologically and filter for accuracy (defensive copy to avoid mutation)
    const sortedLocations = [...locations]
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .filter(loc => {
        // Be more permissive with timelinePath points - allow up to 200m accuracy
        // TimelinePath points are invaluable for route definition as user noted
        return loc.accuracy ? loc.accuracy <= 200 : true;
      });

    if (sortedLocations.length < 2) return [];

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
    
    if (smartFilteredLocations.length < 2) return [];

    const segments: [number, number][][] = [];
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
      
      // Calculate distance between points (rough estimate)
      const latDiff = current.lat - previous.lat;
      const lngDiff = current.lng - previous.lng;
      const distanceKm = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111; // Rough km conversion
      
      // Detect gaps: >30 minutes OR >5km distance suggests a gap (flight, drive, etc.)
      const isGap = timeDiffMinutes > 30 || distanceKm > 5;
      
      if (isGap && currentSegment.length > 1) {
        // End current segment and start new one
        segments.push([...currentSegment]);
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
    
    return segments;
  };

  const pathSegments = createCleanPathSegments(filteredLocations);

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
          
          {/* Draw clean path segments (multiple polylines for gaps) */}
          {pathSegments.map((segment, segmentIndex) => (
            <Polyline
              key={segmentIndex}
              positions={segment}
              color="#3b82f6"
              weight={3}
              opacity={0.9}
              smoothFactor={1.0}
            />
          ))}
          
          {/* Auto-pan and auto-zoom controller */}
          <MapViewController 
            locations={locations} 
            selectedDate={selectedDate}
          />
          
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