import { defineConfig } from 'tsdown';

const PACKAGE_NAME = 'dsh-bilibili-plugin';

export default defineConfig([
  // 1. Host bundle (ESM for Node.js)
  {
    name: `${PACKAGE_NAME}/host`,
    entry: { index: 'src/index.ts' },
    tsconfig: 'tsconfig.json',
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    dts: true,
    clean: true,
  },
  // 2. Client bundle (CJS wrapped for DSH __ModuleLoader__)
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        'react-dom/client',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-locale/client',
        '@deepseek-ai/dsh-client-store',
        '@deepseek-ai/dsh-client-ui-layout/client',
        '@deepseek-ai/dsh-client-ui-primitives',
        '@deepseek-ai/dsh-client-ui-settings/client',
        '@deepseek-ai/dsh-client-ui-sidebar/client',
        '@deepseek-ai/dsh-client-ui-slots',
      ],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]);
