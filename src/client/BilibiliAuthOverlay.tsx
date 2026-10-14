import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from './request.js';
import { startQrcodeSession } from './qrcode-session.js';
import { createLatestRequest } from './async.js';
import { useBiliStore, biliStore } from './store.js';
import {
  setupVaultPassword,
  unlockVault,
  logoutVault,
  getSafeAvatarUrl,
} from './api.js';
import type { BiliUserInfo } from '../types.js';

type ViewMode = 'auto' | 'qrcode' | 'setup_pwd' | 'unlock';

export function BilibiliAuthOverlay() {
  const { isOpen, status, error: authError } = useBiliStore();

  const [viewMode, setViewMode] = useState<ViewMode>('auto');

  // QR Code State
  const [qrcodeDataUrl, setQrcodeDataUrl] = useState('');
  const [qrStatus, setQrStatus] = useState<'waiting' | 'scanned' | 'expired' | 'loading' | 'error'>('loading');
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

  const [logoutError, setLogoutError] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const stopQrcodeRef = useRef<(() => void) | null>(null);
  const actions = useRef(createLatestRequest());
  const actionBusy = useRef(false);

  const stopQrcode = useCallback(() => {
    stopQrcodeRef.current?.();
    stopQrcodeRef.current = null;
  }, []);

  // Determine actual view
  const currentView = (() => {
    if (viewMode !== 'auto') return viewMode;
    if (status.isUnlocked && status.user) return 'profile';
    if (status.hasVault && !status.isUnlocked) return 'unlock';
    return 'qrcode';
  })();

  const startQrcode = useCallback(() => {
    stopQrcode();
    setQrcodeDataUrl('');
    setQrStatus('loading');
    setStatusMsg('正在申请登录二维码...');
    stopQrcodeRef.current = startQrcodeSession({
      generated: res => {
        setQrcodeDataUrl(res.qrcodeDataUrl);
        setQrStatus('waiting');
        setStatusMsg('请使用哔哩哔哩 App 扫一扫登录');
      },
      polled: poll => {
        if (poll.code === 86101) {
          setQrStatus('waiting');
          setStatusMsg('请使用哔哩哔哩 App 扫一扫登录');
        } else if (poll.code === 86090) {
          setQrStatus('scanned');
          setStatusMsg('已扫码！请在手机客户端点击【确认登录】');
        } else if (poll.code === 86038) {
          setQrStatus('expired');
          setStatusMsg('二维码已失效，请点击刷新');
        } else if (poll.code === 0 && poll.tempToken) {
          setTempToken(poll.tempToken);
          setScannedUser(poll.user || null);
          setViewMode('setup_pwd');
          setSetupPwd('');
          setSetupPwdConfirm('');
          setSetupError('');
        }
      },
      failed: error => {
        setQrStatus('error');
        setStatusMsg(errorMessage(error, '二维码请求失败，请重试'));
      },
    });
  }, [stopQrcode]);

  useEffect(() => {
    if (!isOpen) {
      setViewMode('auto');
      setUnlockPwd('');
      setSetupPwd('');
      setSetupPwdConfirm('');
      setTempToken('');
      setScannedUser(null);
      setUnlockError('');
      setSetupError('');
      setLogoutError('');
      setIsSubmittingPwd(false);
      setIsUnlocking(false);
      setIsLoggingOut(false);
    } else if (currentView === 'qrcode') {
      startQrcode();
    }
    return stopQrcode;
  }, [isOpen, currentView, startQrcode, stopQrcode]);

  useEffect(() => {
    if (isOpen) void biliStore.refresh();
    return () => {
      actions.current.cancel();
      actionBusy.current = false;
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleClose = () => {
    stopQrcode();
    actions.current.cancel();
    actionBusy.current = false;
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

    if (actionBusy.current) return;
    actionBusy.current = true;
    const request = actions.current.begin();
    setIsSubmittingPwd(true);
    setSetupError('');
    try {
      const { user } = await setupVaultPassword(tempToken, setupPwd, autoUnlockOnBoot, request.signal);
      if (!request.isCurrent()) return;
      biliStore.setStatus({ hasVault: true, isUnlocked: true, user, accountSummary: user });
      setSetupPwd('');
      setSetupPwdConfirm('');
      setTempToken('');
      setViewMode('auto');
    } catch (error) {
      if (request.isCurrent()) setSetupError(errorMessage(error, '加密保存失败'));
    } finally {
      if (request.isCurrent()) {
        actionBusy.current = false;
        setIsSubmittingPwd(false);
      }
    }
  };

  // Submit Unlock
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPwd) {
      setUnlockError('请输入主密码');
      return;
    }

    if (actionBusy.current) return;
    actionBusy.current = true;
    const request = actions.current.begin();
    setIsUnlocking(true);
    setUnlockError('');
    try {
      const { user } = await unlockVault(unlockPwd, rememberUnlock, request.signal);
      if (!request.isCurrent()) return;
      biliStore.setStatus({ hasVault: true, isUnlocked: true, user, accountSummary: user });
      setUnlockPwd('');
      setViewMode('auto');
    } catch (error) {
      if (request.isCurrent()) setUnlockError(errorMessage(error, '密码错误，解锁失败'));
    } finally {
      if (request.isCurrent()) {
        actionBusy.current = false;
        setIsUnlocking(false);
      }
    }
  };

  // Logout
  const handleLogout = async () => {
    if (actionBusy.current || !confirm('确定要退出登录吗？')) return;
    actionBusy.current = true;
    const request = actions.current.begin();
    setIsLoggingOut(true);
    setLogoutError('');
    try {
      await logoutVault(request.signal);
      if (!request.isCurrent()) return;
      biliStore.setStatus({ hasVault: false, isUnlocked: false, user: null, accountSummary: null });
      setViewMode('qrcode');
    } catch (error) {
      if (request.isCurrent()) setLogoutError(errorMessage(error, '退出失败'));
    } finally {
      if (request.isCurrent()) {
        actionBusy.current = false;
        setIsLoggingOut(false);
      }
    }
  };

  return createPortal(
    <div className="dsh-bili-overlay-mask" onClick={handleClose}>
      <div className="dsh-bili-modal-card" style={{ maxHeight: 'calc(100dvh - 32px)' }} onClick={(e) => e.stopPropagation()}>
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
        <div className="dsh-bili-modal-body" style={{ overflowY: 'auto', minHeight: 0 }}>
          {(authError || logoutError) && <div role="alert" className="dsh-bili-error-tip">{logoutError || authError}</div>}
          {/* 1. 已登录面板 (Profile) */}
          {currentView === 'profile' && status.user && (
            <div className="dsh-bili-user-card">
              <img
                src={getSafeAvatarUrl(status.user.face)}
                alt={status.user.uname}

                className="dsh-bili-avatar-large"
                referrerPolicy="no-referrer"
              />
              <div className="dsh-bili-uname">{status.user.uname}</div>
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
                  disabled={isLoggingOut}
                >
                  {isLoggingOut ? '正在退出...' : '退出'}
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
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>
                解锁 {status.accountSummary?.uname || 'B 站'} 账号
              </div>
              <div className="dsh-bili-sub-text" style={{ marginTop: 6, marginBottom: 16 }}>
                凭据已加密保存在 DSH 仓库，请输入密码动态解密
              </div>

              <form onSubmit={handleUnlock} className="dsh-bili-form">
                <input
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

                    {(qrStatus === 'expired' || qrStatus === 'error') && (
                      <div className="dsh-bili-qrcode-mask" onClick={startQrcode}>
                        <span style={{ fontSize: 13, fontWeight: 'bold' }}>{qrStatus === 'expired' ? '二维码已过期' : '二维码请求失败'}</span>
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
    </div>,
    document.body,
  );
}
