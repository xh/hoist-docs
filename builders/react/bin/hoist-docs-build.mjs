#!/usr/bin/env node
/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2026 Extremely Heavy Industries Inc.
 */
import process from 'node:process';

import {run} from '../dist/cli/build-index.js';

await run(process.argv.slice(2));
