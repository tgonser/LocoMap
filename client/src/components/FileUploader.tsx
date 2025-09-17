import { useDropzone } from 'react-dropzone';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

interface FileUploaderProps {
  onFileUpload: (data: any) => void;
  isProcessing?: boolean;
}

export default function FileUploader({ onFileUpload, isProcessing = false }: FileUploaderProps) {
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [fileName, setFileName] = useState<string>('');

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setFileName(file.name);
    setUploadStatus('processing');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload-location-history', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      setUploadStatus('success');
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
              <div>
                <p className="text-lg font-medium text-green-600">Successfully uploaded!</p>
                <p className="text-sm text-muted-foreground">{fileName}</p>
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