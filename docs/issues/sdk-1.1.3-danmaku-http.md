# SDK 1.1.3: getXmlDanmaku resolves HTTP error pages as danmaku XML

## Environment and offline reproduction

`@seiuna/bilibili-api@1.1.3`, Node.js 24 native Fetch. The following uses only injected transport, does not load a profile, and never sends network requests:

```js
import { BiliClient, DanmakuAPI } from '@seiuna/bilibili-api';
const client = new BiliClient('offline-repro', async () =>
  new Response('<html>forbidden</html>', {
    status: 403,
    headers: { 'content-type': 'text/html' },
  }),
);
client.config.save = async () => {};
console.log(await DanmakuAPI.getXmlDanmaku(client, 30));
```

## Expected

The XML-specific high-level API should reject the failed HTTP status, rather than returning an error document as usable danmaku data. A valid 200 XML response should remain available as a string.

## Actual

The Promise resolves to `<html>forbidden</html>`. Downstream consumers which search for `<d>` records then report an empty danmaku pool instead of the transport failure.

## Evidence and suggested regression

Published bundle `chunk-V2LYFDJN.js`, `DanmakuAPI.getXmlDanmaku`: calls `client.rawRequest(url)` followed immediately by `response.text()`, without checking `response.ok`. `rawRequest` delegates to the raw transport and also does not reject failed statuses. In contrast, `UploadAPI.uploadFromUrl` checks `res.ok`.

Please check HTTP status in `getXmlDanmaku` before returning XML and add customFetch tests for HTTP 200 XML, HTTP 403 HTML, HTTP 500 text, and network rejection. This report concerns the high-level XML method; the raw Response API may deliberately expose non-2xx responses.

The plugin now rejects non-danmaku XML to avoid presenting HTML/JSON failures as an empty result, but that cannot reliably detect a non-2xx response whose body happens to resemble XML.
