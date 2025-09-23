import { useDropzone } from 'react-dropzone';
import { Upload, FileText, CheckCircle, AlertCircle, Plus, RotateCcw, Download } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useState } from 'react';

interface FileUploaderProps {
  onFileUpload: (data: any) => void;
  isProcessing?: boolean;
  hasExistingData?: boolean; // Whether user already has data to potentially merge with
}

export default function FileUploader({ onFileUpload, isProcessing = false, hasExistingData = false }: FileUploaderProps) {
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [fileName, setFileName] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadMode, setUploadMode] = useState<'replace' | 'merge'>('replace');

  const handleDownloadBackup = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      // Get current dataset info
      const datasetsResponse = await fetch('/api/datasets', { headers });
      const datasets = await datasetsResponse.json();
      
      if (datasets.length === 0) {
        alert('No data found to backup');
        return;
      }

      // Pick the most recent dataset (by upload date)
      const currentDataset = datasets.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())[0];
      
      // Download the current dataset as backup
      const downloadResponse = await fetch(`/api/datasets/${currentDataset.id}/download`, { headers });
      if (!downloadResponse.ok) {
        throw new Error('Failed to download backup');
      }

      const blob = await downloadResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${currentDataset.filename}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      console.log('Backup downloaded successfully');
    } catch (error) {
      console.error('Error downloading backup:', error);
      alert('Failed to download backup. Please try again.');
    }
  };

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setFileName(file.name);
    setUploadStatus('processing');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', uploadMode); // Include merge/replace mode

      const token = localStorage.getItem('authToken');
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch('/api/upload-location-history', {
        method: 'POST',
        headers: headers,
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      setUploadStatus('success');
      setUploadResult(result);
      onFileUpload(result);
      console.log('File uploaded successfully:', result.message);
    } catch (error) {
      console.error('Error uploading file:', error);
      setUploadStatus('error');
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/json': ['.json']
    },
    multiple: false,
    disabled: isProcessing
  });

  return (
    <Card className="p-6">
      {/* Upload Mode Selection - only show if user has existing data */}
      {hasExistingData && uploadStatus === 'idle' && (
        <div className="mb-6 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-medium text-sm mb-3">Upload Options</h3>
          <RadioGroup
            value={uploadMode}
            onValueChange={(value: 'replace' | 'merge') => setUploadMode(value)}
            className="space-y-3"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="replace" id="replace" />
              <Label htmlFor="replace" className="flex items-center gap-2 cursor-pointer">
                <RotateCcw className="w-4 h-4" />
                <div>
                  <div className="font-medium">Replace existing data</div>
                  <div className="text-xs text-muted-foreground">Remove all current data and upload new file</div>
                </div>
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="merge" id="merge" />
              <Label htmlFor="merge" className="flex items-center gap-2 cursor-pointer">
                <Plus className="w-4 h-4" />
                <div>
                  <div className="font-medium">Merge with existing data</div>
                  <div className="text-xs text-muted-foreground">Combine new location data with your current history</div>
                </div>
              </Label>
            </div>
            
            {/* Backup warning for merge mode */}
            {uploadMode === 'merge' && (
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs">
                    <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                      Backup Recommended
                    </p>
                    <p className="text-amber-700 dark:text-amber-300 mb-2">
                      This will modify your existing data. Consider downloading a backup first.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadBackup}
                      className="bg-white dark:bg-gray-950 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                      data-testid="button-download-backup"
                    >
                      <Download className="w-3 h-3 mr-2" />
                      Download Current Data
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </RadioGroup>
        </div>
      )}

      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive 
            ? 'border-primary bg-primary/5' 
            : uploadStatus === 'success'
            ? 'border-green-500 bg-green-500/5'
            : uploadStatus === 'error'
            ? 'border-destructive bg-destructive/5'
            : 'border-muted-foreground/25 hover:border-primary hover:bg-muted/50'
        }`}
        data-testid="dropzone-area"
      >
        <input {...getInputProps()} />
        
        <div className="space-y-4">
          {uploadStatus === 'success' ? (
            <CheckCircle className="w-12 h-12 mx-auto text-green-500" />
          ) : uploadStatus === 'error' ? (
            <AlertCircle className="w-12 h-12 mx-auto text-destructive" />
          ) : (
            <Upload className="w-12 h-12 mx-auto text-muted-foreground" />
          )}
          
          <div>
            {uploadStatus === 'processing' ? (
              <p className="text-lg font-medium">Processing {fileName}...</p>
            ) : uploadStatus === 'success' ? (
              <div className="text-left space-y-3">
                <p className="text-lg font-medium text-green-600">File Analysis Complete!</p>
                <p className="text-sm font-medium">{fileName}</p>
                
                {uploadResult?.metadata && (
                  <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="font-medium">📊 File Stats</p>
                        <p className="text-xs text-muted-foreground">
                          {uploadResult.metadata.fileSize} • {uploadResult.metadata.totalElements.toLocaleString()} elements
                        </p>
                        <p className="text-xs text-muted-foreground">
                          ~{uploadResult.metadata.estimatedPoints.toLocaleString()} GPS points estimated
                        </p>
                      </div>
                      
                      <div>
                        <p className="font-medium">📅 Date Range</p>
                        <p className="text-xs text-muted-foreground">
                          {uploadResult.metadata.dateRange?.start ? 
                            new Date(uploadResult.metadata.dateRange.start).toLocaleDateString() : 'Unknown'} 
                          {' to '}
                          {uploadResult.metadata.dateRange?.end ? 
                            new Date(uploadResult.metadata.dateRange.end).toLocaleDateString() : 'Unknown'}
                        </p>
                      </div>
                    </div>
                    
                    <div>
                      <p className="font-medium">🔍 Data Quality</p>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <p>✅ Good coordinates: {uploadResult.metadata.dataQuality?.goodProbability?.toLocaleString() || 0}</p>
                        <p>❌ Bad coordinates: {uploadResult.metadata.dataQuality?.badProbability?.toLocaleString() || 0}</p>
                        <p>📍 Movement data: {uploadResult.metadata.dataQuality?.goodDistance?.toLocaleString() || 0}</p>
                        <p>🚫 No movement: {uploadResult.metadata.dataQuality?.zeroDistance?.toLocaleString() || 0}</p>
                      </div>
                      {uploadResult.metadata.dataQuality?.totalTimelinePath > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          🗺️ Route details: {uploadResult.metadata.dataQuality.totalTimelinePath.toLocaleString()} timeline points
                        </p>
                      )}
                    </div>
                    
                    <div className="pt-2 border-t border-muted">
                      <p className="text-xs text-primary font-medium">
                        💡 Ready to analyze! Select date ranges and quality filters for processing.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : uploadStatus === 'error' ? (
              <div>
                <p className="text-lg font-medium text-destructive">Upload failed</p>
                <p className="text-sm text-muted-foreground">Please check your JSON file format</p>
              </div>
            ) : (
              <div>
                <p className="text-lg font-medium">
                  {isDragActive ? 'Drop your location history here' : 'Upload Google Location History'}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Drag and drop your JSON file here, or click to select
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supports new mobile location history format
                </p>
              </div>
            )}
          </div>
          
          {uploadStatus === 'idle' && (
            <Button variant="outline" className="mt-4" data-testid="button-upload">
              <FileText className="w-4 h-4 mr-2" />
              Choose File
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}