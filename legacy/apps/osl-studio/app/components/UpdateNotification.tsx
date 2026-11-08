"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, CheckCircle, AlertCircle, X } from "lucide-react";
import type { ElectronAPI, UpdateStatus } from "@/types/electron";

export const UpdateNotification: React.FC = () => {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const electronAPI = typeof window !== "undefined" ? (window.electronAPI as ElectronAPI) : undefined;

  // Handle update now (download and auto-install)
  const handleUpdateNow = () => {
    if (electronAPI?.ipcRenderer) {
      electronAPI.ipcRenderer.send("update-now");
    }
  };

  // Handle install update
  const handleInstallUpdate = () => {
    if (electronAPI?.ipcRenderer) {
      electronAPI.ipcRenderer.send("install-update");
    }
  };

  useEffect(() => {
    if (!electronAPI?.ipcRenderer) {
      return;
    }

    // Listen for update status from main process
    const handleUpdateStatus = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => {
      const status = args[0] as UpdateStatus;

      // Validate the status object
      if (!status || typeof status !== "object" || !status.status) {
        console.error("❌ [UpdateNotification] Invalid status object received:", status);
        return;
      }

      setUpdateStatus(status);

      // Show notification for certain statuses
      if (["available", "error"].includes(status.status)) {
        setIsVisible(true);
      }
    };

    // Add event listener
    const removeListener = electronAPI.ipcRenderer.on("update-status", handleUpdateStatus);

    // Cleanup
    return () => {
      if (removeListener && typeof removeListener === "function") {
        removeListener();
      }
    };
  }, [electronAPI]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number) => {
    return formatBytes(bytesPerSecond) + "/s";
  };

  const getStatusIcon = () => {
    switch (updateStatus?.status) {
      case "checking":
        return <RefreshCw className="h-4 w-4 animate-spin" />;
      case "available":
        return <Download className="h-4 w-4" />;
      case "downloading":
        return <Download className="h-4 w-4 animate-pulse" />;
      case "downloaded":
        return <CheckCircle className="h-4 w-4" />;
      case "error":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getStatusColor = () => {
    switch (updateStatus?.status) {
      case "available":
        return "bg-blue-500";
      case "downloading":
        return "bg-yellow-500";
      case "downloaded":
        return "bg-green-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusText = () => {
    switch (updateStatus?.status) {
      case "checking":
        return "Checking for updates...";
      case "available":
        return `Update ${updateStatus.version} available`;
      case "downloading":
        return `Downloading update ${updateStatus.version}...`;
      case "downloaded":
        return `Update ${updateStatus.version} downloaded - installing in 2 seconds...`;
      case "not-available":
        return "No updates available";
      case "error":
        return `Update error: ${updateStatus.error}`;
      default:
        return "";
    }
  };

  if (!isVisible || !updateStatus) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-64 select-none">
      <Card className="shadow-lg bg-muted dark:bg-black rounded-md border border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              <CardTitle className="text-xs">Update Available</CardTitle>
            </div>
            {/* <Button variant='ghost' size='sm' onClick={() => setIsVisible(false)} className='h-6 w-6 p-0'>
              <X className='h-3 w-3' />
            </Button> */}
          </div>
        </CardHeader>
        <CardContent className="-mt-4">
          {/* <CardDescription className='text-xs mb-2'>{getStatusText()}</CardDescription> */}

          {/* {updateStatus.status === 'downloading' && updateStatus.progress !== undefined && (
            <div className='space-y-2'>
              <Progress value={updateStatus.progress} className='h-2' />
              <div className='flex justify-between text-xs text-muted-foreground'>
                <span>{updateStatus.progress.toFixed(1)}%</span>
                <span>{formatSpeed(updateStatus.speed || 0)}</span>
              </div>
              <div className='text-xs text-muted-foreground'>
                {formatBytes(updateStatus.transferred || 0)} / {formatBytes(updateStatus.total || 0)}
              </div>
            </div>
          )} */}

          <div className="space-y-2 mt-2">
            {updateStatus.releaseNotes && (
              <div className="text-xs text-muted-foreground max-h-20 overflow-y-auto">{updateStatus.releaseNotes}</div>
            )}
            <div className="flex space-x-2">
              <Button
                size="sm"
                className="flex-1"
                onClick={handleUpdateNow}
                disabled={updateStatus.status === "downloading" || updateStatus.status === "downloaded"}
              >
                Install Now
              </Button>
            </div>
          </div>

          {/* {updateStatus.status === 'downloaded' && (
            <div className='space-y-2'>
              <div className='flex items-center justify-center'>
                <div className='flex items-center space-x-2'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='text-sm text-muted-foreground'>Installing update...</span>
                </div>
              </div>
            </div>
          )} */}

          {updateStatus.status === "error" && (
            <div className="space-y-2">
              <Badge variant="destructive" className="text-xs">
                Update Failed
              </Badge>
              <Button size="sm" variant="outline" onClick={() => setIsVisible(false)}>
                Dismiss
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
