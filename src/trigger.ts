import { ASSISTANT_NAME } from './config.js';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTriggers(trigger: string | undefined): string[] {
  const fallback = `@${ASSISTANT_NAME}`;
  const raw = (trigger || fallback).trim();
  if (!raw) return [fallback];

  const parsed = raw
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : [fallback];
}

export function matchesGroupTrigger(
  content: string,
  trigger: string | undefined,
): boolean {
  const text = content.trim();
  if (!text) return false;

  const triggers = parseTriggers(trigger);
  return triggers.some((value) =>
    new RegExp(`^${escapeRegex(value)}\\b`, 'i').test(text),
  );
}
