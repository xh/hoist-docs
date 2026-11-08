/**
 * Vitest unit test configuration, driven by `configureVitest()` from hoist-dev-utils.
 * Run via `pnpm test`. Specs live beside their source as `*.spec.ts`.
 */
import configureVitest from '@xh/hoist-dev-utils/configureVitest';
import {createRequire} from 'node:module';
import {defineConfig} from 'vitest/config';

const require = createRequire(import.meta.url),
    pkg = require('./package.json');

export default defineConfig(
    configureVitest({
        appCode: 'hoistdocs',
        appName: 'Hoist Docs',
        appVersion: pkg.version
    })
);
