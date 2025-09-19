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

  // Create path for polyline
  const pathCoords: [number, number][] = filteredLocations
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    .map(loc => [loc.lat, loc.lng]);

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
          
          {/* Draw path line connecting locations in chronological sequence */}
          {pathCoords.length > 1 && (
            <Polyline 
              positions={pathCoords} 
              color="#3b82f6" 
              weight={4}
              opacity={0.8}
              dashArray="5, 5"
            />
          )}
          
          {/* Auto-pan and auto-zoom controller */}
          <MapViewController 
            locations={locations} 
            selectedDate={selectedDate}
          />
          
          {/* Show markers with start/end indicators */}
          {filteredLocations.slice(0, 100).map((location, index) => {
            const isFirst = index === 0;
            const isLast = index === filteredLocations.length - 1;
            
            return (
              <Marker 
                key={index} 
                position={[location.lat, location.lng]}
                icon={new Icon({
                  iconUrl: isFirst ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png' 
                    : isLast ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png'
                    : 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                  iconRetinaUrl: isFirst ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png' 
                    : isLast ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png'
                    : 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
                  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
                  iconSize: [25, 41],
                  iconAnchor: [12, 41],
                  popupAnchor: [1, -34],
                  shadowSize: [41, 41]
                })}
              >
                <Popup>
                  <div className="space-y-2">
                    <div className="font-medium">
                      {location.timestamp.toLocaleTimeString()}
                      {isFirst && <Badge variant="default" className="ml-2 text-xs">Start</Badge>}
                      {isLast && <Badge variant="destructive" className="ml-2 text-xs">End</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                    </div>
                    {location.accuracy && (
                      <Badge variant="secondary" className="text-xs">
                        ±{location.accuracy}m accuracy
                      </Badge>
                    )}
                    {location.activity && (
                      <Badge variant="outline" className="text-xs">
                        {location.activity.replace('_', ' ')}
                      </Badge>
                    )}
                    <div className="text-xs text-muted-foreground">
                      Point {index + 1} of {filteredLocations.length}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}
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