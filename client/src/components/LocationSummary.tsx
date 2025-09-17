import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapPin, Building, Globe2, Download } from 'lucide-react';

interface LocationData {
  city: string;
  state: string;
  country: string;
  visitCount: number;
  firstVisit: Date;
  lastVisit: Date;
}

interface LocationSummaryProps {
  locations: LocationData[];
  dateRange: { start: Date; end: Date };
  onExport?: () => void;
}

export default function LocationSummary({ locations, dateRange, onExport }: LocationSummaryProps) {
  // Group by country and state
  const countries = Array.from(new Set(locations.map(l => l.country))).length;
  const states = Array.from(new Set(locations.map(l => l.state))).length;
  const cities = locations.length;

  const formatDateRange = () => {
    const startDate = dateRange.start.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
    const endDate = dateRange.end.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: 'numeric'
    });
    return `${startDate} - ${endDate}`;
  };

  const sortedLocations = locations.sort((a, b) => b.visitCount - a.visitCount);

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="w-5 h-5" />
            Places Visited
          </CardTitle>
          {onExport && (
            <Button variant="outline" size="sm" onClick={onExport} data-testid="button-export">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {formatDateRange()}
        </p>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center space-y-2">
            <Globe2 className="w-6 h-6 mx-auto text-muted-foreground" />
            <p className="text-2xl font-bold" data-testid="text-countries-count">
              {countries}
            </p>
            <p className="text-xs text-muted-foreground">Countries</p>
          </div>
          
          <div className="text-center space-y-2">
            <Building className="w-6 h-6 mx-auto text-muted-foreground" />
            <p className="text-2xl font-bold" data-testid="text-states-count">
              {states}
            </p>
            <p className="text-xs text-muted-foreground">States</p>
          </div>
          
          <div className="text-center space-y-2">
            <MapPin className="w-6 h-6 mx-auto text-muted-foreground" />
            <p className="text-2xl font-bold" data-testid="text-cities-count">
              {cities}
            </p>
            <p className="text-xs text-muted-foreground">Cities</p>
          </div>
        </div>

        {/* Top Cities List */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Most Visited Cities</h4>
          <ScrollArea className="h-64">
            <div className="space-y-3">
              {sortedLocations.map((location, index) => (
                <div 
                  key={`${location.city}-${location.state}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 hover-elevate"
                  data-testid={`card-location-${index}`}
                >
                  <div className="space-y-1 flex-1">
                    <p className="font-medium text-sm">
                      {location.city}, {location.state}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {location.country}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {location.firstVisit.toLocaleDateString()} - {location.lastVisit.toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  
                  <div className="text-right space-y-1">
                    <Badge variant="secondary" className="text-xs">
                      {location.visitCount} visits
                    </Badge>
                    {index < 3 && (
                      <Badge variant="outline" className="text-xs">
                        Top {index + 1}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}