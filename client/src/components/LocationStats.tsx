import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, TrendingUp, Activity } from 'lucide-react';

interface LocationStatsProps {
  totalLocations: number;
  timeSpent: string;
  mostVisitedCity: string;
  averageAccuracy: number;
  activities: { name: string; count: number; percentage: number }[];
  dateRange: { start: Date; end: Date };
}

export default function LocationStats({
  totalLocations,
  timeSpent,
  mostVisitedCity,
  averageAccuracy,
  activities,
  dateRange
}: LocationStatsProps) {

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

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          Location Analytics
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatDateRange()}
        </p>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Points</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-total-locations">
              {totalLocations.toLocaleString()}
            </p>
          </div>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Time Period</span>
            </div>
            <p className="text-2xl font-bold" data-testid="text-time-spent">
              {timeSpent}
            </p>
          </div>
        </div>

        {/* Most Visited City */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Most Visited</span>
          </div>
          <p className="font-medium" data-testid="text-most-visited-city">
            {mostVisitedCity}
          </p>
        </div>

        {/* Average Accuracy */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Average Accuracy</span>
          </div>
          <Badge variant="outline" data-testid="text-average-accuracy">
            ±{averageAccuracy}m
          </Badge>
        </div>

        {/* Activities Breakdown */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">Activity Types</h4>
          <div className="space-y-2">
            {activities.map((activity, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm capitalize" data-testid={`text-activity-${activity.name}`}>
                  {activity.name.replace('_', ' ')}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {activity.count}
                  </Badge>
                  <span className="text-xs text-muted-foreground w-8">
                    {activity.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}