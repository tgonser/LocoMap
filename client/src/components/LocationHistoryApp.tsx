import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Calendar, BarChart3, List, Upload } from 'lucide-react';
import FileUploader from './FileUploader';
import MapDisplay from './MapDisplay';
import DateNavigator from './DateNavigator';
import AnalyticsPanel from './AnalyticsPanel';
import LocationSummary from './LocationSummary';
import TimelineViewer from './TimelineViewer';

interface LocationData {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  activity?: string;
}

type ViewMode = 'upload' | 'map' | 'analytics';

export default function LocationHistoryApp() {
  const [locationData, setLocationData] = useState<LocationData[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing user data on component mount
  useEffect(() => {
    const loadExistingData = async () => {
      try {
        const response = await fetch('/api/locations');
        if (response.ok) {
          const locations = await response.json();
          
          if (locations.length > 0) {
            // Convert timestamps to Date objects
            const processedData = locations.map((loc: any) => ({
              ...loc,
              timestamp: new Date(loc.timestamp)
            }));
            
            setLocationData(processedData);
            setViewMode('map'); // Switch to map view since they have data
            
            // Set selected date to the most recent date with data
            const dates = processedData.map((loc: LocationData) => loc.timestamp.getTime());
            const mostRecentDate = new Date(Math.max(...dates));
            setSelectedDate(mostRecentDate);
          }
        }
      } catch (error) {
        console.error('Error loading existing location data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadExistingData();
  }, []);

  const handleFileUpload = async (result: any) => {
    setIsProcessing(true);
    
    try {
      // Fetch the uploaded location data
      const response = await fetch('/api/locations');
      const locations = await response.json();
      
      // Convert timestamps to Date objects
      const processedData = locations.map((loc: any) => ({
        ...loc,
        timestamp: new Date(loc.timestamp)
      }));
      
      setLocationData(processedData);
      setViewMode('map');
      console.log('Location data loaded:', processedData.length, 'points');
    } catch (error) {
      console.error('Error loading location data:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Filter out unrealistic future dates (beyond next month) and very old dates for sidebar display
  const now = new Date();
  const maxReasonableDate = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000)); // Next month
  const minReasonableDate = new Date('2005-01-01'); // Google started around this time
  
  const validLocationData = locationData.filter(l => 
    l.timestamp >= minReasonableDate && l.timestamp <= maxReasonableDate
  );

  // Get available dates with location data (using filtered data)
  const availableDates = Array.from(
    new Set(validLocationData.map(loc => loc.timestamp.toDateString()))
  ).map(dateStr => new Date(dateStr));

  // Get locations for selected date (using filtered data)
  const dayLocations = validLocationData.filter(loc => 
    loc.timestamp.toDateString() === selectedDate.toDateString()
  );

  // Calculate location count by date for calendar overlay (using filtered data)
  const locationCountByDate = validLocationData.reduce((acc, loc) => {
    const dateKey = loc.timestamp.toDateString();
    acc[dateKey] = (acc[dateKey] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Analytics calculations (using filtered data)
  const totalLocations = validLocationData.length;
  
  const dateRange = validLocationData.length > 0 ? {
    start: new Date(Math.min(...validLocationData.map(l => l.timestamp.getTime()))),
    end: new Date(Math.max(...validLocationData.map(l => l.timestamp.getTime())))
  } : { 
    // Use reasonable fallback dates instead of future dates
    start: new Date('2024-02-01'), 
    end: new Date('2024-03-31') 
  };

  const activities = validLocationData.reduce((acc, loc) => {
    if (loc.activity) {
      acc[loc.activity] = (acc[loc.activity] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const activityStats = Object.entries(activities).map(([name, count]) => ({
    name,
    count,
    percentage: Math.round((count / totalLocations) * 100)
  })).sort((a, b) => b.count - a.count);

  const averageAccuracy = validLocationData.length > 0 
    ? Math.round(validLocationData.reduce((sum, loc) => sum + (loc.accuracy || 0), 0) / validLocationData.length)
    : 0;

  const getViewModeButton = (mode: ViewMode, icon: React.ReactNode, label: string) => (
    <Button
      key={mode}
      variant={viewMode === mode ? "default" : "ghost"}
      size="sm"
      onClick={() => setViewMode(mode)}
      className="gap-2"
      data-testid={`button-view-${mode}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  return (
    <div className="h-full bg-background">
      {/* Main Content */}
      <main className="h-full">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading your location data...</p>
            </div>
          </div>
        ) : viewMode === 'upload' ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="w-full max-w-2xl">
              <div className="text-center mb-6">
                <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h2 className="text-2xl font-semibold mb-2">
                  Upload Your Location History
                </h2>
                <p className="text-muted-foreground">
                  Select your Google location history JSON file to visualize your travels
                </p>
              </div>
              <FileUploader onFileUpload={handleFileUpload} isProcessing={isProcessing} />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="border-b bg-card/30 px-4 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" data-testid="text-total-points">
                    {totalLocations.toLocaleString()} points
                  </Badge>
                </div>
                <div className="flex gap-1">
                  {getViewModeButton('map', <MapPin className="w-4 h-4" />, 'Map')}
                  {getViewModeButton('analytics', <BarChart3 className="w-4 h-4" />, 'Analytics')}
                </div>
              </div>
            </div>
            
            {/* Content */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 p-4">
            {/* Left Sidebar - Timeline & Analytics */}
            <div className="lg:col-span-1 space-y-4 order-2 lg:order-1">
              {viewMode === 'map' && (
                <>
                  <DateNavigator
                    selectedDate={selectedDate}
                    onDateChange={setSelectedDate}
                    availableDates={availableDates}
                    locationCount={dayLocations.length}
                  />
                  <TimelineViewer
                    events={dayLocations.map(loc => ({
                      timestamp: loc.timestamp,
                      location: {
                        lat: loc.lat,
                        lng: loc.lng,
                      },
                      activity: loc.activity,
                      accuracy: loc.accuracy
                    }))}
                    selectedDate={selectedDate}
                  />
                </>
              )}
              
              {viewMode === 'analytics' && (
                <LocationSummary
                  locations={validLocationData.length > 0 ? validLocationData.map(location => ({
                    city: 'Unknown City', // Will be filled by geocoding
                    state: 'Unknown State',
                    country: 'Unknown Country', 
                    visitCount: 1,
                    firstVisit: location.timestamp,
                    lastVisit: location.timestamp
                  })) : []}
                  dateRange={dateRange}
                  onExport={() => {
                    // Export location summary data
                    const exportData = {
                      summary: 'Location Summary Export',
                      dateRange: {
                        start: dateRange.start.toISOString().split('T')[0],
                        end: dateRange.end.toISOString().split('T')[0]
                      },
                      totalLocations,
                      exportedAt: new Date().toISOString()
                    };
                    
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `location-summary-${dateRange.start.toISOString().split('T')[0]}-to-${dateRange.end.toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                />
              )}
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-3 order-1 lg:order-2">
              {viewMode === 'map' ? (
                <MapDisplay
                  locations={dayLocations}
                  selectedDate={selectedDate}
                  onDateChange={setSelectedDate}
                  availableDates={availableDates}
                  locationCountByDate={locationCountByDate}
                  className="h-full"
                />
              ) : (
                <AnalyticsPanel
                  onBack={() => setViewMode('map')}
                />
              )}
            </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Navigation */}
      {locationData.length > 0 && (
        <div className="sm:hidden fixed bottom-4 left-4 right-4 flex justify-center">
          <Card className="flex gap-1 p-1">
            {getViewModeButton('map', <MapPin className="w-4 h-4" />, '')}
            {getViewModeButton('analytics', <BarChart3 className="w-4 h-4" />, '')}
          </Card>
        </div>
      )}
    </div>
  );
}