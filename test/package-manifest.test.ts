import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { name as pluginName } from '../src/index.js';

describe('package.json and DSH client bundle contract', () => {
  const root = process.cwd();
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  it('matches package.json name with the exported plugin name for DSH loader discovery', () => {
    // DSH dsh-client-modules expects the manifest name to strictly match the loader entry name.
    // A scoped name mismatch (e.g. @seiuna/dsh-bilibili-plugin vs dsh-bilibili-plugin) causes DSH
    // nearestPackage() to skip this package, resulting in the client UI not loading.
    expect(pkg.name).toBe(pluginName);
    expect(pkg.name).toBe('dsh-bilibili-plugin');
  });

  it('declares dsh.client with web platform and necessary injected modules', () => {
    expect(pkg.dsh).toBeDefined();
    expect(pkg.dsh.client).toBeDefined();
    expect(pkg.dsh.client.platform).toBe('web');
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-locale');
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-conversation');
    expect(pkg.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-slots');
  });

  it('exports ./client pointing to existing client artifact', () => {
    expect(pkg.exports).toBeDefined();
    expect(pkg.exports['./client']).toBeDefined();
    const clientRel = typeof pkg.exports['./client'] === 'string'
      ? pkg.exports['./client']
      : pkg.exports['./client'].default;
    expect(clientRel).toBe('./lib/client.js');
    expect(existsSync(join(root, clientRel))).toBe(true);
  });

  it('ensures compiled client.js registers window.__ModuleLoader__ with identical package id', () => {
    const clientBundlePath = join(root, 'lib/client.js');
    expect(existsSync(clientBundlePath)).toBe(true);
    const content = readFileSync(clientBundlePath, 'utf8');
    expect(content).toContain(`id: "${pkg.name}"`);
  });
});
