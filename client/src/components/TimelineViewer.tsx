import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock, MapPin, Activity } from 'lucide-react';

interface TimelineEvent {
  timestamp: Date;
  location: {
    lat: number;
    lng: number;
    address?: string;
  };
  activity?: string;
  duration?: number; // minutes
  accuracy?: number;
}

interface TimelineViewerProps {
  events: TimelineEvent[];
  selectedDate: Date;
  onEventClick?: (lat: number, lng: number) => void;
}

export default function TimelineViewer({ events, selectedDate, onEventClick }: TimelineViewerProps) {
  // Filter events for selected date and sort by time
  const dayEvents = events
    .filter(event => 
      event.timestamp.toDateString() === selectedDate.toDateString()
    )
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const getActivityIcon = (activity?: string) => {
    switch (activity) {
      case 'still':
        return '🏠';
      case 'walking':
        return '🚶';
      case 'in_vehicle':
        return '🚗';
      case 'on_bicycle':
        return '🚴';
      case 'running':
        return '🏃';
      default:
        return '📍';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Timeline
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {selectedDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          })}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Click items to locate on map
        </p>
      </CardHeader>
      
      <CardContent>
        {dayEvents.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No location data for this date</p>
          </div>
        ) : (
          <ScrollArea className="h-64">
            <div className="space-y-4">
              {dayEvents.map((event, index) => (
                <div 
                  key={index}
                  className="flex gap-3 p-3 rounded-lg bg-muted/30 hover-elevate cursor-pointer transition-all"
                  data-testid={`timeline-event-${index}`}
                  onClick={() => onEventClick?.(event.location.lat, event.location.lng)}
                  title="Click to view on map"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-xs">
                      {getActivityIcon(event.activity)}
                    </span>
                  </div>
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">
                        {formatTime(event.timestamp)}
                      </span>
                      <div className="flex gap-2">
                        {event.activity && (
                          <Badge variant="outline" className="text-xs">
                            <Activity className="w-3 h-3 mr-1" />
                            {event.activity.replace('_', ' ')}
                          </Badge>
                        )}
                        {event.duration && (
                          <Badge variant="secondary" className="text-xs">
                            {formatDuration(event.duration)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      {event.location?.address ? (
                        <p className="text-sm text-muted-foreground">
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {event.location.address}
                        </p>
                      ) : (
                        <p className="text-xs font-mono text-muted-foreground">
                          <MapPin className="w-3 h-3 inline mr-1" />
                          {event.location?.lat?.toFixed(6) || 'N/A'}, {event.location?.lng?.toFixed(6) || 'N/A'}
                        </p>
                      )}
                      
                      {event.accuracy && (
                        <p className="text-xs text-muted-foreground">
                          ±{event.accuracy}m accuracy
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}