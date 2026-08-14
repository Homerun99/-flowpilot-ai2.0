import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useCallback, useEffect } from "react";

export const Route = createFileRoute("/client/upload")({
  component: ClientUpload,
});

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/calendar",
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
];

const EXTENSION_LABELS: Record<string, string> = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".csv": "CSV",
  ".ics": "ICS",
  ".txt": "TXT",
  ".md": "MD",
  ".png": "PNG",
  ".jpg": "JPG",
  ".jpeg": "JPG",
};

type FileStatus = "pending" | "uploading" | "success" | "error";

type UploadFile = {
  file: File;
  id: string;
  status: FileStatus;
  progress: number;
  error?: string;
};

function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "📄";
    case "docx":
    case "doc":
      return "📝";
    case "csv":
      return "📊";
    case "ics":
      return "📅";
    case "txt":
      return "📃";
    case "md":
      return "📋";
    case "png":
    case "jpg":
    case "jpeg":
      return "🖼️";
    default:
      return "📎";
  }
}

function getFileTypeLabel(filename: string): string {
  const ext = "." + (filename.split(".").pop()?.toLowerCase() || "");
  return EXTENSION_LABELS[ext] || ext.replace(".", "").toUpperCase();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ClientUpload() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [allDone, setAllDone] = useState(false);

  // Get workspace from URL search params
  const workspaceId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("workspace") || "ws_demo"
      : "ws_demo";

  // Accept files and convert to UploadFile objects
  const addFiles = useCallback(
    (newFiles: FileList | File[]) => {
      const incoming = Array.from(newFiles).filter((f) =>
        ACCEPTED_TYPES.includes(f.type)
      );
      if (incoming.length === 0) return;

      const uploadFiles: UploadFile[] = incoming.map((file) => ({
        file,
        id: crypto.randomUUID(),
        status: "pending" as FileStatus,
        progress: 0,
      }));

      setFiles((prev) => [...prev, ...uploadFiles]);
    },
    []
  );

  // Drag-and-drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  // Click to browse
  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  // Remove a file
  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Upload a single file with simulated progress
  const uploadFile = async (uf: UploadFile): Promise<UploadFile> => {
    // Simulate progress before the real API call
    return new Promise((resolve) => {
      let progress = 0;
      const interval = setInterval(() => {
        progress += Math.random() * 30 + 10;
        if (progress >= 90) {
          progress = 90;
          clearInterval(interval);
        }
        setFiles((prev) =>
          prev.map((f) => (f.id === uf.id ? { ...f, progress: Math.min(progress, 90), status: "uploading" } : f))
        );
      }, 300);

      // After a short delay, POST to the API
      setTimeout(async () => {
        clearInterval(interval);

        // Update to 90% while API call is in flight
        setFiles((prev) =>
          prev.map((f) =>
            f.id === uf.id ? { ...f, progress: 90, status: "uploading" } : f
          )
        );

        try {
          const formData = new FormData();
          formData.append("file", uf.file);
          formData.append("workspace", workspaceId);

          const resp = await fetch("/api/upload-document", {
            method: "POST",
            body: formData,
          });

          if (!resp.ok) {
            throw new Error(`Upload failed: ${resp.statusText}`);
          }

          resolve({ ...uf, progress: 100, status: "success" });
        } catch (err) {
          resolve({
            ...uf,
            progress: 100,
            status: "error",
            error: err instanceof Error ? err.message : "Upload failed",
          });
        }
      }, 1500);
    });
  };

  // Upload all pending files
  const handleUploadAll = async () => {
    const pending = files.filter((f) => f.status === "pending" || f.status === "error");
    if (pending.length === 0) {
      // All done, redirect
      navigate({ to: "/dashboard", search: { workspace: workspaceId } });
      return;
    }

    setUploading(true);

    // Upload sequentially
    for (const uf of pending) {
      // Reset to pending before upload
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uf.id ? { ...f, status: "uploading", progress: 0, error: undefined } : f
        )
      );

      const result = await uploadFile(uf);
      setFiles((prev) => prev.map((f) => (f.id === result.id ? result : f)));
    }

    setUploading(false);

    // Check if all are done
    const currentFiles = files.filter(
      (f) => f.status === "pending" || f.status === "error"
    );
    if (currentFiles.length <= pending.length) {
      setAllDone(true);
    }
  };

  // Check all-done state when files change
  useEffect(() => {
    if (files.length > 0 && files.every((f) => f.status === "success")) {
      setAllDone(true);
      setUploading(false);
    }
  }, [files]);

  const pendingCount = files.filter(
    (f) => f.status === "pending" || f.status === "error"
  ).length;
  const successCount = files.filter((f) => f.status === "success").length;
  const hasFiles = files.length > 0;

  return (
    <div className="min-h-dvh bg-gray-50 dark:bg-gray-950">
      <header className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-indigo-600">FlowPilot AI</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">Step 3 of 4</span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 mb-4 text-2xl">
            📚
          </span>
          <h1 className="text-2xl font-bold tracking-tight">
            Upload Your Business Knowledge
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
            Help your AI employees learn your business. Upload documents,
            calendars, PDFs, and more.
          </p>
        </div>

        {/* Success state */}
        {allDone && files.length > 0 && (
          <div className="rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 border border-emerald-200 dark:border-emerald-800 p-8 text-center mb-6">
            <span className="text-3xl">🎉</span>
            <h2 className="text-xl font-bold mt-3">All files uploaded!</h2>
            <p className="text-gray-500 dark:text-gray-400 mt-2">
              {successCount} file{successCount !== 1 ? "s" : ""} uploaded
              successfully. Your AI employees will process them shortly.
            </p>
            <Link
              to="/dashboard"
              search={{ workspace: workspaceId }}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors mt-4"
            >
              Continue to Onboarding
              <span>→</span>
            </Link>
          </div>
        )}

        {/* Drag-and-drop zone */}
        {!allDone && (
          <div
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleBrowseClick}
            className={`relative rounded-xl border-2 border-dashed p-12 text-center transition-all cursor-pointer ${
              isDragging
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-500"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES.join(",")}
              onChange={handleFileInputChange}
              className="hidden"
            />

            {/* File type icons row */}
            <div className="flex items-center justify-center gap-3 mb-4">
              {["📄", "📝", "📊", "📅", "🖼️", "📋"].map((icon) => (
                <span key={icon} className="text-2xl opacity-70">
                  {icon}
                </span>
              ))}
            </div>

            <p className="text-lg font-medium text-gray-700 dark:text-gray-300">
              Drop files here or click to browse
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
              PDF, DOCX, CSV, ICS, TXT, MD, PNG, JPG — up to 10MB each
            </p>
          </div>
        )}

        {/* File list */}
        {hasFiles && !allDone && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-500">
                {files.length} file{files.length !== 1 ? "s" : ""} selected
                {successCount > 0 && (
                  <span className="text-emerald-600 ml-1">
                    ({successCount} uploaded)
                  </span>
                )}
              </h3>
            </div>

            {files.map((uf) => (
              <div
                key={uf.id}
                className={`rounded-xl border p-4 transition-all ${
                  uf.status === "success"
                    ? "border-emerald-200 bg-emerald-50/30 dark:bg-emerald-950/20 dark:border-emerald-800"
                    : uf.status === "error"
                      ? "border-red-200 bg-red-50/30 dark:bg-red-950/20 dark:border-red-800"
                      : "border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-700"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* File icon */}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-lg">
                    {getFileIcon(uf.file.name)}
                  </span>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {uf.file.name}
                      </p>
                      <span className="shrink-0 text-[10px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                        {getFileTypeLabel(uf.file.name)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatFileSize(uf.file.size)}
                    </p>

                    {/* Progress bar */}
                    {uf.status === "uploading" && (
                      <div className="mt-2">
                        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                            style={{ width: `${uf.progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Status */}
                  <div className="shrink-0 flex items-center gap-2">
                    {uf.status === "success" && (
                      <span className="text-emerald-600 text-sm font-medium">
                        ✅ Uploaded
                      </span>
                    )}
                    {uf.status === "uploading" && (
                      <span className="text-indigo-600 text-sm font-medium animate-pulse">
                        Uploading...
                      </span>
                    )}
                    {uf.status === "error" && (
                      <span className="text-red-600 text-sm font-medium">
                        ⚠️ Failed
                      </span>
                    )}

                    {/* Remove button (only when pending) */}
                    {uf.status === "pending" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(uf.id);
                        }}
                        className="text-gray-400 hover:text-red-500 transition-colors text-sm"
                        title="Remove"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Error message */}
                {uf.error && (
                  <p className="text-xs text-red-500 mt-2 ml-12">{uf.error}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Action buttons */}
        {!allDone && (
          <div className="mt-8 space-y-3">
            <button
              onClick={handleUploadAll}
              disabled={uploading || !hasFiles}
              className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="animate-spin">⏳</span> Uploading...
                </span>
              ) : pendingCount > 0 ? (
                `Upload ${pendingCount} file${pendingCount !== 1 ? "s" : ""} & Continue`
              ) : (
                "Upload & Continue"
              )}
            </button>

            <Link
              to="/dashboard"
              search={{ workspace: workspaceId }}
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Skip for now
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
