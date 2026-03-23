/**
 * Status Messenger channel for NanoClaw.
 * Communicates via local status-backend HTTP/WebSocket API.
 */

import fs from 'fs';
import path from 'path';

import WebSocket from 'ws';

import {
  ASSISTANT_NAME,
  GROUPS_DIR,
  STATUS_ALLOW_FROM,
  STATUS_DATA_DIR,
  STATUS_KEY_UID,
  STATUS_PASSWORD,
  STATUS_PORT,
  STATUS_PROFILE_NAME,
} from '../config.js';
import { logger } from '../logger.js';
import {
  ActiveChat,
  ChatMessage,
  ContentType,
  createOneToOneChat,
  getActiveChats,
  getAllChats,
  getChatMessages,
  getSettings,
  healthCheck,
  imageTypeMeta,
  initializeApplication,
  loginAccount,
  sendOneToOneMessage,
  sendGroupChatMessage,
  startMessenger,
  updateProfileDisplayName,
} from '../status-api.js';
import {
  Channel,
  MediaAttachment,
  OnChatMetadata,
  OnInboundMessage,
  RegisteredGroup,
} from '../types.js';

const POLL_INTERVAL_MS = 15_000;
const HEALTH_RETRY_INTERVAL_MS = 5_000;
const HEALTH_MAX_RETRIES = 24; // 2 minutes of retries
const CHAT_PAGE_SIZE = 50;
const WS_RECONNECT_DELAY_MS = 5_000;
const SIGNAL_TYPES = new Set(['messages.new', 'message.delivered']);
const GROUP_MEMBER_KEY_FIELDS = ['id', 'publicKey', 'pubKey', 'pk', 'key'];

export interface StatusChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class StatusChannel implements Channel {
  name = 'status';

  private connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private lastSeenId: Record<string, string> = {};
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private polling = false;
  private activeChats: ActiveChat[] = [];
  private blockedDmChats = new Set<string>();
  private loggedBlockedGroupChats = new Set<string>();
  private botPublicKey = '';
  private readonly allowedAdminSet = new Set(
    STATUS_ALLOW_FROM.map((pk) => pk.toLowerCase()),
  );

  constructor(private readonly opts: StatusChannelOpts) {}

  async connect(): Promise<void> {
    logger.info('Waiting for status-backend health check...');
    if (!(await this.retryUntil(() => healthCheck(STATUS_PORT)))) {
      throw new Error(
        `status-backend not healthy after ${HEALTH_MAX_RETRIES} retries`,
      );
    }
    logger.info('status-backend is healthy');

    await initializeApplication(STATUS_PORT, STATUS_DATA_DIR);
    logger.info('Application initialized');
    await loginAccount(STATUS_PORT, STATUS_KEY_UID, STATUS_PASSWORD);
    logger.info('Logged in to Status account');

    logger.info('Waiting for Waku messenger to be ready...');
    if (
      !(await this.retryUntil(async () => {
        try {
          await startMessenger(STATUS_PORT);
          return true;
        } catch {
          return false;
        }
      }))
    ) {
      throw new Error('Failed to start Waku messenger after retries');
    }
    logger.info('Waku messenger started');

    const settings = await this.loadSettings();
    await this.syncProfileName(settings);
    await this.ensureAllowedChatsActive();
    await this.refreshActiveChats();

    this.connected = true;

    this.pollTimer = setInterval(() => {
      this.pollMessages().catch((err) =>
        logger.error({ err }, 'Status message poll error'),
      );
    }, POLL_INTERVAL_MS);

    this.connectWebSocket();

    this.flushOutgoingQueue().catch((err) =>
      logger.error({ err }, 'Failed to flush Status outgoing queue'),
    );

    logger.info('Status channel connected');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const prefixed = this.withAssistantPrefix(text);

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.info(
        {
          jid,
          length: prefixed.length,
          queueSize: this.outgoingQueue.length,
        },
        'Status disconnected, message queued',
      );
      return;
    }

    try {
      await this.sendStatusMessage(jid, prefixed);
      logger.info({ jid, length: prefixed.length }, 'Status message sent');
    } catch (err) {
      this.outgoingQueue.push({ jid, text: prefixed });
      logger.warn(
        { jid, err, queueSize: this.outgoingQueue.length },
        'Failed to send Status message, queued',
      );
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    if (this.isStatusPublicKey(jid)) return true;
    const sep = jid.lastIndexOf('-');
    if (sep !== -1 && this.isStatusPublicKey(jid.slice(sep + 1))) return true;
    // Status group chat IDs may not contain a public key suffix —
    // check if it's a known active chat from the Status backend.
    return this.activeChats.some((c) => c.id === jid);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.info('Status channel disconnected');
  }

  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {}

  private withAssistantPrefix(text: string): string {
    return `${ASSISTANT_NAME}: ${text}`;
  }

  private async retryUntil(task: () => Promise<boolean>): Promise<boolean> {
    for (let i = 0; i < HEALTH_MAX_RETRIES; i++) {
      if (await task()) return true;
      await this.sleep(HEALTH_RETRY_INTERVAL_MS);
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async loadSettings(): Promise<Record<string, unknown>> {
    try {
      const settings = (await getSettings(STATUS_PORT)) as Record<
        string,
        unknown
      >;
      const publicKey = settings['public-key'];
      if (typeof publicKey === 'string') {
        this.botPublicKey = publicKey;
        logger.info(
          { botPublicKey: `${publicKey.slice(0, 16)}...` },
          'Bot public key loaded',
        );
      }
      return settings;
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch bot public key from settings');
      return {};
    }
  }

  private async ensureAllowedChatsActive(): Promise<void> {
    for (const pk of STATUS_ALLOW_FROM) {
      try {
        await createOneToOneChat(STATUS_PORT, pk);
        logger.info({ pk: pk.slice(0, 16) + '...' }, 'Ensured chat active');
      } catch (err) {
        logger.warn(
          { pk: pk.slice(0, 16) + '...', err },
          'Failed to activate chat',
        );
      }
    }
  }

  private async syncProfileName(
    settings: Record<string, unknown>,
  ): Promise<void> {
    const configuredProfileName = STATUS_PROFILE_NAME.trim();
    if (!configuredProfileName) return;

    const currentProfileName =
      typeof settings['display-name'] === 'string'
        ? settings['display-name'].trim()
        : '';
    if (currentProfileName === configuredProfileName) return;

    try {
      await updateProfileDisplayName(STATUS_PORT, configuredProfileName);
      logger.info(
        { profileName: configuredProfileName },
        'Updated Status profile display name',
      );
    } catch (err) {
      logger.warn(
        { err, profileName: configuredProfileName },
        'Failed to update Status profile display name',
      );
    }
  }

  private async refreshActiveChats(): Promise<void> {
    try {
      this.activeChats = await getActiveChats(STATUS_PORT);
      logger.debug(
        { count: this.activeChats.length },
        'Refreshed active chats',
      );
    } catch (err) {
      logger.debug({ err }, 'activeChats failed, falling back to getAllChats');
      try {
        const all = await getAllChats(STATUS_PORT);
        this.activeChats = all.filter((c) => c.active !== false);
        logger.debug(
          { count: this.activeChats.length },
          'Refreshed chats via fallback',
        );
      } catch (err2) {
        logger.warn({ err: err2 }, 'Failed to refresh chats (both methods)');
      }
    }
  }

  private async pollMessages(): Promise<void> {
    if (!this.connected || this.polling) return;
    this.polling = true;
    try {
      await this.doPollMessages();
    } finally {
      this.polling = false;
    }
  }

  private async doPollMessages(): Promise<void> {
    await this.refreshActiveChats();
    const groups = this.opts.registeredGroups();

    for (const chat of this.activeChats) {
      const chatId = chat.id;
      const isGroupChat = this.isGroupChat(chat);

      if (this.shouldSkipChat(chat, isGroupChat)) continue;

      const sorted = await this.getSortedChatMessages(chatId);
      if (!sorted || sorted.length === 0) continue;

      if (this.primeCursorIfNeeded(chatId, sorted, isGroupChat)) continue;

      const newMessages = this.getNewMessages(chatId, sorted);
      if (newMessages.length === 0) continue;

      const lastMessage = newMessages[newMessages.length - 1];
      this.opts.onChatMetadata(
        chatId,
        new Date(lastMessage.timestamp).toISOString(),
        chat.name || undefined,
        'status',
        isGroupChat,
      );

      if (!groups[chatId]) continue;
      this.forwardInboundMessages(chatId, newMessages);
    }
  }

  private shouldSkipChat(chat: ActiveChat, isGroupChat: boolean): boolean {
    if (!this.isAdminFilterEnabled()) return false;

    if (!isGroupChat) {
      return this.blockedDmChats.has(chat.id);
    }

    // Registered groups always pass — the admin explicitly registered them
    const groups = this.opts.registeredGroups();
    if (groups[chat.id]) return false;

    if (this.isAllowedGroupChat(chat)) {
      this.loggedBlockedGroupChats.delete(chat.id);
      return false;
    }

    if (!this.loggedBlockedGroupChats.has(chat.id)) {
      logger.warn(
        { chatId: chat.id },
        'Ignoring Status group chat without configured admin member (check STATUS_ALLOW_FROM and members field)',
      );
      this.loggedBlockedGroupChats.add(chat.id);
    }
    return true;
  }

  private async getSortedChatMessages(
    chatId: string,
  ): Promise<ChatMessage[] | null> {
    try {
      const { messages } = await getChatMessages(
        STATUS_PORT,
        chatId,
        '',
        CHAT_PAGE_SIZE,
      );
      return [...messages].sort((a, b) => a.timestamp - b.timestamp);
    } catch (err) {
      logger.warn({ chatId, err }, 'Failed to poll messages for chat');
      return null;
    }
  }

  private primeCursorIfNeeded(
    chatId: string,
    sorted: ChatMessage[],
    isGroupChat: boolean,
  ): boolean {
    if (this.lastSeenId[chatId]) return false;

    if (
      this.isAdminFilterEnabled() &&
      !isGroupChat &&
      !this.isAdminInitiatedChat(sorted)
    ) {
      this.blockedDmChats.add(chatId);
      logger.debug(
        { chatId },
        'Ignoring Status chat not initiated by configured admin account',
      );
    }

    this.lastSeenId[chatId] = sorted[sorted.length - 1].id;
    return true;
  }

  private getNewMessages(chatId: string, sorted: ChatMessage[]): ChatMessage[] {
    const lastSeen = this.lastSeenId[chatId];
    if (!lastSeen) return [];

    const lastSeenIdx = sorted.findIndex((msg) => msg.id === lastSeen);
    const newMessages =
      lastSeenIdx === -1 ? sorted : sorted.slice(lastSeenIdx + 1);
    if (newMessages.length === 0) return [];

    this.lastSeenId[chatId] = newMessages[newMessages.length - 1].id;
    return newMessages;
  }

  private forwardInboundMessages(
    chatId: string,
    messages: ChatMessage[],
  ): void {
    const groups = this.opts.registeredGroups();
    const group = groups[chatId];

    for (const msg of messages) {
      if (!this.isDeliverableInboundMessage(msg)) continue;

      let attachments: MediaAttachment[] | undefined;
      if (msg.contentType === ContentType.IMAGE && msg.image?.payload) {
        const saved = this.saveImageAttachment(msg, group);
        if (saved) attachments = [saved];
      }

      const content =
        msg.text ||
        (attachments ? `[image: ${attachments[0].filename}]` : '');

      this.opts.onMessage(chatId, {
        id: msg.id,
        chat_jid: chatId,
        sender: msg.from,
        sender_name: msg.alias || msg.from.slice(0, 10),
        content,
        timestamp: new Date(msg.timestamp).toISOString(),
        is_from_me: false,
        is_bot_message: false,
        attachments,
      });
    }
  }

  private isDeliverableInboundMessage(msg: ChatMessage): boolean {
    const isText = msg.contentType === ContentType.TEXT_PLAIN && !!msg.text;
    const isImage =
      msg.contentType === ContentType.IMAGE && !!msg.image?.payload;

    if (!isText && !isImage) return false;
    if (this.botPublicKey && msg.from === this.botPublicKey) return false;
    if (msg.text && msg.text.startsWith(this.withAssistantPrefix('')))
      return false;
    return true;
  }

  private saveImageAttachment(
    msg: ChatMessage,
    group?: RegisteredGroup,
  ): MediaAttachment | null {
    if (!msg.image?.payload) return null;

    const { ext, mime } = imageTypeMeta(msg.image.type);
    const filename = `img-${msg.id.slice(0, 12)}.${ext}`;

    // Save into the group's media directory (accessible from the container)
    const groupFolder = group?.folder ?? 'unknown';
    const mediaDir = path.join(GROUPS_DIR, groupFolder, 'media');
    try {
      fs.mkdirSync(mediaDir, { recursive: true });
    } catch (err) {
      logger.warn({ err, mediaDir }, 'Failed to create media directory');
      return null;
    }

    const filePath = path.join(mediaDir, filename);
    // Store path relative to group dir so it works inside containers
    // (host: groups/{folder}/media/file, container: /workspace/group/media/file)
    const relativePath = `media/${filename}`;
    try {
      const buffer = Buffer.from(msg.image.payload, 'base64');
      fs.writeFileSync(filePath, buffer);
      logger.info(
        { filename, size: buffer.length, chatId: msg.chatId },
        'Saved image attachment',
      );
      return { filename, path: relativePath, mimeType: mime, size: buffer.length };
    } catch (err) {
      logger.warn({ err, filename }, 'Failed to save image attachment');
      return null;
    }
  }

  private isAdminFilterEnabled(): boolean {
    return this.allowedAdminSet.size > 0;
  }

  private isStatusPublicKey(value: string): boolean {
    return /^0x(?:04|00)[0-9a-f]+$/i.test(value);
  }

  private isAllowedAdmin(pk: string): boolean {
    if (!this.isAdminFilterEnabled()) return true;
    return this.allowedAdminSet.has(pk.toLowerCase());
  }

  private isGroupChat(chat: ActiveChat): boolean {
    return chat.chatType !== 1;
  }

  private isAllowedGroupChat(chat: ActiveChat): boolean {
    if (!this.isAdminFilterEnabled()) return true;
    const members = this.getChatMemberPublicKeys(chat);
    return members.some((pk) => this.isAllowedAdmin(pk));
  }

  private getChatMemberPublicKeys(chat: ActiveChat): string[] {
    const members = (chat as unknown as Record<string, unknown>)['members'];
    if (!Array.isArray(members)) return [];
    return members
      .map((member) => this.extractMemberPublicKey(member))
      .filter((pk): pk is string => Boolean(pk));
  }

  private extractMemberPublicKey(member: unknown): string | null {
    if (typeof member === 'string') return member;
    if (!member || typeof member !== 'object') return null;
    const rec = member as Record<string, unknown>;
    for (const field of GROUP_MEMBER_KEY_FIELDS) {
      const value = rec[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
  }

  private isAdminInitiatedChat(messages: ChatMessage[]): boolean {
    if (!this.isAdminFilterEnabled()) return true;
    const initiator = messages.find(
      (msg) => !this.botPublicKey || msg.from !== this.botPublicKey,
    );
    if (!initiator) return false;
    return this.isAllowedAdmin(initiator.from);
  }

  private connectWebSocket(): void {
    const wsUrl = `ws://127.0.0.1:${STATUS_PORT}/signals`;
    logger.info({ wsUrl }, 'Connecting to Status signals WebSocket');

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      logger.warn({ err }, 'Failed to create WebSocket, polling only');
      return;
    }

    this.ws.on('open', () => {
      logger.info('Status signals WebSocket connected');
    });

    this.ws.on('message', (data) => {
      try {
        const signal = JSON.parse(data.toString());
        if (SIGNAL_TYPES.has(signal.type)) {
          this.pollMessages().catch((err) =>
            logger.debug({ err }, 'Signal-triggered poll error (non-critical)'),
          );
        }
      } catch {}
    });

    this.ws.on('close', () => {
      this.ws = null;
      logger.info('Status signals WebSocket closed');
      if (this.connected) {
        setTimeout(() => this.connectWebSocket(), WS_RECONNECT_DELAY_MS);
      }
    });

    this.ws.on('error', (err) => {
      logger.debug({ err }, 'Status WebSocket error');
    });
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing Status outgoing queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift();
        if (!item) break;
        await this.sendStatusMessage(item.jid, item.text);
        logger.info(
          { jid: item.jid, length: item.text.length },
          'Queued Status message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }

  private async sendStatusMessage(jid: string, text: string): Promise<void> {
    if (this.isStatusPublicKey(jid)) {
      await sendOneToOneMessage(STATUS_PORT, jid, text);
      return;
    }
    await sendGroupChatMessage(STATUS_PORT, jid, text);
  }
}
