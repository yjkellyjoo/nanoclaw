import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

export function registerAskGeminiTool(server: McpServer): void {
  server.tool(
    'ask_gemini',
    'Delegate a task to Google Gemini. Use when the user explicitly asks you to use Gemini for a task, or when you want a second opinion. Sends a prompt to Gemini and returns the response.',
    {
      prompt: z.string().describe('The task to send to Gemini.'),
      model: z.string().optional().default('gemini-2.5-flash').describe("Gemini model to use. Defaults to 'gemini-2.5-flash'."),
      system: z.string().optional().describe('Optional system prompt for Gemini.'),
    },
    async (args) => {
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return {
          content: [{ type: 'text' as const, text: 'GEMINI_API_KEY not configured. Add it to your .env file.' }],
          isError: true,
        };
      }

      try {
        const client = new GoogleGenerativeAI(apiKey);
        const model = client.getGenerativeModel({
          model: args.model || 'gemini-2.5-flash',
          systemInstruction: args.system || 'You are an expert coding assistant.',
        });

        const result = await model.generateContent(args.prompt);
        const text = result.response.text();

        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );
}
