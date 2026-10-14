import { afterEach, beforeEach, vi } from 'vitest';

// Default suite is offline. A test must explicitly replace fetch with its own fake.
// The opt-in static profile preview remains separately controlled by BILI_STATIC_TEST.
if (process.env.BILI_STATIC_TEST !== '1') {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('离线测试禁止真实网络请求；请显式 mock fetch/SDK transport');
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
}
