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
  background: var(--dsw-alias-bg-layer-2, #f5f5f5);
  border: 1px solid var(--dsw-alias-border-l2, #e0e0e0);
  color: var(--dsw-alias-label-primary, #222222);
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
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, #e0e0e0);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--dsw-alias-label-primary, #222222);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  animation: dsh-bili-scale-up 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.dsh-bili-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e5e5);
  background: var(--dsw-alias-bg-layer-2, #f7f7f7);
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
  color: var(--dsw-alias-label-secondary, #666666);
  border-radius: 4px;
  padding: 4px 8px;
  line-height: 1;
}
.dsh-bili-modal-close:hover {
  color: var(--dsw-alias-label-primary, #111111);
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
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
  border: 1px solid var(--dsw-alias-border-l2, #e0e0e0);
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
  color: #ffffff;
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
  color: #ffffff;
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
  border: 1px solid var(--dsw-alias-border-l2, #cccccc);
  background: var(--dsw-alias-bg-layer-2, #fafafa);
  color: var(--dsw-alias-label-primary, #111111);
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
  background: #999999;
  cursor: not-allowed;
}

.dsh-bili-btn-secondary {
  background: var(--dsw-alias-bg-layer-2, #eeeeee);
  color: var(--dsw-alias-label-primary, #333333);
  border: 1px solid var(--dsw-alias-border-l2, #cccccc);
}
.dsh-bili-btn-secondary:hover {
  background: var(--dsw-alias-interactive-bg-hover, #e0e0e0);
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
  color: var(--dsw-alias-label-primary, #111111);
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

/* Header Pill Container & Hover Dropdown */
.dsh-bili-pill-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.dsh-bili-dropdown {
  position: fixed;
  width: 320px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, #e0e0e0);
  box-shadow: 0 4px 20px rgb(0 0 0 / 10%), 0 1px 4px rgb(0 0 0 / 4%);
  border-radius: 12px;
  padding: 16px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 72px);
  overflow-y: auto;
  scrollbar-width: thin;
  font-family: inherit;
  line-height: 1.5;
  z-index: 999999;
  color: var(--dsw-alias-label-primary, #222222);
  font-size: 12px;
  animation: dsh-bili-fade-in 0.15s ease-out;
  box-sizing: border-box;
}

.dsh-bili-dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e5e5);
}

.dsh-bili-dropdown-title {
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}

.dsh-bili-dropdown-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.dsh-bili-dropdown-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-tertiary, #888888);
  text-transform: uppercase;
}

.dsh-bili-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: var(--dsw-alias-label-primary, #222222);
  transition: color 0.12s ease;
}
.dsh-bili-check-row:hover {
  color: #FB7299;
}

.dsh-bili-whitelist-box {
  max-height: 140px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--dsw-alias-bg-layer-2, #f5f5f5);
  padding: 6px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2, #e0e0e0);
}

.dsh-bili-whitelist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.03));
  color: var(--dsw-alias-label-primary, #222222);
  transition: background 0.12s ease;
}
.dsh-bili-whitelist-item:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
}

.dsh-bili-whitelist-info {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.dsh-bili-remove-btn {
  background: transparent;
  border: none;
  color: var(--dsw-alias-label-tertiary, #888888);
  cursor: pointer;
  padding: 2px 5px;
  font-size: 11px;
  border-radius: 3px;
}
.dsh-bili-remove-btn:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
}

.dsh-bili-mini-input {
  flex: 1;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--dsw-alias-border-l2, #cccccc);
  background: var(--dsw-alias-bg-layer-2, #fafafa);
  color: var(--dsw-alias-label-primary, #111111);
  font-size: 12px;
  outline: none;
}
.dsh-bili-mini-input:focus {
  border-color: #FB7299;
}

.dsh-bili-mini-btn {
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  background: #FB7299;
  color: #ffffff;
  white-space: nowrap;
  transition: background 0.12s ease;
}
.dsh-bili-mini-btn:hover {
  background: #E05D84;
}

.dsh-bili-user-preview-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  background: rgba(251, 114, 153, 0.08);
  border: 1px solid rgba(251, 114, 153, 0.25);
  border-radius: 6px;
  margin-top: 6px;
}
/* Match DSH floating menus; keep branding on the header pill only. */
.dsh-bili-dropdown .dsh-bili-dropdown-section { gap: 8px; margin-bottom: 16px; }
.dsh-bili-dropdown .dsh-bili-dropdown-label {
  font-size: 12px; font-weight: 500; text-transform: none;
  color: var(--dsw-alias-label-secondary);
}
.dsh-bili-dropdown .dsh-bili-check-row {
  min-height: 28px; border-radius: 6px; padding: 2px 4px; margin: 0 -4px;
}
.dsh-bili-dropdown .dsh-bili-check-row:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-bili-dropdown input[type="checkbox"] {
  accent-color: var(--dsw-alias-label-primary) !important;
  width: 14px; height: 14px; margin: 0; flex-shrink: 0;
}
.dsh-bili-dropdown .dsh-bili-mini-input {
  min-width: 0; min-height: 34px; padding: 7px 10px; border-radius: 8px;
  font-family: inherit; font-size: 12px !important;
  background: var(--dsw-alias-bg-layer-1);
  border-color: var(--dsw-alias-border-l2);
}
.dsh-bili-dropdown select option, .dsh-bili-dropdown select optgroup {
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
}
.dsh-bili-dropdown :is(input, select, textarea, button):focus-visible {
  outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px;
}
.dsh-bili-dropdown .dsh-bili-mini-input:focus { border-color: var(--dsw-alias-label-tertiary); }
.dsh-bili-image-limits-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  align-items: end;
}
.dsh-bili-image-limit-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  color: var(--dsw-alias-label-secondary, #666666);
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}
.dsh-bili-dropdown .dsh-bili-image-limit-field .dsh-bili-mini-input {
  width: 100%;
  max-width: none;
  min-width: 0;
  flex: none;
}
.dsh-bili-dropdown .dsh-bili-mini-btn {
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
.dsh-bili-dropdown .dsh-bili-mini-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-bili-dropdown button:not(.dsh-bili-remove-btn) { color: var(--dsw-alias-label-primary) !important; font-family: inherit; }
.dsh-bili-dropdown :disabled { opacity: .5; cursor: not-allowed; }
.dsh-bili-dropdown .dsh-bili-whitelist-box { border-radius: 8px; padding: 4px; }
.dsh-bili-dropdown .dsh-bili-whitelist-item { border-radius: 6px; padding: 8px; }
.dsh-bili-dropdown .dsh-bili-user-preview-card {
  background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); border-radius: 8px;
}

/* Portal Container for Side-by-Side Panels */
.dsh-bili-portal-wrap {
  position: fixed;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  z-index: 999999;
  pointer-events: auto;
  animation: dsh-bili-fade-in 0.15s ease-out;
  box-sizing: border-box;
  max-width: calc(100vw - 20px);
}

.dsh-bili-portal-wrap .dsh-bili-dropdown {
  position: static;
  animation: none;
}

/* Recent Messages Panel (Right Floating Box) */
.dsh-bili-recent-panel {
  width: 350px;
  height: 540px;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l1, #e0e0e0);
  box-shadow: 0 4px 20px rgb(0 0 0 / 10%), 0 1px 4px rgb(0 0 0 / 4%);
  border-radius: 12px;
  padding: 16px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 72px);
  overflow: hidden;
  font-family: inherit;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, #222222);
  font-size: 12px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.dsh-bili-recent-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e5e5);
}

.dsh-bili-recent-title {
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsh-bili-recent-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(251, 114, 153, 0.15);
  color: #FB7299;
}

.dsh-bili-recent-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsh-bili-recent-action-btn {
  background: none;
  border: none;
  color: var(--dsw-alias-label-tertiary, #888888);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 4px;
  transition: all 0.12s ease;
}
.dsh-bili-recent-action-btn:hover {
  color: #FB7299;
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
}

.dsh-bili-recent-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.15)) transparent;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 4px;
}

.dsh-bili-recent-list::-webkit-scrollbar {
  width: 5px;
}
.dsh-bili-recent-list::-webkit-scrollbar-track {
  background: transparent;
}
.dsh-bili-recent-list::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2, rgba(0, 0, 0, 0.15));
  border-radius: 4px;
}
.dsh-bili-recent-list::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l2, rgba(0, 0, 0, 0.3));
}

.dsh-bili-recent-card {
  background: var(--dsw-alias-bg-layer-2, #f8f9fa);
  border: 1px solid var(--dsw-alias-border-l2, #e5e5e5);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.12s ease;
  flex-shrink: 0;
}
.dsh-bili-recent-card:hover {
  border-color: rgba(251, 114, 153, 0.4);
}

.dsh-bili-recent-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.dsh-bili-recent-user {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.dsh-bili-recent-avatar {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(251, 114, 153, 0.3);
}

.dsh-bili-recent-uname {
  font-size: 11px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #111111);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-bili-recent-time {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #999999);
  white-space: nowrap;
  flex-shrink: 0;
}

.dsh-bili-recent-source {
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #666666);
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-bili-recent-tag {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 500;
  background: var(--dsw-alias-border-l2, #e0e0e0);
  color: var(--dsw-alias-label-secondary, #555555);
  flex-shrink: 0;
}

.dsh-bili-recent-tag-video {
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
}

.dsh-bili-recent-tag-dynamic {
  background: rgba(251, 114, 153, 0.15);
  color: #FB7299;
}

.dsh-bili-recent-title-link {
  color: var(--dsw-alias-label-secondary, #555);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-bili-recent-title-link:hover {
  color: #FB7299;
  text-decoration: underline;
}

.dsh-bili-recent-message {
  font-size: 11px;
  color: var(--dsw-alias-label-primary, #222222);
  line-height: 1.4;
  word-break: break-word;
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2, #eeeeee);
  border-radius: 6px;
  padding: 6px 8px;
}

.dsh-bili-recent-reply {
  font-size: 11px;
  line-height: 1.4;
  word-break: break-word;
  padding: 6px 8px;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dsh-bili-recent-reply-success {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.25);
  color: #16a34a;
}

/* DSH 风格的处理中卡片 */
.dsh-bili-recent-reply-processing {
  background: var(--dsw-alias-bg-layer-1, #ffffff);
  border: 1px solid var(--dsh-state-ongoing, #4d6bfe);
  box-shadow: 0 0 10px rgba(77, 107, 254, 0.12);
  padding: 8px 10px;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dsh-bili-processing-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--dsh-state-ongoing, #4d6bfe);
}

.dsh-bili-processing-hint {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, #888888);
  line-height: 1.4;
}

/* DSH 原生风格双层同心呼吸点 */
.dsh-state-dot-ongoing {
  position: relative;
  display: inline-block;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  color: var(--dsh-state-ongoing, #4d6bfe);
}
.dsh-state-dot-ongoing:before {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.25;
  animation: dsh-state-dot-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
}
.dsh-state-dot-ongoing:after {
  content: "";
  position: absolute;
  inset: 1px;
  border-radius: 50%;
  background: currentColor;
}
@keyframes dsh-state-dot-ping {
  0% {
    transform: scale(0.8);
    opacity: 0.5;
  }
  50% {
    transform: scale(1.6);
    opacity: 0;
  }
  100% {
    transform: scale(0.8);
    opacity: 0;
  }
}

/* DSH 风格的三段波形渐进动画 */
.dsh-bili-pulse-bars {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}
.dsh-bili-pulse-bars span {
  width: 3px;
  height: 8px;
  border-radius: 1.5px;
  background: var(--dsh-state-ongoing, #4d6bfe);
  opacity: 0.3;
  animation: dsh-bar-pulse 1.2s ease-in-out infinite;
}
.dsh-bili-pulse-bars span:nth-child(1) { animation-delay: 0s; }
.dsh-bili-pulse-bars span:nth-child(2) { animation-delay: 0.2s; }
.dsh-bili-pulse-bars span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dsh-bar-pulse {
  0%, 100% {
    transform: scaleY(0.6);
    opacity: 0.3;
  }
  50% {
    transform: scaleY(1.4);
    opacity: 0.9;
  }
}

.dsh-bili-recent-reply-failed {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #ef4444;
}

.dsh-bili-recent-reply-ignored {
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.04));
  color: var(--dsw-alias-label-tertiary, #888888);
}

.dsh-bili-recent-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 16px;
  color: var(--dsw-alias-label-tertiary, #888888);
  font-size: 12px;
  text-align: center;
  gap: 6px;
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