import { useRef } from "react";
import type { StorageSummary, TrackMeta } from "../types";
import { formatBytes, formatDuration } from "../utils";

interface LibraryScreenProps {
  tracks: TrackMeta[];
  selectedTrackId: string | null;
  onImportFiles: (files: FileList | null) => Promise<void> | void;
  onDeleteTrack: (trackId: string) => Promise<void> | void;
  onPlayTrack: (trackId: string) => Promise<void> | void;
  onQueueTrack: (trackId: string) => void;
  storage: StorageSummary;
  importing: boolean;
}

export function LibraryScreen({
  tracks,
  selectedTrackId,
  onImportFiles,
  onDeleteTrack,
  onPlayTrack,
  onQueueTrack,
  storage,
  importing
}: LibraryScreenProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const usageEstimateLine =
    storage.usageBytes !== null && storage.quotaBytes !== null
      ? `Device estimate: ${formatBytes(storage.usageBytes)} / ${formatBytes(storage.quotaBytes)}`
      : "Device estimate unavailable on this browser.";

  return (
    <section className="screen">
      <div className="library-toolbar">
        <h2 className="section-title">Library</h2>

        <button
          type="button"
          className="primary-button"
          disabled={importing}
          onClick={() => inputRef.current?.click()}
        >
          {importing ? "Importing..." : "Import Files"}
        </button>

        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept=".wav,.mp3,.flac,.m4a,.aac,.alac,audio/wav,audio/mpeg,audio/flac,audio/mp4,audio/aac,audio/alac"
          onChange={(event) => {
            void onImportFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <div className="storage-card">
        <p className="storage-line">Library stored bytes: {formatBytes(storage.appBytes)}</p>
        <p className="storage-line">{usageEstimateLine}</p>
      </div>

      {tracks.length === 0 ? (
        <p className="empty-state">
          No tracks yet. Import WAV, FLAC, ALAC, MP3, AAC, or M4A from the iOS Files picker.
        </p>
      ) : (
        <ul className="track-list">
          {tracks.map((track) => (
            <li
              key={track.id}
              className={`track-row ${track.id === selectedTrackId ? "is-selected" : ""}`}
            >
              <button
                className="track-main"
                type="button"
                onClick={() => {
                  void onPlayTrack(track.id);
                }}
              >
                <span className="track-title">{track.displayName}</span>
                <span className="track-subtitle">
                  {formatDuration(track.durationSeconds)} • {formatBytes(track.sizeBytes)}
                </span>
              </button>

              <div className="track-actions">
                <button
                  type="button"
                  className="queue-button"
                  onClick={() => {
                    onQueueTrack(track.id);
                  }}
                >
                  Queue
                </button>

                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    const ok = window.confirm(
                      `Delete "${track.displayName}" from your library?`
                    );
                    if (ok) {
                      void onDeleteTrack(track.id);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
