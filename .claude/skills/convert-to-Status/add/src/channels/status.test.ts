import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const statusApiMocks = vi.hoisted(() => ({
  healthCheck: vi.fn(),
  initializeApplication: vi.fn(),
  loginAccount: vi.fn(),
  startMessenger: vi.fn(),
  getSettings: vi.fn(),
  updateProfileDisplayName: vi.fn(),
  createOneToOneChat: vi.fn(),
  getActiveChats: vi.fn(),
  getAllChats: vi.fn(),
  getChatMessages: vi.fn(),
  sendOneToOneMessage: vi.fn(),
  sendChatMessage: vi.fn(),
  sendGroupChatMessage: vi.fn(),
}));

const wsState = vi.hoisted(() => ({
  instances: [] as Array<{
    url: string;
    handlers: Record<string, Array<(arg?: unknown) => void>>;
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    emit: (event: string, arg?: unknown) => void;
  }>,
}));

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Assistant',
  STATUS_ALLOW_FROM: ['0xallowed'],
  STATUS_DATA_DIR: '/tmp/status-data',
  STATUS_KEY_UID: 'key-uid',
  STATUS_PASSWORD: 'password',
  STATUS_PORT: 21405,
  STATUS_PROFILE_NAME: 'Assistant',
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../status-api.js', () => statusApiMocks);

vi.mock('ws', () => ({
  default: vi.fn(function (url: string) {
    const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    const ws = {
      url,
      handlers,
      on: vi.fn((event: string, cb: (arg?: unknown) => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(cb);
      }),
      close: vi.fn(),
      emit: (event: string, arg?: unknown) => {
        for (const cb of handlers[event] ?? []) cb(arg);
      },
    };
    wsState.instances.push(ws);
    return ws;
  }),
}));

import WebSocket from 'ws';

import {
  ASSISTANT_NAME,
  STATUS_DATA_DIR,
  STATUS_KEY_UID,
  STATUS_PASSWORD,
  STATUS_PORT,
  STATUS_PROFILE_NAME,
} from '../config.js';
import { StatusChannel, StatusChannelOpts } from './status.js';

function createOpts(
  overrides: Partial<StatusChannelOpts> = {},
): StatusChannelOpts {
  return {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({
      '0xallowed': {
        name: 'Allowed Chat',
        folder: 'allowed',
        trigger: '@Assistant',
        added_at: '2024-01-01T00:00:00.000Z',
      },
    })),
    ...overrides,
  };
}

describe('StatusChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wsState.instances.length = 0;

    statusApiMocks.healthCheck.mockResolvedValue(true);
    statusApiMocks.initializeApplication.mockResolvedValue(undefined);
    statusApiMocks.loginAccount.mockResolvedValue(undefined);
    statusApiMocks.startMessenger.mockResolvedValue(undefined);
    statusApiMocks.getSettings.mockResolvedValue({ 'public-key': '0xbot' });
    statusApiMocks.updateProfileDisplayName.mockResolvedValue(undefined);
    statusApiMocks.createOneToOneChat.mockResolvedValue(undefined);
    statusApiMocks.getActiveChats.mockResolvedValue([]);
    statusApiMocks.getAllChats.mockResolvedValue([]);
    statusApiMocks.getChatMessages.mockResolvedValue({ messages: [], cursor: '' });
    statusApiMocks.sendOneToOneMessage.mockResolvedValue(undefined);
    statusApiMocks.sendChatMessage.mockResolvedValue(undefined);
    statusApiMocks.sendGroupChatMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('constructor accepts opts correctly', () => {
    const opts = createOpts();
    const channel = new StatusChannel(opts);

    expect((channel as any).opts).toBe(opts);
  });

  it('connect() runs full connection flow', async () => {
    const opts = createOpts();
    const channel = new StatusChannel(opts);
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockReturnValue(123 as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    statusApiMocks.healthCheck
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await channel.connect();

    expect(statusApiMocks.healthCheck).toHaveBeenCalledTimes(3);
    expect(statusApiMocks.healthCheck).toHaveBeenCalledWith(STATUS_PORT);
    expect(statusApiMocks.initializeApplication).toHaveBeenCalledWith(
      STATUS_PORT,
      STATUS_DATA_DIR,
    );
    expect(statusApiMocks.loginAccount).toHaveBeenCalledWith(
      STATUS_PORT,
      STATUS_KEY_UID,
      STATUS_PASSWORD,
    );
    expect(statusApiMocks.startMessenger).toHaveBeenCalledWith(STATUS_PORT);
    expect(statusApiMocks.getSettings).toHaveBeenCalledWith(STATUS_PORT);
    expect(statusApiMocks.updateProfileDisplayName).toHaveBeenCalledWith(
      STATUS_PORT,
      STATUS_PROFILE_NAME,
    );
    expect(statusApiMocks.createOneToOneChat).toHaveBeenCalled();
    expect(statusApiMocks.getActiveChats).toHaveBeenCalledWith(STATUS_PORT);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(WebSocket).toHaveBeenCalledWith('ws://127.0.0.1:21405/signals');
    expect(channel.isConnected()).toBe(true);
  });

  it('connect() throws when health check never succeeds', async () => {
    const opts = createOpts();
    const channel = new StatusChannel(opts);
    statusApiMocks.healthCheck.mockResolvedValue(false);
    vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    await expect(channel.connect()).rejects.toThrow(
      'status-backend not healthy after 30 retries',
    );
    expect(statusApiMocks.healthCheck).toHaveBeenCalledTimes(30);
    expect(statusApiMocks.initializeApplication).not.toHaveBeenCalled();
  });

  it('connect() skips profile update when configured name already matches', async () => {
    const channel = new StatusChannel(createOpts());
    statusApiMocks.getSettings.mockResolvedValue({
      'public-key': '0xbot',
      'display-name': STATUS_PROFILE_NAME,
    });

    await channel.connect();

    expect(statusApiMocks.updateProfileDisplayName).not.toHaveBeenCalled();
  });

  it('sendMessage() sends with prefix when connected and queues when disconnected', async () => {
    const channel = new StatusChannel(createOpts());

    await channel.sendMessage('0x04abc', 'queued');
    expect(statusApiMocks.sendOneToOneMessage).not.toHaveBeenCalled();
    expect((channel as any).outgoingQueue).toEqual([
      { jid: '0x04abc', text: `${ASSISTANT_NAME}: queued` },
    ]);

    (channel as any).connected = true;
    await channel.sendMessage('0x04def', 'sent');
    expect(statusApiMocks.sendOneToOneMessage).toHaveBeenCalledWith(
      STATUS_PORT,
      '0x04def',
      `${ASSISTANT_NAME}: sent`,
    );
    expect(statusApiMocks.sendChatMessage).not.toHaveBeenCalled();
    expect(statusApiMocks.sendGroupChatMessage).not.toHaveBeenCalled();
  });

  it('sendMessage() queues message on send failure', async () => {
    const channel = new StatusChannel(createOpts());
    (channel as any).connected = true;
    statusApiMocks.sendOneToOneMessage.mockRejectedValueOnce(new Error('boom'));

    await channel.sendMessage('0x04abc', 'fails');

    expect((channel as any).outgoingQueue).toEqual([
      { jid: '0x04abc', text: `${ASSISTANT_NAME}: fails` },
    ]);
  });

  it('sendMessage() uses sendGroupChatMessage for group JIDs', async () => {
    const channel = new StatusChannel(createOpts());
    (channel as any).connected = true;

    const groupJid = 'group-123-0x04357af6';
    await channel.sendMessage(groupJid, 'hello group');

    expect(statusApiMocks.sendGroupChatMessage).toHaveBeenCalledWith(
      STATUS_PORT,
      groupJid,
      `${ASSISTANT_NAME}: hello group`,
    );
    expect(statusApiMocks.sendOneToOneMessage).not.toHaveBeenCalled();
    expect(statusApiMocks.sendChatMessage).not.toHaveBeenCalled();
  });

  it('ownsJid() recognizes status dm and group JID formats', () => {
    const channel = new StatusChannel(createOpts());

    expect(channel.ownsJid('0x04abcdef')).toBe(true);
    expect(channel.ownsJid('0x00abcdef')).toBe(true);
    expect(
      channel.ownsJid(
        '00000000-0000-0000-0000-000000000000-0x04aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(true);
    expect(channel.ownsJid('0x05abcdef')).toBe(false);
    expect(channel.ownsJid('group-0x04nothexZZ')).toBe(false);
    expect(channel.ownsJid('12345')).toBe(false);
  });

  it('isConnected() returns connection state', () => {
    const channel = new StatusChannel(createOpts());

    expect(channel.isConnected()).toBe(false);
    (channel as any).connected = true;
    expect(channel.isConnected()).toBe(true);
  });

  it('disconnect() clears poll timer and closes websocket', async () => {
    const channel = new StatusChannel(createOpts());
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const ws = { close: vi.fn() };

    (channel as any).connected = true;
    (channel as any).pollTimer = 123 as unknown as ReturnType<typeof setInterval>;
    (channel as any).ws = ws;

    await channel.disconnect();

    expect(channel.isConnected()).toBe(false);
    expect(clearIntervalSpy).toHaveBeenCalledWith(123);
    expect(ws.close).toHaveBeenCalledTimes(1);
    expect((channel as any).pollTimer).toBeNull();
    expect((channel as any).ws).toBeNull();
  });

  it('pollMessages only processes chats initiated by allowed admin', async () => {
    const onMessage = vi.fn();
    const onChatMetadata = vi.fn();
    const opts = createOpts({ onMessage, onChatMetadata });
    const channel = new StatusChannel(opts);

    (channel as any).connected = true;
    (channel as any).botPublicKey = '0xbot';

    statusApiMocks.getActiveChats.mockResolvedValue([
      { id: '0xallowed', name: 'Allowed', chatType: 1 },
      { id: '0xblocked', name: 'Blocked', chatType: 1 },
    ]);

    const firstPollMessagesAllowed = [
      {
        id: 'm1',
        text: 'old-1 from admin',
        from: '0xallowed',
        alias: 'Admin',
        timestamp: 1000,
        chatId: '0xallowed',
        localChatId: '0xallowed',
        contentType: 1,
        responseTo: '',
      },
      {
        id: 'm2',
        text: 'old-2 from admin',
        from: '0xallowed',
        alias: 'Admin',
        timestamp: 2000,
        chatId: '0xallowed',
        localChatId: '0xallowed',
        contentType: 1,
        responseTo: '',
      },
    ];

    const firstPollMessagesBlocked = [
      {
        id: 'b1',
        text: 'old blocked',
        from: '0xblocked',
        alias: 'Blocked',
        timestamp: 1500,
        chatId: '0xblocked',
        localChatId: '0xblocked',
        contentType: 1,
        responseTo: '',
      },
    ];

    const secondPollMessagesAllowed = [
      ...firstPollMessagesAllowed,
      {
        id: 'm3',
        text: 'deliver me',
        from: '0xpeer',
        alias: 'Peer',
        timestamp: 3000,
        chatId: '0xallowed',
        localChatId: '0xallowed',
        contentType: 1,
        responseTo: '',
      },
      {
        id: 'm4',
        text: 'self by key',
        from: '0xbot',
        alias: 'Bot',
        timestamp: 4000,
        chatId: '0xallowed',
        localChatId: '0xallowed',
        contentType: 1,
        responseTo: '',
      },
      {
        id: 'm5',
        text: `${ASSISTANT_NAME}: self by prefix`,
        from: '0xpeer',
        alias: 'Peer',
        timestamp: 5000,
        chatId: '0xallowed',
        localChatId: '0xallowed',
        contentType: 1,
        responseTo: '',
      },
      {
        id: 'm6',
        text: 'not text content',
        from: '0xpeer',
        alias: 'Peer',
        timestamp: 6000,
        chatId: '0xallowed',
        localChatId: '0xallowed',
        contentType: 2,
        responseTo: '',
      },
    ];

    let allowedPollCount = 0;
    statusApiMocks.getChatMessages.mockImplementation(
      async (_port: number, chatId: string) => {
        if (chatId === '0xallowed') {
          allowedPollCount++;
          return {
            messages:
              allowedPollCount === 1
                ? firstPollMessagesAllowed
                : secondPollMessagesAllowed,
            cursor: '',
          };
        }
        if (chatId === '0xblocked') {
          return { messages: firstPollMessagesBlocked, cursor: '' };
        }
        return { messages: [], cursor: '' };
      },
    );

    await (channel as any).pollMessages();
    expect(onMessage).not.toHaveBeenCalled();
    expect(statusApiMocks.getChatMessages).toHaveBeenCalledTimes(2);
    expect(statusApiMocks.getChatMessages).toHaveBeenCalledWith(
      STATUS_PORT,
      '0xallowed',
      '',
      50,
    );
    expect(statusApiMocks.getChatMessages).toHaveBeenCalledWith(
      STATUS_PORT,
      '0xblocked',
      '',
      50,
    );

    await (channel as any).pollMessages();

    expect(statusApiMocks.getChatMessages).toHaveBeenCalledTimes(3);
    expect(
      statusApiMocks.getChatMessages.mock.calls.filter(
        (args: unknown[]) => args[1] === '0xblocked',
      ),
    ).toHaveLength(1);
    expect(onChatMetadata).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      '0xallowed',
      expect.objectContaining({
        id: 'm3',
        content: 'deliver me',
        sender: '0xpeer',
        chat_jid: '0xallowed',
      }),
    );
  });

  it('pollMessages allows group chats when admin is a member', async () => {
    const onMessage = vi.fn();
    const onChatMetadata = vi.fn();
    const opts = createOpts({
      onMessage,
      onChatMetadata,
      registeredGroups: vi.fn(() => ({
        '0xgroup-allowed': {
          name: 'Allowed Group',
          folder: 'group-allowed',
          trigger: '@Assistant',
          added_at: '2024-01-01T00:00:00.000Z',
        },
      })),
    });
    const channel = new StatusChannel(opts);

    (channel as any).connected = true;
    (channel as any).botPublicKey = '0xbot';

    statusApiMocks.getActiveChats.mockResolvedValue([
      {
        id: '0xgroup-allowed',
        name: 'Allowed Group',
        chatType: 2,
        members: [{ id: '0xallowed' }, { id: '0xpeer' }],
      },
      {
        id: '0xgroup-blocked',
        name: 'Blocked Group',
        chatType: 2,
        members: [{ id: '0xblocked' }],
      },
    ]);

    const firstPollMessages = [
      {
        id: 'g1',
        text: 'old group message',
        from: '0xpeer',
        alias: 'Peer',
        timestamp: 1000,
        chatId: '0xgroup-allowed',
        localChatId: '0xgroup-allowed',
        contentType: 1,
        responseTo: '',
      },
    ];

    const secondPollMessages = [
      ...firstPollMessages,
      {
        id: 'g2',
        text: 'new group message',
        from: '0xpeer',
        alias: 'Peer',
        timestamp: 2000,
        chatId: '0xgroup-allowed',
        localChatId: '0xgroup-allowed',
        contentType: 1,
        responseTo: '',
      },
    ];

    let pollCount = 0;
    statusApiMocks.getChatMessages.mockImplementation(
      async (_port: number, chatId: string) => {
        if (chatId !== '0xgroup-allowed') return { messages: [], cursor: '' };
        pollCount++;
        return {
          messages: pollCount === 1 ? firstPollMessages : secondPollMessages,
          cursor: '',
        };
      },
    );

    await (channel as any).pollMessages();
    expect(onMessage).not.toHaveBeenCalled();
    expect(statusApiMocks.getChatMessages).toHaveBeenCalledTimes(1);
    expect(statusApiMocks.getChatMessages).toHaveBeenCalledWith(
      STATUS_PORT,
      '0xgroup-allowed',
      '',
      50,
    );

    await (channel as any).pollMessages();
    expect(statusApiMocks.getChatMessages).toHaveBeenCalledTimes(2);
    expect(onChatMetadata).toHaveBeenCalledTimes(1);
    expect(onChatMetadata).toHaveBeenCalledWith(
      '0xgroup-allowed',
      expect.any(String),
      'Allowed Group',
      'status',
      true,
    );
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      '0xgroup-allowed',
      expect.objectContaining({
        id: 'g2',
        content: 'new group message',
        sender: '0xpeer',
        chat_jid: '0xgroup-allowed',
      }),
    );
  });

  it('flushOutgoingQueue sends queued messages in order after connect', async () => {
    const channel = new StatusChannel(createOpts());
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockReturnValue(123 as unknown as ReturnType<typeof setInterval>);

    await channel.sendMessage('0x04a1', 'first');
    await channel.sendMessage('0x04a2', 'second');

    await channel.connect();
    await vi.waitFor(() => {
      expect((channel as any).outgoingQueue).toEqual([]);
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(statusApiMocks.sendOneToOneMessage).toHaveBeenNthCalledWith(
      1,
      STATUS_PORT,
      '0x04a1',
      `${ASSISTANT_NAME}: first`,
    );
    expect(statusApiMocks.sendOneToOneMessage).toHaveBeenNthCalledWith(
      2,
      STATUS_PORT,
      '0x04a2',
      `${ASSISTANT_NAME}: second`,
    );
  });
});
