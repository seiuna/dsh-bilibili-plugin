# SDK 1.1.3: comment string-ID declarations are inconsistent; reply dialog has the wrong response type

## Environment

- `@seiuna/bilibili-api@1.1.3`
- TypeScript 5.7, NodeNext module resolution
- Evidence is offline: declaration checks and fake `request` transport; no account/profile/network.

## TypeScript reproduction

```ts
import { BiliClient, CommentAPI } from '@seiuna/bilibili-api';
declare const client: BiliClient<any>;
const oid = '90071992547409931234';
const root = '90071992547409931235';

CommentAPI.getReply(client, oid, 17, root); // accepts string
client.getComment(oid, 17, root);            // TS2345: string is not assignable to number
CommentAPI.getReplies(client, oid, 17);     // TS2345
CommentAPI.getReplyDialog(client, oid, root, 17); // TS2345

const response = await CommentAPI.getReplyDialog(client, 20, 30, 17);
response.data.root; // TS2339: root does not exist on ReplyMainData
```

The installed declarations produce three TS2345 diagnostics and one TS2339 diagnostic for these lines.

## Runtime evidence (JavaScript)

```js
import { CommentAPI } from '@seiuna/bilibili-api';
const oid = '90071992547409931234';
const root = '90071992547409931235';
const calls = [];
const fakeClient = {
  request: async url => {
    calls.push(url);
    return {
      code: 0, message: '0', ttl: 1,
      data: { root: { rpid_str: root }, replies: [], page: { count: 0, size: 20 } },
    };
  },
};
const dialog = await CommentAPI.getReplyDialog(fakeClient, oid, root, 17);
await CommentAPI.getReplies(fakeClient, oid, 17);
console.log(calls, dialog.data.root);
```

The actual implementation serializes the full string IDs unchanged:

```text
/x/v2/reply/reply?type=17&oid=90071992547409931234&root=90071992547409931235&ps=20&pn=1
/x/v2/reply?type=17&oid=90071992547409931234&sort=0&nohot=0&ps=20&pn=1
```

The dialog's root object is also retained in the raw returned data. The top-level list and dialog do not share the same page/root shape.

## Expected

- Align `BiliClient.getComment`, `CommentAPI.getReplies`, and `getReplyDialog` identifier inputs with the already widened `getReply` (`number | string`). Reject unsafe numeric inputs instead of asking consumers to coerce large identifiers with `Number`.
- Introduce a dedicated dialog response type including its root and correct pagination fields.
- Consider declaring observed authoritative `oid_str`, `root_str`, and `parent_str` fields where appropriate, alongside existing `rpid_str`, so consumers need not cast to read precise identifiers.

## Published implementation references

`dist/index.d.ts`: getReplies around line 1664, getReplyDialog 1676, getReply 1701, BiliClient.getComment 3854. The implementation in `chunk-PCX6NLBK.js` around lines 137–147 uses `String(oid)` / `String(root)` and returns the raw response. Line numbers apply specifically to published 1.1.3.

The plugin currently uses a narrow, documented local declaration bridge for fallback listing, with exact string-ID regression tests. This issue does not claim that the offline fake response proves any real endpoint's availability.
