import { useState, useEffect } from 'react';
import { Calendar, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DateRange } from 'react-day-picker';

export interface DateRangePickerProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback to set the open state */
  setOpen: (open: boolean) => void;
  /** Callback called when user confirms date range selection */
  onConfirm: (startDate: Date, endDate: Date) => void;
  /** Callback called when user cancels */
  onCancel: () => void;
  /** Optional default start date */
  defaultStartDate?: Date;
  /** Optional default end date */
  defaultEndDate?: Date;
  /** Optional minimum selectable date */
  minDate?: Date;
  /** Optional maximum selectable date */
  maxDate?: Date;
  /** Optional title for the dialog */
  title?: string;
  /** Optional description for the dialog */
  description?: string;
}

export default function DateRangePicker({
  open,
  setOpen,
  onConfirm,
  onCancel,
  defaultStartDate,
  defaultEndDate,
  minDate,
  maxDate,
  title = "Select Date Range",
  description = "Choose the date range for loading location data."
}: DateRangePickerProps) {
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>(undefined);
  const [validationError, setValidationError] = useState<string>('');

  // Helper function to normalize a date to start of day (00:00:00.000)
  const normalizeToStartOfDay = (date: Date): Date => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  };

  // Helper function to normalize a date to end of day (23:59:59.999)
  const normalizeToEndOfDay = (date: Date): Date => {
    const normalized = new Date(date);
    normalized.setHours(23, 59, 59, 999);
    return normalized;
  };

  // Helper function to clamp a date to min/max bounds
  const clampDate = (date: Date, min?: Date, max?: Date): Date => {
    let clamped = new Date(date);
    if (min && clamped < min) clamped = new Date(min);
    if (max && clamped > max) clamped = new Date(max);
    return clamped;
  };

  // Initialize default dates when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedRange(
        defaultStartDate && defaultEndDate
          ? { from: defaultStartDate, to: defaultEndDate }
          : undefined
      );
      setValidationError('');
    }
  }, [open, defaultStartDate, defaultEndDate]);

  // Validate date range
  const validateDateRange = (range: DateRange | undefined): string => {
    if (!range?.from || !range?.to) {
      return 'Please select both start and end dates';
    }

    if (range.from > range.to) {
      return 'Start date must be before or equal to end date';
    }

    if (minDate && range.from < minDate) {
      return `Start date cannot be before ${minDate.toLocaleDateString()}`;
    }

    if (maxDate && range.to > maxDate) {
      return `End date cannot be after ${maxDate.toLocaleDateString()}`;
    }

    // Check if range is too large (more than 2 years)
    const daysDiff = Math.ceil((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff > 730) {
      return 'Date range cannot exceed 2 years';
    }

    return '';
  };

  // Handle date range selection
  const handleRangeSelect = (range: DateRange | undefined) => {
    if (!range) {
      setSelectedRange(undefined);
      setValidationError('');
      return;
    }

    setSelectedRange(range);

    // Validate and set error if any
    const error = validateDateRange(range);
    setValidationError(error);
  };

  // Handle confirm button click
  const handleConfirm = () => {
    if (selectedRange?.from && selectedRange?.to) {
      const error = validateDateRange(selectedRange);
      if (error) {
        setValidationError(error);
        return;
      }

      // Normalize dates before calling onConfirm to ensure consistent backend filtering
      const normalizedStartDate = normalizeToStartOfDay(selectedRange.from);
      const normalizedEndDate = normalizeToEndOfDay(selectedRange.to);
      
      onConfirm(normalizedStartDate, normalizedEndDate);
      setOpen(false);
    }
  };

  // Handle cancel/close
  const handleCancel = () => {
    setSelectedRange(undefined);
    setValidationError('');
    onCancel();
    setOpen(false);
  };

  // Check if Load Data button should be enabled
  const isLoadDataEnabled = Boolean(selectedRange?.from && selectedRange?.to && !validationError);

  // Format date range for display
  const formatDateRange = () => {
    if (!selectedRange?.from || !selectedRange?.to) return 'No dates selected';
    
    if (selectedRange.from.toDateString() === selectedRange.to.toDateString()) {
      return selectedRange.from.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }

    return `${selectedRange.from.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })} - ${selectedRange.to.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })}`;
  };

  // Calculate number of days selected
  const getDaysCount = (): number => {
    if (!selectedRange?.from || !selectedRange?.to) return 0;
    return Math.ceil((selectedRange.to.getTime() - selectedRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  };

  // Handle dialog open/close changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && open) {
      // Dialog is closing, call onCancel to sync state
      handleCancel();
    } else {
      setOpen(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} data-testid="dialog-date-range-picker">
      <DialogContent className="max-w-md w-full sm:max-w-lg" data-testid="content-date-range-picker">
        <DialogHeader className="pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold" data-testid="title-date-range-picker">
            <CalendarDays className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground" data-testid="description-date-range-picker">
            {description}
          </DialogDescription>
        </DialogHeader>

        {/* Calendar */}
        <div className="space-y-4">
          <Card className="p-4">
            <CalendarComponent
              mode="range"
              selected={selectedRange}
              onSelect={handleRangeSelect}
              disabled={(date) => {
                if (minDate && date < minDate) return true;
                if (maxDate && date > maxDate) return true;
                return false;
              }}
              numberOfMonths={1}
              className="w-full"
              data-testid="calendar-date-range"
            />
          </Card>

          {/* Selected Range Display */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Selected Range:</span>
              <Badge 
                variant={isLoadDataEnabled ? "default" : "secondary"}
                data-testid="badge-selected-range"
              >
                {getDaysCount() > 0 ? `${getDaysCount()} day${getDaysCount() === 1 ? '' : 's'}` : 'None'}
              </Badge>
            </div>
            <div 
              className={cn(
                "text-sm p-3 rounded-md border",
                isLoadDataEnabled ? "bg-accent/10 border-accent" : "bg-muted/50 border-border"
              )}
              data-testid="text-date-range-display"
            >
              {formatDateRange()}
            </div>
          </div>

          {/* Validation Error */}
          {validationError && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md" data-testid="error-validation">
              {validationError}
            </div>
          )}

          {/* Quick Selection Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                
                // Get exactly 7 days by subtracting 6 days from today
                let startDate = new Date(today);
                startDate.setDate(today.getDate() - 6);
                startDate = normalizeToStartOfDay(startDate);
                
                let endDate = normalizeToEndOfDay(today);
                
                // Clamp dates to min/max bounds if provided
                if (minDate || maxDate) {
                  startDate = clampDate(startDate, minDate, maxDate);
                  endDate = clampDate(endDate, minDate, maxDate);
                }
                
                handleRangeSelect({ from: startDate, to: endDate });
              }}
              data-testid="button-last-week"
            >
              Last 7 days
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const today = new Date();
                
                // Get exactly 30 days by subtracting 29 days from today
                let startDate = new Date(today);
                startDate.setDate(today.getDate() - 29);
                startDate = normalizeToStartOfDay(startDate);
                
                let endDate = normalizeToEndOfDay(today);
                
                // Clamp dates to min/max bounds if provided
                if (minDate || maxDate) {
                  startDate = clampDate(startDate, minDate, maxDate);
                  endDate = clampDate(endDate, minDate, maxDate);
                }
                
                handleRangeSelect({ from: startDate, to: endDate });
              }}
              data-testid="button-last-month"
            >
              Last 30 days
            </Button>
          </div>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="flex-col sm:flex-row gap-2 pt-4">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="w-full sm:w-auto"
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isLoadDataEnabled}
            className="w-full sm:w-auto"
            data-testid="button-load-data"
          >
            <Calendar className="w-4 h-4 mr-2" />
            Load Data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}