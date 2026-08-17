import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "ready"
  | "channel-pending"
  | "error"
  | "unsupported";

export interface AppUpdaterState {
  status: AppUpdateStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useAppUpdater() {
  const updateRef = useRef<Update | null>(null);
  const operationRef = useRef(false);
  const [state, setState] = useState<AppUpdaterState>({
    status: isTauri() ? "idle" : "unsupported",
    currentVersion: null,
    availableVersion: null,
    notes: null,
    progress: null,
    error: null,
  });

  const checkForUpdates = useCallback(async () => {
    if (!isTauri() || operationRef.current) return;
    operationRef.current = true;
    setState((current) => ({ ...current, status: "checking", error: null, progress: null }));

    try {
      const currentVersion = await getVersion();
      if (updateRef.current) {
        await updateRef.current.close();
        updateRef.current = null;
      }

      const update = await check({ timeout: 15_000 });
      updateRef.current = update;
      setState({
        status: update ? "available" : "up-to-date",
        currentVersion,
        availableVersion: update?.version ?? null,
        notes: update?.body?.trim() || null,
        progress: null,
        error: null,
      });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes("Could not fetch a valid release JSON from the remote")) {
        setState((current) => ({ ...current, status: "channel-pending", error: null }));
      } else {
        setState((current) => ({ ...current, status: "error", error: message }));
      }
    } finally {
      operationRef.current = false;
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update || operationRef.current) return;
    operationRef.current = true;
    let downloaded = 0;
    let contentLength: number | undefined;
    setState((current) => ({ ...current, status: "downloading", progress: 0, error: null }));

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          downloaded = 0;
          return;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const progress = contentLength
            ? Math.min(99, Math.round((downloaded / contentLength) * 100))
            : null;
          setState((current) => ({ ...current, progress }));
          return;
        }
        setState((current) => ({ ...current, progress: 100 }));
      });
      setState((current) => ({ ...current, status: "ready", progress: 100 }));
      await relaunch();
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: errorMessage(error) }));
      operationRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    void getVersion()
      .then((currentVersion) => {
        if (!disposed) setState((current) => ({ ...current, currentVersion }));
      })
      .catch(() => undefined);

    const timer = window.setTimeout(() => {
      if (!disposed) void checkForUpdates();
    }, 3_500);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      const update = updateRef.current;
      updateRef.current = null;
      if (update) void update.close();
    };
  }, [checkForUpdates]);

  return { state, checkForUpdates, installUpdate };
}
