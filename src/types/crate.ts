export type DigMode = 'general' | 'world_adventure' | 'only_vocal' | 'only_instrumental';
export type ExportFormat = 'wav' | 'mp3_320';

export interface SearchFilters {
  mode: DigMode;
  sampleType: 'all' | 'track' | 'vocal' | 'instrumental';
  region: string;
  decade: string;
  duration: 'any' | 'shorts' | 'medium' | 'long';
  genre: string;
  cardCount: 2 | 3 | 4;
}

export interface SampleCandidate {
  id: string;
  source: 'youtube' | 'soundcloud' | 'internet_archive' | 'wikimedia' | 'freesound';
  title: string;
  channel: string;
  durationSec: number;
  thumbnailUrl: string;
  sourceUrl: string;
  queryTag: string;
}

export interface ChopJobProgress {
  jobId: string;
  stage: 'downloading' | 'decoding' | 'ready' | 'error';
  percent: number;
  message: string;
}

export interface ActiveSample {
  jobId: string;
  title: string;
  masterWavPath: string;
  exportedPath: string;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  format: ExportFormat;
}

export interface StorageInfo {
  samplesDir: string;
  seenCount: number;
}