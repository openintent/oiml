/**
 * Storage-related type definitions
 */

export interface FileUploadRequest {
  bucket: string;
  folder?: string;
  userId?: string;
}

export interface FileUploadResponse {
  success: boolean;
  data?: {
    path: string;
    publicUrl: string;
    message: string;
  };
  error?: string;
}

export interface FileDownloadRequest {
  bucket: string;
  path: string;
}

export interface FileDeleteRequest {
  bucket: string;
  paths: string[];
}

export interface FileDeleteResponse {
  success: boolean;
  data?: {
    deletedFiles: FileObject[];
    message: string;
  };
  error?: string;
}

export interface FileListRequest {
  bucket: string;
  path?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface FileListResponse {
  success: boolean;
  data?: {
    files: FileObject[];
    message: string;
  };
  error?: string;
}

export interface FileObject {
  id: string;
  name: string;
  bucket_id: string;
  owner?: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  metadata: FileMetadata;
}

export interface FileMetadata {
  eTag: string;
  size: number;
  mimetype: string;
  cacheControl: string;
  lastModified: string;
  contentLength: number;
  httpStatusCode: number;
}

export interface ImageTransformOptions {
  width?: number;
  height?: number;
  resize?: "cover" | "contain" | "fill";
  quality?: number;
  format?: "origin" | "webp" | "avif";
}

export interface BucketConfig {
  name: string;
  public: boolean;
  fileSizeLimit?: number;
  allowedMimeTypes?: string[];
}

/**
 * Common MIME types for validation
 */
export const MIME_TYPES = {
  // Images
  PNG: "image/png",
  JPEG: "image/jpeg",
  JPG: "image/jpg",
  GIF: "image/gif",
  WEBP: "image/webp",
  SVG: "image/svg+xml",

  // Documents
  PDF: "application/pdf",
  DOC: "application/msword",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  XLS: "application/vnd.ms-excel",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PPT: "application/vnd.ms-powerpoint",
  PPTX: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  TXT: "text/plain",

  // Archives
  ZIP: "application/zip",
  RAR: "application/x-rar-compressed",

  // Video
  MP4: "video/mp4",
  WEBM: "video/webm",
  MOV: "video/quicktime",

  // Audio
  MP3: "audio/mpeg",
  WAV: "audio/wav",
  OGG: "audio/ogg"
} as const;

/**
 * File size limits (in bytes)
 */
export const FILE_SIZE_LIMITS = {
  AVATAR: 5 * 1024 * 1024, // 5MB
  IMAGE: 10 * 1024 * 1024, // 10MB
  DOCUMENT: 50 * 1024 * 1024, // 50MB
  VIDEO: 500 * 1024 * 1024, // 500MB
  MAX: 1024 * 1024 * 1024 // 1GB
} as const;
