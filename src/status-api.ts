/**
 * HTTP/RPC wrapper for status-backend.
 * Communicates with the local status-backend REST API.
 */

import https from 'https';

import { logger } from './logger.js';

// status-go media server uses self-signed TLS on localhost
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

interface RPCResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

async function postStatusJson<T>(
  port: number,
  endpoint: string,
  body: unknown,
  action: string,
): Promise<T> {
  const res = await fetch(`${baseUrl(port)}${endpoint}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${action} failed: ${res.status}`);
  return (await res.json()) as T;
}

function parseRPCResponse(method: string, text: string): RPCResponse {
  try {
    const outer = JSON.parse(text);
    return typeof outer === 'string'
      ? (JSON.parse(outer) as RPCResponse)
      : (outer as RPCResponse);
  } catch {
    logger.warn(
      { method, text: text.slice(0, 200) },
      'Failed to parse RPC response',
    );
    throw new Error(`CallRPC ${method}: invalid JSON response`);
  }
}

export async function healthCheck(port: number): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(port)}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function initializeApplication(
  port: number,
  dataDir: string,
): Promise<unknown> {
  return postStatusJson(
    port,
    '/statusgo/InitializeApplication',
    { dataDir },
    'InitializeApplication',
  );
}

export async function loginAccount(
  port: number,
  keyUID: string,
  password: string,
): Promise<unknown> {
  return postStatusJson(
    port,
    '/statusgo/LoginAccount',
    { keyUID, password },
    'LoginAccount',
  );
}

let rpcIdCounter = 0;

export async function callRPC(
  port: number,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const body = {
    jsonrpc: '2.0',
    method,
    params,
    id: ++rpcIdCounter,
  };

  const res = await fetch(`${baseUrl(port)}/statusgo/CallRPC`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`CallRPC ${method} HTTP error: ${res.status}`);

  const text = await res.text();
  const rpc = parseRPCResponse(method, text);

  if (rpc.error) {
    throw new Error(`RPC ${method} error: ${rpc.error.message}`);
  }

  return rpc.result;
}

export async function sendOneToOneMessage(
  port: number,
  chatId: string,
  message: string,
): Promise<unknown> {
  return callRPC(port, 'wakuext_sendOneToOneMessage', [
    { id: chatId, message },
  ]);
}

export async function sendChatMessage(
  port: number,
  chatId: string,
  message: string,
): Promise<unknown> {
  return callRPC(port, 'wakuext_sendChatMessage', [{ chatId, text: message }]);
}

export async function sendGroupChatMessage(
  port: number,
  chatId: string,
  message: string,
): Promise<unknown> {
  try {
    // Canonical group send request in status-go:
    // { id: <groupChatId>, message: <text> }
    return await callRPC(port, 'wakuext_sendGroupChatMessage', [
      { id: chatId, message },
    ]);
  } catch (err) {
    // Fallback for older backends that only expose sendChatMessage.
    logger.warn(
      { chatId, err },
      'wakuext_sendGroupChatMessage failed, falling back to wakuext_sendChatMessage',
    );
    return sendChatMessage(port, chatId, message);
  }
}

/** status-go protobuf ContentType enum values */
export const ContentType = {
  TEXT_PLAIN: 1,
  STICKER: 2,
  IMAGE: 7,
  AUDIO: 8,
} as const;

export interface ChatMessage {
  id: string;
  text: string;
  from: string;
  alias: string;
  timestamp: number;
  chatId: string;
  localChatId: string;
  contentType: number;
  responseTo: string;
  /** Media server URL when contentType === IMAGE (7) */
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  albumId?: string;
}

/**
 * Fetch image bytes from the status-go media server.
 * The `image` field on ChatMessage is a URL like:
 *   https://localhost:<port>/messages/images?messageId=0x...
 * TLS is self-signed, so we skip certificate verification.
 */
export function fetchImageFromMediaServer(
  imageUrl: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  return new Promise((resolve) => {
    https.get(imageUrl, { agent: insecureAgent }, (res) => {
      if (res.statusCode !== 200) {
        logger.warn(
          { imageUrl, status: res.statusCode },
          'Failed to fetch image from media server',
        );
        res.resume(); // drain
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const mimeType = res.headers['content-type'] || 'image/jpeg';
        resolve({ buffer, mimeType });
      });
      res.on('error', (err) => {
        logger.warn({ err, imageUrl }, 'Error reading image response');
        resolve(null);
      });
    }).on('error', (err) => {
      logger.warn({ err, imageUrl }, 'Error fetching image from media server');
      resolve(null);
    });
  });
}

export interface ChatMessagesResponse {
  messages: ChatMessage[];
  cursor: string;
}

export async function getChatMessages(
  port: number,
  chatId: string,
  cursor: string,
  limit: number,
): Promise<ChatMessagesResponse> {
  const result = await callRPC(port, 'wakuext_chatMessages', [
    chatId,
    cursor,
    limit,
  ]);
  const data = result as { messages?: ChatMessage[]; cursor?: string } | null;
  return {
    messages: data?.messages ?? [],
    cursor: data?.cursor ?? '',
  };
}

export interface ActiveChat {
  id: string;
  name: string;
  chatType: number;
  lastMessage?: { text: string; timestamp: number };
}

export async function getActiveChats(port: number): Promise<ActiveChat[]> {
  const result = await callRPC(port, 'wakuext_activeChats', []);
  return (result as ActiveChat[] | null) ?? [];
}

export async function getAllChats(
  port: number,
): Promise<(ActiveChat & { active?: boolean })[]> {
  const result = await callRPC(port, 'wakuext_chats', []);
  return (result as (ActiveChat & { active?: boolean })[] | null) ?? [];
}

export async function createOneToOneChat(
  port: number,
  publicKey: string,
): Promise<unknown> {
  return callRPC(port, 'wakuext_createOneToOneChat', [{ id: publicKey }]);
}

export async function startMessenger(port: number): Promise<unknown> {
  return callRPC(port, 'wakuext_startMessenger', []);
}

export async function getSettings(port: number): Promise<unknown> {
  return callRPC(port, 'settings_getSettings', []);
}

export async function updateProfileDisplayName(
  port: number,
  displayName: string,
): Promise<unknown> {
  return callRPC(port, 'settings_saveSetting', ['display-name', displayName]);
}

export async function createAccount(
  port: number,
  displayName: string,
  password: string,
): Promise<{ keyUID: string }> {
  const data = await postStatusJson<{ keyUID?: string }>(
    port,
    '/statusgo/CreateAccount',
    { displayName, password },
    'CreateAccount',
  );
  if (!data.keyUID) throw new Error('CreateAccount did not return keyUID');
  return { keyUID: data.keyUID };
}
