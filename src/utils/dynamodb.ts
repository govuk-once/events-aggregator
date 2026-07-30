export const toEventStore = () => {
  return {
    eventID: 'sdlfsdlfsdlk3u3i4u39', // Partition Key //MD5 Hash of Event Note+Timestamp
    namespace: 'travel',
    group: 'spain',
    compositeKey: '{{namespace}}+{{group}}', // SK
    eventTimestamp: '2025-06-04T14:08:25Z',
    eventNote:
      'Temperatures may rise above 30 degrees, take appropriate precautions when travelling',
    deeplink: 'https://url',
    notificationStatus: {
      daily_status: 'true',
      weekly_status: 'false',
    },
  };
};
