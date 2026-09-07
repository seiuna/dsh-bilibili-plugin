import { useEffect } from 'react';
import { useBiliStore, biliStore } from './store.js';
import { getSafeAvatarUrl } from './api.js';

export function BilibiliHeaderPill() {
  const { status } = useBiliStore();

  useEffect(() => {
    biliStore.refresh();
  }, []);

  const handleClick = () => {
    biliStore.open();
  };

  if (status.isUnlocked && status.user) {
    return (
      <div
        className="dsh-bili-pill dsh-bili-pill-authed"
        onClick={handleClick}
        title={`已登录 B 站: ${status.user.uname} (UID: ${status.user.mid})`}
      >
        {status.user.face && (
          <img
            src={getSafeAvatarUrl(status.user.face)}
            alt={status.user.uname}
            className="dsh-bili-avatar-mini"
            referrerPolicy="no-referrer"
          />
        )}
        <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status.user.uname}
        </span>
        <span style={{ fontSize: 10, color: '#FB7299', fontWeight: 'bold' }}>
          Lv.{status.user.level}
        </span>
      </div>
    );
  }

  if (status.hasVault && !status.isUnlocked) {
    const name = status.accountSummary?.uname || '账号';
    return (
      <div
        className="dsh-bili-pill dsh-bili-pill-locked"
        onClick={handleClick}
        title="B 站凭据已加锁，点击动态解密"
      >
        {status.accountSummary?.face && (
          <img
            src={getSafeAvatarUrl(status.accountSummary.face)}
            alt={name}
            className="dsh-bili-avatar-mini"
            referrerPolicy="no-referrer"
          />
        )}
        <span>解锁 B站 ({name})</span>
      </div>
    );
  }

  return (
    <div
      className="dsh-bili-pill dsh-bili-pill-unlogged"
      onClick={handleClick}
      title="点击扫码登录 Bilibili 账号"
    >
      <span>登录 B站</span>
    </div>
  );
}
