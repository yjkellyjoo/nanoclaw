import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('status-api', () => {
  describe('healthCheck', () => {
    it('returns true when /health returns ok', async () => {
      fetchMock.mockResolvedValue({ ok: true } as Response);
      const api = await import('./status-api.js');

      await expect(api.healthCheck(1234)).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1234/health');
    });

    it('returns false when /health returns not ok', async () => {
      fetchMock.mockResolvedValue({ ok: false } as Response);
      const api = await import('./status-api.js');

      await expect(api.healthCheck(1234)).resolves.toBe(false);
    });

    it('returns false when fetch throws', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const api = await import('./status-api.js');

      await expect(api.healthCheck(1234)).resolves.toBe(false);
    });
  });

  describe('initializeApplication', () => {
    it('POSTs expected payload and returns JSON', async () => {
      const payload = { ok: true };
      const json = vi.fn().mockResolvedValue(payload);
      fetchMock.mockResolvedValue({ ok: true, json } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.initializeApplication(8080, '/tmp/data')).resolves.toEqual(
        payload,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:8080/statusgo/InitializeApplication',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataDir: '/tmp/data' }),
        },
      );
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
      const api = await import('./status-api.js');

      await expect(api.initializeApplication(8080, '/tmp/data')).rejects.toThrow(
        'InitializeApplication failed: 500',
      );
    });
  });

  describe('loginAccount', () => {
    it('POSTs expected payload and returns JSON', async () => {
      const payload = { loggedIn: true };
      const json = vi.fn().mockResolvedValue(payload);
      fetchMock.mockResolvedValue({ ok: true, json } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.loginAccount(8080, 'key-1', 'pw')).resolves.toEqual(
        payload,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:8080/statusgo/LoginAccount',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyUID: 'key-1', password: 'pw' }),
        },
      );
    });

    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 } as Response);
      const api = await import('./status-api.js');

      await expect(api.loginAccount(8080, 'key-1', 'pw')).rejects.toThrow(
        'LoginAccount failed: 401',
      );
    });
  });

  describe('callRPC', () => {
    it('sends JSON-RPC envelope with incrementing id', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'one' }),
          ),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'two' }),
          ),
        } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.callRPC(8080, 'method_one', ['a'])).resolves.toBe('one');
      await expect(api.callRPC(8080, 'method_two', ['b'])).resolves.toBe('two');

      const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);

      expect(firstBody).toEqual({
        jsonrpc: '2.0',
        method: 'method_one',
        params: ['a'],
        id: 1,
      });
      expect(secondBody).toEqual({
        jsonrpc: '2.0',
        method: 'method_two',
        params: ['b'],
        id: 2,
      });
    });

    it('parses double-encoded JSON responses', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify(
            JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: 42 } }),
          ),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.callRPC(8080, 'method', [])).resolves.toEqual({
        value: 42,
      });
    });

    it('throws when RPC response has an error object', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32000, message: 'boom' },
          }),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.callRPC(8080, 'bad_method', [])).rejects.toThrow(
        'RPC bad_method error: boom',
      );
    });

    it('throws invalid JSON error and warns when response is malformed', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('not-json'),
      } as unknown as Response);
      const api = await import('./status-api.js');
      const { logger } = await import('./logger.js');

      await expect(api.callRPC(8080, 'bad_json', [])).rejects.toThrow(
        'CallRPC bad_json: invalid JSON response',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'bad_json', text: 'not-json' }),
        'Failed to parse RPC response',
      );
    });
  });

  describe('sendOneToOneMessage', () => {
    it('uses wakuext_sendOneToOneMessage with expected params', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' })),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(
        api.sendOneToOneMessage(8080, 'chat-123', 'hello world'),
      ).resolves.toBe('ok');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('wakuext_sendOneToOneMessage');
      expect(body.params).toEqual([{ id: 'chat-123', message: 'hello world' }]);
    });
  });

  describe('sendChatMessage', () => {
    it('uses wakuext_sendChatMessage with chatId/text payload first', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' })),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.sendChatMessage(8080, 'group-123', 'hello')).resolves.toBe(
        'ok',
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('wakuext_sendChatMessage');
      expect(body.params).toEqual([{ chatId: 'group-123', text: 'hello' }]);
    });

    it('surfaces RPC errors without trying alternate payload shapes', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: { code: -32602, message: 'invalid params' },
            }),
          ),
        } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(
        api.sendChatMessage(8080, 'group-123', 'hello'),
      ).rejects.toThrow('RPC wakuext_sendChatMessage error: invalid params');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendGroupChatMessage', () => {
    it('uses wakuext_sendGroupChatMessage with id/message payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' })),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(
        api.sendGroupChatMessage(8080, 'group-123', 'hello'),
      ).resolves.toBe('ok');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('wakuext_sendGroupChatMessage');
      expect(body.params).toEqual([{ id: 'group-123', message: 'hello' }]);
    });

    it('falls back to wakuext_sendChatMessage when group RPC fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              error: { code: -32601, message: 'method not found' },
            }),
          ),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: vi.fn().mockResolvedValue(
            JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'ok' }),
          ),
        } as unknown as Response);
      const api = await import('./status-api.js');
      const { logger } = await import('./logger.js');

      await expect(
        api.sendGroupChatMessage(8080, 'group-123', 'hello'),
      ).resolves.toBe('ok');

      const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
      expect(firstBody.method).toBe('wakuext_sendGroupChatMessage');
      expect(firstBody.params).toEqual([{ id: 'group-123', message: 'hello' }]);
      expect(secondBody.method).toBe('wakuext_sendChatMessage');
      expect(secondBody.params).toEqual([{ chatId: 'group-123', text: 'hello' }]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: 'group-123' }),
        'wakuext_sendGroupChatMessage failed, falling back to wakuext_sendChatMessage',
      );
    });
  });

  describe('getChatMessages', () => {
    it('passes params and normalizes result payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { messages: [{ id: 'm1' }], cursor: 'next' },
          }),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.getChatMessages(8080, 'chat-1', 'cur-1', 50)).resolves.toEqual(
        {
          messages: [{ id: 'm1' }],
          cursor: 'next',
        },
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('wakuext_chatMessages');
      expect(body.params).toEqual(['chat-1', 'cur-1', 50]);
    });

    it('normalizes null result to empty messages/cursor', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.getChatMessages(8080, 'chat-1', '', 10)).resolves.toEqual({
        messages: [],
        cursor: '',
      });
    });
  });

  describe('getActiveChats', () => {
    it('uses wakuext_activeChats and returns result', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: [{ id: 'chat-1' }] }),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.getActiveChats(8080)).resolves.toEqual([{ id: 'chat-1' }]);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('wakuext_activeChats');
      expect(body.params).toEqual([]);
    });

    it('normalizes null result to empty array', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.getActiveChats(8080)).resolves.toEqual([]);
    });
  });

  describe('getSettings', () => {
    it('passes through CallRPC result from settings_getSettings', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { theme: 'light' } }),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.getSettings(8080)).resolves.toEqual({ theme: 'light' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('settings_getSettings');
      expect(body.params).toEqual([]);
    });
  });

  describe('updateProfileDisplayName', () => {
    it('uses settings_saveSetting for display-name', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.updateProfileDisplayName(8080, 'Nova')).resolves.toBeNull();

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('settings_saveSetting');
      expect(body.params).toEqual(['display-name', 'Nova']);
    });
  });

  describe('getAllChats', () => {
    it('uses wakuext_chats and returns result', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: [{ id: 'chat-1', active: true }] }),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.getAllChats(8080)).resolves.toEqual([{ id: 'chat-1', active: true }]);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('wakuext_chats');
    });

    it('normalizes null result to empty array', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null })),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.getAllChats(8080)).resolves.toEqual([]);
    });
  });

  describe('createOneToOneChat', () => {
    it('uses wakuext_createOneToOneChat with public key', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { chats: [{ id: '0xabc', active: true }] } }),
        ),
      } as unknown as Response);
      const api = await import('./status-api.js');

      await api.createOneToOneChat(8080, '0xabc');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.method).toBe('wakuext_createOneToOneChat');
      expect(body.params).toEqual([{ id: '0xabc' }]);
    });
  });

  describe('createAccount', () => {
    it('POSTs expected payload and extracts keyUID', async () => {
      const json = vi.fn().mockResolvedValue({ keyUID: 'key-123' });
      fetchMock.mockResolvedValue({ ok: true, json } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.createAccount(8080, 'Kelly', 'secret')).resolves.toEqual({
        keyUID: 'key-123',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:8080/statusgo/CreateAccount',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: 'Kelly', password: 'secret' }),
        },
      );
    });

    it('throws when response does not include keyUID', async () => {
      const json = vi.fn().mockResolvedValue({});
      fetchMock.mockResolvedValue({ ok: true, json } as unknown as Response);
      const api = await import('./status-api.js');

      await expect(api.createAccount(8080, 'Kelly', 'secret')).rejects.toThrow(
        'CreateAccount did not return keyUID',
      );
    });
  });
});
