import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Calendar, BarChart3, List, Upload, CalendarDays, Globe } from 'lucide-react';
import FileManager from './FileManager';
import MapDisplay from './MapDisplay';
import DateNavigator from './DateNavigator';
import DayTimeline from './DayTimeline';
import AnalyticsPanel from './AnalyticsPanel';
import TimelineViewer from './TimelineViewer';
import DateRangePicker from './DateRangePicker';
import YearlyStateReport from '@/pages/YearlyStateReport';
import { apiRequest } from '@/lib/queryClient';

interface LocationData {
  lat: number;
  lng: number;
  timestamp: Date;
  accuracy?: number;
  activity?: string;
}

// Day aggregation for multi-day view
interface DayData {
  date: string; // YYYY-MM-DD format
  dateObj: Date;
  points: LocationData[];
  firstPoint: LocationData;
  lastPoint: LocationData;
  totalPoints: number;
  startTime: Date;
  endTime: Date;
}

type ViewMode = 'files' | 'map' | 'analytics' | 'yearly-report';

export default function LocationHistoryApp() {
  const [locationData, setLocationData] = useState<LocationData[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  // State for timeline click-to-map navigation
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lng: number } | null>(null);
  // Highlighted day state for multi-day view
  const [highlightedDay, setHighlightedDay] = useState<string | null>(null);
  // View mode state with localStorage persistence
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem('viewMode');
      if (saved) {
        return saved as ViewMode;
      }
    } catch (error) {
      console.error('Error loading saved view mode:', error);
    }
    return 'files'; // Default fallback
  });

  // Save view mode to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('viewMode', viewMode);
    } catch (error) {
      console.error('Error saving view mode:', error);
    }
  }, [viewMode]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  // DateRangePicker state management
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [isLoadingMapData, setIsLoadingMapData] = useState(false);
  const [mapDataLoaded, setMapDataLoaded] = useState(false);
  const [previousViewMode, setPreviousViewMode] = useState<ViewMode>('analytics');
  
  // Shared date range state between analytics and map views with localStorage persistence
  const [selectedDateRange, setSelectedDateRange] = useState<{start: Date, end: Date} | null>(() => {
    try {
      const saved = localStorage.getItem('selectedDateRange');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          start: new Date(parsed.start),
          end: new Date(parsed.end)
        };
      }
    } catch (error) {
      console.error('Error loading saved date range:', error);
    }
    // Default to current month if no saved range
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start, end };
  });

  // Save date range to localStorage whenever it changes
  useEffect(() => {
    if (selectedDateRange) {
      try {
        localStorage.setItem('selectedDateRange', JSON.stringify({
          start: selectedDateRange.start.toISOString(),
          end: selectedDateRange.end.toISOString()
        }));
      } catch (error) {
        console.error('Error saving date range:', error);
      }
    }
  }, [selectedDateRange]);

  // Clear selected point when date or date range changes to prevent stale highlights
  useEffect(() => {
    setSelectedPoint(null);
  }, [selectedDate, selectedDateRange]);

  // Helper function for consistent local date normalization
  const getLocalDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };


  // Handle day click interactions
  const handleDayClick = (dayData: DayData) => {
    // Single click: highlight day and fly to day start location
    setHighlightedDay(dayData.date);
    const { lat, lng } = dayData.firstPoint;
    setSelectedPoint({ lat, lng });
  };

  const handleDayDoubleClick = (dayData: DayData) => {
    // Double click: switch to single day view and select the day
    setHighlightedDay(null);
    setSelectedDate(dayData.dateObj);
    setSelectedDateRange(null); // Clear date range to switch to single-day view
  };

  // Check for existing data on component mount
  useEffect(() => {
    const checkExistingData = async () => {
      try {
        const response = await fetch('/api/datasets');
        if (response.ok) {
          const datasets = await response.json();
          if (datasets && datasets.length > 0) {
            // User has existing data - keep current viewMode (from localStorage or initial state)
            // Only default to analytics if no saved viewMode and user has data
            const savedViewMode = localStorage.getItem('viewMode');
            if (!savedViewMode) {
              setViewMode('analytics');
            }
            // If savedViewMode exists, we already loaded it in the useState initializer
          } else {
            // No data exists - force to files view regardless of saved state
            setViewMode('files');
          }
        } else {
          // API error or no auth - default to files
          setViewMode('files');
        }
      } catch (error) {
        console.error('Error checking existing data:', error);
        // On error, default to files view
        setViewMode('files');
      } finally {
        setIsLoading(false);
      }
    };

    checkExistingData();
  }, []);

  // Load location data with efficient server-side date range filtering
  const loadLocationDataForDateRange = async (startDate: Date, endDate: Date) => {
    // Loading state is set by caller to avoid empty state flash
    try {
      // Format dates as YYYY-MM-DD strings for API using local date components to avoid timezone shifts
      const startDateStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
      const endDateStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      
      // Build query parameters for date range filtering
      const params = new URLSearchParams({
        start: startDateStr,
        end: endDateStr
      });
      
      // Use time-based association system directly (the working system)
      console.log('🎯 Using time-based association system to extract GPS data...');
      
      // Get the uploaded dataset
      const datasetsResponse = await apiRequest('GET', '/api/datasets');
      const datasets = await datasetsResponse.json();
      
      let locations = [];
      if (datasets && datasets.length > 0) {
        const dataset = datasets[0]; // Use first available dataset
        
        const processResponse = await apiRequest('POST', '/api/process-date-range', {
          datasetId: dataset.id,
          startDate: startDateStr,
          endDate: endDateStr
        });
        
        const processResult = await processResponse.json();
        if (processResult.success && processResult.data) {
          locations = processResult.data;
          console.log(`🎯 Time-based association found ${locations.length} GPS points`);
        } else {
          console.error('Time-based association failed:', processResult.error);
        }
      } else {
        console.warn('No datasets found - please upload a location history file first');
      }
        
      // Convert timestamps to Date objects
        const locationData = locations.map((loc: any) => ({
          ...loc,
          timestamp: new Date(loc.timestamp)
        }));
        
        setLocationData(locationData);
        setSelectedDateRange({ start: startDate, end: endDate });
        setMapDataLoaded(true);
        
        // Set selected date to the earliest date with data in the range (first day)
        if (locationData.length > 0) {
          const dates = locationData.map((loc: LocationData) => loc.timestamp.getTime());
          const earliestDate = new Date(Math.min(...dates));
          setSelectedDate(earliestDate);
        } else {
          // No data in selected range - set to start date
          setSelectedDate(startDate);
        }
        
        const dataSource = locations.length > 0 && locations[0].id?.includes('_') ? 'time-based association' : 'database cache';
        console.log(`Location data loaded: ${locationData.length} points for date range ${startDateStr} to ${endDateStr} (${dataSource})`);
    } catch (error) {
      console.error('Error loading location data:', error);
    } finally {
      setIsLoadingMapData(false);
    }
  };

  // Load full location data (fallback method for non-date-range requests)
  const loadFullLocationData = async () => {
    try {
      const response = await apiRequest('GET', '/api/locations');
      const locations = await response.json();
        
        // Convert timestamps to Date objects
        const processedData = locations.map((loc: any) => ({
          ...loc,
          timestamp: new Date(loc.timestamp)
        }));
        
        setLocationData(processedData);
        
        // Set selected date to the most recent date with data
        if (processedData.length > 0) {
          const dates = processedData.map((loc: LocationData) => loc.timestamp.getTime());
          const mostRecentDate = new Date(Math.max(...dates));
          setSelectedDate(mostRecentDate);
        }
        
        console.log('Location data loaded:', processedData.length, 'points');
    } catch (error) {
      console.error('Error loading location data:', error);
    }
  };

  const handleFileUpload = async (result: any) => {
    setIsProcessing(true);
    
    try {
      // File has been uploaded and stored successfully
      // Navigate to analytics view where user can select date range for processing
      setViewMode('analytics');
      console.log('File uploaded successfully:', result.message);
    } catch (error) {
      console.error('Error handling file upload:', error);
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
  const dayLocations = useMemo(() => {
    const selectedKey = getLocalDateKey(selectedDate);
    const filtered = validLocationData.filter(loc => 
      getLocalDateKey(loc.timestamp) === selectedKey
    );
    return filtered;
  }, [validLocationData, selectedDate]);

  // Get all locations within date range for multi-day map view
  const dateRangeLocations = useMemo(() => {
    if (!selectedDateRange) return dayLocations; // Fall back to single day
    
    return validLocationData.filter(location => {
      const locationDate = new Date(location.timestamp.getFullYear(), location.timestamp.getMonth(), location.timestamp.getDate());
      const startDate = new Date(selectedDateRange.start.getFullYear(), selectedDateRange.start.getMonth(), selectedDateRange.start.getDate());
      const endDate = new Date(selectedDateRange.end.getFullYear(), selectedDateRange.end.getMonth(), selectedDateRange.end.getDate());
      
      return locationDate >= startDate && locationDate <= endDate;
    });
  }, [validLocationData, selectedDateRange, dayLocations]);

  // Calculate location count by date for calendar overlay (using filtered data)
  const locationCountByDate = validLocationData.reduce((acc, loc) => {
    const dateKey = loc.timestamp.toDateString();
    acc[dateKey] = (acc[dateKey] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Day aggregation logic for multi-day view
  const dayAggregatedData: DayData[] = useMemo(() => {
    if (!selectedDateRange || validLocationData.length === 0) return [];

    const dayGroups = new Map<string, LocationData[]>();
    
    // Group locations by date within the selected date range
    validLocationData.forEach(location => {
      const locationDate = new Date(location.timestamp.getFullYear(), location.timestamp.getMonth(), location.timestamp.getDate());
      const startDate = new Date(selectedDateRange.start.getFullYear(), selectedDateRange.start.getMonth(), selectedDateRange.start.getDate());
      const endDate = new Date(selectedDateRange.end.getFullYear(), selectedDateRange.end.getMonth(), selectedDateRange.end.getDate());
      
      // Only include locations within the selected date range
      if (locationDate >= startDate && locationDate <= endDate) {
        const dateKey = getLocalDateKey(location.timestamp);
        if (!dayGroups.has(dateKey)) {
          dayGroups.set(dateKey, []);
        }
        dayGroups.get(dateKey)!.push(location);
      }
    });
    
    // Convert to DayData objects
    return Array.from(dayGroups.entries())
      .map(([dateKey, points]) => {
        const sortedPoints = points.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        const firstPoint = sortedPoints[0];
        const lastPoint = sortedPoints[sortedPoints.length - 1];
        
        // Parse dateKey (YYYY-MM-DD) safely without timezone issues
        const [year, month, day] = dateKey.split('-').map(Number);
        
        return {
          date: dateKey,
          dateObj: new Date(year, month - 1, day), // month is 0-based
          points: sortedPoints,
          firstPoint,
          lastPoint,
          totalPoints: sortedPoints.length,
          startTime: firstPoint.timestamp,
          endTime: lastPoint.timestamp
        };
      })
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
  }, [validLocationData, selectedDateRange, getLocalDateKey]);

  // Choose the right locations to pass to MapDisplay based on view type
  const mapLocations = selectedDateRange && dayAggregatedData.length > 1 
    ? dateRangeLocations  // Multi-day view: use all locations in range
    : dayLocations;       // Single-day view: use single day locations

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
      variant={viewMode === mode ? "default" : "secondary"}
      size="sm"
      onClick={() => handleViewModeChange(mode)}
      className="gap-2"
      data-testid={`button-view-${mode}`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );

  // Handle DateRangePicker confirm - load data for selected range
  const handleDateRangeConfirm = async (startDate: Date, endDate: Date) => {
    setShowDateRangePicker(false);
    setIsLoadingMapData(true); // Set loading state before switching views
    setViewMode('map'); // Now switch to map view with loading state active
    
    // Update shared date range state
    setSelectedDateRange({ start: startDate, end: endDate });
    
    await loadLocationDataForDateRange(startDate, endDate);
  };

  // Handle DateRangePicker cancel - return to previous view
  const handleDateRangeCancel = () => {
    setShowDateRangePicker(false);
    setViewMode(previousViewMode);
  };

  // Handle view mode changes - show DateRangePicker for map view
  const handleViewModeChange = (mode: ViewMode) => {
    if (mode === 'map') {
      // Store current view as previous view
      setPreviousViewMode(viewMode);
      // Show DateRangePicker dialog instead of switching directly to map
      setShowDateRangePicker(true);
    } else {
      setViewMode(mode);
    }
  };

  // Handle re-opening date range picker when already in map view
  const handleChangeDateRange = () => {
    setPreviousViewMode('map');
    setShowDateRangePicker(true);
  };

  return (
    <div className="h-screen bg-background">
      {/* Main Content */}
      <main className="h-full">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Checking for existing data...</p>
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
                  {viewMode === 'map' && selectedDateRange && (
                    <Badge variant="outline" data-testid="text-date-range">
                      {selectedDateRange.start.toLocaleDateString()} - {selectedDateRange.end.toLocaleDateString()}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  {viewMode === 'map' && mapDataLoaded && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleChangeDateRange}
                      className="gap-2"
                      data-testid="button-change-date-range"
                    >
                      <CalendarDays className="w-4 h-4" />
                      <span className="hidden sm:inline">Change Range</span>
                    </Button>
                  )}
                  {getViewModeButton('files', <Upload className="w-4 h-4" />, 'Files')}
                  {getViewModeButton('map', <MapPin className="w-4 h-4" />, 'Map')}
                  {getViewModeButton('analytics', <BarChart3 className="w-4 h-4" />, 'Analytics')}
                  {getViewModeButton('yearly-report', <Globe className="w-4 h-4" />, 'Yearly Report')}
                </div>
              </div>
            </div>
            
            {/* Content */}
            {viewMode === 'map' ? (
              <div className="flex-1 flex min-h-0">
                {/* Left Sidebar - Fixed width with scroll */}
                <div className="w-80 min-w-80 shrink-0 p-4 border-r bg-card/50 overflow-y-auto">
                  {/* Multi-day view: Show DayTimeline when dateRange spans multiple days */}
                  {selectedDateRange && dayAggregatedData.length > 1 ? (
                    <DayTimeline 
                      dayData={dayAggregatedData}
                      selectedDate={selectedDate}
                      onDayClick={handleDayClick}
                      onDayDoubleClick={handleDayDoubleClick}
                      highlightedDay={highlightedDay ?? undefined}
                    />
                  ) : (
                    /* Single-day view: Show DateNavigator and Timeline */
                    <div className="space-y-4">
                      <DateNavigator
                        selectedDate={selectedDate}
                        onDateChange={setSelectedDate}
                        availableDates={availableDates}
                        locationCount={dayLocations.length}
                        selectedDateRange={selectedDateRange}
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
                        onEventClick={(lat, lng) => setSelectedPoint({ lat, lng })}
                      />
                    </div>
                  )}
                </div>

                {/* Main Content Area - Takes remaining space */}
                <div className="flex-1 min-h-0 relative overflow-hidden p-4">
                  {isLoadingMapData ? (
                    <Card className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                        <p className="text-muted-foreground">Loading location data...</p>
                        <p className="text-sm text-muted-foreground mt-1">This may take a moment for large date ranges</p>
                      </div>
                    </Card>
                  ) : mapDataLoaded ? (
                    <MapDisplay
                      locations={mapLocations}
                      selectedDate={selectedDate}
                      onDateChange={setSelectedDate}
                      availableDates={availableDates}
                      locationCountByDate={locationCountByDate}
                      className="h-full"
                      selectedPoint={selectedPoint}
                      dateRange={selectedDateRange ?? undefined}
                      onViewModeChange={(mode) => {
                        if (mode === 'single') {
                          // When switching to single day view, use highlighted day if available
                          if (highlightedDay) {
                            // Find the highlighted day data and set it as selected
                            const dayData = dayAggregatedData.find(d => d.date === highlightedDay);
                            if (dayData) {
                              setSelectedDate(dayData.dateObj);
                              setHighlightedDay(null); // Clear highlight since we're selecting it
                            }
                          }
                          // Clear the date range so sidebar switches to hourly timeline
                          setSelectedDateRange(null);
                        } else if (mode === 'multi') {
                          console.log('🔘 Multi-day mode requested!', {
                            currentSelectedDateRange: selectedDateRange,
                            dayAggregatedDataLength: dayAggregatedData.length,
                            dayAggregatedData: dayAggregatedData.map(d => ({ date: d.date, dateObj: d.dateObj.toDateString() }))
                          });
                          // When switching to multi-day view, restore the existing date range
                          // Don't open date picker - user wants to see all days in current range
                          if (!selectedDateRange && dayAggregatedData.length > 0) {
                            // If no range selected, create one from available days
                            const dates = dayAggregatedData.map(d => d.dateObj);
                            const startDate = new Date(Math.min(...dates.map(d => d.getTime())));
                            const endDate = new Date(Math.max(...dates.map(d => d.getTime())));
                            console.log('🔘 Creating date range from available days:', {
                              startDate: startDate.toDateString(),
                              endDate: endDate.toDateString()
                            });
                            setSelectedDateRange({ start: startDate, end: endDate });
                          } else {
                            console.log('🔘 Date range already exists or no days available');
                          }
                          // If we already have a date range, just switching view mode is enough
                        }
                      }}
                    />
                  ) : (
                    <Card className="h-full flex items-center justify-center">
                      <div className="text-center">
                        <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                        <h3 className="text-lg font-semibold mb-2">Select Date Range</h3>
                        <p className="text-muted-foreground mb-4">Choose a date range to load and view your location data on the map</p>
                        <Button onClick={() => setShowDateRangePicker(true)} data-testid="button-select-date-range">
                          <CalendarDays className="w-4 h-4 mr-2" />
                          Select Date Range
                        </Button>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-start justify-center p-4">
                <div className="w-full max-w-6xl">
                  {viewMode === 'files' ? (
                    <FileManager onFileUpload={handleFileUpload} />
                  ) : viewMode === 'yearly-report' ? (
                    <YearlyStateReport />
                  ) : (
                    <AnalyticsPanel
                      onBack={() => setViewMode('map')}
                      defaultStartDate={selectedDateRange?.start}
                      defaultEndDate={selectedDateRange?.end}
                      onDateRangeChange={(startDate: Date, endDate: Date) => {
                        // Update shared date range state when analytics dates change
                        setSelectedDateRange({ start: startDate, end: endDate });
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* DateRangePicker Dialog */}
      <DateRangePicker
        open={showDateRangePicker}
        setOpen={setShowDateRangePicker}
        onConfirm={handleDateRangeConfirm}
        onCancel={handleDateRangeCancel}
        title="Select Date Range for Map View"
        description="Choose the date range to load and display location data on the map."
        defaultStartDate={selectedDateRange?.start}
        defaultEndDate={selectedDateRange?.end}
        minDate={new Date('2005-01-01')}
        maxDate={new Date()}
      />

      {/* Mobile Navigation */}
      {(locationData.length > 0 || mapDataLoaded) && (
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