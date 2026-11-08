/**
 * Rsbuild (Rspack + SWC) build configuration, driven by `configureRsbuild()` from hoist-dev-utils.
 * Run via `pnpm start` / `pnpm build`. See Toolbox's rsbuild.config.mjs for the available options.
 */
import configureRsbuild, {readCliEnv} from '@xh/hoist-dev-utils/configureRsbuild';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url),
    // Keep in sync with `xhAppVersion` in gradle.properties. Release builds override via
    // `XH_APP_VERSION`.
    pkg = require('./package.json');

export default ({envMode}) => {
    return configureRsbuild({
        appCode: 'hoistdocs',
        appName: 'Hoist Docs',
        appVersion: pkg.version,
        favicon: './public/favicon.svg',
        devServerOpenPage: 'admin/',
        preloadBackgroundColor: '#0f3a5f',
        prodBuild: envMode === 'prod',
        inlineHoist: envMode === 'inlineHoist',
        ...readCliEnv()
    });
};
