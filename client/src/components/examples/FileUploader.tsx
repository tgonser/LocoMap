import FileUploader from '../FileUploader';

export default function FileUploaderExample() {
  const handleFileUpload = (data: any) => {
    console.log('File uploaded with data:', data);
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <FileUploader onFileUpload={handleFileUpload} />
    </div>
  );
}