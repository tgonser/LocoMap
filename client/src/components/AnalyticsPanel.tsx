import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Globe, Users, BarChart3, Calendar, RefreshCw, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

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
}

export default function AnalyticsPanel({ onBack }: AnalyticsPanelProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const { toast } = useToast();
  
  // Set default date range to last calendar year
  const getDefaultDateRange = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const lastYear = currentYear - 1;
    return {
      start: `${lastYear}-01-01`,
      end: `${lastYear}-12-31`
    };
  };
  
  const [startDate, setStartDate] = useState(getDefaultDateRange().start);
  const [endDate, setEndDate] = useState(getDefaultDateRange().end);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('AnalyticsPanel: Fetching analytics data from /api/analytics/geocoded-places with body:', { startDate, endDate });
      
      const response = await fetch('/api/analytics/geocoded-places', {
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
      setAnalytics(data);
    } catch (err) {
      console.error('AnalyticsPanel: Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };
  
  const handleApplyDateRange = () => {
    fetchAnalytics();
  };
  
  const isDateRangeValid = () => {
    return startDate && endDate && new Date(startDate) <= new Date(endDate);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };


  const handleBackfillCentroids = async () => {
    try {
      setBackfillLoading(true);
      const response = await fetch('/api/analytics/backfill-centroids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' // Include cookies for authentication
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }
      
      const result = await response.json();
      const centroidsCreated = result.centroidsCreated || 0;
      toast({
        title: "Success",
        description: `Backfilled ${centroidsCreated} daily centroids`
      });
      
      // Refresh analytics after backfill
      await fetchAnalytics();
    } catch (err) {
      console.error('Backfill error:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to backfill centroids',
        variant: "destructive"
      });
    } finally {
      setBackfillLoading(false);
    }
  };

  const handleProcessGeocoding = async () => {
    try {
      setGeocodingLoading(true);
      const response = await fetch('/api/analytics/process-geocoding-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' // Include cookies for authentication
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }
      
      const result = await response.json();
      const processed = result.processed || 0;
      toast({
        title: "Success", 
        description: `Processed ${processed} geocoding requests`
      });
      
      // Refresh analytics after geocoding
      await fetchAnalytics();
    } catch (err) {
      console.error('Geocoding error:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to process geocoding',
        variant: "destructive"
      });
    } finally {
      setGeocodingLoading(false);
    }
  };

  const handleGeocodeDataRange = async () => {
    try {
      setGeocodingLoading(true);
      const response = await fetch('/api/analytics/geocode-date-range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startDate: startDate,
          endDate: endDate
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }
      
      const result = await response.json();
      const processed = result.processed || 0;
      const timeElapsed = result.timeElapsed || 0;
      toast({
        title: "Success", 
        description: `Geocoded ${processed} centroids in ${timeElapsed.toFixed(1)}s for date range`
      });
      
      // Refresh analytics after geocoding
      await fetchAnalytics();
    } catch (err) {
      console.error('Date range geocoding error:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : 'Failed to geocode date range',
        variant: "destructive"
      });
    } finally {
      setGeocodingLoading(false);
    }
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96" data-testid="loading-analytics">
        <div className="text-center">
          <BarChart3 className="h-8 w-8 mx-auto mb-2 animate-spin" />
          <p>Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="flex flex-col items-center justify-center h-96" data-testid="error-analytics">
        <p className="text-red-600 mb-4">{error || 'Failed to load analytics'}</p>
        <Button onClick={fetchAnalytics} data-testid="button-retry-analytics">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="analytics-panel">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          Location Analytics
        </h1>
        <div className="flex gap-2">
          {analytics && (
            <Button onClick={exportData} variant="outline" data-testid="button-export-analytics">
              Export Analytics
            </Button>
          )}
          <Button onClick={onBack} data-testid="button-back-to-map">
            Back to Map
          </Button>
        </div>
      </div>
      
      {/* Date Range Picker */}
      <Card data-testid="card-date-range-picker">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Select Date Range
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <Label htmlFor="start-date">Start Date</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1"
                data-testid="input-start-date"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="end-date">End Date</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1"
                data-testid="input-end-date"
              />
            </div>
            <Button 
              onClick={handleApplyDateRange}
              disabled={loading || !isDateRangeValid()}
              data-testid="button-apply-date-range"
            >
              {loading ? 'Loading...' : 'Update Analytics'}
            </Button>
          </div>
          {!isDateRangeValid() && (
            <p className="text-sm text-red-600 mt-2">Please ensure start date is before end date.</p>
          )}
        </CardContent>
      </Card>

      {/* Data Processing Tools */}
      <Card data-testid="card-data-processing">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Data Processing Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              onClick={handleBackfillCentroids}
              disabled={backfillLoading}
              variant="outline"
              className="flex items-center gap-2"
              data-testid="button-backfill-centroids"
            >
              <Database className="h-4 w-4" />
              {backfillLoading ? 'Computing...' : 'Compute Daily Centroids'}
            </Button>
            <Button 
              onClick={handleProcessGeocoding}
              disabled={geocodingLoading}
              variant="outline"
              className="flex items-center gap-2"
              data-testid="button-process-geocoding"
            >
              <RefreshCw className="h-4 w-4" />
              {geocodingLoading ? 'Geocoding...' : 'Process All'}
            </Button>
            <Button 
              onClick={handleGeocodeDataRange}
              disabled={geocodingLoading}
              variant="default"
              className="flex items-center gap-2"
              data-testid="button-geocode-date-range"
            >
              <Calendar className="h-4 w-4" />
              {geocodingLoading ? 'Geocoding...' : 'Geocode Date Range'}
            </Button>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mt-3">
            <div className="flex items-start gap-2">
              <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">Large Dataset Processing</p>
                <p className="text-amber-700 dark:text-amber-300">
                  For testing, use a small date range (e.g., 1 month). Full dataset geocoding takes 15-20 minutes (~4,700 daily centroids at 25 per batch).
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Analytics Results */}
      {analytics && (
        <>
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
        </>
      )}
    </div>
  );
}