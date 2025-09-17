import { useState, useEffect } from "react";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, MapPin, Globe, Users, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AnalyticsData {
  totalPoints: number;
  dateRange: { start: string; end: string } | null;
  cities: Array<{ name: string; count: number; state?: string; country?: string }>;
  states: Array<{ name: string; count: number; country?: string }>;
  countries: Array<{ name: string; count: number }>;
  activities: Array<{ name: string; count: number }>;
  dailyStats: Array<{ date: string; points: number; cities: number }>;
}

interface AnalyticsPanelProps {
  onBack: () => void;
}

export default function AnalyticsPanel({ onBack }: AnalyticsPanelProps) {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/locations/stats');
      if (!response.ok) {
        throw new Error('Failed to fetch analytics');
      }
      const data = await response.json();
      setAnalytics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const exportData = () => {
    if (!analytics) return;
    
    const exportData = {
      summary: {
        totalLocationPoints: analytics.totalPoints,
        dateRange: analytics.dateRange,
        uniqueCities: analytics.cities.length,
        uniqueStates: analytics.states.length,
        uniqueCountries: analytics.countries.length
      },
      topCities: analytics.cities.slice(0, 10),
      topStates: analytics.states.slice(0, 10),
      countries: analytics.countries,
      activities: analytics.activities,
      dailyStatistics: analytics.dailyStats
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'location-analytics.json';
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
          <Button onClick={exportData} variant="outline" data-testid="button-export-data">
            Export Data
          </Button>
          <Button onClick={onBack} data-testid="button-back-to-map">
            Back to Map
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-points">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Points</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-points">
              {analytics.totalPoints.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-unique-cities">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unique Cities</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-unique-cities">
              {analytics.cities.length}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-unique-states">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">States/Regions</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-unique-states">
              {analytics.states.length}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-countries">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Countries</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-countries">
              {analytics.countries.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Date Range */}
      {analytics.dateRange && (
        <Card data-testid="card-date-range">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Date Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg">
              <span className="font-semibold" data-testid="text-start-date">
                {formatDate(analytics.dateRange.start)}
              </span>
              {' to '}
              <span className="font-semibold" data-testid="text-end-date">
                {formatDate(analytics.dateRange.end)}
              </span>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Top Cities */}
      <Card data-testid="card-top-cities">
        <CardHeader>
          <CardTitle>Top Cities by Visit Count</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {analytics.cities.slice(0, 10).map((city, index) => (
              <div
                key={`${city.name}-${index}`}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
                data-testid={`row-city-${index}`}
              >
                <div>
                  <span className="font-medium" data-testid={`text-city-name-${index}`}>
                    {city.name}
                  </span>
                  {city.state && city.country && (
                    <span className="text-sm text-gray-600 ml-2" data-testid={`text-city-location-${index}`}>
                      {city.state}, {city.country}
                    </span>
                  )}
                </div>
                <Badge variant="secondary" data-testid={`badge-city-count-${index}`}>
                  {city.count}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Top States */}
      {analytics.states.length > 0 && (
        <Card data-testid="card-top-states">
          <CardHeader>
            <CardTitle>Top States/Regions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {analytics.states.slice(0, 10).map((state, index) => (
                <div
                  key={`${state.name}-${index}`}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
                  data-testid={`row-state-${index}`}
                >
                  <div>
                    <span className="font-medium" data-testid={`text-state-name-${index}`}>
                      {state.name}
                    </span>
                    {state.country && (
                      <span className="text-sm text-gray-600 ml-2" data-testid={`text-state-country-${index}`}>
                        {state.country}
                      </span>
                    )}
                  </div>
                  <Badge variant="secondary" data-testid={`badge-state-count-${index}`}>
                    {state.count}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Countries */}
      <Card data-testid="card-countries-list">
        <CardHeader>
          <CardTitle>Countries Visited</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {analytics.countries.map((country, index) => (
              <Badge
                key={`${country.name}-${index}`}
                variant="outline"
                className="text-sm"
                data-testid={`badge-country-${index}`}
              >
                {country.name} ({country.count})
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Activities */}
      {analytics.activities.length > 0 && (
        <Card data-testid="card-activities">
          <CardHeader>
            <CardTitle>Activity Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {analytics.activities.map((activity, index) => (
                <Badge
                  key={`${activity.name}-${index}`}
                  variant="secondary"
                  className="text-sm"
                  data-testid={`badge-activity-${index}`}
                >
                  {activity.name.replace('_', ' ')} ({activity.count})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}