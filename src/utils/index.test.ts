import { describe, it, expect } from 'vitest';
import { getStartTime } from './index';

describe('getStartTime', () => {
  const BASE = '2026-10-21T12:00:00.000Z';

  it('subtracts 15 minutes for 15m schedule', () => {
    expect(getStartTime(BASE, '15m')).toBe('2026-10-21T11:45:00.000Z');
  });

  it('subtracts 1 hour for hourly schedule', () => {
    expect(getStartTime(BASE, 'hourly')).toBe('2026-10-21T11:00:00.000Z');
  });

  it('subtracts 1 day for daily schedule', () => {
    expect(getStartTime(BASE, 'daily')).toBe('2026-10-20T12:00:00.000Z');
  });

  it('subtracts 7 days for weekly schedule', () => {
    expect(getStartTime(BASE, 'weekly')).toBe('2026-10-14T12:00:00.000Z');
  });

  it('handles 15m subtraction across an hour boundary', () => {
    expect(getStartTime('2026-10-21T12:05:00.000Z', '15m')).toBe(
      '2026-10-21T11:50:00.000Z',
    );
  });

  it('handles 15m subtraction across a day boundary', () => {
    expect(getStartTime('2026-10-21T00:10:00.000Z', '15m')).toBe(
      '2026-10-20T23:55:00.000Z',
    );
  });
});
