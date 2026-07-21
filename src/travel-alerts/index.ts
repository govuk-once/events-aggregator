export const handler = (event: { triggeredAt: string; schedule: string }) => {
  console.log(`Running ${event.schedule} aggregation at ${event.triggeredAt}`);
  return '';
};
