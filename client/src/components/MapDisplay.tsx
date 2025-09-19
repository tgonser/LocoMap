import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import { Icon } from 'leaflet';
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

  // Use first location as center if available
  const mapCenter = filteredLocations.length > 0 
    ? [filteredLocations[0].lat, filteredLocations[0].lng] as [number, number]
    : center;

  return (
    <Card className={`h-full relative ${className}`}>
      <div className="h-full rounded-lg">
        <MapContainer
          center={mapCenter}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          data-testid="map-container"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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