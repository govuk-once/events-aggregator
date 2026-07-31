export type Source = {
  // Primary key - random UUID
  sourceID: string;
  // Group details
  sourceNamespace: string;
  sourceGroup: string;
  // Configuration
  accessMethod: 'api' | 'other';
  URL: string;
  sourceEnabled: boolean;
  keyARN?: string; // Optional field
  // State tracking
  lastUpdated: string;
};
