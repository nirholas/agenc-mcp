#!/usr/bin/env node
// @three-ws/agenc-mcp — MCP server entry point.
//
// The agent-to-agent coordination surface over stdio. AgenC (agenc.tech, by
// Tetsuo Corp) is an on-chain task marketplace + agent registry; this server is
// the FREE, read-first three.ws bridge over it, plus the identity-link path:
//   • list_tasks          — every task a creator wallet has posted
//   • get_task            — one task's status + (optional) lifecycle timeline
//   • get_agent           — an agent's on-chain registry entry (ERC-8004-style)
//   • link_agent          — resolve a three.ws identity to its AgenC agent id
//   • query_x402_services — the x402 service directory as claimable AgenC tasks
//
// A thin wrapper over the PUBLIC three.ws /api/agenc/* bridge. No keys, no
// signer, no payment — point THREE_WS_BASE at a deployment and go. (The paid
// $0.001 AgenC tools live in the flagship three.ws MCP server; these reads are
// free here.)
//
// Run standalone:
//   node packages/agenc-mcp/src/index.js
//
// Or wire into Claude Code / Cursor — see README.md.

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { def as listTasks } from './tools/list-tasks.js';
import { def as getTask } from './tools/get-task.js';
import { def as getAgent } from './tools/get-agent.js';
import { def as linkAgent } from './tools/link-agent.js';
import { def as queryX402Services } from './tools/query-x402-services.js';

// Single source of truth for the advertised server version — package.json.
const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json');

export const TOOLS = [
	listTasks,
	getTask,
	getAgent,
	linkAgent,
	queryX402Services,
];

/**
 * Construct a fully-registered McpServer without connecting a transport.
 * Registration is env-free, so this is safe to import from tests.
 * @returns {McpServer}
 */
export function buildServer() {
	const server = new McpServer(
		{ name: 'agenc-mcp', title: 'three.ws AgenC', version: PKG_VERSION },
		{
			capabilities: { tools: {} },
			instructions:
				'three.ws AgenC MCP — the agent-to-agent coordination surface. AgenC (agenc.tech, by ' +
				'Tetsuo Corp) is an on-chain task marketplace + agent registry on Solana. list_tasks shows ' +
				'every task a creator wallet has posted (state, reward, deadline, workers). get_task returns ' +
				'one task in full with an optional lifecycle timeline so an agent can audit it before claiming. ' +
				'get_agent resolves another agent\'s on-chain registry identity (ERC-8004-style: authority, ' +
				'status, capabilities, endpoint, reputation, stake) — use it to verify who you are coordinating ' +
				'with. link_agent maps a three.ws identity (ERC-8004 id, MPL-Core asset, or handle) to its ' +
				'canonical AgenC agent id and checks whether it is registered; it derives + reads, it does not ' +
				'register or sign. query_x402_services browses the x402 paid-service directory projected into ' +
				'AgenC task shape — paid work an agent can earn by calling. All data comes live from the public ' +
				'three.ws /api/agenc bridge — no API key, signer, or payment required. Every tool is read-only.',
		},
	);

	for (const tool of TOOLS) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.inputSchema,
				annotations: tool.annotations,
			},
			async (args, extra) => {
				try {
					const result = await tool.handler(args, extra);
					const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
					return { content: [{ type: 'text', text }] };
				} catch (err) {
					const payload = {
						ok: false,
						error: err?.code || 'unhandled',
						message: err?.message || String(err),
						...(err?.status ? { status: err.status } : {}),
					};
					return {
						content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
						isError: true,
					};
				}
			},
		);
	}

	return server;
}

async function main() {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(`[agenc-mcp@${PKG_VERSION}] connected over stdio with ${TOOLS.length} tools`);
}

// Connect stdio ONLY when this file is the process entry point. Importing the
// module (tests, embedding) must not grab the transport. realpath both sides:
// npm bin shims are symlinks, so argv[1] may differ from import.meta.url.
function isProcessEntryPoint() {
	if (!process.argv[1]) return false;
	try {
		return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

if (isProcessEntryPoint()) {
	main().catch((err) => {
		console.error('[agenc-mcp] fatal:', err);
		process.exit(1);
	});
}
