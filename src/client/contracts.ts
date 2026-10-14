import type {
  BiliPollerConfig, BiliProcessedMessageItem, BiliUserInfo, BiliWhitelistUser,
  BiliWorkspaceItem, QrcodeGenerateResponse, QrcodePollResponse, VaultStatusResponse,
} from '../types.js';
import { isRecord } from './request.js';

export interface PollerConfigResponse extends BiliPollerConfig {
  promptFilePath?: string;
}
export interface ModelGroup {
  id: string;
  name: string;
  error?: string;
  models: Array<{
    id: string;
    name: string;
    reasoning?: {
      efforts: Array<{ id: string; name?: string; description?: string }>;
      defaultEffort?: string;
    };
  }>;
}
export interface SuccessResponse { success: true }
export interface VaultUserResponse extends SuccessResponse { user: BiliUserInfo }
export interface ConfigUpdateResponse extends SuccessResponse { config: PollerConfigResponse }
export interface FollowingsResponse { list: BiliWhitelistUser[]; total: number }
export interface RecentMessagesResponse extends SuccessResponse { list: BiliProcessedMessageItem[] }

const text = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalText = (value: unknown) => value === undefined || text(value);
export const arrayOf = <T>(validate: (value: unknown) => value is T) =>
  (value: unknown): value is T[] => Array.isArray(value) && value.every(validate);

export function isWhitelistUser(value: unknown): value is BiliWhitelistUser {
  return isRecord(value) && number(value.mid) && text(value.uname) && text(value.face) && optionalText(value.sign);
}
export function isBiliUser(value: unknown): value is BiliUserInfo {
  return isWhitelistUser(value) && isRecord(value) && number(value.level) && number(value.coins) && number(value.vipType);
}
export function isAuthStatus(value: unknown): value is VaultStatusResponse {
  return isRecord(value) && typeof value.hasVault === 'boolean' && typeof value.isUnlocked === 'boolean'
    && (value.user === null || isBiliUser(value.user))
    && (value.accountSummary == null || isWhitelistUser(value.accountSummary));
}
export function isQrcode(value: unknown): value is QrcodeGenerateResponse {
  return isRecord(value) && text(value.qrcodeKey) && !!value.qrcodeKey && text(value.url)
    && text(value.qrcodeDataUrl) && !!value.qrcodeDataUrl;
}
export function isQrcodePoll(value: unknown): value is QrcodePollResponse {
  return isRecord(value) && number(value.code) && text(value.message)
    && text(value.status) && ['waiting', 'scanned', 'success', 'expired', 'error'].includes(value.status)
    && optionalText(value.tempToken) && (value.user == null || isBiliUser(value.user));
}
export function isConfig(value: unknown): value is PollerConfigResponse {
  if (!isRecord(value)) return false;
  const selection = value.modelSelection;
  return ['enableReply', 'enableAt', 'autoLikeOnReply', 'enableWhitelist'].every(key => typeof value[key] === 'boolean')
    && ['pollIntervalSeconds', 'imageDownloadTimeoutMs', 'imageDownloadMaxBytes', 'imageDownloadMaxCount'].every(key => number(value[key]))
    && arrayOf(isWhitelistUser)(value.whitelist)
    && optionalText(value.systemPrompt) && optionalText(value.targetWorkspacePath) && optionalText(value.promptFilePath)
    && (selection == null || (isRecord(selection) && text(selection.provider) && text(selection.model) && optionalText(selection.reasoningEffort)));
}
export function isWorkspace(value: unknown): value is BiliWorkspaceItem {
  return isRecord(value) && text(value.id) && text(value.title) && text(value.path);
}
export function isModelGroup(value: unknown): value is ModelGroup {
  return isRecord(value) && text(value.id) && text(value.name) && optionalText(value.error)
    && Array.isArray(value.models) && value.models.every(model => {
      if (!isRecord(model) || !text(model.id) || !text(model.name)) return false;
      const reasoning = model.reasoning;
      return reasoning == null || (isRecord(reasoning) && optionalText(reasoning.defaultEffort)
        && Array.isArray(reasoning.efforts) && reasoning.efforts.every(effort => isRecord(effort)
          && text(effort.id) && optionalText(effort.name) && optionalText(effort.description)));
    });
}
export function isRecentMessage(value: unknown): value is BiliProcessedMessageItem {
  return isRecord(value) && text(value.id) && number(value.time) && text(value.sourceType)
    && optionalText(value.sourceTitle) && optionalText(value.uri) && text(value.message)
    && isRecord(value.user) && text(value.user.mid) && text(value.user.uname) && optionalText(value.user.avatar)
    && text(value.status) && ['processing', 'replied', 'command_replied', 'failed', 'ignored'].includes(value.status)
    && (value.images === undefined || arrayOf(text)(value.images)) && optionalText(value.replyText) && optionalText(value.error);
}
export function isSuccess(value: unknown): value is SuccessResponse {
  return isRecord(value) && value.success === true;
}
export function isVaultUserResponse(value: unknown): value is VaultUserResponse {
  return isSuccess(value) && isRecord(value) && isBiliUser(value.user);
}
export function isConfigUpdate(value: unknown): value is ConfigUpdateResponse {
  return isSuccess(value) && isRecord(value) && isConfig(value.config);
}
export function isFollowings(value: unknown): value is FollowingsResponse {
  return isRecord(value) && arrayOf(isWhitelistUser)(value.list) && number(value.total);
}
export function isRecentMessages(value: unknown): value is RecentMessagesResponse {
  return isSuccess(value) && isRecord(value) && arrayOf(isRecentMessage)(value.list);
}
