import { describe, it, expect } from 'vitest';
import { getTimeWindow, isValidSchedule } from './config.js';

describe('config', () => {
  describe('getTimeWindow', () => {
    const now = new Date('2026-07-16T15:00:00.000Z');

    it('returns 1 hour ago for hourly schedule', () => {
      const result = getTimeWindow('hourly', now);
      expect(result).toBe('2026-07-16T14:00:00.000Z');
    });

    it('returns 1 day ago for daily schedule', () => {
      const result = getTimeWindow('daily', now);
      expect(result).toBe('2026-07-15T15:00:00.000Z');
    });

    it('returns 7 days ago for weekly schedule', () => {
      const result = getTimeWindow('weekly', now);
      expect(result).toBe('2026-07-09T15:00:00.000Z');
    });
  });

  describe('isValidSchedule', () => {
    it('accepts valid schedules', () => {
      expect(isValidSchedule('hourly')).toBe(true);
      expect(isValidSchedule('daily')).toBe(true);
      expect(isValidSchedule('weekly')).toBe(true);
    });

    it('rejects invalid values', () => {
      expect(isValidSchedule('monthly')).toBe(false);
      expect(isValidSchedule(undefined)).toBe(false);
      expect(isValidSchedule(null)).toBe(false);
      expect(isValidSchedule('')).toBe(false);
    });
  });
});
