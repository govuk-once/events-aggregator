import { ScheduleFrequency } from './types.js';

export const handler = (event: {
  triggeredAt: string;
  schedule: ScheduleFrequency;
}) => {
  console.log(`${event.schedule} event triggered at ${event.triggeredAt}`);
  return '';
};
