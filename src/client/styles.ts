export const CSS_TAG_ID = 'dsh-bilibili-plugin/styles';

export const styles = `
/* Header Pill */
.dsh-bili-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 13px;
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}

.dsh-bili-pill-unlogged {
  background: rgba(251, 114, 153, 0.12);
  border: 1px solid rgba(251, 114, 153, 0.4);
  color: #FB7299;
}
.dsh-bili-pill-unlogged:hover {
  background: rgba(251, 114, 153, 0.22);
  border-color: #FB7299;
  transform: translateY(-1px);
}

.dsh-bili-pill-locked {
  background: rgba(251, 114, 153, 0.12);
  border: 1px solid rgba(251, 114, 153, 0.4);
  color: #FB7299;
  animation: dsh-bili-pulse 2s infinite ease-in-out;
}
.dsh-bili-pill-locked:hover {
  background: rgba(251, 114, 153, 0.22);
  border-color: #FB7299;
}

.dsh-bili-pill-authed {
  background: var(--dsw-alias-bg-layer-1, #252526);
  border: 1px solid var(--dsw-alias-border-l2, #3c3c3c);
  color: var(--dsw-alias-label-primary, #cccccc);
}
.dsh-bili-pill-authed:hover {
  border-color: #FB7299;
  color: #FB7299;
}

.dsh-bili-avatar-mini {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid #FB7299;
}

/* Modal Overlay */
.dsh-bili-overlay-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: dsh-bili-fade-in 0.18s ease-out;
}

.dsh-bili-modal-card {
  position: relative;
  width: 90%;
  max-width: 440px;
  background: var(--dsw-alias-bg-layer-1, #1e1e1e);
  border: 1px solid var(--dsw-alias-border-l1, #333333);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--dsw-alias-label-primary, #e0e0e0);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  animation: dsh-bili-scale-up 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.dsh-bili-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #2d2d2d);
  background: var(--dsw-alias-bg-layer-2, #252526);
}

.dsh-bili-modal-title {
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  color: #FB7299;
}

.dsh-bili-modal-close {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary, #888888);
  border-radius: 4px;
  padding: 4px 8px;
  line-height: 1;
}
.dsh-bili-modal-close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.1);
}

.dsh-bili-modal-body {
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* QR Code Section */
.dsh-bili-qrcode-box {
  position: relative;
  width: 200px;
  height: 200px;
  background: #ffffff;
  border-radius: 10px;
  padding: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.dsh-bili-qrcode-img {
  width: 184px;
  height: 184px;
  display: block;
}

.dsh-bili-qrcode-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(2px);
}

.dsh-bili-qrcode-status-scanned {
  position: absolute;
  inset: 0;
  background: rgba(251, 114, 153, 0.92);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #fff;
  font-weight: bold;
}

.dsh-bili-status-text {
  font-size: 13px;
  color: #FB7299;
  margin-bottom: 8px;
}

.dsh-bili-sub-text {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #888888);
}

/* Inputs & Form */
.dsh-bili-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 10px;
}

.dsh-bili-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1, #444444);
  background: var(--dsw-alias-bg-layer-3, #2b2b2b);
  color: #ffffff;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}
.dsh-bili-input:focus {
  border-color: #FB7299;
}

.dsh-bili-btn {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.dsh-bili-btn-primary {
  background: #FB7299;
  color: #ffffff;
}
.dsh-bili-btn-primary:hover {
  background: #E05D84;
}
.dsh-bili-btn-primary:disabled {
  background: #555555;
  cursor: not-allowed;
}

.dsh-bili-btn-secondary {
  background: var(--dsw-alias-bg-layer-2, #333333);
  color: #cccccc;
  border: 1px solid var(--dsw-alias-border-l2, #444444);
}
.dsh-bili-btn-secondary:hover {
  background: var(--dsw-alias-bg-layer-3, #444444);
  color: #ffffff;
}

/* User Card */
.dsh-bili-user-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 0;
}

.dsh-bili-avatar-large {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid #FB7299;
  box-shadow: 0 4px 14px rgba(251, 114, 153, 0.3);
}

.dsh-bili-uname {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
}

.dsh-bili-badges {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dsh-bili-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
}
.dsh-bili-tag-level {
  background: #FB7299;
  color: #ffffff;
}
.dsh-bili-tag-vip {
  background: #00AEEC;
  color: #ffffff;
}

.dsh-bili-error-tip {
  color: #ef4444;
  font-size: 12px;
  margin-top: 6px;
}

@keyframes dsh-bili-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes dsh-bili-scale-up {
  from { transform: scale(0.94); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes dsh-bili-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}
`;

export function installStyles(): () => void {
  if (document.getElementById(CSS_TAG_ID)) {
    return () => {};
  }
  const styleEl = document.createElement('style');
  styleEl.id = CSS_TAG_ID;
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);
  return () => {
    styleEl.remove();
  };
}
