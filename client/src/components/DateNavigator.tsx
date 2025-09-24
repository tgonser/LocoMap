import { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

interface DateNavigatorProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  availableDates?: Date[];
  locationCount?: number;
  selectedDateRange?: { start: Date; end: Date } | null;
}

export default function DateNavigator({ 
  selectedDate, 
  onDateChange, 
  availableDates = [], 
  locationCount = 0,
  selectedDateRange = null
}: DateNavigatorProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const { toast } = useToast();

  // Date normalization helper function - strips time components for accurate date-only comparisons
  const toZeroTime = (date: Date): Date => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  };

  // Date clamping helper function
  const clampDateToRange = (date: Date): Date => {
    if (!selectedDateRange) return date;
    
    const normalizedDate = toZeroTime(date);
    const normalizedStart = toZeroTime(selectedDateRange.start);
    const normalizedEnd = toZeroTime(selectedDateRange.end);
    
    if (normalizedDate < normalizedStart) {
      toast({
        title: "Date adjusted",
        description: `Selected date was before the allowed range. Moved to ${selectedDateRange.start.toLocaleDateString()}.`,
        variant: "default"
      });
      return new Date(selectedDateRange.start);
    }
    
    if (normalizedDate > normalizedEnd) {
      toast({
        title: "Date adjusted",
        description: `Selected date was after the allowed range. Moved to ${selectedDateRange.end.toLocaleDateString()}.`,
        variant: "default"
      });
      return new Date(selectedDateRange.end);
    }
    
    return date;
  };

  const goToPreviousDay = () => {
    const previousDay = new Date(selectedDate);
    previousDay.setDate(selectedDate.getDate() - 1);
    const clampedDate = clampDateToRange(previousDay);
    onDateChange(clampedDate);
    console.log('Navigate to previous day:', clampedDate.toDateString());
  };

  const goToNextDay = () => {
    const nextDay = new Date(selectedDate);
    nextDay.setDate(selectedDate.getDate() + 1);
    const clampedDate = clampDateToRange(nextDay);
    onDateChange(clampedDate);
    console.log('Navigate to next day:', clampedDate.toDateString());
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit'
    });
  };

  const hasDataForDate = (date: Date) => {
    return availableDates.some(d => 
      d.toDateString() === date.toDateString()
    );
  };

  // Range restriction helper functions - using normalized dates for accurate comparisons
  const isDateOutsideRange = (date: Date): boolean => {
    if (!selectedDateRange) return false;
    const normalizedDate = toZeroTime(date);
    const normalizedStart = toZeroTime(selectedDateRange.start);
    const normalizedEnd = toZeroTime(selectedDateRange.end);
    return normalizedDate < normalizedStart || normalizedDate > normalizedEnd;
  };

  const canNavigateToPrevious = (): boolean => {
    if (!selectedDateRange) return true;
    const previousDay = new Date(selectedDate);
    previousDay.setDate(selectedDate.getDate() - 1);
    const normalizedPrevious = toZeroTime(previousDay);
    const normalizedStart = toZeroTime(selectedDateRange.start);
    return normalizedPrevious >= normalizedStart;
  };

  const canNavigateToNext = (): boolean => {
    if (!selectedDateRange) return true;
    const nextDay = new Date(selectedDate);
    nextDay.setDate(selectedDate.getDate() + 1);
    const normalizedNext = toZeroTime(nextDay);
    const normalizedEnd = toZeroTime(selectedDateRange.end);
    return normalizedNext <= normalizedEnd;
  };

  const formatDateRange = (): string => {
    if (!selectedDateRange) return '';
    const startStr = selectedDateRange.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = selectedDateRange.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startStr} - ${endStr}`;
  };

  return (
    <Card className="p-4 w-full max-w-none">
      <div className="flex items-center gap-3 w-full">
        <div className="flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousDay}
            disabled={!canNavigateToPrevious()}
            title={!canNavigateToPrevious() ? "Cannot navigate before selected date range" : "Previous day"}
            data-testid="button-previous-day"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 min-w-0 text-center space-y-2">
          <div 
            className="flex items-center justify-center gap-2 cursor-pointer hover-elevate rounded-md p-2"
            onClick={() => setShowDatePicker(!showDatePicker)}
            data-testid="button-date-picker"
          >
            <Calendar className="w-4 h-4" />
            <span className="font-medium text-sm md:text-base truncate">
              {formatDate(selectedDate)}
            </span>
          </div>
          
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Badge 
              variant={locationCount > 0 ? "default" : "secondary"}
              className="text-xs"
              data-testid="text-location-count"
            >
              {locationCount} locations
            </Badge>
            
            {hasDataForDate(selectedDate) && (
              <Badge variant="outline" className="text-xs">
                Data available
              </Badge>
            )}
          </div>
          
          {/* Show warning when outside selected date range */}
          {isDateOutsideRange(selectedDate) && selectedDateRange && (
            <div className="mt-2">
              <Badge variant="destructive" className="text-xs" data-testid="text-outside-range-warning">
                Outside selected range ({formatDateRange()})
              </Badge>
            </div>
          )}
        </div>

        <div className="flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={goToNextDay}
            disabled={!canNavigateToNext()}
            title={!canNavigateToNext() ? "Cannot navigate after selected date range" : "Next day"}
            data-testid="button-next-day"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {showDatePicker && (
        <div className="mt-4 flex justify-center">
          <div className="bg-card border rounded-lg p-4 shadow-lg">
            <DatePicker
              selected={selectedDate}
              onChange={(date: Date | null) => {
                if (date) {
                  const clampedDate = clampDateToRange(date);
                  onDateChange(clampedDate);
                  setShowDatePicker(false);
                  console.log('Date selected:', clampedDate.toDateString());
                }
              }}
              minDate={selectedDateRange?.start}
              maxDate={selectedDateRange?.end}
              includeDates={availableDates.length > 0 ? availableDates : undefined}
              highlightDates={availableDates}
              inline
              data-testid="date-picker-calendar"
            />
          </div>
        </div>
      )}
    </Card>
  );
}