import { openDB, type DBSchema } from "idb";
import type { TrackMeta } from "./types";

interface MusicDB extends DBSchema {
  tracks: {
    key: string;
    value: TrackMeta;
    indexes: { "by-addedAt": number };
  };
  blobs: {
    key: string;
    value: Blob;
  };
}

const DB_NAME = "music-slowing-pwa-db";
const DB_VERSION = 1;

const dbPromise = openDB<MusicDB>(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("tracks")) {
      const tracksStore = db.createObjectStore("tracks", { keyPath: "id" });
      tracksStore.createIndex("by-addedAt", "addedAt");
    }

    if (!db.objectStoreNames.contains("blobs")) {
      db.createObjectStore("blobs");
    }
  }
});

export async function putTrack(track: TrackMeta, blob: Blob): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(["tracks", "blobs"], "readwrite");
  await tx.objectStore("tracks").put(track);
  await tx.objectStore("blobs").put(blob, track.id);
  await tx.done;
}

export async function getAllTracks(): Promise<TrackMeta[]> {
  const db = await dbPromise;
  const records = await db.getAllFromIndex("tracks", "by-addedAt");
  return records.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getTrackBlob(trackId: string): Promise<Blob | undefined> {
  const db = await dbPromise;
  return db.get("blobs", trackId);
}

export async function deleteTrackById(trackId: string): Promise<void> {
  const db = await dbPromise;
  const tx = db.transaction(["tracks", "blobs"], "readwrite");
  await tx.objectStore("tracks").delete(trackId);
  await tx.objectStore("blobs").delete(trackId);
  await tx.done;
}

export async function getLibraryStoredBytes(): Promise<number> {
  const db = await dbPromise;
  const records = await db.getAll("tracks");
  return records.reduce((sum, track) => sum + track.sizeBytes, 0);
}
