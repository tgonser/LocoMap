import { useState } from 'react';
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

  // Get available dates with location data
  const availableDates = Array.from(
    new Set(locationData.map(loc => loc.timestamp.toDateString()))
  ).map(dateStr => new Date(dateStr));

  // Get locations for selected date
  const dayLocations = locationData.filter(loc => 
    loc.timestamp.toDateString() === selectedDate.toDateString()
  );

  // Calculate location count by date for calendar overlay
  const locationCountByDate = locationData.reduce((acc, loc) => {
    const dateKey = loc.timestamp.toDateString();
    acc[dateKey] = (acc[dateKey] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Analytics calculations
  const totalLocations = locationData.length;
  const dateRange = locationData.length > 0 ? {
    start: new Date(Math.min(...locationData.map(l => l.timestamp.getTime()))),
    end: new Date(Math.max(...locationData.map(l => l.timestamp.getTime())))
  } : { start: new Date(), end: new Date() };

  const activities = locationData.reduce((acc, loc) => {
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

  const averageAccuracy = locationData.length > 0 
    ? Math.round(locationData.reduce((sum, loc) => sum + (loc.accuracy || 0), 0) / locationData.length)
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
    <div className="h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <MapPin className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-semibold">Location History Analyzer</h1>
            {locationData.length > 0 && (
              <Badge variant="secondary" data-testid="text-total-points">
                {totalLocations.toLocaleString()} points
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {locationData.length > 0 && (
              <div className="hidden sm:flex gap-1">
                {getViewModeButton('map', <MapPin className="w-4 h-4" />, 'Map')}
                {getViewModeButton('analytics', <BarChart3 className="w-4 h-4" />, 'Analytics')}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="h-[calc(100vh-73px)]">
        {viewMode === 'upload' ? (
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
          <div className="h-full grid grid-cols-1 lg:grid-cols-4 gap-4 p-4">
            {/* Left Sidebar - Timeline & Analytics */}
            <div className="lg:col-span-1 space-y-4 order-2 lg:order-1">
              {viewMode === 'map' && (
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
              )}
              
              {viewMode === 'analytics' && (
                <LocationSummary
                  locations={[
                    // //todo: remove mock functionality - Generate from real geocoded data
                    { city: 'San Francisco', state: 'California', country: 'United States', visitCount: 45, firstVisit: dateRange.start, lastVisit: dateRange.end },
                    { city: 'Oakland', state: 'California', country: 'United States', visitCount: 23, firstVisit: dateRange.start, lastVisit: dateRange.end }
                  ]}
                  dateRange={dateRange}
                  onExport={() => console.log('Export functionality')}
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
                  totalLocations={totalLocations}
                  timeSpent={`${Math.ceil((dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60 * 24))} days`}
                  mostVisitedCity="San Francisco, CA"
                  averageAccuracy={averageAccuracy}
                  activities={activityStats}
                  dateRange={dateRange}
                />
              )}
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