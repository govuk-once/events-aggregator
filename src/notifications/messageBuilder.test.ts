import { describe, it, expect } from 'vitest';
import { buildMessage } from './messageBuilder.js';
import type { ChangeHistoryEntry } from '../govuk/types.js';

describe('messageBuilder', () => {
  const history: ChangeHistoryEntry[] = [
    { note: 'Recent change', public_timestamp: '2026-07-16T14:30:00Z' },
    { note: 'Older change', public_timestamp: '2026-07-16T13:00:00Z' },
    { note: 'Very old change', public_timestamp: '2026-07-10T10:00:00Z' },
  ];

  it('returns null when no changes match the window', () => {
    const result = buildMessage(
      'Pakistan travel advice',
      'pakistan',
      'hourly',
      history,
      '2026-07-17T00:00:00.000Z',
    );
    expect(result).toBeNull();
  });

  describe('single change', () => {
    const result = buildMessage(
      'Pakistan travel advice',
      'pakistan',
      'hourly',
      history,
      '2026-07-16T14:00:00.000Z',
    );

    it('returns a message', () => {
      expect(result).not.toBeNull();
    });

    it('uses the change note as NotificationBody', () => {
      expect(result!.NotificationBody).toBe('Recent change');
    });

    it('formats title as country updated', () => {
      expect(result!.NotificationTitle).toBe('Pakistan travel advice updated');
    });

    it('puts the change note in MessageBody as markdown', () => {
      expect(result!.MessageBody).toBe('- Recent change');
    });
  });

  describe('multiple changes', () => {
    const result = buildMessage(
      'Pakistan travel advice',
      'pakistan',
      'daily',
      history,
      '2026-07-16T12:00:00.000Z',
    );

    it('returns a message', () => {
      expect(result).not.toBeNull();
    });

    it('includes count in NotificationTitle', () => {
      expect(result!.NotificationTitle).toBe(
        'Pakistan travel advice: 2 updates',
      );
    });

    it('summarises in NotificationBody', () => {
      expect(result!.NotificationBody).toBe('2 changes in the daily digest');
    });

    it('lists all changes as markdown bullets in MessageBody', () => {
      expect(result!.MessageBody).toBe('- Recent change\n- Older change');
    });
  });

  describe('dedupMarker (NotificationID)', () => {
    it('generates a stable hash from content', () => {
      const result1 = buildMessage(
        'Pakistan travel advice',
        'pakistan',
        'hourly',
        history,
        '2026-07-16T14:00:00.000Z',
      );
      const result2 = buildMessage(
        'Pakistan travel advice',
        'pakistan',
        'hourly',
        history,
        '2026-07-16T14:00:00.000Z',
      );

      expect(result1!.NotificationID).toBe(result2!.NotificationID);
      expect(result1!.NotificationID).toMatch(/^[a-f0-9]{64}$/);
    });

    it('differs by country', () => {
      const result1 = buildMessage(
        'Pakistan travel advice',
        'pakistan',
        'hourly',
        history,
        '2026-07-01T00:00:00.000Z',
      );
      const result2 = buildMessage(
        'France travel advice',
        'france',
        'hourly',
        history,
        '2026-07-01T00:00:00.000Z',
      );

      expect(result1!.NotificationID).not.toBe(result2!.NotificationID);
    });

    it('differs by schedule', () => {
      const result1 = buildMessage(
        'Pakistan travel advice',
        'pakistan',
        'hourly',
        history,
        '2026-07-01T00:00:00.000Z',
      );
      const result2 = buildMessage(
        'Pakistan travel advice',
        'pakistan',
        'daily',
        history,
        '2026-07-01T00:00:00.000Z',
      );

      expect(result1!.NotificationID).not.toBe(result2!.NotificationID);
    });
  });
});
