#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { extractDesignSystem } from './extractor.js';
import { generateStarterProject } from './generator.js';
import path from 'path';

/**
 * Starts the Model Context Protocol (MCP) Server over stdio so AI coding agents
 * (Cursor, Claude Code, Windsurf) can natively call steal_design_tokens.
 */
export async function startMcpServer() {
  const server = new Server(
    {
      name: 'steal-this-stack-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'steal_design_tokens',
          description:
            'Launches a real headless Chromium browser to extract exact computed CSS colors, root variables, fonts, box-shadows, border-radii, transitions, and SVGs from any live URL.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The live website URL to inspect (e.g., https://linear.app)',
              },
              generateStarterInDir: {
                type: 'string',
                description: 'Optional local folder path to write tailwind.config.js and index.html starter files',
              },
            },
            required: ['url'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'steal_design_tokens') {
      const { url, generateStarterInDir } = request.params.arguments;
      const targetUrl = url.startsWith('http') ? url : `https://${url}`;

      try {
        const designData = await extractDesignSystem(targetUrl);

        if (generateStarterInDir) {
          const outPath = path.resolve(process.cwd(), generateStarterInDir);
          await generateStarterProject(designData, outPath);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(designData, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to extract design system from ${targetUrl}: ${err.message}`,
            },
          ],
        };
      }
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Allow direct execution via `node ./src/mcp-server.js`
if (process.argv[1] && process.argv[1].endsWith('mcp-server.js')) {
  startMcpServer();
}
