import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import { Icon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Fix for default markers in react-leaflet
delete (Icon.Default.prototype as any)._getIconUrl;
Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
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
  center?: [number, number];
  zoom?: number;
  className?: string;
}

export default function MapDisplay({ 
  locations, 
  selectedDate, 
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
    <Card className={`h-full ${className}`}>
      <div className="h-full rounded-lg overflow-hidden">
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
          
          {/* Draw path line */}
          {pathCoords.length > 1 && (
            <Polyline 
              positions={pathCoords} 
              color="#3b82f6" 
              weight={3}
              opacity={0.7}
            />
          )}
          
          {/* Show markers */}
          {filteredLocations.slice(0, 50).map((location, index) => (
            <Marker 
              key={index} 
              position={[location.lat, location.lng]}
            >
              <Popup>
                <div className="space-y-2">
                  <div className="font-medium">
                    {location.timestamp.toLocaleTimeString()}
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
                      {location.activity}
                    </Badge>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      
      {filteredLocations.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-lg">
          <div className="text-center">
            <p className="text-muted-foreground">No locations for selected date</p>
          </div>
        </div>
      )}
    </Card>
  );
}