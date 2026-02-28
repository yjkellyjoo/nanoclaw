/**
 * Step: groups — List group metadata from local SQLite.
 * Replaces 05-sync-groups.sh + 05b-list-groups.sh
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { STORE_DIR } from '../src/config.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

function parseArgs(args: string[]): { list: boolean; limit: number } {
  let list = false;
  let limit = 30;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--list') list = true;
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return { list, limit };
}

export async function run(args: string[]): Promise<void> {
  const { list, limit } = parseArgs(args);

  if (list) {
    await listGroups(limit);
    return;
  }

  await syncGroups();
}

async function listGroups(limit: number): Promise<void> {
  const rows = getGroupsFromDb(limit);
  for (const row of rows) {
    console.log(`${row.jid}|${row.name}`);
  }
}

function getGroupsFromDb(limit?: number): Array<{ jid: string; name: string }> {
  const dbPath = path.join(STORE_DIR, 'messages.db');

  if (!fs.existsSync(dbPath)) {
    throw new Error('database_not_found');
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const columns = db.prepare('PRAGMA table_info(chats)').all() as Array<{
      name: string;
    }>;
    const hasIsGroup = columns.some((c) => c.name === 'is_group');

    const sql = `
      SELECT jid, name
      FROM chats
      WHERE jid <> '__group_sync__'
        AND name IS NOT NULL
        AND TRIM(name) <> ''
        AND name <> jid
        ${hasIsGroup ? 'AND is_group = 1' : ''}
      ORDER BY datetime(last_message_time) DESC
      ${typeof limit === 'number' ? 'LIMIT ?' : ''}
    `;

    return (typeof limit === 'number'
      ? db.prepare(sql).all(limit)
      : db.prepare(sql).all()) as Array<{ jid: string; name: string }>;
  } finally {
    db.close();
  }
}

async function syncGroups(): Promise<void> {
  logger.info('Loading groups from local database');
  let syncOk = false;
  let groupsInDb = 0;

  try {
    groupsInDb = getGroupsFromDb().length;
    syncOk = true;
  } catch (err) {
    logger.error({ err }, 'Failed to load groups from database');
  }

  const status = syncOk ? 'success' : 'failed';

  emitStatus('SYNC_GROUPS', {
    BUILD: 'skipped',
    SYNC: syncOk ? 'success' : 'failed',
    GROUPS_IN_DB: groupsInDb,
    STATUS: status,
    SOURCE: 'sqlite',
    ERROR: syncOk ? '' : 'db_read_failed',
    LOG: 'logs/setup.log',
  });

  if (status === 'failed') process.exit(1);
}
