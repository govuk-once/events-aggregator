export type IncomingEvent = {
  eventID: string;
  eventTimestamp: string;
  // Group details
  namespace: string;
  group: string;
  // Event details - in the future if other services are integrated into the event aggregator, each row here could have it's own custom set of properties
  eventNote: string;
};

export type DatabaseEvent = {
  eventID: string;
  // Sort key
  compositeKey: string; // '{{namespace}}/{{group}}';
  eventTimestamp: string;
  // Group details
  namespace: string;
  group: string;
  // Event details - in the future if other services are integrated into the event aggregator, each row here could have it's own custom set of properties
  eventNote: string;
  // Tracking processing states
  processingStatus: {
    INSTANT: boolean;
    DAILY: boolean;
    WEEKLY: boolean;
  };
};
