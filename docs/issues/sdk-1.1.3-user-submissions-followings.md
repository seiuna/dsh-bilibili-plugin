# Feature: typed methods for user submissions and followings

## SDK version

`@seiuna/bilibili-api@1.1.3`

## Summary

`UserAPI` currently has no method for **a user's submitted videos** (`x/space/wbi/arc/search`) or **the logged-in user's followings list** (`x/relation/followings`). Consumers that need these two very common reads must hand-build the endpoint URL and query string and call `client.request(url, { wbi: true })` themselves, which reintroduces manual endpoint/parameter handling that the SDK otherwise encapsulates (cookie injection, WBI signing and credential refresh already work correctly through `client.request`).

Confirmed absent from 1.1.3: `UserAPI` exposes getInfo/getRelationStat/getUpStat/getNavNum/getMedalWall/getFans/fans/modifyRelation/nameToUid/getLoginNotice/getLoginLog/getMyInfo/getNavInfo/getMemberAccount/getRewardStatus/getTodayCoinExp/addContract/addContractMessage; the `User` entity has getStat/getUpStat/getNavNum/getMedalWall/follow/unfollow/block/unblock/contract methods, getFans/fans and getDynamics/dynamics. Neither surface covers submissions or followings (fans is the inverse relation), and no other exported API class wraps these endpoints.

## Current consumer workaround (offline, no credentials used)

```ts
// user submissions — needs WBI signing
const params = new URLSearchParams({ mid: String(mid), pn: String(page), ps: String(pageSize) });
const res = await client.request(
  `https://api.bilibili.com/x/space/wbi/arc/search?${params}`, { wbi: true });
// res.data.list.vlist, res.data.page.count

// own followings (whitelist picker)
const res2 = await client.request(
  `https://api.bilibili.com/x/relation/followings?vmid=${mid}&pn=${page}&ps=${pageSize}&order=desc`);
// res2.data.list, res2.data.total
```

## Expected

- `UserAPI.getSubmissions(client, mid, pn?, ps?)` returning a typed response with `list.vlist` (aid/bvid/title/play/created/length/pic) and `page.count`, WBI handled internally like other wbi endpoints.
- `UserAPI.getFollowings(client, vmid, pn?, ps?, order?)` returning a typed relation list (`list` entries with mid/uname/sign/avatar fields and `total`).
- Optional entity conveniences (`User.submissions()`, followings paging generator) are welcome but not required; typed single-page methods are enough.

Keeping IDs and pagination values in their authoritative types (long IDs as strings where the endpoint returns `*_str`) would be ideal.

This is a feature request, not a bug report: `client.request` works today. Filed because the SDK aims to encapsulate endpoints so consumers do not construct API URLs by hand. No account, cookie or private data is involved in this report.
