export type IncomingEvent = {
  eventID: string;
  eventTimestamp: string;
  // Group details
  namespace: string;
  group: string;
  // Event details - in the future if other services are integrated into the event aggregator, each row here could have it's own custom set of properties
  eventNote: string;
};
