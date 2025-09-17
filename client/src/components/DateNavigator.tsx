import { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface DateNavigatorProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  availableDates?: Date[];
  locationCount?: number;
}

export default function DateNavigator({ 
  selectedDate, 
  onDateChange, 
  availableDates = [], 
  locationCount = 0 
}: DateNavigatorProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);

  const goToPreviousDay = () => {
    const previousDay = new Date(selectedDate);
    previousDay.setDate(selectedDate.getDate() - 1);
    onDateChange(previousDay);
    console.log('Navigate to previous day:', previousDay.toDateString());
  };

  const goToNextDay = () => {
    const nextDay = new Date(selectedDate);
    nextDay.setDate(selectedDate.getDate() + 1);
    onDateChange(nextDay);
    console.log('Navigate to next day:', nextDay.toDateString());
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const hasDataForDate = (date: Date) => {
    return availableDates.some(d => 
      d.toDateString() === date.toDateString()
    );
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={goToPreviousDay}
          data-testid="button-previous-day"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <div className="flex-1 text-center space-y-2">
          <div 
            className="flex items-center justify-center gap-2 cursor-pointer hover-elevate rounded-md p-2"
            onClick={() => setShowDatePicker(!showDatePicker)}
            data-testid="button-date-picker"
          >
            <Calendar className="w-4 h-4" />
            <span className="font-medium text-sm md:text-base">
              {formatDate(selectedDate)}
            </span>
          </div>
          
          <div className="flex items-center justify-center gap-2">
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
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={goToNextDay}
          data-testid="button-next-day"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {showDatePicker && (
        <div className="mt-4 flex justify-center">
          <div className="bg-card border rounded-lg p-4 shadow-lg">
            <DatePicker
              selected={selectedDate}
              onChange={(date: Date | null) => {
                if (date) {
                  onDateChange(date);
                  setShowDatePicker(false);
                  console.log('Date selected:', date.toDateString());
                }
              }}
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