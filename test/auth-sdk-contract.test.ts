import { describe, it, expect, vi } from 'vitest';
import { BiliClient, ConfigManager } from '@seiuna/bilibili-api';
import { createMemoryClient } from '../src/auth/sdk-client.js';

describe('SDK 1.1.3 离线认证契约', () => {
  it('内存客户端不 load profile，setAuthCookies 数组不触发 profile 迁移/删除', async () => {
    const load = vi.spyOn(ConfigManager.prototype, 'load').mockRejectedValue(new Error('禁止 profile 读取'));
    const createProfile = vi.spyOn(ConfigManager.prototype, 'createProfileForUser').mockRejectedValue(new Error('禁止 profile 迁移'));
    try {
      const client = createMemoryClient();
      await client.config.setAuthCookies([
        'DedeUserID=42; Path=/; Expires=Wed, 21 Oct 2030 07:28:00 GMT',
        'SESSDATA=synthetic==; Path=/; HttpOnly',
        'bili_jct=synthetic-csrf; Secure',
      ]);
      expect(client.config.data.cookie).toBe('DedeUserID=42; SESSDATA=synthetic==; bili_jct=synthetic-csrf');
      expect(client.config.getCsrf()).toBe('synthetic-csrf');
      expect(load).not.toHaveBeenCalled();
      expect(createProfile).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });

  // 上游已确认缺陷：performRefresh 把原始 Set-Cookie 传 updateCookie 而非合并数组。
  // 这是预期失败的契约测试；SDK 修复后应去掉 .fails，绝不靠真实请求复现。
  it.fails('已知上游缺陷：自动刷新应保留原 Cookie 且只合并 Cookie 键值', async () => {
    let calls = 0;
    const transport = vi.fn(async () => {
      calls++;
      if (calls === 1) return Response.json({ code: -101 });
      if (calls === 2) return Response.json({ code: 0, data: { refresh_token: 'synthetic-new' } }, {
        headers: [
          ['set-cookie', 'SESSDATA=synthetic-session; Path=/; HttpOnly'],
          ['set-cookie', 'bili_jct=synthetic-csrf; Path=/'],
        ],
      });
      return Response.json({ code: 0 });
    });
    const client = new BiliClient('offline-repro', transport);
    client.config.save = async () => {};
    client.config.data = { cookie: 'DedeUserID=42; SESSDATA=old; bili_jct=old', refreshToken: 'synthetic-old' };
    await client.request('https://api.bilibili.com/x/web-interface/nav');
    expect(calls).toBe(3);
    expect(client.config.data.cookie).toBe('DedeUserID=42; SESSDATA=synthetic-session; bili_jct=synthetic-csrf');
    expect(client.config.getCsrf()).toBe('synthetic-csrf');
  });
});
