#!/usr/bin/env node
// Launcher for the published package, a stable path for .mcp.json:
//   {"command": "node", "args": ["client-app/node_modules/@xh/hoist-docs/bin/hoist-docs.mjs"]}
// Runs the compiled CLI. During development, run the source directly: node src/cli.ts
import process from 'node:process';

import {run} from '../dist/cli.js';

await run(process.argv.slice(2));
