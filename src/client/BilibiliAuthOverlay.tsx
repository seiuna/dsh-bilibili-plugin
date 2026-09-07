import { useState, useEffect, useRef } from 'react';
import { useBiliStore, biliStore } from './store.js';
import {
  generateQrcode,
  pollQrcode,
  setupVaultPassword,
  unlockVault,
  logoutVault,
  getSafeAvatarUrl,
} from './api.js';
import type { BiliUserInfo } from '../types.js';

type ViewMode = 'auto' | 'qrcode' | 'setup_pwd' | 'unlock';

export function BilibiliAuthOverlay() {
  const { isOpen, status } = useBiliStore();

  const [viewMode, setViewMode] = useState<ViewMode>('auto');

  // QR Code State
  const [qrcodeDataUrl, setQrcodeDataUrl] = useState('');
  const [qrcodeKey, setQrcodeKey] = useState('');
  const [qrStatus, setQrStatus] = useState<'waiting' | 'scanned' | 'expired' | 'loading'>('loading');
  const [statusMsg, setStatusMsg] = useState('正在申请登录二维码...');

  // Setup Password State (Post-Scan)
  const [tempToken, setTempToken] = useState('');
  const [scannedUser, setScannedUser] = useState<BiliUserInfo | null>(null);
  const [setupPwd, setSetupPwd] = useState('');
  const [setupPwdConfirm, setSetupPwdConfirm] = useState('');
  const [autoUnlockOnBoot, setAutoUnlockOnBoot] = useState(true);
  const [setupError, setSetupError] = useState('');
  const [isSubmittingPwd, setIsSubmittingPwd] = useState(false);

  // Unlock State
  const [unlockPwd, setUnlockPwd] = useState('');
  const [rememberUnlock, setRememberUnlock] = useState(true);
  const [unlockError, setUnlockError] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  const pollTimerRef = useRef<any>(null);

  const clearTimer = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // Determine actual view
  const currentView = (() => {
    if (viewMode !== 'auto') return viewMode;
    if (status.isUnlocked && status.user) return 'profile';
    if (status.hasVault && !status.isUnlocked) return 'unlock';
    return 'qrcode';
  })();

  // Trigger QR Code generation
  const startQrcode = async () => {
    clearTimer();
    setQrStatus('loading');
    setStatusMsg('正在申请登录二维码...');
    try {
      const res = await generateQrcode();
      setQrcodeDataUrl(res.qrcodeDataUrl);
      setQrcodeKey(res.qrcodeKey);
      setQrStatus('waiting');
      setStatusMsg('请使用哔哩哔哩 App 扫一扫登录');

      // Start polling
      pollTimerRef.current = setInterval(async () => {
        try {
          const poll = await pollQrcode(res.qrcodeKey);
          // status code reference from bilibili api and doucment
          if (poll.code === 86101) {
            setQrStatus('waiting');
            setStatusMsg('请使用哔哩哔哩 App 扫一扫登录');
          } else if (poll.code === 86090) {
            setQrStatus('scanned');
            setStatusMsg('已扫码！请在手机客户端点击【确认登录】');
          } else if (poll.code === 86038) {
            setQrStatus('expired');
            setStatusMsg('二维码已失效，请点击刷新');
            clearTimer();
          } else if (poll.code === 0 && poll.tempToken) {
            // 扫码成功，流转到设置密码
            clearTimer();
            setTempToken(poll.tempToken);
            setScannedUser(poll.user || null);
            setViewMode('setup_pwd');
            setSetupPwd('');
            setSetupPwdConfirm('');
            setSetupError('');
          }
        } catch {
          // ignore poll error
        }
      }, 2000);
    } catch (err: any) {
      setQrStatus('expired');
      setStatusMsg(err.message || '申请二维码失败，请重试');
    }
  };

  useEffect(() => {
    if (!isOpen) {
      clearTimer();
      setViewMode('auto');
      setUnlockPwd('');
      setUnlockError('');
      setSetupError('');
      return;
    }

    if (currentView === 'qrcode') {
      startQrcode();
    }

    return () => {
      clearTimer();
    };
  }, [isOpen, currentView]);

  if (!isOpen) return null;

  const handleClose = () => {
    clearTimer();
    biliStore.close();
  };

  // Submit Password Setup
  const handleSetupPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupPwd) {
      setSetupError('请输入主密码');
      return;
    }
    if (setupPwd !== setupPwdConfirm) {
      setSetupError('两次输入的密码不一致');
      return;
    }

    setIsSubmittingPwd(true);
    setSetupError('');
    try {
      await setupVaultPassword(tempToken, setupPwd, autoUnlockOnBoot);
      await biliStore.refresh();
      setViewMode('auto');
    } catch (err: any) {
      setSetupError(err.message || '加密保存失败');
    } finally {
      setIsSubmittingPwd(false);
    }
  };

  // Submit Unlock
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPwd) {
      setUnlockError('请输入主密码');
      return;
    }

    setIsUnlocking(true);
    setUnlockError('');
    try {
      await unlockVault(unlockPwd, rememberUnlock);
      await biliStore.refresh();
      setViewMode('auto');
    } catch (err: any) {
      setUnlockError(err.message || '密码错误，解锁失败');
    } finally {
      setIsUnlocking(false);
    }
  };

  // Logout
  const handleLogout = async () => {
    if (!confirm('确定要退出登录吗？')) return;
    try {
      await logoutVault();
      await biliStore.refresh();
      setViewMode('qrcode');
    } catch (err: any) {
      alert(err.message || '退出失败');
    }
  };

  return (
    <div className="dsh-bili-overlay-mask" onClick={handleClose}>
      <div className="dsh-bili-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="dsh-bili-modal-header">
          <div className="dsh-bili-modal-title">
            <span>哔哩哔哩账号空间</span>
          </div>
          <button className="dsh-bili-modal-close" onClick={handleClose}>
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="dsh-bili-modal-body">
          {/* 1. 已登录面板 (Profile) */}
          {currentView === 'profile' && status.user && (
            <div className="dsh-bili-user-card">
              <img
                src={getSafeAvatarUrl(status.user.face)}
                alt={status.user.uname}

                className="dsh-bili-avatar-large"
                referrerPolicy="no-referrer"
              />
              <div className="dsh-bili-uname" style={{ color: status.user.vipType > 0 ? 'rgba(239, 68, 68, 0.4)' : 'black' }}>{status.user.uname}</div>
              <div className="dsh-bili-badges">
                <span className="dsh-bili-tag dsh-bili-tag-level">
                  Lv.{status.user.level}
                </span>
                {status.user.vipType > 0 && (
                  <span className="dsh-bili-tag dsh-bili-tag-vip">大会员</span>
                )}
              </div>
              <div className="dsh-bili-sub-text" style={{ marginTop: 4 }}>
                UID: {status.user.mid} | 凭据受 AES-256-GCM 本地加密保护
              </div>

              <div style={{ width: '100%', marginTop: 20, display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="dsh-bili-btn dsh-bili-btn-secondary"
                  onClick={() => setViewMode('qrcode')}
                >
                  重新扫码 / 切换账号
                </button>
                <button
                  type="button"
                  className="dsh-bili-btn dsh-bili-btn-secondary"
                  style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                  onClick={handleLogout}
                >
                  退出
                </button>
              </div>
            </div>
          )}

          {/* 2. 启动解锁视图 (Unlock) */}
          {currentView === 'unlock' && (
            <div style={{ width: '100%' }}>
              {status.accountSummary?.face && (
                <img
                  src={getSafeAvatarUrl(status.accountSummary.face)}
                  alt="account"
                  className="dsh-bili-avatar-large"
                  style={{ margin: '0 auto 12px' }}
                  referrerPolicy="no-referrer"
                />
              )}
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
                解锁 {status.accountSummary?.uname || 'B 站'} 账号
              </div>
              <div className="dsh-bili-sub-text" style={{ marginTop: 6, marginBottom: 16 }}>
                凭据已加密保存在 DSH 仓库，请输入密码动态解密
              </div>

              <form onSubmit={handleUnlock} className="dsh-bili-form">
                <input
                  style={ { color: 'black' } }
                  type="password"
                  autoFocus
                  placeholder="输入主密码 (Master Password)"
                  className="dsh-bili-input"
                  value={unlockPwd}
                  onChange={(e) => setUnlockPwd(e.target.value)}
                />

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: '#aaa',
                    cursor: 'pointer',
                    marginTop: 4,
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rememberUnlock}
                    onChange={(e) => setRememberUnlock(e.target.checked)}
                    style={{ accentColor: '#FB7299' }}
                  />
                  <span>记住密码，下次启动 DSH 自动登录</span>
                </label>

                {unlockError && <div className="dsh-bili-error-tip">{unlockError}</div>}
                <button
                  type="submit"
                  disabled={isUnlocking}
                  className="dsh-bili-btn dsh-bili-btn-primary"
                >
                  {isUnlocking ? '正在解密并验证...' : '动态解密凭据'}
                </button>
              </form>

              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => setViewMode('qrcode')}
                >
                  重新扫码绑定
                </button>
              </div>
            </div>
          )}

          {/* 3. 扫码成功后设置主密码 (Setup Password) */}
          {currentView === 'setup_pwd' && (
            <div style={{ width: '100%' }}>
              {scannedUser?.face && (
                <img
                  src={getSafeAvatarUrl(scannedUser.face)}
                  alt="account"
                  className="dsh-bili-avatar-large"
                  style={{ margin: '0 auto 10px' }}
                  referrerPolicy="no-referrer"
                />
              )}
              <div style={{ fontSize: 16, fontWeight: 600, color: '#FB7299' }}>
                扫码成功：{scannedUser?.uname || 'B站用户'}
              </div>
              <div className="dsh-bili-sub-text" style={{ marginTop: 6, marginBottom: 14 }}>
                凭据将通过 <strong>AES-256-GCM</strong> 强加密存入 DSH 存储。
                可勾选下方选项实现每次启动自动解密，无需重复输入。
              </div>

              <form onSubmit={handleSetupPassword} className="dsh-bili-form">
                <input
                  type="password"
                  autoFocus
                  placeholder="设置主保护密码"
                  className="dsh-bili-input"
                  value={setupPwd}
                  onChange={(e) => setSetupPwd(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="再次确认密码"
                  className="dsh-bili-input"
                  value={setupPwdConfirm}
                  onChange={(e) => setSetupPwdConfirm(e.target.value)}
                />

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    color: '#aaa',
                    cursor: 'pointer',
                    marginTop: 4,
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoUnlockOnBoot}
                    onChange={(e) => setAutoUnlockOnBoot(e.target.checked)}
                    style={{ accentColor: '#FB7299' }}
                  />
                  <span>每次启动 DSH 自动解密登录（无需重复输入密码）</span>
                </label>

                {setupError && <div className="dsh-bili-error-tip">{setupError}</div>}
                <button
                  type="submit"
                  disabled={isSubmittingPwd}
                  className="dsh-bili-btn dsh-bili-btn-primary"
                >
                  {isSubmittingPwd ? '正在加密...' : '完成加密并激活使用'}
                </button>
              </form>
            </div>
          )}

          {/* 4. 纯二维码扫码登录 (QR Code Login Only) */}
          {currentView === 'qrcode' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className="dsh-bili-qrcode-box">
                {qrStatus === 'loading' ? (
                  <div style={{ color: '#888', fontSize: 13 }}>生成二维码中...</div>
                ) : (
                  <>
                    {qrcodeDataUrl && (
                      <img
                        src={qrcodeDataUrl}
                        alt="Bilibili Login QR Code"
                        className="dsh-bili-qrcode-img"
                      />
                    )}

                    {qrStatus === 'scanned' && (
                      <div className="dsh-bili-qrcode-status-scanned">
                        <span style={{ fontSize: 14 }}>已扫码，请在手机客户端确认</span>
                      </div>
                    )}

                    {qrStatus === 'expired' && (
                      <div className="dsh-bili-qrcode-mask" onClick={startQrcode}>
                        <span style={{ fontSize: 13, fontWeight: 'bold' }}>二维码已过期</span>
                        <span style={{ fontSize: 11, opacity: 0.8 }}>点击重新生成</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="dsh-bili-status-text" style={{ fontWeight: 500, color: '#FB7299' }}>
                {statusMsg}
              </div>
              <div className="dsh-bili-sub-text">
                使用手机哔哩哔哩客户端「扫一扫」安全登录
              </div>

              {status.hasVault && (
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12 }}
                    onClick={() => setViewMode('auto')}
                  >
                    返回密码解锁已有账号
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
