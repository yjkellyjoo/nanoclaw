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

  it('Status group JID: 32-byte hex public key', () => {
    const jid = '0x04a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12';
    expect(jid.startsWith('0x04')).toBe(true);
    expect(jid.length).toBe(132); // 0x + 04 + 128 hex chars
  });

  it('Status DM JID: user public key', () => {
    const jid = '0x04fedcba0987654321';
    expect(jid.startsWith('0x04')).toBe(true);
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns only groups, excludes DMs', () => {
    storeChatMetadata(
      'group10x04abcd',
      '2024-01-01T00:00:01.000Z',
      'Group 1',
      'status',
      true,
    );
    storeChatMetadata(
      'user0x04user',
      '2024-01-01T00:00:02.000Z',
      'User DM',
      'status',
      false,
    );
    storeChatMetadata(
      'group20x04abcd',
      '2024-01-01T00:00:03.000Z',
      'Group 2',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.jid)).toContain('group10x04abcd');
    expect(groups.map((g) => g.jid)).toContain('group20x04abcd');
    expect(groups.map((g) => g.jid)).not.toContain('user0x04user');
  });

  it('excludes __group_sync__ sentinel', () => {
    storeChatMetadata('__group_sync__', '2024-01-01T00:00:00.000Z');
    storeChatMetadata(
      'group0x04abcd',
      '2024-01-01T00:00:01.000Z',
      'Group',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group0x04abcd');
  });

  it('marks registered groups correctly', () => {
    storeChatMetadata(
      'reg0x04abcd',
      '2024-01-01T00:00:01.000Z',
      'Registered',
      'status',
      true,
    );
    storeChatMetadata(
      'unreg0x04abcd',
      '2024-01-01T00:00:02.000Z',
      'Unregistered',
      'status',
      true,
    );

    _setRegisteredGroups({
      'reg0x04abcd': {
        name: 'Registered',
        folder: 'registered',
        trigger: '@Andy',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    });

    const groups = getAvailableGroups();
    const reg = groups.find((g) => g.jid === 'reg0x04abcd');
    const unreg = groups.find((g) => g.jid === 'unreg0x04abcd');

    expect(reg?.isRegistered).toBe(true);
    expect(unreg?.isRegistered).toBe(false);
  });

  it('returns groups ordered by most recent activity', () => {
    storeChatMetadata(
      'old0x04abcd',
      '2024-01-01T00:00:01.000Z',
      'Old',
      'status',
      true,
    );
    storeChatMetadata(
      'new0x04abcd',
      '2024-01-01T00:00:05.000Z',
      'New',
      'status',
      true,
    );
    storeChatMetadata(
      'mid0x04abcd',
      '2024-01-01T00:00:03.000Z',
      'Mid',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups[0].jid).toBe('new0x04abcd');
    expect(groups[1].jid).toBe('mid0x04abcd');
    expect(groups[2].jid).toBe('old0x04abcd');
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
      'group0x04abcd',
      '2024-01-01T00:00:03.000Z',
      'Group',
      'status',
      true,
    );

    const groups = getAvailableGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].jid).toBe('group0x04abcd');
  });

  it('returns empty array when no chats exist', () => {
    const groups = getAvailableGroups();
    expect(groups).toHaveLength(0);
  });
});
