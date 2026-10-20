import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBiliStore, biliStore } from './store.js';
import {
  getSafeAvatarUrl,
  fetchPollerConfig,
  updatePollerConfig,
  fetchFollowings,
  fetchWorkspaces,
  searchBiliUser,
  addWhitelistUser,
  removeWhitelistUser,
  fetchRecentMessages,
  clearRecentMessages,
  fetchModels,
} from './api.js';
import type { BiliPollerConfig, BiliProcessedMessageItem, BiliWhitelistUser, BiliWorkspaceItem } from '../types.js';
import type { ModelGroup, PollerConfigResponse } from './contracts.js';
import { errorMessage } from './request.js';
import { createLatestRequest, startSerialPolling } from './async.js';

function formatRelativeTime(ts: number): string {
  if (!ts) return '';
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return '刚刚';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const d = new Date(ts);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${m}月${day}日 ${h}:${min}`;
}

export function BilibiliHeaderPill() {
  const { status, error: authError, isLoading: authLoading } = useBiliStore();

  const pillRef = useRef<HTMLDivElement>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 40, left: 10 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configReads = useRef(createLatestRequest());
  const recentReads = useRef(createLatestRequest());
  const searches = useRef(createLatestRequest());
  const followingReads = useRef(createLatestRequest());
  const mutationBusy = useRef(false);
  const mounted = useRef(true);
  const clearingRecent = useRef(false);
  const promptDirty = useRef(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [recentError, setRecentError] = useState('');
  const [recentClearing, setRecentClearing] = useState(false);

  // Recent Processed Messages State
  const [showRecentPanel, setShowRecentPanel] = useState(false);
  const [recentMessages, setRecentMessages] = useState<BiliProcessedMessageItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // Poller Config State
  const [config, setConfig] = useState<PollerConfigResponse | null>(null);

  // Followings State
  const [showFollowings, setShowFollowings] = useState(false);
  const [followings, setFollowings] = useState<BiliWhitelistUser[]>([]);
  const [loadingFollowings, setLoadingFollowings] = useState(false);

  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState('');
  useEffect(() => {
    if (!isDropdownOpen) return;
    const controller = new AbortController();
    setModelBusy(true);
    setModelError('');
    fetchModels(controller.signal)
      .then(data => { if (!controller.signal.aborted) setModelGroups(data); })
      .catch(error => { if (!controller.signal.aborted) setModelError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setModelBusy(false); });
    return () => { controller.abort(); };
  }, [isDropdownOpen]);

  // Workspaces State
  const [workspaces, setWorkspaces] = useState<BiliWorkspaceItem[]>([]);

  // Manual Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<BiliWhitelistUser | null>(null);

  // System Prompt Customization State
  const [showPromptEdit, setShowPromptEdit] = useState(false);
  const [promptText, setPromptText] = useState('');

  // Friendly In-Panel Feedback (No alerts)
  const [panelError, setPanelError] = useState('');
  const [panelNotice, setPanelNotice] = useState('');

  const updatePosition = (showRecent = showRecentPanel) => {
    if (pillRef.current) {
      const rect = pillRef.current.getBoundingClientRect();
      const totalWidth = showRecent ? (320 + 12 + 350) : 320;
      let left = Math.round(rect.left);
      // 如果按左对齐向右展开会超出屏幕右侧，则向左偏移
      if (left + totalWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - totalWidth - 10);
      }
      setDropdownPos({
        top: Math.round(rect.bottom + 6),
        left: Math.max(10, left),
      });
    }
  };

  const loadRecent = async () => {
    if (clearingRecent.current) return;
    const request = recentReads.current.begin();
    setLoadingRecent(true);
    setRecentError('');
    try {
      const list = await fetchRecentMessages(request.signal);
      if (request.isCurrent()) setRecentMessages(list);
    } catch (error) {
      if (request.isCurrent()) setRecentError(errorMessage(error, '获取最近消息失败'));
    } finally {
      if (request.isCurrent()) setLoadingRecent(false);
    }
  };

  const handleClearRecent = async () => {
    if (clearingRecent.current) return;
    clearingRecent.current = true;
    recentReads.current.cancel();
    setLoadingRecent(false);
    setRecentClearing(true);
    setRecentError('');
    try {
      await clearRecentMessages();
      if (mounted.current) setRecentMessages([]);
    } catch (error) {
      if (mounted.current) setRecentError(errorMessage(error, '清空最近消息失败'));
    } finally {
      clearingRecent.current = false;
      if (mounted.current) setRecentClearing(false);
    }
  };

  const loadConfig = async () => {
    if (mutationBusy.current) return;
    const request = configReads.current.begin();
    setConfigLoading(true);
    setPanelError('');
    try {
      const cfg = await fetchPollerConfig(request.signal);
      if (!request.isCurrent()) return;
      setConfig(cfg);
      if (!promptDirty.current) setPromptText(cfg.systemPrompt ?? '');
    } catch (error) {
      if (request.isCurrent()) setPanelError(errorMessage(error, '获取配置失败'));
    } finally {
      if (request.isCurrent()) setConfigLoading(false);
    }
  };

  // Serialize writes by admitting only one at a time; a stale GET must not undo a save.
  const mutateConfig = async (operation: () => Promise<PollerConfigResponse>) => {
    if (mutationBusy.current) throw new Error('配置正在保存，请稍后再试');
    mutationBusy.current = true;
    configReads.current.cancel();
    setConfigLoading(false);
    setConfigBusy(true);
    setPanelError('');
    setPanelNotice('');
    try {
      const saved = await operation();
      if (mounted.current) setPanelNotice('配置已保存');
      return saved;
    } finally {
      mutationBusy.current = false;
      if (mounted.current) setConfigBusy(false);
    }
  };
  const saveConfig = (patch: Partial<BiliPollerConfig>) => mutateConfig(() => updatePollerConfig(patch));

  useEffect(() => {
    mounted.current = true;
    void biliStore.refresh();
    return () => {
      mounted.current = false;
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      configReads.current.cancel();
      recentReads.current.cancel();
      searches.current.cancel();
      followingReads.current.cancel();
    };
  }, []);

  useEffect(() => {
    if (!isDropdownOpen) return;
    void loadConfig();
    const controller = new AbortController();
    fetchWorkspaces(controller.signal)
      .then(list => { if (!controller.signal.aborted) setWorkspaces(list); })
      .catch(error => { if (!controller.signal.aborted) setPanelError(errorMessage(error, '获取工作区失败')); });
    return () => {
      controller.abort();
      configReads.current.cancel();
      searches.current.cancel();
      followingReads.current.cancel();
    };
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const stop = startSerialPolling(async () => {
      await loadRecent();
      return showRecentPanel;
    }, error => setRecentError(errorMessage(error)), 3500);
    return () => { stop(); recentReads.current.cancel(); };
  }, [isDropdownOpen, showRecentPanel]);

  const handleMouseEnter = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    updatePosition(showRecentPanel);
    setIsDropdownOpen(true);
  };

  const handleMouseLeave = () => {
    hoverTimerRef.current = setTimeout(() => {
      setIsDropdownOpen(false);
      setShowRecentPanel(false);
      setShowFollowings(false);
      setSearching(false);
      setLoadingFollowings(false);
      setSearchResult(null);
      setPanelError('');
      setPanelNotice('');
    }, 350);
  };

  const handleToggle = async (key: 'enableReply' | 'enableAt' | 'enableWhitelist' | 'autoLikeOnReply') => {
    if (!config) return;
    setPanelError('');
    try {
      setConfig(await saveConfig({ [key]: !config[key] }));
    } catch (error) {
      setPanelError(errorMessage(error, '更新失败'));
    }
  };

  const handleOpenFollowings = async () => {
    if (showFollowings) {
      followingReads.current.cancel();
      setShowFollowings(false);
      return;
    }
    setShowFollowings(true);
    setPanelError('');
    if (followings.length === 0) {
      const request = followingReads.current.begin();
      setLoadingFollowings(true);
      try {
        const res = await fetchFollowings(1, 50, request.signal);
        if (request.isCurrent()) setFollowings(res.list);
      } catch (error) {
        if (request.isCurrent()) setPanelError(errorMessage(error, '获取关注列表失败'));
      } finally {
        if (request.isCurrent()) setLoadingFollowings(false);
      }
    }
  };

  const handleAddFromFollowings = async (user: BiliWhitelistUser) => {
    setPanelError('');
    try {
      const updated = await mutateConfig(() => addWhitelistUser(user));
      setConfig(updated);
    } catch (err) {
      setPanelError(errorMessage(err) || '添加失败');
    }
  };

  const handleSearchUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const request = searches.current.begin();
    setSearching(true);
    setPanelError('');
    setSearchResult(null);
    try {
      const user = await searchBiliUser(searchQuery.trim(), request.signal);
      if (request.isCurrent()) setSearchResult(user);
    } catch (error) {
      if (request.isCurrent()) setPanelError(errorMessage(error, '查询用户失败'));
    } finally {
      if (request.isCurrent()) setSearching(false);
    }
  };

  const handleAddSearchedUser = async () => {
    const user = searchResult;
    if (!user) return;
    setPanelError('');
    try {
      const updated = await mutateConfig(() => addWhitelistUser(user));
      setConfig(updated);
      setSearchResult(null);
      setSearchQuery('');
    } catch (err) {
      setPanelError(errorMessage(err) || '添加失败');
    }
  };

  const handleRemoveWhitelist = async (mid: number) => {
    setPanelError('');
    try {
      const updated = await mutateConfig(() => removeWhitelistUser(mid));
      setConfig(updated);
    } catch (err) {
      setPanelError(errorMessage(err) || '移除失败');
    }
  };

  const handleSavePrompt = async () => {
    setPanelError('');
    try {
      const saved = await saveConfig({ systemPrompt: promptText });
      setConfig(saved);
      setPromptText(saved.systemPrompt ?? '');
      promptDirty.current = false;
      setShowPromptEdit(false);
    } catch (err) {
      setPanelError(errorMessage(err) || '保存人设失败');
    }
  };

  const handleResetPrompt = async () => {
    setPanelError('');
    try {
      const defaultP = `你是一个活跃在哔哩哔哩（B站）的智能看板娘/AI伙伴。
【性格与语言风格】：
1. 语言亲切、风趣幽默、充满年轻活力，熟知B站常见文化和社区梗。
2. 高情商回复，懂得夸赞观众、体贴互动，切勿说教，切勿使用客服式机械套话。
3. 严格精简：由于发布在评论区楼中楼，回复字数严格控制在 100 字以内，言简意赅。
4. 禁止输出 Markdown 标题或思维链标签，直接输出准备发表的纯文本评论内容。`;
      const saved = await saveConfig({ systemPrompt: defaultP });
      setConfig(saved);
      setPromptText(saved.systemPrompt ?? '');
      promptDirty.current = false;
      setShowPromptEdit(false);
    } catch (err) {
      setPanelError(errorMessage(err) || '重置人设失败');
    }
  };

  return (
    <div
      ref={pillRef}
      className="dsh-bili-pill-wrapper"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 胶囊主体 */}
      {status.isUnlocked && status.user ? (
        <div
          className="dsh-bili-pill dsh-bili-pill-authed"
          onClick={() => biliStore.open()}
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
          <span style={{ fontSize: 10, color: '#FB7299', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
            Lv.{status.user.level}
          </span>
        </div>
      ) : status.hasVault && !status.isUnlocked ? (
        <div
          className="dsh-bili-pill dsh-bili-pill-locked"
          onClick={() => biliStore.open()}
          title="B站凭据已加锁，点击输入密码解密"
        >
          {status.accountSummary?.face && (
            <img
              src={getSafeAvatarUrl(status.accountSummary.face)}
              alt="avatar"
              className="dsh-bili-avatar-mini"
              referrerPolicy="no-referrer"
            />
          )}
          <span>解锁 B站 ({status.accountSummary?.uname || '账号'})</span>
        </div>
      ) : (
        <div
          className="dsh-bili-pill dsh-bili-pill-unlogged"
          onClick={() => biliStore.open()}
          title="点击扫码登录 Bilibili 账号"
        >
          <span>登录 B站</span>
        </div>
      )}

      {/* 彻底置顶的悬浮并排面板 (Fixed + createPortal 到 body) */}
      {isDropdownOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="dsh-bili-portal-wrap"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 左侧：B 站消息分发控制面板 */}
            <div className="dsh-bili-dropdown">
            {/* Header */}
            <div className="dsh-bili-dropdown-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="dsh-bili-dropdown-title">设置</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  style={{
                    background: showRecentPanel ? 'rgba(251, 114, 153, 0.15)' : 'none',
                    border: showRecentPanel ? '1px solid rgba(251, 114, 153, 0.4)' : '1px solid transparent',
                    color: showRecentPanel ? '#FB7299' : 'var(--dsw-alias-label-secondary, #666666)',
                    borderRadius: 4,
                    padding: '2px 7px',
                    cursor: 'pointer',
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    transition: 'all 0.12s ease',
                  }}
                  onClick={() => {
                    const next = !showRecentPanel;
                    setShowRecentPanel(next);
                    updatePosition(next);
                  }}
                  title={showRecentPanel ? '收起消息历史' : '展开最近处理的消息历史'}
                >
                  <span>消息历史</span>
                  {(() => {
                    const count = recentMessages.filter((m) => !m.user?.uname?.includes('测试')).length;
                    return count > 0 ? (
                      <span
                        style={{
                          fontSize: 9,
                          background: '#FB7299',
                          color: '#ffffff',
                          borderRadius: 8,
                          padding: '0 4px',
                          fontWeight: 600,
                          lineHeight: '13px',
                        }}
                      >
                        {count}
                      </span>
                    ) : null;
                  })()}
                </button>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#FB7299',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                  onClick={() => biliStore.open()}
                >
                  账号管理 &gt;
                </button>
              </div>
            </div>

            {/* In-Panel Friendly Feedback (替代所有原生 alert) */}
            {panelNotice && (
              <div
                style={{
                  background: 'rgba(251, 114, 153, 0.12)',
                  border: '1px solid rgba(251, 114, 153, 0.3)',
                  color: '#FB7299',
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  marginBottom: 8,
                }}
              >
                {panelNotice}
              </div>
            )}
            {(panelError || authError) && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  marginBottom: 8,
                }}
              >
                {panelError || authError}
              </div>
            )}

            {(configLoading || authLoading) && <div role="status">正在加载配置或账号状态…</div>}
            {configBusy && <div role="status">正在保存配置…</div>}
            {!config && !configLoading && <button type="button" className="dsh-bili-mini-btn" onClick={loadConfig}>重试加载配置</button>}
            {config && <fieldset disabled={configBusy || configLoading} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="dsh-bili-dropdown-section">
              <span className="dsh-bili-dropdown-label">默认模型</span>
              <select className="dsh-bili-mini-input" disabled={modelBusy}
                value={config.modelSelection ? JSON.stringify([config.modelSelection.provider, config.modelSelection.model]) : ''}
                onChange={async e => {
                  const value = e.target.value;
                  setModelBusy(true);
                  setModelError('');
                  try {
                    if (!value) {
                      setConfig(await saveConfig({ modelSelection: null }));
                      setPanelNotice('已恢复跟随 DSH 默认模型');
                      return;
                    }
                    const selection: unknown = JSON.parse(value);
                    if (!Array.isArray(selection) || selection.length !== 2 || !selection.every(part => typeof part === 'string')) {
                      throw new Error('请选择有效的提供商和模型');
                    }
                    const [provider, model] = selection as [string, string];
                    const targetGroup = modelGroups.find((g) => g.id === provider);
                    const targetModel = targetGroup?.models?.find((m) => m.id === model);
                    const targetEfforts: Array<{ id: string }> = targetModel?.reasoning?.efforts || [];
                    const prevEffort = config.modelSelection?.reasoningEffort;
                    const validEffort = targetEfforts.some((eff) => eff.id === prevEffort)
                      ? prevEffort
                      : undefined;

                    setConfig(await saveConfig({
                      modelSelection: {
                        provider,
                        model,
                        ...validEffort ? { reasoningEffort: validEffort } : {},
                      },
                    }));
                    setPanelNotice('模型已保存；后续消息使用对应模型的独立会话，不修改 DSH 默认模型。');
                  } catch (err) { setModelError(errorMessage(err)); }
                  finally { setModelBusy(false); }
                }}>
                <option value="">跟随 DSH 默认模型（未单独设置）</option>
                {config.modelSelection && !modelGroups.some(g => g.id === config.modelSelection?.provider && g.models.some((m) => m.id === config.modelSelection?.model)) &&
                  <option value={JSON.stringify([config.modelSelection.provider, config.modelSelection.model])}>{config.modelSelection.provider} / {config.modelSelection.model}（已保存，目录未确认）</option>}
                {modelGroups.map(g => <optgroup key={g.id} label={g.name}>
                  {g.models.map((m) => <option key={m.id} value={JSON.stringify([g.id, m.id])}>{m.name}</option>)}
                </optgroup>)}
              </select>
              {modelBusy && <div>正在加载或保存模型…</div>}
              {modelError && <div role="alert" style={{ color: '#ef4444' }}>{modelError}</div>}
              {modelGroups.filter(g => g.error).map(g => <div key={g.id}>{g.name}：{g.error}</div>)}
            </div>

            {/* 思考强度设定板块 (严格按选定模型动态判定；若模型不支持思考强度则不显示) */}
            {config.modelSelection && (() => {
              const selectedGroup = modelGroups.find(
                (g) => g.id === config.modelSelection?.provider,
              );
              const selectedModel = selectedGroup?.models?.find(
                (m) => m.id === config.modelSelection?.model,
              );
              const modelEfforts: Array<{ id: string; name: string; description?: string }> =
                (selectedModel?.reasoning?.efforts || []).map(effort => ({ ...effort, name: effort.name || effort.id }));

              // 如果该模型没有思考强度选项，完全不显示选择框
              if (modelEfforts.length === 0) {
                return null;
              }

              const handleSaveEffort = async (effortVal?: string) => {
                if (!config.modelSelection) return;
                setModelBusy(true);
                setModelError('');
                try {
                  const updated = await saveConfig({
                    modelSelection: {
                      provider: config.modelSelection.provider,
                      model: config.modelSelection.model,
                      ...effortVal ? { reasoningEffort: effortVal } : {},
                    },
                  });
                  setConfig(updated);
                  setPanelNotice(
                    effortVal
                      ? `思考强度已设为【${effortVal}】`
                      : '思考强度已恢复为模型默认',
                  );
                } catch (err) {
                  setModelError(errorMessage(err));
                } finally {
                  setModelBusy(false);
                }
              };

              return (
                <div className="dsh-bili-dropdown-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="dsh-bili-dropdown-label">思考强度 (Reasoning Effort)</span>
                    {config.modelSelection.reasoningEffort && (
                      <span style={{ fontSize: 10, color: '#FB7299', fontWeight: 600 }}>
                        {config.modelSelection.reasoningEffort}
                      </span>
                    )}
                  </div>
                  <select
                    className="dsh-bili-mini-input"
                    disabled={modelBusy}
                    value={config.modelSelection.reasoningEffort || ''}
                    onChange={async (e) => {
                      const val = e.target.value;
                      await handleSaveEffort(val || undefined);
                    }}
                  >
                    <option value="">跟随模型默认 (Default)</option>
                    {modelEfforts.map((eff) => (
                      <option key={eff.id} value={eff.id}>
                        {eff.name || eff.id} {eff.description ? `(${eff.description})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}

            {/* 指定工作区设定板块 */}
            <div className="dsh-bili-dropdown-section">
              <span className="dsh-bili-dropdown-label">指定归属工作区</span>
              <select
                className="dsh-bili-mini-input"
                style={{ cursor: 'pointer', fontSize: 11 }}
                value={config.targetWorkspacePath || ''}
                onChange={async (e) => {
                  const val = e.target.value;
                  try {
                    const updated = await saveConfig({ targetWorkspacePath: val });
                    setConfig(updated);
                  } catch (err) {
                    setPanelError(errorMessage(err) || '更新工作区失败');
                  }
                }}
              >
                <option value="">自动绑定当前活跃工作区</option>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.path}>
                    {w.title} ({w.path})
                  </option>
                ))}
              </select>
            </div>

            {/* 评论图片下载安全限制 */}
            <div className="dsh-bili-dropdown-section">
              <span className="dsh-bili-dropdown-label">评论图片下载限制</span>
              <div className="dsh-bili-image-limits-grid">
                <label className="dsh-bili-image-limit-field" title="图片下载超时（秒）">
                  <span>超时（秒）</span>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="dsh-bili-mini-input"
                    value={Math.round((config.imageDownloadTimeoutMs || 10000) / 1000)}
                    onChange={async (e) => {
                      const seconds = Math.max(1, Math.min(60, Number(e.target.value) || 10));
                      try { setConfig(await saveConfig({ imageDownloadTimeoutMs: seconds * 1000 })); }
                      catch (err) { setPanelError(errorMessage(err) || '保存图片超时限制失败'); }
                    }}
                  />
                </label>
                <label className="dsh-bili-image-limit-field" title="单张图片大小上限（MB）">
                  <span>上限（MB）</span>
                  <input
                    type="number"
                    min={1}
                    max={32}
                    className="dsh-bili-mini-input"
                    value={Math.round((config.imageDownloadMaxBytes || 8388608) / 1048576)}
                    onChange={async (e) => {
                      const mb = Math.max(1, Math.min(32, Number(e.target.value) || 8));
                      try { setConfig(await saveConfig({ imageDownloadMaxBytes: mb * 1048576 })); }
                      catch (err) { setPanelError(errorMessage(err) || '保存图片大小限制失败'); }
                    }}
                  />
                </label>
                <label className="dsh-bili-image-limit-field" title="每条评论最多下载的图片数量">
                  <span>图片数</span>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    className="dsh-bili-mini-input"
                    value={config.imageDownloadMaxCount ?? 5}
                    onChange={async (e) => {
                      const count = Math.max(0, Math.min(10, Number(e.target.value) || 0));
                      try { setConfig(await saveConfig({ imageDownloadMaxCount: count })); }
                      catch (err) { setPanelError(errorMessage(err) || '保存图片数量限制失败'); }
                    }}
                  />
                </label>
              </div>
            </div>

            {/* 1. 消息接收开关 */}
            <div className="dsh-bili-dropdown-section">
              <span className="dsh-bili-dropdown-label">监听设置</span>
              <label className="dsh-bili-check-row">
                <input
                  type="checkbox"
                  checked={config.enableReply}
                  onChange={() => handleToggle('enableReply')}
                  style={{ accentColor: '#FB7299' }}
                />
                <span>接收回复消息 (reply)</span>
              </label>
              <label className="dsh-bili-check-row">
                <input
                  type="checkbox"
                  checked={config.enableAt}
                  onChange={() => handleToggle('enableAt')}
                  style={{ accentColor: '#FB7299' }}
                />
                <span>接收艾特消息 (@)</span>
              </label>
              <label className="dsh-bili-check-row">
                <input
                  type="checkbox"
                  checked={config.autoLikeOnReply ?? true}
                  onChange={() => handleToggle('autoLikeOnReply')}
                  style={{ accentColor: '#FB7299' }}
                />
                <span>接收到回复给用户点个赞</span>
              </label>
            </div>

            {/* 2. 白名单控制 */}
            <div className="dsh-bili-dropdown-section" style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dsh-bili-dropdown-label">白名单控制</span>
                {status.isUnlocked && (
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--dsw-alias-label-secondary, #666666)',
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#FB7299')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--dsw-alias-label-secondary, #666666)')}
                    onClick={handleOpenFollowings}
                  >
                    {showFollowings ? '关闭关注列表' : '从我的关注选择'}
                  </button>
                )}
              </div>

              <label className="dsh-bili-check-row">
                <input
                  type="checkbox"
                  checked={config.enableWhitelist}
                  onChange={() => handleToggle('enableWhitelist')}
                  style={{ accentColor: '#FB7299' }}
                />
                <span>仅接收白名单用户消息</span>
              </label>

              {/* 我的关注列表展开 */}
              {showFollowings && (
                <div
                  style={{
                    maxHeight: 130,
                    overflowY: 'auto',
                    background: 'var(--dsw-alias-bg-layer-2, #f5f5f5)',
                    borderRadius: 6,
                    border: '1px solid var(--dsw-alias-border-l2, #e0e0e0)',
                    padding: 6,
                    marginTop: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {loadingFollowings ? (
                    <div style={{ textAlign: 'center', color: 'var(--dsw-alias-label-tertiary, #888888)', padding: 8 }}>
                      加载关注列表中...
                    </div>
                  ) : followings.length === 0 ? (
                    <div style={{ textAlign: 'center', color: 'var(--dsw-alias-label-tertiary, #888888)', padding: 8 }}>
                      无关注用户
                    </div>
                  ) : (
                    followings.map((u) => {
                      const isAdded = (config.whitelist || []).some(
                        (w) => w.mid === u.mid,
                      );
                      return (
                        <div
                          key={u.mid}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '3px 6px',
                            borderRadius: 4,
                            fontSize: 11,
                            color: 'var(--dsw-alias-label-primary, #222222)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                            <img
                              src={getSafeAvatarUrl(u.face)}
                              alt={u.uname}
                              style={{ width: 16, height: 16, borderRadius: '50%' }}
                              referrerPolicy="no-referrer"
                            />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                              {u.uname}
                            </span>
                          </div>
                          {isAdded ? (
                            <span style={{ color: 'var(--dsw-alias-label-tertiary, #888888)', fontSize: 10 }}>已添加</span>
                          ) : (
                            <button
                              type="button"
                              className="dsh-bili-mini-btn"
                              style={{ padding: '2px 6px', fontSize: 10 }}
                              onClick={() => handleAddFromFollowings(u)}
                            >
                              添加
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* 手动搜索输入 */}
              <form
                onSubmit={handleSearchUser}
                style={{ display: 'flex', gap: 6, marginTop: 6 }}
              >
                <input
                  type="text"
                  placeholder="输入 UID 或 用户名"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="dsh-bili-mini-input"
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="dsh-bili-mini-btn"
                >
                  {searching ? '查询中' : '查询'}
                </button>
              </form>

              {/* 查询结果预览 */}
              {searchResult && (
                <div className="dsh-bili-user-preview-card">
                  <img
                    src={getSafeAvatarUrl(searchResult.face)}
                    alt={searchResult.uname}
                    style={{ width: 28, height: 28, borderRadius: '50%' }}
                    referrerPolicy="no-referrer"
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--dsw-alias-label-primary, #111111)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {searchResult.uname}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #888888)' }}>
                      UID: {searchResult.mid}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dsh-bili-mini-btn"
                    style={{ padding: '4px 8px', fontSize: 11 }}
                    onClick={handleAddSearchedUser}
                  >
                    添加
                  </button>
                </div>
              )}

              {/* 当前白名单成员展示 */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #888888)', marginBottom: 4 }}>
                  已加入白名单 ({config.whitelist?.length || 0}人):
                </div>
                {config.whitelist && config.whitelist.length > 0 ? (
                  <div className="dsh-bili-whitelist-box">
                    {config.whitelist.map((item) => (
                      <div key={item.mid} className="dsh-bili-whitelist-item">
                        <div className="dsh-bili-whitelist-info">
                          <img
                            src={getSafeAvatarUrl(item.face)}
                            alt={item.uname}
                            style={{ width: 18, height: 18, borderRadius: '50%' }}
                            referrerPolicy="no-referrer"
                          />
                          <span style={{ fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary, #222222)' }}>
                            {item.uname}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #888888)' }}>({item.mid})</span>
                        </div>
                        <button
                          type="button"
                          className="dsh-bili-remove-btn"
                          onClick={() => handleRemoveWhitelist(item.mid)}
                          title="从白名单移除"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #888888)', fontStyle: 'italic' }}>
                    暂未添加白名单用户
                  </div>
                )}
              </div>
            </div>

            {/* 3. AI 人设与回复规范定制 */}
            <div className="dsh-bili-dropdown-section" style={{ marginTop: 8, marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="dsh-bili-dropdown-label">AI 回复人设</span>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--dsw-alias-label-secondary, #666666)',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#FB7299')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--dsw-alias-label-secondary, #666666)')}
                  onClick={() => setShowPromptEdit(!showPromptEdit)}
                >
                  {showPromptEdit ? '收起设置' : '自定义人设'}
                </button>
              </div>

              {showPromptEdit && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #888888)', wordBreak: 'break-all' }}>
                    独立文件: {config.promptFilePath || '~/.dsh/storages/bilibili-prompt.md'}
                  </div>
                  <textarea
                    rows={5}
                    value={promptText}
                    onChange={(e) => { promptDirty.current = true; setPromptText(e.target.value); }}
                    placeholder="输入自定义回复人设、性格要求、语言风格..."
                    className="dsh-bili-mini-input"
                    style={{ resize: 'vertical', fontSize: 11, lineHeight: '16px' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#888' }}>保存将直接写回本地 .md 文件</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="dsh-bili-mini-btn"
                        style={{ background: 'transparent', border: '1px solid var(--dsw-alias-border-l2, #ccc)', color: 'var(--dsw-alias-label-secondary, #666)', padding: '3px 8px', fontSize: 11 }}
                        onClick={handleResetPrompt}
                      >
                        恢复默认
                      </button>
                      <button
                        type="button"
                        className="dsh-bili-mini-btn"
                        style={{ padding: '3px 8px', fontSize: 11 }}
                        onClick={handleSavePrompt}
                      >
                        保存文件
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            </fieldset>}
            </div>

            {/* 右侧：最近处理的消息悬浮框（仅在用户点击“消息历史”按钮时展开显示） */}
            {showRecentPanel && (
              <div className="dsh-bili-recent-panel">
                <div className="dsh-bili-recent-header">
                  {(() => {
                    const displayMessages = recentMessages.filter(
                      (m) => !m.user?.uname?.includes('测试'),
                    );
                    return (
                      <>
                        <div className="dsh-bili-recent-title">
                          <span>最近处理的消息</span>
                          {displayMessages.length > 0 && (
                            <span className="dsh-bili-recent-badge">{displayMessages.length}</span>
                          )}
                        </div>
                        <div className="dsh-bili-recent-actions">
                          <button
                            type="button"
                            className="dsh-bili-recent-action-btn"
                            onClick={loadRecent}
                             disabled={loadingRecent || recentClearing}
                            title="刷新列表"
                          >
                            刷新
                          </button>
                          {displayMessages.length > 0 && (
                            <button
                              type="button"
                              className="dsh-bili-recent-action-btn"
                              onClick={handleClearRecent}
                               disabled={recentClearing}
                              title="清空记录"
                            >
                              清空
                            </button>
                          )}
                          <button
                            type="button"
                            className="dsh-bili-recent-action-btn"
                            onClick={() => {
                              setShowRecentPanel(false);
                              updatePosition(false);
                            }}
                            title="收起消息历史"
                            style={{ fontSize: 13, lineHeight: 1, padding: '1px 5px' }}
                          >
                            ✕
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>

                {recentError && <div role="alert" className="dsh-bili-error-tip">{recentError}</div>}
                {recentClearing && <div role="status">正在清空记录…</div>}
                {(() => {
                  const displayMessages = recentMessages.filter(
                    (m) => !m.user?.uname?.includes('测试'),
                  );

                  if (loadingRecent && displayMessages.length === 0) {
                    return (
                      <div className="dsh-bili-recent-empty">
                        <span>正在加载处理记录...</span>
                      </div>
                    );
                  }

                  if (displayMessages.length === 0 && recentError) return null;
                  if (displayMessages.length === 0) {
                    return (
                      <div className="dsh-bili-recent-empty">
                        <div style={{ fontSize: 24, opacity: 0.5 }}>📭</div>
                        <span style={{ fontWeight: 500 }}>暂无处理记录</span>
                        <span style={{ fontSize: 11, opacity: 0.7 }}>
                          当收到 B 站回复或 @ 提及消息时，处理进度与回复内容将在此实时显示
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div className="dsh-bili-recent-list">
                      {displayMessages.map((msg) => {
                    const isVideo = msg.sourceType === 'video' || msg.sourceType === '1';
                    const isDynamic =
                      msg.sourceType === 'dynamic' ||
                      msg.sourceType === '11' ||
                      msg.sourceType === '16' ||
                      msg.sourceType === '17';
                    const tagClass = isVideo
                      ? 'dsh-bili-recent-tag dsh-bili-recent-tag-video'
                      : isDynamic
                        ? 'dsh-bili-recent-tag dsh-bili-recent-tag-dynamic'
                        : 'dsh-bili-recent-tag';
                    const tagText = isVideo ? '视频' : isDynamic ? '动态' : msg.sourceType || '内容';

                    return (
                      <div key={msg.id} className="dsh-bili-recent-card">
                        <div className="dsh-bili-recent-card-top">
                          <div className="dsh-bili-recent-user">
                            {msg.user?.avatar && (
                              <img
                                src={getSafeAvatarUrl(msg.user.avatar)}
                                alt={msg.user.uname || 'user'}
                                className="dsh-bili-recent-avatar"
                                referrerPolicy="no-referrer"
                              />
                            )}
                            <span className="dsh-bili-recent-uname">
                              {msg.user?.uname || '未知用户'}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--dsw-alias-label-tertiary, #999)',
                              }}
                            >
                              ({msg.user?.mid})
                            </span>
                          </div>
                          <span className="dsh-bili-recent-time">
                            {formatRelativeTime(msg.time)}
                          </span>
                        </div>

                        {/* 来源主体信息 */}
                        {(msg.sourceTitle || msg.sourceType) && (
                          <div className="dsh-bili-recent-source">
                            <span className={tagClass}>{tagText}</span>
                            {msg.uri ? (
                              <a
                                href={msg.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="dsh-bili-recent-title-link"
                                title={msg.sourceTitle || msg.uri}
                              >
                                {msg.sourceTitle || '查看原内容 ↗'}
                              </a>
                            ) : (
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {msg.sourceTitle}
                              </span>
                            )}
                          </div>
                        )}

                        {/* 用户评论内容 */}
                        <div className="dsh-bili-recent-message">
                          {msg.message || (msg.images?.length ? '[纯图片评论]' : '（无正文）')}
                          {msg.images && msg.images.length > 0 && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: '#FB7299' }}>
                              📷 [{msg.images.length}张图片]
                            </span>
                          )}
                        </div>

                        {/* 处理状态与回复 */}
                        {msg.status === 'replied' ? (
                          <div className="dsh-bili-recent-reply dsh-bili-recent-reply-success">
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontWeight: 600,
                              }}
                            >
                              <span>● 已回复</span>
                            </div>
                            {msg.replyText && (
                              <div
                                style={{
                                  color: 'var(--dsw-alias-label-primary)',
                                  opacity: 0.9,
                                }}
                              >
                                {msg.replyText}
                              </div>
                            )}
                          </div>
                        ) : msg.status === 'command_replied' ? (
                          <div
                            className="dsh-bili-recent-reply dsh-bili-recent-reply-success"
                            style={{
                              borderColor: 'rgba(168, 85, 247, 0.3)',
                              color: '#9333ea',
                              background: 'rgba(168, 85, 247, 0.08)',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontWeight: 600,
                              }}
                            >
                              <span>● 指令执行完成</span>
                            </div>
                            {msg.replyText && (
                              <div
                                style={{
                                  color: 'var(--dsw-alias-label-primary)',
                                  opacity: 0.9,
                                }}
                              >
                                {msg.replyText}
                              </div>
                            )}
                          </div>

                        ) : msg.status === 'ignored' ? (
                          <div className="dsh-bili-recent-reply dsh-bili-recent-reply-ignored">
                            <span>⚪ 已跳过: {msg.error || '白名单拦截'}</span>
                          </div>
                        ) : msg.status === 'failed' ? (
                          <div className="dsh-bili-recent-reply dsh-bili-recent-reply-failed">
                            <span style={{ fontWeight: 600 }}>✕ 处理失败</span>
                            {msg.error && <div style={{ fontSize: 10 }}>{msg.error}</div>}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  </div>
                );
              })()}
            </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}