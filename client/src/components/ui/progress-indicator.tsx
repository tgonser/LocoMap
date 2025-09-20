import { useEffect, useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { MapPin, Loader2 } from "lucide-react";

interface ProgressEvent {
  type: 'connected' | 'geocoding_start' | 'geocoding_progress' | 'geocoding_batch_complete' | 'completed';
  taskId?: string;
  totalLocations?: number;
  batch?: number;
  totalBatches?: number;
  batchSize?: number;
  totalProcessed?: number;
  percentage?: number;
  message?: string;
}

interface ProgressIndicatorProps {
  taskId: string | null;
  onComplete?: () => void;
  onClose?: () => void;
}

export function ProgressIndicator({ taskId, onComplete, onClose }: ProgressIndicatorProps) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("Initializing...");
  const [isVisible, setIsVisible] = useState(false);
  const [currentBatch, setCurrentBatch] = useState<number | null>(null);
  const [totalBatches, setTotalBatches] = useState<number | null>(null);
  const [totalLocations, setTotalLocations] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) return;

    // Create EventSource connection for progress updates
    const eventSource = new EventSource(`/api/progress/${taskId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('Progress connection opened');
      setIsVisible(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: ProgressEvent = JSON.parse(event.data);
        console.log('Progress update:', data);

        switch (data.type) {
          case 'connected':
            setStatus("Connected");
            break;

          case 'geocoding_start':
            setStatus(`Geocoding ${data.totalLocations} locations`);
            setTotalLocations(data.totalLocations || 0);
            setProgress(0);
            break;

          case 'geocoding_progress':
            setCurrentBatch(data.batch || null);
            setTotalBatches(data.totalBatches || null);
            setProgress(data.percentage || 0);
            setStatus(data.message || "Processing...");
            break;

          case 'geocoding_batch_complete':
            setCurrentBatch(data.batch || null);
            setTotalBatches(data.totalBatches || null);
            setProgress(data.percentage || 0);
            setStatus(data.message || "Batch completed");
            break;

          case 'completed':
            setProgress(100);
            setStatus("Analytics computation complete");
            setTimeout(() => {
              setIsVisible(false);
              onComplete?.();
            }, 1000);
            break;
        }
      } catch (error) {
        console.error('Failed to parse progress event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('Progress connection error:', error);
      eventSource.close();
      setIsVisible(false);
    };

    // Cleanup on unmount or taskId change
    return () => {
      eventSource.close();
    };
  }, [taskId, onComplete]);

  // Handle manual close
  const handleClose = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setIsVisible(false);
    onClose?.();
  };

  if (!isVisible) return null;

  return (
    <Card className="fixed top-4 right-4 w-96 z-50 shadow-lg border-primary/20" data-testid="progress-indicator">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <MapPin className="h-5 w-5 text-primary" />
            <Loader2 className="h-3 w-3 text-primary animate-spin absolute -top-1 -right-1" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-sm" data-testid="progress-title">
              Location Analysis
            </h4>
            {totalLocations && (
              <p className="text-xs text-muted-foreground">
                Processing {totalLocations.toLocaleString()} locations
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground text-sm"
            data-testid="button-close-progress"
          >
            ×
          </button>
        </div>

        <div className="space-y-3">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Progress</span>
              <span className="text-sm font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="w-full" data-testid="progress-bar" />
          </div>

          {/* Batch Information */}
          {currentBatch && totalBatches && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Batch Progress</span>
              <Badge variant="secondary" className="text-xs" data-testid={`badge-batch-${currentBatch}`}>
                {currentBatch}/{totalBatches}
              </Badge>
            </div>
          )}

          {/* Status Message */}
          <p className="text-sm text-muted-foreground leading-tight" data-testid="text-progress-status">
            {status}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}