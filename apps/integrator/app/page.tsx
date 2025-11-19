"use client";

import { useState, useRef } from "react";
import Image from "next/image";

interface UploadedFile {
  path: string;
  publicUrl: string;
  message: string;
}

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
      setUploadedFile(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please select a file first");
      return;
    }

    setUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("bucket", "avatars"); // Change to your bucket name

      // Simulate upload progress (in a real app, use XMLHttpRequest for progress)
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch("/api/storage/upload", {
        method: "POST",
        body: formData
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      const result = await response.json();

      if (response.ok && result.success) {
        setUploadedFile(result.data);
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } else {
        setError(result.error || "Failed to upload file");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  const isImage = (filename: string) => {
    return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-8 py-16 px-8 bg-white dark:bg-black">
        <div className="flex flex-col items-center gap-4 text-center">
          <Image className="dark:invert" src="/next.svg" alt="Next.js logo" width={120} height={24} priority />
          <h1 className="text-4xl font-bold tracking-tight text-black dark:text-zinc-50">File Storage Demo</h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-md">
            Upload files to Supabase Storage using the storage API
          </p>
        </div>

        {/* Upload Section */}
        <div className="w-full max-w-md space-y-4">
          {/* File Input */}
          <div className="flex flex-col gap-2">
            <label htmlFor="file-upload" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Choose a file
            </label>
            <input
              ref={fileInputRef}
              id="file-upload"
              type="file"
              onChange={handleFileSelect}
              disabled={uploading}
              className="block w-full text-sm text-zinc-500 dark:text-zinc-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-full file:border-0
                file:text-sm file:font-semibold
                file:bg-zinc-900 file:text-zinc-50
                dark:file:bg-zinc-50 dark:file:text-zinc-900
                hover:file:bg-zinc-700 dark:hover:file:bg-zinc-200
                file:cursor-pointer cursor-pointer
                disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {selectedFile && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* Upload Button */}
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="w-full flex items-center justify-center gap-2 rounded-full bg-zinc-900 dark:bg-zinc-50 px-6 py-3 text-base font-semibold text-white dark:text-zinc-900 transition-colors hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <svg
                  className="animate-spin h-5 w-5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Uploading... {uploadProgress}%
              </>
            ) : (
              <>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                Upload File
              </>
            )}
          </button>

          {/* Progress Bar */}
          {uploading && uploadProgress > 0 && (
            <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-zinc-900 dark:bg-zinc-50 h-2 transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-200 font-medium">❌ {error}</p>
            </div>
          )}

          {/* Success Message */}
          {uploadedFile && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 space-y-3">
              <p className="text-sm text-green-800 dark:text-green-200 font-medium">✅ {uploadedFile.message}</p>
              <div className="space-y-2">
                <p className="text-xs text-green-700 dark:text-green-300 font-mono break-all">
                  Path: {uploadedFile.path}
                </p>
                {isImage(uploadedFile.path) && (
                  <div className="mt-3 rounded-lg overflow-hidden border border-green-200 dark:border-green-800">
                    <Image
                      src={uploadedFile.publicUrl}
                      alt="Uploaded file"
                      width={600}
                      height={400}
                      className="w-full h-auto"
                      unoptimized
                    />
                  </div>
                )}
                <a
                  href={uploadedFile.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-300 hover:underline"
                >
                  View file
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Info Section */}
        <div className="text-center text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
          <p>
            This demo uses the{" "}
            <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-xs">
              POST /api/storage/upload
            </code>{" "}
            endpoint to store files in Supabase Storage.
          </p>
        </div>
      </main>
    </div>
  );
}
