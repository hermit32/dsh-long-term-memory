/**
 * dsh-memory-feiyu 的浏览器设置页。
 * 在 Settings 的 settings.section 槽位注册“记忆”页：
 * - 读取记忆库状态（活动/归档/摘要/版本/索引预览/最近事件）
 * - 编辑真实生效的 volatile 配置（索引注入、自动摘要、预算、上限）
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-feiyu',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'settings.memory';
    const NAMESPACE = 'dsh-memory-feiyu';
    // 默认仅使用当前会话的相对目录；Host API 优先返回配置的真实私有工作区。
    const MEMORY_DIR = '.dsh/memories-feiyu';
    // No machine-specific absolute path: use current workspace relative paths only.

    const zh = {
      nav: '记忆',
      title: '记忆',
      description: '只对当前配置的私有工作区生效。短期记忆逐条保存事实，长期记忆由 AI 持续综合、去重和更新。',
      workspaceOnly: '记忆库只在该私有工作区的根会话中可读写；当前会话不属于该工作区，已隐藏内容并禁用操作。',
      loading: '正在读取设置…',
      unavailable: '记忆插件当前未加载。',
      readOnly: '当前部署的设置是只读的。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '保存失败，请检查数值后重试。',
      reset: '恢复默认',
      noChanges: '没有改动需要保存。',
      noChange: '内容没有变化，未写入。',
      invalidNumber: '请输入不小于 {min} 的整数。',
      maxTooSmall: '摘要总预算必须至少比工作区摘要预算多 2000 B。',
      statusTitle: '记忆库状态',
      refresh: '刷新',
      refreshing: '读取中…',
      active: '短期记忆（有效）',
      archived: '短期记忆（已归档）',
      summary: '长期记忆大小',
      versions: '长期记忆版本',
      summaryModeLabel: '长期记忆更新方式',
      modeAuto: '自动演化',
      modeManual: '已冻结',
      switchAuto: '恢复自动演化',
      curatorLabel: '记忆整理',
      curatorPending: '待整理 {turns} 轮 / 根会话 {sessions} 个',
      parseErrors: '损坏记录 {count} 条（已隔离，写操作暂停）',
      indexPreview: '短期记忆索引预览',
      recent: '最近事件',
      noSession: '打开一个会话后可以读取记忆库状态。',
      noEntries: '（暂无短期记忆）',
      noSummary: '（暂无长期记忆）',
      noEvents: '（暂无事件）',
      entriesTitle: '短期记忆',
      activeList: '短期记忆（有效）',
      deletedList: '短期记忆（已删除，可恢复）',
      noDeleted: '（没有被删除的记忆）',
      deleteBtn: '删除',
      confirmDelete: '确认删除',
      restoreBtn: '恢复',
      cancelBtn: '取消',
      versionsTitle: '长期记忆版本历史',
      noVersions: '（还没有历史版本）',
      rollbackBtn: '回滚',
      confirmRollback: '确认回滚',
      softDeleteHint: '短期记忆删除是软删除：正文保留，随时可恢复；删除后仅由它支持的长期事实会从注入中移除。',
      readEmptyHint: '读不到记忆文件：设置页没拿到 .dsh/memories-feiyu 的内容（可能是当前会话的工作区不对，或文件服务受限）。记忆本身仍然正常工作。',
      hostReadOnly: 'Host 认证不可用，当前只读；请修复/重启 DSH 认证后再编辑。',
      longTermTitle: '长期记忆',
      longTermHint: 'AI 综合出的主人认知。编辑后改动段落会自动锁定，AI 不能覆盖；可逐条解锁，让未来继续演化。',
      longTermEdit: '编辑长期记忆',
      longTermSave: '保存并保护修改',
      longTermCancel: '取消',
      longTermUnlock: '解锁',
      longTermDelete: '删除',
      longTermConfirmDelete: '确认删除',
      longTermEmpty: '暂无长期记忆。',
      longTermLocked: '已锁定',
      longTermSaved: '长期记忆已更新',
      longTermDeleted: '已删除长期记忆片段',
      longTermIndexError: '长期版本索引与文件不一致；编辑/回滚已暂停，请先运行 repair-summary-index。',
      longTermForgotten: '已遗忘 {count} 条长期内容',
      traceLabel: '溯源',
      editBtn: '编辑',
      historyBtn: '历史',
      saveBtn: '保存修改',
      contentLabel: '正文',
      summaryLabel: '概述',
      tagsLabel: '标签（逗号分隔）',
      quoteLabel: '引文（可选）',
      reasonLabel: '修改原因（可选）',
      editOk: '已更新 {id}',
      historyTitle: '修改历史',
      noHistory: '（没有修改历史）',
      revertBtn: '回退',
      revertOk: '已回退到第 {version} 次修改前',
      deleteReason: '删除原因',
      actionBusy: '处理中…',
      deleteOk: '已删除 {id}',
      restoreOk: '已恢复 {id}',
      rollbackOk: '已回滚到版本 {version}',
      actionFailed: '操作失败：{error}',
      bytes: 'B',
      statusError: '读取记忆库失败：{error}',
      filesUnavailable: '文件读取服务不可用，暂时只能修改设置。',
      indexInject: '注入记忆索引',
      indexInjectHint: '新会话第一轮注入活动记忆索引；关闭后只注入摘要。',
      autoSummary: '自动演化长期记忆',
      autoSummaryHint: '允许 Curator 在有新短期记忆时综合长期记忆；冻结后只保留当前版本。',
      scopeMaxBytes: '工作区摘要预算（B）',
      scopeMaxBytesHint: '私有工作区摘要最多占用多少字节。',
      maxBytes: '摘要总预算（B）',
      maxBytesHint: '全局摘要 + 工作区摘要的总上限。',
      maxActiveMemories: '活动记忆上限',
      maxActiveMemoriesHint: '超过后最旧记忆进入 archive，不会被删除。',
      keepSummaryVersions: '保留摘要版本',
      keepSummaryVersionsHint: 'summary_history 中最多保留多少份旧摘要。',
      indexMaxBytes: '索引字节上限',
      indexMaxBytesHint: '活动记忆索引最多占用多少字节。',
      indexMaxTokens: '索引 token 上限',
      indexMaxTokensHint: '活动记忆索引最多占用多少 token。',
      configTitle: '记忆设置',
      configHint: '这些改动会写入当前 profile，并即时影响记忆行为。',
      pathNote: '记忆文件位于工作区的 .dsh/memories-feiyu；修改会保存到当前 DSH profile。',
      statusNote: '状态读取为只读，不会修改记忆文件。',
    };

    const en = {
      nav: 'Memory',
      title: 'Memory',
      description: 'Applies only to the Feiyu workspace. Short-term memories store atomic facts; long-term memory is synthesized, deduplicated and updated by AI.',
      workspaceOnly: 'Memory is readable and writable only from a root session in the configured private workspace. This session is outside it, so content is hidden and actions are disabled.',
      loading: 'Reading settings…',
      unavailable: 'The memory plugin is not loaded.',
      readOnly: 'Settings are read-only in this deployment.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Save failed. Check the values and try again.',
      reset: 'Reset to defaults',
      noChanges: 'Nothing to save.',
      noChange: 'No change; nothing was written.',
      invalidNumber: 'Enter an integer no smaller than {min}.',
      maxTooSmall: 'The total summary budget must exceed the workspace budget by at least 2000 B.',
      statusTitle: 'Memory status',
      refresh: 'Refresh',
      refreshing: 'Reading…',
      active: 'Short-term (active)',
      archived: 'Short-term (archived)',
      summary: 'Long-term size',
      versions: 'Long-term versions',
      summaryModeLabel: 'Long-term update mode',
      modeAuto: 'Auto-evolve',
      modeManual: 'Frozen',
      switchAuto: 'Resume auto-evolve',
      curatorLabel: 'Memory curation',
      curatorPending: '{turns} pending turns / {sessions} root sessions',
      parseErrors: '{count} corrupt records isolated; writes paused',
      indexPreview: 'Index preview',
      recent: 'Recent events',
      noSession: 'Open a session to read memory status.',
      noEntries: '(No active memories)',
      noSummary: '(No summary)',
      noEvents: '(No events)',
      entriesTitle: 'Short-term memory',
      activeList: 'Short-term (active)',
      deletedList: 'Short-term (deleted, restorable)',
      noDeleted: '(No deleted memories)',
      deleteBtn: 'Delete',
      confirmDelete: 'Confirm delete',
      restoreBtn: 'Restore',
      cancelBtn: 'Cancel',
      versionsTitle: 'Long-term version history',
      noVersions: '(No earlier versions)',
      rollbackBtn: 'Roll back',
      confirmRollback: 'Confirm rollback',
      softDeleteHint: 'Short-term deletion is soft: the text stays on disk and can be restored. Long-term claims supported only by a deleted memory are removed from injection.',
      readEmptyHint: 'Could not read the memory files: the settings page did not reach .dsh/memories-feiyu (wrong workspace session or restricted file service). Memory itself still works.',
      hostReadOnly: 'Host authentication is unavailable; this page is read-only until DSH auth is repaired.',
      longTermTitle: 'Long-term memory',
      longTermHint: 'AI-synthesized understanding of the owner. Edited blocks are locked against automatic overwrite and can be unlocked individually.',
      longTermEdit: 'Edit long-term memory',
      longTermSave: 'Save and protect changes',
      longTermCancel: 'Cancel',
      longTermUnlock: 'Unlock',
      longTermDelete: 'Delete',
      longTermConfirmDelete: 'Confirm delete',
      longTermEmpty: 'No long-term memory yet.',
      longTermLocked: 'Locked',
      longTermSaved: 'Long-term memory updated',
      longTermDeleted: 'Long-term memory block deleted',
      longTermIndexError: 'Long-term version index is inconsistent; editing/rollback is paused. Run repair-summary-index first.',
      longTermForgotten: '{count} long-term claims forgotten',
      traceLabel: 'Trace',
      editBtn: 'Edit',
      historyBtn: 'History',
      saveBtn: 'Save',
      contentLabel: 'Content',
      summaryLabel: 'Summary',
      tagsLabel: 'Tags (comma separated)',
      quoteLabel: 'Quote (optional)',
      reasonLabel: 'Reason (optional)',
      editOk: 'Updated {id}',
      historyTitle: 'Edit history',
      noHistory: '(No edit history)',
      revertBtn: 'Revert',
      revertOk: 'Reverted before edit #{version}',
      deleteReason: 'Reason',
      actionBusy: 'Working…',
      deleteOk: 'Deleted {id}',
      restoreOk: 'Restored {id}',
      rollbackOk: 'Rolled back to version {version}',
      actionFailed: 'Action failed: {error}',
      bytes: 'B',
      statusError: 'Failed to read memory: {error}',
      filesUnavailable: 'The file service is unavailable; settings can still be edited.',
      indexInject: 'Inject memory index',
      indexInjectHint: 'Inject the active memory index into the first turn of a new session.',
      autoSummary: 'Auto-evolve long-term memory',
      autoSummaryHint: 'Allow the curator to synthesize long-term memory when short-term memory changes; freezing keeps the current version.',
      scopeMaxBytes: 'Workspace summary budget (B)',
      scopeMaxBytesHint: 'Maximum bytes for the Feiyu workspace summary.',
      maxBytes: 'Total summary budget (B)',
      maxBytesHint: 'Upper bound for global plus workspace summaries.',
      maxActiveMemories: 'Active memory limit',
      maxActiveMemoriesHint: 'Oldest memories move to archive; nothing is deleted.',
      keepSummaryVersions: 'Summary versions kept',
      keepSummaryVersionsHint: 'How many old summaries summary_history keeps.',
      indexMaxBytes: 'Index byte limit',
      indexMaxBytesHint: 'Maximum bytes for the active memory index.',
      indexMaxTokens: 'Index token limit',
      indexMaxTokensHint: 'Maximum tokens for the active memory index.',
      configTitle: 'Memory settings',
      configHint: 'These changes are written to the current profile and take effect immediately.',
      pathNote: 'Memory files live in .dsh/memories-feiyu in the workspace; changes are saved to the current DSH profile.',
      statusNote: 'Status reads are read-only and never modify memory files.',
    };

    const DEFAULTS = {
      scopeMaxBytes: 12000,
      maxBytes: 14000,
      maxActiveMemories: 200,
      keepSummaryVersions: 30,
      injectIndex: true,
      indexMaxBytes: 40960,
      indexMaxTokens: 12000,
      autoSummary: true,
    };

    const FIELD_DEFS = [
      { key: 'injectIndex', kind: 'boolean', label: 'indexInject', hint: 'indexInjectHint' },
      { key: 'autoSummary', kind: 'boolean', label: 'autoSummary', hint: 'autoSummaryHint' },
      { key: 'scopeMaxBytes', kind: 'number', min: 1000, label: 'scopeMaxBytes', hint: 'scopeMaxBytesHint' },
      { key: 'maxBytes', kind: 'number', min: 3000, label: 'maxBytes', hint: 'maxBytesHint' },
      { key: 'maxActiveMemories', kind: 'number', min: 1, label: 'maxActiveMemories', hint: 'maxActiveMemoriesHint' },
      { key: 'keepSummaryVersions', kind: 'number', min: 1, label: 'keepSummaryVersions', hint: 'keepSummaryVersionsHint' },
      { key: 'indexMaxBytes', kind: 'number', min: 1, label: 'indexMaxBytes', hint: 'indexMaxBytesHint' },
      { key: 'indexMaxTokens', kind: 'number', min: 1, label: 'indexMaxTokens', hint: 'indexMaxTokensHint' },
    ];

    const COLORS = {
      text: 'var(--dsw-alias-label-primary, #e8e8e8)',
      muted: 'var(--dsw-alias-label-secondary, #9a9a9a)',
      faint: 'var(--dsw-alias-label-tertiary, #777)',
      surface: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04))',
      surfaceAlt: 'var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06))',
      border: 'var(--dsw-alias-border-secondary, rgba(255,255,255,0.12))',
      accent: 'var(--dsw-alias-brand-primary-new-color, #4176e6)',
      danger: 'var(--dsw-alias-label-danger, #ff7b72)',
      success: 'var(--dsw-alias-label-success, #61c454)',
    };

    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (_, key) => String(values?.[key] ?? ''));
    }

    function stripHeader(text) {
      return String(text ?? '')
        .split('\n')
        .filter((line) => !line.startsWith('<!-- feiyu-summary v1') && !line.startsWith('<!-- feiyu-raw v1') && !line.startsWith('<!-- feiyu-archive v1'))
        .join('\n')
        .trim();
    }

    function fieldOf(block, label) {
      const match = new RegExp(`^- ${label}[:：]\\s?(.*)$`, 'm').exec(block);
      return match ? match[1].trim() : '';
    }

    function parseEntries(raw) {
      const text = String(raw ?? '');
      const pattern = /^## (mem-[0-9a-f]{8})\s*$/gm;
      const heads = [];
      let match;
      while ((match = pattern.exec(text)) !== null) {
        heads.push({ id: match[1], start: match.index, end: pattern.lastIndex });
      }
      return heads.map((head, index) => {
        const block = text.slice(head.end, index + 1 < heads.length ? heads[index + 1].start : text.length);
        return {
          id: head.id,
          createdAt: fieldOf(block, '创建'),
          tags: fieldOf(block, '标签'),
          summary: fieldOf(block, '概述'),
          status: fieldOf(block, '状态') === 'deleted' ? 'deleted' : 'active',
          deletedAt: fieldOf(block, '删除于'),
          deleteReason: fieldOf(block, '删除原因'),
        };
      });
    }

    function displayTime(value) {
      const text = String(value ?? '');
      return text.length >= 16 ? `${text.slice(0, 10)} ${text.slice(11, 16)}` : text;
    }

    function indexLine(entry) {
      return `- ${entry.id} · ${displayTime(entry.createdAt)} · ${entry.tags || '无标签'} · ${entry.summary || '（无概述）'}`;
    }

    function decode(bytes) {
      return new TextDecoder('utf-8').decode(bytes);
    }

    function useScopeSnapshot(scope) {
      const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
      useEffect(() => {
        setSnapshot(scope.getSnapshot());
        return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
      }, [scope]);
      return snapshot;
    }

    function useMemoryStatus(loadMemory, sessionKey) {
      const [state, setState] = useState({
        status: sessionKey ? 'loading' : 'no-session',
        data: null,
        error: '',
      });
      const abortRef = useRef();

      const refresh = useCallback(async () => {
        abortRef.current?.abort();
        if (!sessionKey) {
          setState({ status: 'no-session', data: null, error: '' });
          return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setState((previous) => ({ ...previous, status: 'loading', error: '' }));
        try {
          const data = await loadMemory(sessionKey.split('|').filter(Boolean), controller.signal);
          if (!controller.signal.aborted) setState({ status: 'ready', data, error: '' });
        } catch (error) {
          if (controller.signal.aborted) return;
          setState({ status: 'error', data: null, error: String(error?.message ?? error) });
        }
      }, [loadMemory, sessionKey]);

      useEffect(() => {
        void refresh();
        return () => abortRef.current?.abort();
      }, [refresh]);

      return [state, refresh];
    }

    function Metric({ label, value, suffix }) {
      return h('div', {
        style: {
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: '12px 14px',
          minWidth: 0,
        },
      }, [
        h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 6 } }, label),
        h('div', { key: 'value', style: { color: COLORS.text, fontSize: 22, fontWeight: 600, lineHeight: 1.15 } },
          value === undefined || value === null ? '—' : `${value}${suffix ? ` ${suffix}` : ''}`),
      ]);
    }

    function Toggle({ checked, onChange, disabled, label }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
        style: {
          width: 42,
          height: 24,
          borderRadius: 12,
          border: 'none',
          padding: 0,
          position: 'relative',
          flex: '0 0 auto',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          background: checked ? COLORS.accent : COLORS.surfaceAlt,
          transition: 'background .15s ease',
        },
      }, h('span', {
        style: {
          position: 'absolute',
          top: 3,
          left: checked ? 21 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,.35)',
          transition: 'left .15s ease',
        },
      }));
    }

    function FieldRow({ label, hint, error, children }) {
      return h('div', {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
          padding: '12px 0',
          borderBottom: `1px solid ${COLORS.border}`,
        },
      }, [
        h('div', { key: 'copy', style: { minWidth: 0 } }, [
          h('div', { key: 'label', style: { color: COLORS.text, fontSize: 14, fontWeight: 500 } }, label),
          hint ? h('div', { key: 'hint', style: { color: COLORS.muted, fontSize: 12, lineHeight: 1.5, marginTop: 3 } }, hint) : null,
          error ? h('div', { key: 'error', style: { color: COLORS.danger, fontSize: 12, marginTop: 4 } }, error) : null,
        ]),
        h('div', { key: 'control', style: { flex: '0 0 auto', paddingTop: 1 } }, children),
      ]);
    }

    function MemorySection(props) {
      const { scope, loadMemory, workspaceAllowed } = props;
      const t = props.t ?? ((key) => zh[key] ?? key);
      const initialAllowed = typeof workspaceAllowed === 'function' ? workspaceAllowed() : true;
      const snapshot = useScopeSnapshot(scope);
      const [draft, setDraft] = useState({});
      const [message, setMessage] = useState('');
      const [busy, setBusy] = useState(false);

      // 先让 Host 返回真实 privateWorkspace，再判断当前会话是否属于该工作区。
      const sessionKey = 'host';

      const [status, refreshStatus] = useMemoryStatus(loadMemory, sessionKey);
      const allowed = status.data?.workspaceAllowed ?? initialAllowed;
      const [confirm, setConfirm] = useState(null);
      const [actionMsg, setActionMsg] = useState(null);
      const [actionBusy, setActionBusy] = useState(false);
      const [editing, setEditing] = useState(null);
      const [historyFor, setHistoryFor] = useState(null);
      const [longTermEditing, setLongTermEditing] = useState(false);
      const [longTermDraft, setLongTermDraft] = useState('');

      useEffect(() => {
        setDraft({});
        setMessage('');
      }, [snapshot.revision]);

      const values = snapshot.value ?? {};
      const readValue = (key) => (draft[key] !== undefined ? draft[key] : values[key]);
      const readNumber = (key) => {
        const value = readValue(key);
        return value === undefined || value === '' ? '' : String(value);
      };

      const save = async () => {
        if (!snapshot.writable || busy) return;
        const ops = [];
        const errors = {};
        for (const field of FIELD_DEFS) {
          if (draft[field.key] === undefined) continue;
          let value = draft[field.key];
          if (field.kind === 'number') {
            const parsed = Number(value);
            if (!Number.isSafeInteger(parsed) || parsed < field.min) {
              errors[field.key] = format(t('invalidNumber'), { min: field.min });
              continue;
            }
            value = parsed;
          }
          if (String(value) === String(values[field.key])) continue;
          ops.push({ op: 'set', path: [field.key], value });
        }
        const scopeBytes = Number(readValue('scopeMaxBytes'));
        const totalBytes = Number(readValue('maxBytes'));
        if (Number.isFinite(scopeBytes) && Number.isFinite(totalBytes) && totalBytes < scopeBytes + 2000) {
          errors.maxBytes = t('maxTooSmall');
        }
        if (Object.keys(errors).length > 0) {
          setMessage('');
          setDraft((previous) => ({ ...previous, __errors: errors }));
          return;
        }
        if (ops.length === 0) {
          setMessage(t('noChanges'));
          return;
        }
        setBusy(true);
        setMessage('');
        try {
          const accepted = await scope.mutate(ops);
          if (accepted) {
            setMessage(t('saved'));
            setDraft({});
          } else {
            setMessage(t('saveFailed'));
          }
        } catch (error) {
          setMessage(`${t('saveFailed')} ${String(error?.message ?? error)}`);
        } finally {
          setBusy(false);
        }
      };

      const reset = async () => {
        if (!snapshot.writable || busy) return;
        setBusy(true);
        setMessage('');
        try {
          const ops = FIELD_DEFS.map((field) => ({ op: 'set', path: [field.key], value: DEFAULTS[field.key] }));
          const accepted = await scope.mutate(ops);
          setMessage(accepted ? t('saved') : t('saveFailed'));
          if (accepted) setDraft({});
        } catch (error) {
          setMessage(`${t('saveFailed')} ${String(error?.message ?? error)}`);
        } finally {
          setBusy(false);
        }
      };

      const errors = draft.__errors ?? {};
      const data = status.data;
      if (data && data.workspaceAllowed === false) {
        return h('div', { style: { color: COLORS.muted, fontSize: 13, lineHeight: 1.6, padding: '12px 0' } }, t('workspaceOnly'));
      }
      const indexEntries = data?.indexEntries ?? [];
      const activeEntries = data?.active ?? [];
      const deletedEntries = data?.deleted ?? [];
      const versionNames = data?.versionNames ?? [];
      const memoryAction = props.memoryAction;
      const hostWritable = allowed && data?.hostAuth !== 'unavailable';
      const longTermWritable = hostWritable && data?.longTerm?.indexOk !== false;

      const runAction = async (kind, payload) => {
        if (actionBusy) return;
        if (!allowed) {
          setActionMsg({ text: t('workspaceOnly'), ok: false });
          return;
        }
        if (!hostWritable) {
          setActionMsg({ text: t('hostReadOnly'), ok: false });
          return;
        }
        if (typeof memoryAction !== 'function') {
          setActionMsg(format(t('actionFailed'), { error: t('filesUnavailable') }));
          return;
        }
        setActionBusy(true);
        setActionMsg(null);
        try {
          const result = await memoryAction(kind, payload);
          if (result?.changed === false && kind !== 'history') {
            setActionMsg({ text: t('noChange'), ok: true });
            setConfirm(null);
            await refreshStatus();
            return;
          }
          const text = kind === 'forget'
            ? format(t('deleteOk'), { id: payload.id })
            : kind === 'restore'
              ? format(t('restoreOk'), { id: payload.id })
              : kind === 'update'
                ? format(t('editOk'), { id: payload.id })
                : kind === 'state'
                  ? t('switchAuto')
                  : kind === 'revert'
                    ? format(t('revertOk'), { version: result?.version ?? payload.version })
                    : format(t('rollbackOk'), { version: result?.version ?? payload.version });
          setActionMsg({ text, ok: true });
          setConfirm(null);
          await refreshStatus();
        } catch (error) {
          setActionMsg({ text: format(t('actionFailed'), { error: String(error?.message ?? error) }), ok: false });
        } finally {
          setActionBusy(false);
        }
      };

      const actionButton = (label, onClick, tone, disabled = false) => h('button', {
        type: 'button',
        onClick,
        disabled: actionBusy || !hostWritable || disabled,
        style: {
          background: 'transparent',
          color: tone === 'danger' ? COLORS.danger : COLORS.accent,
          border: `1px solid ${tone === 'danger' ? COLORS.danger : COLORS.border}`,
          borderRadius: 7,
          padding: '4px 10px',
          fontSize: 12,
          cursor: actionBusy || !hostWritable || disabled ? 'not-allowed' : 'pointer',
          opacity: actionBusy || !hostWritable || disabled ? 0.6 : 1,
          flex: '0 0 auto',
        },
      }, label);

      const startEdit = (entry) => {
        setActionMsg(null);
        setHistoryFor(null);
        setEditing({
          id: entry.id,
          content: entry.content ?? '',
          summary: entry.summary ?? '',
          tags: (entry.tags ?? []).join(', '),
          quote: entry.quote ?? '',
          reason: '',
        });
      };

      const openHistory = async (entry) => {
        setEditing(null);
        setActionMsg(null);
        if (typeof memoryAction !== 'function') return;
        setActionBusy(true);
        try {
          const result = await memoryAction('history', { id: entry.id });
          setHistoryFor({ id: entry.id, items: (result?.revisions ?? []).slice().reverse() });
        } catch (error) {
          setActionMsg({ text: format(t('actionFailed'), { error: String(error?.message ?? error) }), ok: false });
        } finally {
          setActionBusy(false);
        }
      };

      const openLongTermEditor = () => {
        if (!longTermWritable) {
          setActionMsg({ text: hostWritable ? t('longTermIndexError') : t('hostReadOnly'), ok: false });
          return;
        }
        setActionMsg(null);
        setLongTermDraft(data?.summaryText ?? '');
        setLongTermEditing(true);
      };

      const saveLongTerm = async () => {
        if (!longTermWritable || actionBusy) return;
        if (typeof memoryAction !== 'function') return;
        setActionBusy(true);
        setActionMsg(null);
        try {
          const result = await memoryAction('long-term', {
            action: 'update',
            text: longTermDraft,
            expectedHash: data?.summaryHash ?? '',
            protectChanged: true,
            reason: 'settings-long-term-edit',
          });
          setActionMsg({
            text: result?.changed === false ? t('noChange') : t('longTermSaved'),
            ok: true,
          });
          setLongTermEditing(false);
          await refreshStatus();
        } catch (error) {
          setActionMsg({ text: format(t('actionFailed'), { error: String(error?.message ?? error) }), ok: false });
        } finally {
          setActionBusy(false);
        }
      };

      const unlockLongTerm = async (id) => {
        if (!longTermWritable || actionBusy) return;
        if (typeof memoryAction !== 'function') return;
        setActionBusy(true);
        setActionMsg(null);
        try {
          await memoryAction('long-term', { action: 'unlock', id });
          setActionMsg({ text: t('longTermUnlock'), ok: true });
          await refreshStatus();
        } catch (error) {
          setActionMsg({ text: format(t('actionFailed'), { error: String(error?.message ?? error) }), ok: false });
        } finally {
          setActionBusy(false);
        }
      };

      const deleteLongTerm = async (id) => {
        if (!longTermWritable || actionBusy) return;
        if (typeof memoryAction !== 'function') return;
        setActionBusy(true);
        setActionMsg(null);
        try {
          await memoryAction('long-term', { action: 'forget', id, reason: 'user-delete-long-term' });
          setActionMsg({ text: t('longTermDeleted'), ok: true });
          setConfirm(null);
          await refreshStatus();
        } catch (error) {
          setActionMsg({ text: format(t('actionFailed'), { error: String(error?.message ?? error) }), ok: false });
        } finally {
          setActionBusy(false);
        }
      };

      const fieldStyle = {
        width: '100%',
        boxSizing: 'border-box',
        background: COLORS.surfaceAlt,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        color: COLORS.text,
        padding: '6px 8px',
        fontSize: 12,
        fontFamily: 'inherit',
      };

      const editForm = (entry) => h('div', { key: `edit-${entry.id}`, style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0 4px' } }, [
        h('textarea', {
          key: 'content',
          value: editing.content,
          rows: 4,
          placeholder: t('contentLabel'),
          style: { ...fieldStyle, resize: 'vertical' },
          onChange: (event) => setEditing((prev) => ({ ...prev, content: event.target.value })),
        }),
        h('div', { key: 'row1', style: { display: 'flex', gap: 8 } }, [
          h('input', {
            key: 'summary',
            value: editing.summary,
            placeholder: t('summaryLabel'),
            style: fieldStyle,
            onChange: (event) => setEditing((prev) => ({ ...prev, summary: event.target.value })),
          }),
          h('input', {
            key: 'tags',
            value: editing.tags,
            placeholder: t('tagsLabel'),
            style: fieldStyle,
            onChange: (event) => setEditing((prev) => ({ ...prev, tags: event.target.value })),
          }),
        ]),
        h('div', { key: 'row2', style: { display: 'flex', gap: 8 } }, [
          h('input', {
            key: 'quote',
            value: editing.quote,
            placeholder: t('quoteLabel'),
            style: fieldStyle,
            onChange: (event) => setEditing((prev) => ({ ...prev, quote: event.target.value })),
          }),
          h('input', {
            key: 'reason',
            value: editing.reason,
            placeholder: t('reasonLabel'),
            style: fieldStyle,
            onChange: (event) => setEditing((prev) => ({ ...prev, reason: event.target.value })),
          }),
        ]),
        h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
          actionButton(t('saveBtn'), () => {
            const payload = { ...editing };
            setEditing(null);
            void runAction('update', payload);
          }, 'normal'),
          actionButton(t('cancelBtn'), () => setEditing(null), 'normal'),
        ]),
      ]);

      const historyList = (entry) => {
        const items = historyFor?.items ?? [];
        return h('div', { key: `history-${entry.id}`, style: { padding: '8px 0 4px' } }, [
          h('div', { key: 'title', style: { color: COLORS.muted, fontSize: 12, marginBottom: 4 } }, `${t('historyTitle')}（${items.length}）`),
          items.length === 0
            ? h('div', { key: 'empty', style: { color: COLORS.faint, fontSize: 12 } }, t('noHistory'))
            : h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, items.map((item) => h('div', {
              key: item.index,
              style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
            }, [
              h('div', { key: 'text', style: { color: COLORS.muted, fontSize: 11, lineHeight: 1.5 } },
                `${item.index}. ${displayTime(item.ts)} · ${(item.changed ?? []).join('/')} · ${item.reason || '—'}`),
              actionButton(t('revertBtn'), () => {
                setHistoryFor(null);
                void runAction('revert', { id: entry.id, version: item.version ?? item.index });
              }, 'normal'),
            ]))),
        ]);
      };

      const entryRow = (entry, kind) => {
        const isConfirming = confirm && confirm.kind === kind && confirm.id === entry.id;
        const isEditing = editing?.id === entry.id;
        const isHistory = historyFor?.id === entry.id;
        const buttons = isConfirming
          ? [
            actionButton(kind === 'deleted' ? t('confirmDelete') : t('confirmRollback'), () => {
              if (kind === 'active') void runAction('forget', { id: entry.id, reason: '' });
              else if (kind === 'deleted') void runAction('restore', { id: entry.id });
              else void runAction('rollback', { version: entry.version });
            }, kind === 'active' ? 'danger' : 'normal'),
            actionButton(t('cancelBtn'), () => setConfirm(null), 'normal'),
          ]
          : [
            kind === 'active' ? actionButton(t('editBtn'), () => startEdit(entry), 'normal') : null,
            kind === 'active' ? actionButton(t('historyBtn'), () => { void openHistory(entry); }, 'normal') : null,
            actionButton(
              kind === 'active' ? t('deleteBtn') : (kind === 'deleted' ? t('restoreBtn') : t('rollbackBtn')),
              () => {
                if (kind === 'active' || kind === 'versions') setConfirm({ kind, id: entry.id });
                else void runAction('restore', { id: entry.id });
              },
              kind === 'active' ? 'danger' : 'normal',
            ),
          ].filter(Boolean);

        const row = h('div', {
          key: `${kind}-${entry.id}-row`,
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            padding: '8px 0',
            borderBottom: `1px solid ${COLORS.border}`,
          },
        }, [
          h('div', { key: 'body', style: { minWidth: 0 } }, [
            h('div', {
              key: 'id',
              style: { color: COLORS.text, fontSize: 12, fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)' },
            }, `${entry.label ?? `${entry.id} · ${displayTime(entry.createdAt)}`}`),
            h('div', { key: 'summary', style: { color: COLORS.muted, fontSize: 12, lineHeight: 1.5, marginTop: 2 } },
              entry.summary || '（无概述）'),
            kind === 'deleted' && entry.deleteReason
              ? h('div', { key: 'reason', style: { color: COLORS.faint, fontSize: 11, marginTop: 2 } },
                `${t('deleteReason')}: ${entry.deleteReason}`)
              : null,
            entry.trace
              ? h('div', { key: 'trace', style: { color: COLORS.faint, fontSize: 11, marginTop: 2 } },
                `${t('traceLabel')}: ${entry.trace}`)
              : null,
          ]),
          h('div', { key: 'actions', style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } }, buttons),
        ]);

        const extras = [];
        if (isEditing) extras.push(editForm(entry));
        if (isHistory) extras.push(historyList(entry));
        if (extras.length === 0) return row;
        return h('div', { key: `${kind}-${entry.id}`, style: { display: 'flex', flexDirection: 'column' } }, [row, ...extras]);
      };

      const emptyLine = (text) => h('div', { style: { color: COLORS.faint, fontSize: 12, padding: '6px 0' } }, text);

      const entriesContent = (!data ? null : h('div', { key: 'entries-body', style: { display: 'flex', flexDirection: 'column', gap: 14 } }, [
        h('div', { key: 'active' }, [
          h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 2 } }, `${t('activeList')}（${activeEntries.length}）`),
          activeEntries.length === 0 ? emptyLine(t('noEntries')) : h('div', null, activeEntries.map((entry) => entryRow(entry, 'active'))),
        ]),
        h('div', { key: 'deleted' }, [
          h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 2 } }, `${t('deletedList')}（${deletedEntries.length}）`),
          deletedEntries.length === 0 ? emptyLine(t('noDeleted')) : h('div', null, deletedEntries.map((entry) => entryRow(entry, 'deleted'))),
        ]),
        h('div', { key: 'versions' }, [
          h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 2 } }, `${t('versionsTitle')}（${versionNames.length}）`),
          versionNames.length === 0
            ? emptyLine(t('noVersions'))
            : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 4 } },
              versionNames.slice().reverse().map((name) => {
                const version = name.replace(/\.md$/i, '');
                const entry = { id: `v-${version}`, version, label: `${version} 版`, summary: '', deleteReason: '' };
                return entryRow(entry, 'versions');
              })),
        ]),
        actionMsg
          ? h('div', {
            key: 'msg',
            style: { color: actionMsg.ok ? COLORS.success : COLORS.danger, fontSize: 12 },
          }, actionMsg.text)
          : null,
      ]));

      const longTermLocks = data?.longTermLocks ?? [];
      const longTermContent = !data ? null : h('section', {
        key: 'long-term',
        style: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 },
      }, [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 } }, [
          h('div', { key: 'copy' }, [
            h('h3', { key: 'title', style: { margin: 0, fontSize: 15, fontWeight: 600 } }, t('longTermTitle')),
            h('div', { key: 'hint', style: { color: COLORS.muted, fontSize: 12, lineHeight: 1.5, marginTop: 3 } }, t('longTermHint')),
          ]),
          longTermEditing
            ? null
            : actionButton(t('longTermEdit'), openLongTermEditor, 'normal', !longTermWritable),
        ]),
        data.longTerm?.indexOk === false
          ? h('div', { key: 'index-error', style: { color: COLORS.danger, fontSize: 12, lineHeight: 1.5, marginBottom: 8 } }, t('longTermIndexError'))
          : null,
        status.status === 'ready' && data.hostAuth === 'unavailable'
          ? h('div', { key: 'host-readonly', style: { color: COLORS.danger, fontSize: 12, lineHeight: 1.5, marginBottom: 8 } }, t('hostReadOnly'))
          : null,
        longTermEditing
          ? h('div', { key: 'editor', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, [
            h('textarea', {
              key: 'text',
              value: longTermDraft,
              rows: 16,
              style: {
                ...fieldStyle,
                resize: 'vertical',
                minHeight: 220,
                lineHeight: 1.6,
                fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
              },
              onChange: (event) => setLongTermDraft(event.target.value),
            }),
            h('div', { key: 'actions', style: { display: 'flex', gap: 8, alignItems: 'center' } }, [
              actionButton(t('longTermSave'), () => void saveLongTerm(), 'normal', !longTermWritable),
              actionButton(t('longTermCancel'), () => setLongTermEditing(false), 'normal'),
              actionMsg ? h('span', { key: 'msg', style: { color: actionMsg.ok ? COLORS.success : COLORS.danger, fontSize: 12 } }, actionMsg.text) : null,
            ]),
          ])
          : h('pre', {
            key: 'preview',
            style: {
              margin: 0,
              maxHeight: 260,
              overflow: 'auto',
              background: COLORS.surfaceAlt,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: '10px 12px',
              color: COLORS.text,
              fontSize: 11,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
            },
          }, data.summaryText || t('longTermEmpty')),
        longTermLocks.length > 0
          ? h('div', { key: 'locks', style: { marginTop: 12 } }, [
            h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 6 } },
              `${t('longTermLocked')} ${longTermLocks.length}`),
            h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              longTermLocks.map((lock) => {
                const isConfirming = confirm?.kind === 'long-term' && confirm.id === lock.id;
                return h('div', {
                  key: lock.id,
                  style: {
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    background: COLORS.surfaceAlt,
                  },
                }, [
                  h('div', { key: 'text', style: { color: COLORS.text, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' } },
                    lock.content.length > 180 ? `${lock.content.slice(0, 180)}…` : lock.content),
                  h('div', { key: 'actions', style: { display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' } }, [
                    actionButton(t('longTermUnlock'), () => void unlockLongTerm(lock.id), 'normal', !longTermWritable),
                    isConfirming
                      ? actionButton(t('longTermConfirmDelete'), () => void deleteLongTerm(lock.id), 'danger', !longTermWritable)
                      : actionButton(t('longTermDelete'), () => setConfirm({ kind: 'long-term', id: lock.id }), 'danger', !longTermWritable),
                    isConfirming ? actionButton(t('cancelBtn'), () => setConfirm(null), 'normal') : null,
                  ]),
                ]);
              })),
          ])
          : null,
        data.longTermForgottenList?.length > 0
          ? h('div', { key: 'forgotten', style: { color: COLORS.faint, fontSize: 11, marginTop: 10 } },
            format(t('longTermForgotten'), { count: data.longTermForgottenList.length }))
          : null,
        actionMsg && !longTermEditing
          ? h('div', { key: 'msg', style: { color: actionMsg.ok ? COLORS.success : COLORS.danger, fontSize: 12, marginTop: 8 } }, actionMsg.text)
          : null,
      ]);

      const configContent = (() => {
        if (snapshot.status === 'loading') return h('div', { style: { color: COLORS.muted, fontSize: 13 } }, t('loading'));
        if (snapshot.status === 'unavailable') return h('div', { style: { color: COLORS.muted, fontSize: 13 } }, t('unavailable'));

        const controls = FIELD_DEFS.map((field) => {
          const control = field.kind === 'boolean'
            ? h(Toggle, {
              checked: Boolean(readValue(field.key)),
              disabled: !snapshot.writable || busy,
              label: t(field.label),
              onChange: (checked) => setDraft((previous) => ({ ...previous, [field.key]: checked })),
            })
            : h('input', {
              type: 'number',
              min: field.min,
              step: 1,
              value: readNumber(field.key),
              disabled: !snapshot.writable || busy,
              'aria-label': t(field.label),
              onChange: (event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value })),
              style: {
                width: 150,
                boxSizing: 'border-box',
                background: COLORS.surfaceAlt,
                border: `1px solid ${errors[field.key] ? COLORS.danger : COLORS.border}`,
                borderRadius: 8,
                color: COLORS.text,
                padding: '8px 10px',
                fontSize: 13,
                textAlign: 'right',
              },
            });
          return h(FieldRow, {
            key: field.key,
            label: t(field.label),
            hint: t(field.hint),
            error: errors[field.key],
          }, control);
        });

        return h('div', null, [
          h('div', { key: 'hint', style: { color: COLORS.muted, fontSize: 12, marginBottom: 4 } }, t('configHint')),
          !snapshot.writable ? h('div', { key: 'ro', style: { color: COLORS.danger, fontSize: 12, marginBottom: 8 } }, t('readOnly')) : null,
          ...controls,
          h('div', { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 } }, [
            h('button', {
              key: 'save',
              type: 'button',
              onClick: save,
              disabled: !snapshot.writable || busy,
              style: {
                background: COLORS.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: !snapshot.writable || busy ? 'not-allowed' : 'pointer',
                opacity: !snapshot.writable || busy ? 0.6 : 1,
              },
            }, busy ? t('saving') : t('save')),
            h('button', {
              key: 'reset',
              type: 'button',
              onClick: reset,
              disabled: !snapshot.writable || busy,
              style: {
                background: 'transparent',
                color: COLORS.text,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
                cursor: !snapshot.writable || busy ? 'not-allowed' : 'pointer',
                opacity: !snapshot.writable || busy ? 0.6 : 1,
              },
            }, t('reset')),
            message ? h('span', { key: 'msg', style: { color: message === t('saved') ? COLORS.success : COLORS.muted, fontSize: 12 } }, message) : null,
          ]),
        ]);
      })();

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0 24px', color: COLORS.text } }, [
        h('header', { key: 'header' }, [
          h('h2', { key: 'title', style: { margin: 0, fontSize: 20, fontWeight: 650 } }, t('title')),
          h('p', { key: 'description', style: { margin: '6px 0 0', color: COLORS.muted, fontSize: 13, lineHeight: 1.6 } }, t('description')),
        ]),

        !allowed ? h('div', {
          key: 'workspace-warning',
          style: { color: COLORS.danger, fontSize: 13, lineHeight: 1.6, background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 },
        }, t('workspaceOnly')) : null,

        h('section', { key: 'status', style: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 } }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 } }, [
            h('h3', { key: 'title', style: { margin: 0, fontSize: 15, fontWeight: 600 } }, t('statusTitle')),
            h('button', {
              key: 'refresh',
              type: 'button',
              onClick: refreshStatus,
              disabled: !sessionKey || status.status === 'loading',
              style: {
                background: 'transparent',
                color: sessionKey ? COLORS.accent : COLORS.faint,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 7,
                padding: '5px 10px',
                fontSize: 12,
                cursor: !sessionKey || status.status === 'loading' ? 'not-allowed' : 'pointer',
              },
            }, status.status === 'loading' ? t('refreshing') : t('refresh')),
          ]),
          !sessionKey ? h('div', { key: 'nosession', style: { color: COLORS.muted, fontSize: 13 } }, t('noSession')) : null,
          status.status === 'error' ? h('div', { key: 'error', style: { color: COLORS.danger, fontSize: 13 } }, format(t('statusError'), { error: status.error })) : null,
          status.status === 'ready' && data?.readEmpty
            ? h('div', { key: 'empty-warning', style: { color: COLORS.danger, fontSize: 12, marginBottom: 8 } }, t('readEmptyHint'))
            : null,
          status.status === 'ready' ? h('div', { key: 'metrics' }, [
            h('div', { key: 'grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 } }, [
              h(Metric, { key: 'active', label: t('active'), value: data.active.length }),
              h(Metric, { key: 'archived', label: t('archived'), value: data.archivedCount }),
              h(Metric, { key: 'summary', label: t('summary'), value: data.summaryBytes, suffix: t('bytes') }),
              h(Metric, { key: 'versions', label: t('versions'), value: data.versions }),
              h(Metric, { key: 'mode', label: t('summaryModeLabel'), value: data.summaryMode === 'manual' ? t('modeManual') : t('modeAuto') }),
            ]),
            h('div', { key: 'mode-row', style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' } }, [
              h('span', { key: 'curator', style: { color: COLORS.muted, fontSize: 12 } },
                `${t('curatorLabel')}: ${data.curator?.pendingTurns != null ? format(t('curatorPending'), { turns: data.curator.pendingTurns, sessions: data.curator.rootSessions ?? 0 }) : '—'}`),
              data.summaryMode === 'manual'
                ? h('button', {
                  key: 'auto',
                  type: 'button',
                  disabled: actionBusy || !hostWritable,
                  onClick: () => void runAction('state', { mode: 'auto' }),
                  style: { background: 'transparent', color: COLORS.accent, border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: '4px 10px', fontSize: 12, cursor: actionBusy || !hostWritable ? 'not-allowed' : 'pointer' },
                }, t('switchAuto'))
                : null,
            ]),
            data.parseErrors > 0
              ? h('div', { key: 'parse-errors', style: { color: COLORS.danger, fontSize: 12, marginTop: 8 } }, format(t('parseErrors'), { count: data.parseErrors }))
              : null,
            h('div', { key: 'index', style: { marginTop: 14 } }, [
              h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 6 } }, t('indexPreview')),
              indexEntries.length === 0
                ? h('div', { key: 'empty', style: { color: COLORS.faint, fontSize: 12 } }, t('noEntries'))
                : h('div', { key: 'lines', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  indexEntries.slice(0, 6).map((entry) => h('div', {
                    key: entry.id,
                    title: indexLine(entry),
                    style: {
                      color: COLORS.text,
                      fontSize: 12,
                      lineHeight: 1.5,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)',
                    },
                  }, indexLine(entry)))),
            ]),
            h('div', { key: 'recent', style: { marginTop: 12 } }, [
              h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 4 } }, t('recent')),
              data.recent.length === 0
                ? h('div', { key: 'empty', style: { color: COLORS.faint, fontSize: 12 } }, t('noEvents'))
                : h('div', { key: 'lines', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                  data.recent.map((event, index) => h('div', {
                    key: `${event.op}-${index}`,
                    style: { color: COLORS.muted, fontSize: 12, lineHeight: 1.5 },
                  }, `${event.time || ''} ${event.op || ''}${event.id ? ` · ${event.id}` : ''}`))),
            ]),
            data.summaryText
              ? h('div', { key: 'summary', style: { marginTop: 12 } }, [
                h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12, marginBottom: 4 } }, t('summary')),
                h('pre', {
                  key: 'body',
                  style: {
                    margin: 0,
                    maxHeight: 104,
                    overflow: 'auto',
                    background: COLORS.surfaceAlt,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    color: COLORS.text,
                    fontSize: 11,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                  },
                }, data.summaryText),
              ])
              : null,
          ]) : null,
          status.status === 'ready' ? h('div', { key: 'note', style: { color: COLORS.faint, fontSize: 11, marginTop: 10 } }, t('statusNote')) : null,
        ]),

        longTermContent,

        data ? h('section', { key: 'entries', style: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 } }, [
          h('h3', { key: 'title', style: { margin: '0 0 2px', fontSize: 15, fontWeight: 600 } }, t('entriesTitle')),
          h('div', { key: 'hint', style: { color: COLORS.muted, fontSize: 12, marginBottom: 6, lineHeight: 1.5 } }, t('softDeleteHint')),
          entriesContent,
        ]) : null,

        h('section', { key: 'config', style: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 } }, [
          h('h3', { key: 'title', style: { margin: '0 0 2px', fontSize: 15, fontWeight: 600 } }, t('configTitle')),
          configContent,
          h('div', { key: 'path', style: { color: COLORS.faint, fontSize: 11, marginTop: 10, lineHeight: 1.5 } }, t('pathNote')),
        ]),
      ]);
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-memory-feiyu: locale');

      const t = ctx.locale.bind(NS);
      const scope = ctx.configForms.get(NAMESPACE);

      const PRIVATE_WORKSPACE = '';
      const normalizePath = (value) => String(value ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
      const workspaceAllowed = (rootValue = PRIVATE_WORKSPACE) => {
        try {
          const snapshot = ctx.sessions?.list?.getSnapshot?.();
          const sessions = Object.values(snapshot?.byId ?? {});
          if (sessions.length === 0) return true;
          const main = sessions.find((item) => (item?.retainedBy?.mainView ?? 0) > 0) ?? sessions[0];
          const cwd = normalizePath(main?.cwd);
          const root = normalizePath(rootValue);
          return cwd === root || cwd.startsWith(`${root}\\`);
        } catch {
          return true;
        }
      };

      // Host 端读取是首选：它直接读自己的记忆库，不受会话工作目录影响。
      // 工作区判断在拿到 Host 返回的 privateWorkspace 后做，不能把私人工作区路径写死。
      let hostError = '';
      const readHostState = async (signal) => {
        try {
          const response = await fetch('/api/dsh-memory-feiyu/state', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-dsh-memory-client': 'dsh-memory-feiyu/1',
            },
            body: '{}',
            credentials: 'same-origin',
            signal,
          });
          if (!response.ok) {
            hostError = `HTTP ${response.status}`;
            return null;
          }
          const body = await response.json();
          if (!body?.ok) {
            hostError = body?.error || '接口返回失败';
            return null;
          }
          return body;
        } catch (error) {
          if (signal?.aborted) throw error;
          hostError = String(error?.message ?? error);
          return null;
        }
      };

      const loadMemory = async (sessionIds, signal) => {
        const host = await readHostState(signal);
        if (host) {
          const active = Array.isArray(host.active) ? host.active : [];
          const deleted = Array.isArray(host.deleted) ? host.deleted : [];
          const versions = Array.isArray(host.versions) ? host.versions : [];
          const summaryText = stripHeader(host.summaryText ?? '');
          return {
            active,
            deleted,
            archivedCount: host.archivedCount ?? 0,
            summaryText,
            summaryHash: host.summaryHash ?? '',
            privateWorkspace: host.privateWorkspace ?? PRIVATE_WORKSPACE,
            workspaceAllowed: workspaceAllowed(host.privateWorkspace ?? PRIVATE_WORKSPACE),
            summaryBytes: host.summaryBytes ?? new TextEncoder().encode(summaryText).length,
            versions: versions.length,
            versionNames: versions,
            summaryMode: host.summaryMode ?? 'auto',
            hostAuth: 'ok',
            longTerm: host.longTerm ?? null,
            longTermLocks: host.longTermLocks ?? [],
            longTermForgottenList: host.longTermForgottenList ?? [],
            curator: host.curator ?? null,
            parseErrors: host.parseErrors ?? 0,
            parseErrorDetails: Array.isArray(host.parseErrorDetails) ? host.parseErrorDetails : [],
            stateRecovered: host.stateRecovered === true,
            recent: (Array.isArray(host.recent) ? host.recent : []).map((event) => ({
              op: event.op,
              id: event.id,
              time: typeof event.ts === 'string' ? event.ts.slice(11, 16) : '',
            })),
            indexEntries: active,
            readEmpty: false,
            sessionUsed: 'host',
            error: '',
          };
        }

        if (!ctx.remote?.workspaceFiles?.readBytes) throw new Error(zh.filesUnavailable);
        const ids = (Array.isArray(sessionIds) ? sessionIds : [sessionIds]).filter(Boolean);
        let lastError = hostError;

        const onError = (message) => {
          if (!lastError) lastError = message;
        };

        const readBytes = async (id, relative) => {
          for (const base of [MEMORY_DIR]) {
            try {
              const result = await ctx.remote.workspaceFiles.readBytes(id, `${base}/${relative}`, {}, signal);
              const text = decode(result.data);
              if (text) return text;
            } catch (error) {
              if (signal?.aborted) throw error;
              onError(String(error?.message ?? error));
            }
          }
          return '';
        };

        const listVersions = async (id) => {
          for (const base of [MEMORY_DIR]) {
            try {
              const listing = await ctx.remote.workspaceFiles.list(id, `${base}/summary_history`, signal);
              const names = (listing.entries ?? [])
                .map((entry) => entry.name ?? '')
                .filter((name) => /^\d{4,}\.md$/.test(name))
                .sort();
              if (names.length > 0) return names;
            } catch (error) {
              if (signal?.aborted) throw error;
              onError(String(error?.message ?? error));
            }
          }
          return [];
        };

        const readAll = async (id) => {
          const raw = await readBytes(id, 'raw_memories.md');
          if (!raw.trim()) return null;
          const [summaryRaw, archiveRaw, journalRaw] = await Promise.all([
            readBytes(id, 'memory_summary.md'),
            readBytes(id, 'archive/raw_memories.md'),
            readBytes(id, 'journal.jsonl'),
          ]);
          const versionNames = await listVersions(id);
          const entries = parseEntries(raw);
          const recent = journalRaw
            .split('\n')
            .filter(Boolean)
            .slice(-3)
            .map((line) => {
              try {
                const event = JSON.parse(line);
                return {
                  op: event.op,
                  id: event.id,
                  time: typeof event.ts === 'string' ? event.ts.slice(11, 16) : '',
                };
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .reverse();
          const summaryText = stripHeader(summaryRaw);
          return {
            active: entries.filter((entry) => entry.status !== 'deleted'),
            deleted: entries.filter((entry) => entry.status === 'deleted'),
            archivedCount: parseEntries(archiveRaw).length,
            summaryText,
            summaryHash: '',
            privateWorkspace: PRIVATE_WORKSPACE,
            workspaceAllowed: workspaceAllowed(),
            summaryBytes: new TextEncoder().encode(summaryText).length,
            versions: versionNames.length,
            versionNames,
            summaryMode: 'auto',
            hostAuth: 'unavailable',
            longTerm: { indexOk: true, locks: 0, forgotten: 0 },
            longTermLocks: [],
            longTermForgottenList: [],
            curator: null,
            parseErrors: 0,
            parseErrorDetails: [],
            stateRecovered: false,
            recent,
            indexEntries: entries.filter((entry) => entry.status !== 'deleted'),
            readEmpty: false,
            sessionUsed: id,
            error: '',
          };
        };

        for (const id of ids) {
          const result = await readAll(id);
          if (result) return result;
          if (signal?.aborted) return null;
        }

        return {
          active: [],
          deleted: [],
          archivedCount: 0,
          summaryText: '',
          summaryHash: '',
          summaryBytes: 0,
          versions: 0,
          versionNames: [],
          summaryMode: 'auto',
          hostAuth: 'unavailable',
          longTerm: { indexOk: true, locks: 0, forgotten: 0 },
          longTermLocks: [],
          longTermForgottenList: [],
          curator: null,
          parseErrors: 0,
          parseErrorDetails: [],
          stateRecovered: false,
          recent: [],
          indexEntries: [],
          readEmpty: true,
          sessionUsed: '',
          error: lastError,
          sessionsTried: ids.length,
        };
      };

      const memoryAction = async (action, payload) => {
        const response = await fetch(`/api/dsh-memory-feiyu/${action}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dsh-memory-client': 'dsh-memory-feiyu/1',
          },
          body: JSON.stringify(payload ?? {}),
          credentials: 'same-origin',
        });
        let body = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`);
        return body;
      };

      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'memory',
        order: 20,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ scope, loadMemory, memoryAction, workspaceAllowed }),
      }, MemorySection)), 'dsh-memory-feiyu: settings section');
    }

    return {
      inject: ['slots', 'locale', 'configForms', 'remote', 'remote.workspaceFiles', 'sessions'],
      apply,
    };
  },
});
