import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Globe, Users, BarChart3, Calendar, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import DateRangePicker from "@/components/DateRangePicker";

interface AnalyticsData {
  totalDays: number;
  geocodedDays: number;
  dateRange: { start: string; end: string };
  countries: Record<string, number>;
  states: Record<string, number>;
  cities: Record<string, number>;
  curatedPlaces: Array<{
    city: string;
    state?: string;
    country: string;
    lat: number;
    lng: number;
    visitDays: number;
    reason: string;
    mapsLink: string;
  }>;
}

interface AnalyticsPanelProps {
  onBack: () => void;
  /** Optional default start date from shared state */
  defaultStartDate?: Date;
  /** Optional default end date from shared state */
  defaultEndDate?: Date;
  /** Callback to update shared date range state */
  onDateRangeChange?: (startDate: Date, endDate: Date) => void;
}

export default function AnalyticsPanel({ 
  onBack, 
  defaultStartDate, 
  defaultEndDate, 
  onDateRangeChange 
}: AnalyticsPanelProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const { toast } = useToast();
  
  // Helper functions for timezone-safe date handling
  const formatLocalYmd = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const fromLocalYmd = (dateString: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  // Set default date range from shared state or fallback to reasonable defaults
  const getDefaultDateRange = () => {
    if (defaultStartDate && defaultEndDate) {
      return {
        start: formatLocalYmd(defaultStartDate), // Use timezone-safe formatting
        end: formatLocalYmd(defaultEndDate)
      };
    }
    // Better defaults: current month and next month
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const firstOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return {
      start: formatLocalYmd(firstOfMonth),
      end: formatLocalYmd(firstOfNextMonth)
    };
  };
  
  const [startDate, setStartDate] = useState(getDefaultDateRange().start);
  const [endDate, setEndDate] = useState(getDefaultDateRange().end);

  // Update local state when shared state changes (e.g., coming from map view)
  useEffect(() => {
    if (defaultStartDate && defaultEndDate) {
      const newStartDate = formatLocalYmd(defaultStartDate);
      const newEndDate = formatLocalYmd(defaultEndDate);
      
      // Only update if different to avoid unnecessary re-renders
      if (newStartDate !== startDate || newEndDate !== endDate) {
        setStartDate(newStartDate);
        setEndDate(newEndDate);
      }
    }
  }, [defaultStartDate, defaultEndDate]);

  // Handle DateRangePicker confirm
  const handleDateRangeConfirm = (selectedStartDate: Date, selectedEndDate: Date) => {
    setShowDateRangePicker(false);
    const newStartDate = formatLocalYmd(selectedStartDate);
    const newEndDate = formatLocalYmd(selectedEndDate);
    setStartDate(newStartDate);
    setEndDate(newEndDate);
    
    // Update shared state using the original Date objects (not reconstructed from strings)
    if (onDateRangeChange) {
      onDateRangeChange(selectedStartDate, selectedEndDate);
    }
  };

  // Handle DateRangePicker cancel
  const handleDateRangeCancel = () => {
    setShowDateRangePicker(false);
  };

  const handleRunAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      setAnalytics(null);
      
      console.log('AnalyticsPanel: Running full analytics pipeline with dates:', { 
        startDate, 
        endDate,
        startDateType: typeof startDate,
        endDateType: typeof endDate 
      });
      
      toast({
        title: "Processing Analytics",
        description: "Running complete analytics pipeline - this may take a few minutes for large datasets...",
      });
      
      const response = await fetch('/api/analytics/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          startDate,
          endDate
        })
      });
      
      console.log('AnalyticsPanel: Response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('AnalyticsPanel: API error:', errorData);
        
        // Handle authentication failures more clearly
        if (response.status === 401) {
          toast({
            title: "Authentication Expired",
            description: "Your session has expired. Refreshing the page...",
            variant: "destructive",
          });
          
          // Auto-refresh the page after a short delay
          setTimeout(() => {
            window.location.reload();
          }, 2000);
          
          throw new Error('Authentication expired. Page will refresh automatically.');
        }
        
        throw new Error(errorData.error || `API request failed (${response.status})`);
      }
      
      const data = await response.json();
      console.log('AnalyticsPanel: Received analytics data:', data);
      
      // The /api/analytics/run endpoint returns the analytics data directly
      if (data.analytics) {
        setAnalytics(data.analytics);
        
        // Update shared state with the analytics date range that was just used
        if (onDateRangeChange) {
          onDateRangeChange(fromLocalYmd(startDate), fromLocalYmd(endDate));
        }
        
        toast({
          title: "Analytics Complete",
          description: `Successfully processed analytics for ${data.analytics.totalDays} days`,
        });
      } else {
        throw new Error('No analytics data returned from pipeline');
      }
      
    } catch (err) {
      console.error('AnalyticsPanel: Run analytics error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to run analytics pipeline';
      setError(errorMessage);
      toast({
        title: "Analytics Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };
  
  const isDateRangeValid = () => {
    return startDate && endDate && fromLocalYmd(startDate) <= fromLocalYmd(endDate);
  };

  const formatDate = (dateString: string) => {
    return fromLocalYmd(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const exportData = () => {
    if (!analytics) return;
    
    const exportData = {
      summary: {
        totalDays: analytics.totalDays,
        geocodedDays: analytics.geocodedDays,
        dateRange: analytics.dateRange,
        uniqueCountries: Object.keys(analytics.countries).length,
        uniqueStates: Object.keys(analytics.states).length,
        uniqueCities: Object.keys(analytics.cities).length
      },
      countries: analytics.countries,
      states: analytics.states,
      cities: analytics.cities,
      curatedPlaces: analytics.curatedPlaces,
      generatedAt: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `location-analytics-${startDate}-to-${endDate}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute content based on current state
  let content;

  if (!analytics && !loading && !error) {
    // Initial loading state - show instructions instead of loading spinner
    content = (
      <div className="space-y-6 p-6" data-testid="analytics-panel">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Location Analytics
          </h1>
          <Button onClick={onBack} data-testid="button-back-to-map">
            Back to Map
          </Button>
        </div>
        
        {/* Date Range Picker and Run Analytics */}
        <Card data-testid="card-date-range-picker">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Run Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div>
                <Label>Selected Date Range</Label>
                <Button
                  variant="outline"
                  onClick={() => setShowDateRangePicker(true)}
                  className="w-full mt-1 justify-start text-left font-normal"
                  data-testid="button-select-date-range"
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {startDate && endDate ? 
                    `${fromLocalYmd(startDate).toLocaleDateString()} - ${fromLocalYmd(endDate).toLocaleDateString()}` : 
                    'Click to select date range'
                  }
                </Button>
              </div>
              <Button 
                onClick={handleRunAnalytics}
                disabled={loading || !isDateRangeValid()}
                className="flex items-center gap-2"
                data-testid="button-run-analytics"
              >
                <Play className="h-4 w-4" />
                {loading ? 'Processing...' : 'Run Analytics'}
              </Button>
            </div>
            {!isDateRangeValid() && (
              <p className="text-sm text-red-600 mt-2">Please ensure start date is before end date.</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  } else if (loading) {
    content = (
      <div className="space-y-6 p-6" data-testid="analytics-panel">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Location Analytics
          </h1>
          <Button onClick={onBack} data-testid="button-back-to-map">
            Back to Map
          </Button>
        </div>
        
        <div className="flex items-center justify-center h-96" data-testid="loading-analytics">
          <div className="text-center">
            <BarChart3 className="h-8 w-8 mx-auto mb-2 animate-spin" />
            <p className="text-lg font-medium">Processing Analytics Pipeline...</p>
            <p className="text-sm text-muted-foreground mt-2">This may take several minutes for large datasets</p>
          </div>
        </div>
      </div>
    );
  } else if (error) {
    content = (
      <div className="space-y-6 p-6" data-testid="analytics-panel">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Location Analytics
          </h1>
          <Button onClick={onBack} data-testid="button-back-to-map">
            Back to Map
          </Button>
        </div>
        
        <div className="flex flex-col items-center justify-center h-96" data-testid="error-analytics">
          <p className="text-red-600 mb-4 text-center">{error}</p>
          <div className="flex gap-2">
            <Button onClick={handleRunAnalytics} data-testid="button-retry-analytics">
              Try Again
            </Button>
            <Button onClick={() => setError(null)} variant="outline" data-testid="button-clear-error">
              Clear Error
            </Button>
          </div>
        </div>
      </div>
    );
  } else if (analytics) {
    // Analytics results display
    content = (
      <div className="space-y-6 p-6" data-testid="analytics-panel">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Location Analytics
          </h1>
          <div className="flex gap-2">
            <Button onClick={exportData} variant="outline" data-testid="button-export-analytics">
              Export Analytics
            </Button>
            <Button onClick={onBack} data-testid="button-back-to-map">
              Back to Map
            </Button>
          </div>
        </div>
        
        {/* Date Range Picker and Run Analytics */}
        <Card data-testid="card-date-range-picker">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Run New Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div>
                <Label>Selected Date Range</Label>
                <Button
                  variant="outline"
                  onClick={() => setShowDateRangePicker(true)}
                  className="w-full mt-1 justify-start text-left font-normal"
                  data-testid="button-select-date-range"
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {startDate && endDate ? 
                    `${fromLocalYmd(startDate).toLocaleDateString()} - ${fromLocalYmd(endDate).toLocaleDateString()}` : 
                    'Click to select date range'
                  }
                </Button>
              </div>
              <Button 
                onClick={handleRunAnalytics}
                disabled={loading || !isDateRangeValid()}
                className="flex items-center gap-2"
                data-testid="button-run-analytics"
              >
                <Play className="h-4 w-4" />
                {loading ? 'Processing...' : 'Run Analytics'}
              </Button>
            </div>
            {!isDateRangeValid() && (
              <p className="text-sm text-red-600 mt-2">Please ensure start date is before end date.</p>
            )}
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card data-testid="card-total-days">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Days</CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-total-days">
                {analytics.totalDays.toLocaleString()}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-countries-count">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Countries</CardTitle>
              <Globe className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-countries-count">
                {Object.keys(analytics.countries).length}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-states-count">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">States</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-states-count">
                {Object.keys(analytics.states).length}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-cities-count">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cities</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-cities-count">
                {Object.keys(analytics.cities).length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Date Range Summary */}
        <Card data-testid="card-analyzed-date-range">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Analyzed Date Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg">
              <span className="font-semibold" data-testid="text-analyzed-start-date">
                {formatDate(analytics.dateRange.start)}
              </span>
              {' to '}
              <span className="font-semibold" data-testid="text-analyzed-end-date">
                {formatDate(analytics.dateRange.end)}
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Places Visited Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Countries */}
          <Card data-testid="card-countries">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Countries Visited
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto">
              <div className="space-y-3">
                {Object.entries(analytics.countries)
                  .sort(([,a], [,b]) => b - a)
                  .map(([country, days], index) => (
                  <div
                    key={`${country}-${index}`}
                    className="flex items-center justify-between py-2 border-b border-muted last:border-b-0"
                    data-testid={`row-country-${index}`}
                  >
                    <div className="text-base" data-testid={`text-country-details-${index}`}>
                      <span className="font-medium">{country}</span>
                      <span className="text-muted-foreground ml-2">
                        {days} day{days !== 1 ? 's' : ''} ({((days / analytics.totalDays) * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <Badge variant="outline" data-testid={`badge-country-days-${index}`}>
                      {days} day{days !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* States */}
          <Card data-testid="card-states">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                States/Regions Visited
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto">
              <div className="space-y-3">
                {Object.entries(analytics.states)
                  .sort(([,a], [,b]) => b - a)
                  .map(([state, days], index) => (
                  <div
                    key={`${state}-${index}`}
                    className="flex items-center justify-between py-2 border-b border-muted last:border-b-0"
                    data-testid={`row-state-${index}`}
                  >
                    <div className="text-base" data-testid={`text-state-details-${index}`}>
                      <span className="font-medium">{state}</span>
                      <span className="text-muted-foreground ml-2">
                        {days} day{days !== 1 ? 's' : ''} ({((days / analytics.totalDays) * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <Badge variant="secondary" data-testid={`badge-state-days-${index}`}>
                      {days} day{days !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cities */}
        <Card data-testid="card-cities">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Cities Visited
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Object.entries(analytics.cities)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 50) // Show top 50 cities
                .map(([city, days], index) => (
                <div
                  key={`${city}-${index}`}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-md"
                  data-testid={`row-city-${index}`}
                >
                  <div className="text-sm" data-testid={`text-city-details-${index}`}>
                    <span className="font-medium">{city}</span>
                    <div className="text-muted-foreground text-xs">
                      {days} day{days !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <Badge variant="outline" data-testid={`badge-city-days-${index}`}>
                    {days}
                  </Badge>
                </div>
              ))}
            </div>
            {Object.keys(analytics.cities).length > 50 && (
              <p className="text-sm text-muted-foreground mt-4 text-center">
                Showing top 50 cities of {Object.keys(analytics.cities).length} total
              </p>
            )}
          </CardContent>
        </Card>

        {/* Interesting Places - AI Curated */}
        {analytics.curatedPlaces.length > 0 && (
          <Card data-testid="card-interesting-places">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Interesting Places
                <Badge variant="secondary" className="ml-2">AI Curated</Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Highlighted places from your travels based on cultural significance, natural beauty, and uniqueness.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {analytics.curatedPlaces.map((place, index) => (
                  <div
                    key={`${place.city}-${index}`}
                    className="p-4 border rounded-lg hover-elevate"
                    data-testid={`card-interesting-place-${index}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-medium" data-testid={`text-place-name-${index}`}>
                          {place.city}{place.state && `, ${place.state}`}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {place.country}
                        </p>
                      </div>
                      <Badge variant="outline" data-testid={`badge-place-days-${index}`}>
                        {place.visitDays} day{place.visitDays !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-sm mb-3" data-testid={`text-place-reason-${index}`}>
                      {place.reason}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(place.mapsLink, '_blank')}
                      className="flex items-center gap-2 w-full"
                      data-testid={`button-view-on-maps-${index}`}
                    >
                      <Globe className="h-4 w-4" />
                      View on Google Maps
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Always render DateRangePicker alongside any content
  return (
    <>
      {content}
      <DateRangePicker
        open={showDateRangePicker}
        setOpen={setShowDateRangePicker}
        onConfirm={handleDateRangeConfirm}
        onCancel={handleDateRangeCancel}
        title="Select Date Range for Analytics"
        description="Choose the date range to analyze your location data and generate insights."
        defaultStartDate={startDate ? fromLocalYmd(startDate) : undefined}
        defaultEndDate={endDate ? fromLocalYmd(endDate) : undefined}
        minDate={new Date('2005-01-01')}
        maxDate={new Date()}
      />
    </>
  );
}