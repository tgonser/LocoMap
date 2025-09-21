import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Upload, Trash2, Calendar, BarChart3, AlertCircle, CheckCircle, Play } from 'lucide-react';
import FileUploader from './FileUploader';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface FileMetadata {
  filename: string;
  fileSize: string;
  totalElements: number;
  estimatedPoints: number;
  dateRange?: {
    start: string | null;
    end: string | null;
  };
  dataQuality?: {
    goodProbability: number;
    badProbability: number;
    zeroDistance: number;
    goodDistance: number;
    badAccuracy: number;
    totalTimelinePath: number;
  };
  activityBreakdown?: Record<string, number>;
}

interface Dataset {
  id: string;
  filename: string;
  fileSize: number;
  totalPoints: number;
  deduplicatedPoints: number;
  uploadedAt: string;
  processedAt?: string | null;
}

interface FileManagerProps {
  onFileUpload?: (data: any) => void;
}

export default function FileManager({ onFileUpload }: FileManagerProps) {
  const [showUploader, setShowUploader] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastUploadResult, setLastUploadResult] = useState<any>(null);

  // Query to get user's datasets
  const { data: datasets, refetch: refetchDatasets, isLoading } = useQuery({
    queryKey: ['/api/datasets'],
    refetchOnWindowFocus: false,
  });

  // Check if we have any datasets
  const hasDatasets = Array.isArray(datasets) && datasets.length > 0;
  const currentDataset = hasDatasets ? datasets[0] : null; // Most recent dataset

  const handleFileUpload = async (result: any) => {
    setLastUploadResult(result);
    setShowUploader(false);
    await refetchDatasets(); // Refresh the dataset list
    if (onFileUpload) {
      onFileUpload(result);
    }
  };

  const handleDeleteFile = async () => {
    if (!currentDataset) return;
    
    const fileName = currentDataset.filename;
    setIsDeleting(true);
    try {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      
      const response = await fetch(`/api/datasets/${currentDataset.id}`, {
        method: 'DELETE',
        headers,
      });

      if (response.ok) {
        await refetchDatasets(); // Refresh the dataset list
        setLastUploadResult(null); // Clear upload result since file is deleted
        console.log('Dataset deleted successfully');
        alert(`✅ File "${fileName}" deleted successfully.\n\nYou can now upload a new location history file.`);
      } else {
        const result = await response.json();
        const errorMsg = result.error || 'Failed to delete dataset';
        console.error('Failed to delete dataset:', errorMsg);
        alert(`❌ Delete failed: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Error deleting dataset:', error);
      alert(`❌ Delete error: ${error.message || 'Network error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleProcessFile = async () => {
    if (!currentDataset || currentDataset.processedAt) return;
    
    setIsProcessing(true);
    try {
      console.log(`🚀 Starting processing for dataset ${currentDataset.id}`);
      
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      
      const response = await fetch(`/api/datasets/${currentDataset.id}/process`, {
        method: 'POST',
        headers,
      });

      const result = await response.json();

      if (response.ok && result.success) {
        console.log(`✅ Processing completed: ${result.pointsProcessed} points processed`);
        await refetchDatasets(); // Refresh the dataset list to show updated status
        await queryClient.invalidateQueries({ queryKey: ['/api/locations'] }); // Refresh location data
      } else {
        const errorMsg = result.error || result.message || 'Unknown error';
        console.error('Processing failed:', errorMsg);
        alert(`Processing failed: ${errorMsg}\n\nCheck the console for details.`);
        await refetchDatasets(); // Refresh to show current status
      }
    } catch (error) {
      console.error('Error processing dataset:', error);
      alert(`Processing error: ${error.message || 'Network error'}`);
      await refetchDatasets(); // Refresh to show current status
    } finally {
      setIsProcessing(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}MB` : `${(bytes / 1024).toFixed(1)}KB`;
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString();
  };

  // Show the metadata from the last upload result if available
  // TODO: Store metadata in database during upload for full persistence
  const metadata: FileMetadata | null = lastUploadResult?.metadata || null;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading file information...</p>
        </div>
      </div>
    );
  }

  if (showUploader) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl mx-auto">
          <div className="text-center mb-6">
            <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-2xl font-semibold mb-2">
              Upload Location History
            </h2>
            <p className="text-muted-foreground">
              Select your Google location history JSON file to analyze your travels
            </p>
            <Button 
              variant="outline" 
              onClick={() => setShowUploader(false)} 
              className="mt-4"
              data-testid="button-cancel-upload"
            >
              Cancel
            </Button>
          </div>
          <FileUploader onFileUpload={handleFileUpload} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-2xl font-semibold mb-2">File Management</h2>
          <p className="text-muted-foreground">
            Manage your location history files and view analysis details
          </p>
        </div>

        {/* Current File Info or Upload Prompt */}
        {hasDatasets ? (
          <div className="space-y-6">
            {/* File Info Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                    <CardTitle className="text-lg">Current File</CardTitle>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowUploader(true)}
                      data-testid="button-upload-new"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Upload New
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteFile}
                      disabled={isDeleting}
                      data-testid="button-delete-file"
                    >
                      {isDeleting ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">File Details</p>
                    <p className="font-semibold">{currentDataset.filename}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(currentDataset.fileSize)} • Uploaded {formatDate(currentDataset.uploadedAt)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {currentDataset.totalPoints.toLocaleString()} total points
                      {currentDataset.processedAt && ` • ${currentDataset.deduplicatedPoints.toLocaleString()} processed`}
                    </p>
                  </div>
                  
                  <div>
                    <p className="font-medium text-sm text-muted-foreground">Status</p>
                    <div className="flex items-center gap-2 mt-1">
                      {currentDataset.processedAt ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-sm font-medium text-green-600">Processed</span>
                        </>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium text-orange-600">Ready to Process</span>
                          </div>
                          <Button
                            onClick={handleProcessFile}
                            disabled={isProcessing}
                            size="sm"
                            variant="default"
                            data-testid="button-process-dataset"
                          >
                            {isProcessing ? (
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
                            ) : (
                              <Play className="w-4 h-4 mr-2" />
                            )}
                            {isProcessing ? 'Processing...' : 'Process'}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Smart Upload Analysis (if available from last upload) */}
            {metadata && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    File Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="font-medium text-sm text-muted-foreground mb-2">📊 Data Summary</p>
                      <div className="space-y-1 text-sm">
                        <p><span className="font-medium">{metadata.totalElements.toLocaleString()}</span> total elements</p>
                        <p><span className="font-medium">~{metadata.estimatedPoints.toLocaleString()}</span> GPS points estimated</p>
                        {(metadata.dataQuality?.totalTimelinePath || 0) > 0 && (
                          <p><span className="font-medium">{(metadata.dataQuality?.totalTimelinePath || 0).toLocaleString()}</span> route timeline points</p>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <p className="font-medium text-sm text-muted-foreground mb-2">📅 Date Range</p>
                      <div className="text-sm">
                        <p>
                          <Calendar className="w-4 h-4 inline mr-1" />
                          {formatDate(metadata.dateRange?.start)} to {formatDate(metadata.dateRange?.end)}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {metadata.dataQuality && (
                    <div className="mt-6">
                      <p className="font-medium text-sm text-muted-foreground mb-3">🔍 Data Quality Analysis</p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                          <p className="text-sm font-medium text-green-600">
                            {(metadata.dataQuality.goodProbability || 0).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">Good Coordinates</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-red-600">
                            {(metadata.dataQuality.badProbability || 0).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">Poor Coordinates</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-blue-600">
                            {(metadata.dataQuality.goodDistance || 0).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">Movement Data</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-orange-600">
                            {(metadata.dataQuality.zeroDistance || 0).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground">No Movement</p>
                        </div>
                      </div>
                      
                      <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                        <p className="text-sm text-primary font-medium">
                          💡 Quality Summary: {Math.round(((metadata.dataQuality.goodProbability || 0) / metadata.totalElements) * 100)}% of your data has good coordinate accuracy. 
                          Consider filtering out poor quality points during processing for better results.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            
            {/* Next Steps */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Next Steps</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg">
                    <h4 className="font-medium flex items-center gap-2 mb-2">
                      <BarChart3 className="w-4 h-4" />
                      Run Analytics
                    </h4>
                    <p className="text-sm text-muted-foreground mb-3">
                      Process your data for a specific date range and generate travel analytics with quality filtering.
                    </p>
                    <Badge variant="secondary">Recommended</Badge>
                  </div>
                  
                  <div className="p-4 border rounded-lg opacity-75">
                    <h4 className="font-medium flex items-center gap-2 mb-2">
                      <Upload className="w-4 h-4" />
                      Upload New File
                    </h4>
                    <p className="text-sm text-muted-foreground mb-3">
                      Replace your current file with a different location history export.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setShowUploader(true)} data-testid="button-upload-another">
                      Upload New
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* No files - show upload prompt */
          <Card>
            <CardContent className="pt-8 pb-8">
              <div className="text-center">
                <Upload className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Files Uploaded</h3>
                <p className="text-muted-foreground mb-6">
                  Upload your Google location history file to get started with analysis and visualization.
                </p>
                <Button onClick={() => setShowUploader(true)} size="lg" data-testid="button-first-upload">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Location History
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}