import {defineConfig, globalIgnores} from 'eslint/config';
import xhEslintConfig from '@xh/eslint-config';
import prettier from 'eslint-config-prettier';

export default defineConfig([
    {extends: [xhEslintConfig, prettier]},
    globalIgnores(['node_modules/**/*', 'indexes/**/*'])
]);
