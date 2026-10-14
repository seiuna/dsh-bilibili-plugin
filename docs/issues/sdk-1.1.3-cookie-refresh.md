# SDK 1.1.3: credential refresh stores raw Set-Cookie and loses CSRF / existing cookies

## Environment

- Package: `@seiuna/bilibili-api@1.1.3`
- Runtime: Node.js 24 (native Fetch / Headers)
- Reproduction: entirely offline using the SDK's `customFetch`; no real account, profile loading, credentials, or network traffic.

## Minimal reproduction

```js
import { BiliClient } from '@seiuna/bilibili-api';

let requestNumber = 0;
const transport = async () => {
  if (++requestNumber === 1) return Response.json({ code: -101 });
  if (requestNumber === 2) {
    return Response.json(
      { code: 0, data: { refresh_token: 'synthetic-new' } },
      { headers: [
        ['set-cookie', 'SESSDATA=synthetic-session; Path=/; HttpOnly'],
        ['set-cookie', 'bili_jct=synthetic-csrf; Path=/'],
      ] },
    );
  }
  return Response.json({ code: 0 });
};
const client = new BiliClient('offline-repro', transport);
client.config.save = async () => {}; // no disk writes
client.config.data = {
  cookie: 'DedeUserID=42; SESSDATA=old; bili_jct=old',
  refreshToken: 'synthetic-old',
};
await client.request('https://api.bilibili.com/x/web-interface/nav');
console.log(client.config.data.cookie);
console.log(client.config.getCsrf());
```

All values above are synthetic placeholders.

## Expected

Refresh should merge the auth cookie pairs, retain `DedeUserID=42`, remove Set-Cookie attributes, and make `getCsrf()` return `synthetic-csrf`. The retried request and subsequent authenticated writes should receive a valid Cookie header.

## Actual

The stored Cookie value becomes:

```text
SESSDATA=synthetic-session; Path=/; HttpOnly, bili_jct=synthetic-csrf; Path=/
```

`getCsrf()` throws a missing-CSRF error. The previous `DedeUserID` is also lost.

## Implementation evidence

In the published 1.1.3 bundle, `BiliClient.performRefresh()` calls `headers.get('set-cookie')` followed by `config.updateCookie(setCookie)`. That stores a combined Set-Cookie header verbatim as a Cookie header. `ConfigManager` already provides `setAuthCookies` / `mergeCookie` capable of parsing cookie arrays, but this path does not use them.

Suggested fix: use `headers.getSetCookie()` when available (with the existing parser's safe fallback), merge only cookie name/value pairs into existing auth state, and persist refreshed cookie/token coherently. Please add an offline transport regression covering multiple Set-Cookie headers, Expires commas, preserved identity cookies, and the retried request's Cookie header.
