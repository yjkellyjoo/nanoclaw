import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

export function registerAskCodexTool(server: McpServer): void {
  server.tool(
    'ask_codex',
    'Delegate a coding task to OpenAI Codex CLI (uses ChatGPT Pro subscription). Use when the user explicitly asks you to use Codex/OpenAI for a task, or when you want a second opinion on code generation.',
    {
      prompt: z.string().describe('The coding task to delegate to Codex'),
    },
    async (args) => {
      const authJson = process.env.CODEX_AUTH_JSON;

      if (!authJson) {
        return {
          content: [{ type: 'text' as const, text: 'Codex auth not configured. Run `codex login` on the host.' }],
          isError: true,
        };
      }

      // Write temp auth file for codex CLI
      const codexDir = path.join(process.env.HOME || '/home/node', '.codex');
      const authFile = path.join(codexDir, 'auth.json');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(authFile, authJson, { mode: 0o600 });

      try {
        const result = await new Promise<string>((resolve, reject) => {
          const child = execFile(
            'codex',
            [
              'exec',
              '--skip-git-repo-check',
              '--ephemeral',
              '-s', 'read-only',
              args.prompt,
            ],
            { timeout: 120_000, maxBuffer: 1024 * 1024 },
            (err, stdout, stderr) => {
              if (err) {
                reject(new Error(stderr || err.message));
              } else {
                resolve(stdout.trim() || stderr.trim() || 'No response');
              }
            },
          );
        });

        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        };
      } finally {
        // Clean up auth file
        try { fs.unlinkSync(authFile); } catch { /* ignore */ }
      }
    },
  );
}
