import { describe, it, expect, beforeEach } from 'vitest';

import { _initTestDatabase, getAllChats, storeChatMetadata } from './db.js';
import { getAvailableGroups, _setRegisteredGroups } from './index.js';

beforeEach(() => {
  _initTestDatabase();
  _setRegisteredGroups({});
});

// --- JID ownership patterns ---

describe('JID ownership patterns', () => {
  // These test the patterns that will become ownsJid() on the Channel interface

  it('Status community JID: starts with community-', () => {
    const jid = 'community-abc123';
    expect(jid.startsWith('community-')).toBe(true);
  });

  it('Status user JID: starts with 0x', () => {
    const jid = '0xabcdef1234567890';
    expect(jid.startsWith('0x')).toBe(true);
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns only groups, excludes DMs', () => {
    storeChatMetadata(
      'community-group-1',
      '2024-01-01T00:00:01.000Z',
      'Group 1',
      'status',
      true,
    );
    storeChatMetadata(
      '0x1111111111111111',
      '2024-01-01T00:00:02.000Z',
      'User DM',
      'status',
      false,
    );
    storeChatMetadata(
      'community-group-2',
      '2024-01-01T00:00:03.000Z',
      'Group 2',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.jid)).toContain('community-group-1');
    expect(groups.map((g) => g.jid)).toContain('community-group-2');
    expect(groups.map((g) => g.jid)).not.toContain('0x1111111111111111');
  });

  it('excludes __group_sync__ sentinel', () => {
    storeChatMetadata('__group_sync__', '2024-01-01T00:00:00.000Z');
    storeChatMetadata(
      'community-group',
      '2024-01-01T00:00:01.000Z',
      'Group',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('community-group');
  });

  it('marks registered groups correctly', () => {
    storeChatMetadata(
      'community-registered',
      '2024-01-01T00:00:01.000Z',
      'Registered',
      'status',
      true,
    );
    storeChatMetadata(
      'community-unregistered',
      '2024-01-01T00:00:02.000Z',
      'Unregistered',
      'status',
      true,
    );

    _setRegisteredGroups({
      'community-registered': {
        name: 'Registered',
        folder: 'registered',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });

    const groups = getAvailableGroups();
    const reg = groups.find((g) => g.jid === 'community-registered');
    const unreg = groups.find((g) => g.jid === 'community-unregistered');

    expect(reg?.isRegistered).toBe(true);
    expect(unreg?.isRegistered).toBe(false);
  });

  it('returns groups ordered by most recent activity', () => {
    storeChatMetadata(
      'community-old',
      '2024-01-01T00:00:01.000Z',
      'Old',
      'status',
      true,
    );
    storeChatMetadata(
      'community-new',
      '2024-01-01T00:00:05.000Z',
      'New',
      'status',
      true,
    );
    storeChatMetadata(
      'community-mid',
      '2024-01-01T00:00:03.000Z',
      'Mid',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups[0].jid).toBe('community-new');
    expect(groups[1].jid).toBe('community-mid');
    expect(groups[2].jid).toBe('community-old');
  });

  it('excludes non-group chats regardless of JID format', () => {
    // Unknown JID format stored without is_group should not appear
    storeChatMetadata(
      'unknown-format-123',
      '2024-01-01T00:00:01.000Z',
      'Unknown',
    );
    // Explicitly non-group with unusual JID
    storeChatMetadata(
      'custom:abc',
      '2024-01-01T00:00:02.000Z',
      'Custom DM',
      'custom',
      false,
    );
    // A real group for contrast
    storeChatMetadata(
      'community-group',
      '2024-01-01T00:00:03.000Z',
      'Group',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('community-group');
  });

  it('returns empty array when no chats exist', () => {
    const groups = getAvailableGroups();
    expect(groups).toHaveLength(0);
  });
});
