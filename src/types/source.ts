export type Source = {
  // Primary key - random UUID
  sourceID: string;
  // Group details
  sourceNamespace: string;
  sourceGroup: string;
  compositeKey: string; // combo of sourceNamespace/sourceGroup
  // Configuration
  accessMethod: 'api' | 'other';
  URL: string;
  sourceEnabled: boolean;
  keyARN?: string; // Optional field
  // State tracking
  lastUpdated: string;
};
