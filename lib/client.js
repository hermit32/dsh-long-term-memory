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
    // 相对路径按「当前会话 cwd」解析；设置页可能选中其他工作区的会话，因此优先用绝对路径。
    const MEMORY_DIR = '.dsh/memories-feiyu';
    // 记忆库绝对路径由 Host 状态接口下发；这里不再硬编码任何工作区路径。
    const MEMORY_ABS_DIR = '';

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
      readEmptyHint: '读不到记忆文件：设置页没拿到记忆库文件内容（可能是当前会话的工作区不对，或文件服务受限）。记忆本身仍然正常工作。',
      hostReadOnly: 'Host 认证不可用，当前只读；请修复/重启 DSH 认证后再编辑。',
      longTermTitle: '长期记忆',
      longTermHint: 'AI 综合出的用户认知。编辑后改动段落会自动锁定，AI 不能覆盖；可逐条解锁，让未来继续演化。',
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
      scopeMaxBytesHint: '私有工作区摘要最多占用多少字节；0 = 不限。',
      maxBytes: '摘要总预算（B）',
      maxBytesHint: '全局摘要 + 工作区摘要的总上限。',
      maxActiveMemories: '活动记忆上限',
      maxActiveMemoriesHint: '超过后最旧记忆进入 archive，不会被删除。',
      keepSummaryVersions: '保留摘要版本',
      keepSummaryVersionsHint: 'summary_history 中最多保留多少份旧摘要。',
      indexMaxBytes: '索引字节上限',
      indexMaxBytesHint: '活动记忆索引最多占用多少字节；0 = 不限。',
      indexMaxTokens: '索引 token 上限',
      indexMaxTokensHint: '活动记忆索引最多占用多少 token；0 = 不限。',
      configTitle: '记忆设置',
      configHint: '这些改动会写入当前 profile，并即时影响记忆行为。',
      pathNote: '记忆文件位于工作区的 .dsh/memories-feiyu；修改会保存到当前 DSH profile。',
      statusNote: '状态读取为只读，不会修改记忆文件。',

      /* ---------- v2.0 ---------- */
      overviewTitle: '记忆总览',
      overviewHint: '短期、冷库、长期、浮动核心与 Dreaming 的真实状态（全部来自后端）。',
      layerShort: '短期活跃',
      layerArchive: '冷库',
      layerLong: '长期记忆',
      layerCore: '浮动核心',
      layerHits: '今日有效命中',
      activeLimit: '上限 {max} 条',
      coreLimit: '上限 {max} 条',
      bytesSuffix: 'B',
      never: '尚未运行',
      dreamLastRun: '上次 Dreaming',
      startsAt: '开始 {time}',
      coreTitle: '浮动核心记忆',
      coreHint: 'Dreaming 从短期记忆里综合出的当前重点，最多 {max} 条。与长期记忆重复的不会注入；固定的条目不会被自动改写或删除。它是一层综合视图，不会合并或改写短期记忆正文。',
      coreEmpty: '（暂无浮动核心记忆；有新的短期记忆后 Dreaming 会自动综合）',
      coreAddBtn: '新增核心记忆',
      coreNewTitle: '新的核心记忆',
      coreEditTitle: '编辑核心记忆',
      coreSave: '保存',
      corePin: '固定',
      coreUnpin: '取消固定',
      corePinned: '已固定',
      coreHistoryBtn: '历史',
      coreDelete: '删除',
      coreConfirmDelete: '确认删除',
      coreSources: '来源',
      coreSourcesLabel: '来源短期记忆 ID（逗号分隔，至少 2 条）',
      coreTitleLabel: '标题（≤30 字）',
      coreBodyLabel: '正文（≤400 字）',
      coreHistoryEmpty: '（没有变更历史）',
      coreRestoreBtn: '回退',
      coreSaved: '浮动核心已更新',
      coreDeleted: '已删除浮动核心 {id}',
      coreHistoryTitle: '变更历史',
      coreBudget: '{bytes} B / {max} B',
      corePinnedNote: '固定条目自动流程不能改',
      coreSourceCount: '{count} 条来源',
      sortLabel: '排序',
      sortActivity: '按活跃度',
      sortTime: '按时间',
      activityLabel: '活跃度 {score} · 命中 {hits} · {ago}',
      today: '今天',
      yesterday: '昨天',
      daysAgo: '{days} 天前',
      archiveTitle: '冷库 Archive',
      archiveHint: '冷库不参与日常注入、默认搜索和自动整理。只有你明确要求回忆过去时才会被检索；回忆不等于恢复，这里不会被自动搬回。',
      archiveSearchPlaceholder: '搜索冷库（关键词、主题、人物）',
      archiveSearchBtn: '搜索',
      archiveClear: '清空',
      archiveSearchEmpty: '（没有匹配的冷库条目）',
      archiveEmpty: '（冷库是空的）',
      archiveRestoreBtn: '恢复',
      archiveDemoteBtn: '移入冷库',
      archiveRestored: '已恢复 {id}',
      archiveDemoted: '已移入冷库 {id}',
      archiveTotal: '共 {count} 条 · {bytes} B',
      archiveNoHost: '冷库详情需要 Host 接口；当前只能读取文件层。',
      dreamTitle: 'Dreaming 深度整合',
      dreamHint: '比 Curator 更低频：整合重复/相关/高频的短期记忆、维护浮动核心、提炼长期认知。到点自动运行，也可以手动触发。',
      dreamRun: '立即运行',
      dreamForce: '忽略间隔与阈值',
      dreamDue: '到期',
      dreamIdle: '未到期',
      dreamRuns: '运行记录',
      dreamNoRuns: '（还没有运行记录）',
      dreamOps: '+{add} / ~{update} / -{remove}',
      dreamRevert: '回滚',
      dreamConfirmRevert: '确认回滚',
      dreamRunOk: 'Dreaming 完成：{status}',
      dreamRunSkipped: 'Dreaming 未执行：{reason}',
      dreamRevertOk: '已回滚 {runId}',
      dreamStatusLine: '状态：{status} · 浮动核心 {core} 条',
      dreamReasonLabel: '触发原因',
      dreamDuration: '耗时',
      dreamErrors: '错误',
      dreamingEnabled: '启用 Dreaming',
      dreamingEnabledHint: '关闭后不再自动整合，也不维护浮动核心（手动运行仍可用）。',
      dreamingIntervalHours: 'Dreaming 间隔（小时）',
      dreamingIntervalHoursHint: '没有新记忆时，至少间隔这么久才做一次深度整合。',
      dreamingMinNewMemories: '新记忆触发条数',
      dreamingMinNewMemoriesHint: '新增/变更的短期记忆达到这个数量就触发一次。',
      dreamingHeatThreshold: '热度变化触发条数',
      dreamingHeatThresholdHint: '有效命中（次数/最后命中时间）变化达到这么多条时，Dreaming 也会跑一次，不再只等正文变化。',
      dreamingRunsPerDay: '每天最多运行次数',
      dreamingRunsPerDayHint: '防止 Dreaming 过于频繁地占用模型。',
      coreMaxItems: '浮动核心上限',
      coreMaxItemsHint: '最多保留多少条浮动核心记忆（1～10）。',
      coreMaxBytes: '浮动核心注入预算（B）',
      coreMaxBytesHint: '浮动核心在快照里最多占多少字节；0 = 不限。',
      coreItemMaxBytes: '单条核心记忆上限（B）',
      coreItemMaxBytesHint: '单条浮动核心正文的字节上限。',
      usageHalfLifeDays: '活跃度半衰期（天）',
      usageHalfLifeDaysHint: '最后一次有效引用/实质更新的权重衰减速度。',
      hitStatsMode: '命中统计用途',
      hitStatsModeHint: '观察模式只统计和展示，不参与自动归档；确认转述漏计/ID 误计可接受后再切到参与归档。',
      hitModeObserve: '观察（不参与归档）',
      hitModeEnforce: '参与归档',
      hitObserveNote: '命中统计：观察中——只记录和展示，不参与自动归档。',
      hitReasons: '命中来源：助手引用 {assistant} · 用户再次提及 {user} · 两者都提到 {both}',
      archiveOverflowNote: '（容量上限：{count} 条低活跃记忆已移入冷库）',
      hitEnforceNote: '命中统计：参与归档——活跃度会按命中次数影响淘汰顺序。',
      usageDailyHitCap: '单条每日命中上限',
      usageDailyHitCapHint: '同一条记忆每天最多计多少次有效命中，防止自我强化。',
      activityGraceHours: '活跃保护窗口（小时）',
      activityGraceHoursHint: '窗口内被引用/更新的记忆不会被容量淘汰搬进冷库（严重超容时除外）。',
      archiveRecallLimit: '回忆检索条数',
      archiveRecallLimitHint: 'memory_recall 默认返回多少条冷库记忆。',
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
      readEmptyHint: 'Could not read the memory files: the settings page did not reach the configured memory directory (wrong workspace session or restricted file service). Memory itself still works.',
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
      scopeMaxBytesHint: 'Maximum bytes for the Feiyu workspace summary; 0 = unlimited.',
      maxBytes: 'Total summary budget (B)',
      maxBytesHint: 'Upper bound for global plus workspace summaries.',
      maxActiveMemories: 'Active memory limit',
      maxActiveMemoriesHint: 'Oldest memories move to archive; nothing is deleted.',
      keepSummaryVersions: 'Summary versions kept',
      keepSummaryVersionsHint: 'How many old summaries summary_history keeps.',
      indexMaxBytes: 'Index byte limit',
      indexMaxBytesHint: 'Maximum bytes for the active memory index; 0 = unlimited.',
      indexMaxTokens: 'Index token limit',
      indexMaxTokensHint: 'Maximum tokens for the active memory index; 0 = unlimited.',
      configTitle: 'Memory settings',
      configHint: 'These changes are written to the current profile and take effect immediately.',
      pathNote: 'Memory files live in .dsh/memories-feiyu in the workspace; changes are saved to the current DSH profile.',
      statusNote: 'Status reads are read-only and never modify memory files.',

      /* ---------- v2.0 ---------- */
      overviewTitle: 'Memory overview',
      overviewHint: 'Live state of short-term, archive, long-term, floating core and Dreaming (all from the backend).',
      layerShort: 'Short-term active',
      layerArchive: 'Archive',
      layerLong: 'Long-term',
      layerCore: 'Floating core',
      layerHits: 'Hits today',
      activeLimit: 'limit {max}',
      coreLimit: 'limit {max}',
      bytesSuffix: 'B',
      never: 'Never run',
      dreamLastRun: 'Last Dreaming',
      startsAt: 'started {time}',
      coreTitle: 'Floating core memory',
      coreHint: 'The current focus items Dreaming synthesizes from short-term memory, at most {max}. Items duplicating long-term memory are not injected; pinned items are never auto-edited or auto-deleted. It is a synthesis view, not a merge of short-term bodies.',
      coreEmpty: '(No floating core yet; Dreaming will synthesize it once there are new short-term memories)',
      coreAddBtn: 'New core item',
      coreNewTitle: 'New core item',
      coreEditTitle: 'Edit core item',
      coreSave: 'Save',
      corePin: 'Pin',
      coreUnpin: 'Unpin',
      corePinned: 'Pinned',
      coreHistoryBtn: 'History',
      coreDelete: 'Delete',
      coreConfirmDelete: 'Confirm delete',
      coreSources: 'Sources',
      coreSourcesLabel: 'Source short-term IDs (comma separated, at least 2)',
      coreTitleLabel: 'Title (≤30 chars)',
      coreBodyLabel: 'Body (≤400 chars)',
      coreHistoryEmpty: '(No change history)',
      coreRestoreBtn: 'Revert',
      coreSaved: 'Floating core updated',
      coreDeleted: 'Core item {id} deleted',
      coreHistoryTitle: 'Change history',
      coreBudget: '{bytes} B / {max} B',
      corePinnedNote: 'Pinned items are off-limits to automation',
      coreSourceCount: '{count} sources',
      sortLabel: 'Sort',
      sortActivity: 'By activity',
      sortTime: 'By time',
      activityLabel: 'activity {score} · {hits} hits · {ago}',
      today: 'today',
      yesterday: 'yesterday',
      daysAgo: '{days} days ago',
      archiveTitle: 'Archive',
      archiveHint: 'Archive is excluded from daily injection, default search and routine curation. It is only searched when you explicitly ask to recall the past. Recalling is not restoring.',
      archiveSearchPlaceholder: 'Search archive (keywords, topics, people)',
      archiveSearchBtn: 'Search',
      archiveClear: 'Clear',
      archiveSearchEmpty: '(No matching archived memories)',
      archiveEmpty: '(Archive is empty)',
      archiveRestoreBtn: 'Restore',
      archiveDemoteBtn: 'Move to archive',
      archiveRestored: 'Restored {id}',
      archiveDemoted: 'Archived {id}',
      archiveTotal: '{count} items · {bytes} B',
      archiveNoHost: 'Archive details need the host API; only file-level data is readable.',
      dreamTitle: 'Dreaming',
      dreamHint: 'Lower-frequency than the curator: consolidates repeated/related/high-frequency short-term memories, maintains the floating core and refines long-term understanding. Runs on schedule or on demand.',
      dreamRun: 'Run now',
      dreamForce: 'Ignore interval and thresholds',
      dreamDue: 'due',
      dreamIdle: 'not due',
      dreamRuns: 'Run history',
      dreamNoRuns: '(No runs yet)',
      dreamOps: '+{add} / ~{update} / -{remove}',
      dreamRevert: 'Revert',
      dreamConfirmRevert: 'Confirm revert',
      dreamRunOk: 'Dreaming finished: {status}',
      dreamRunSkipped: 'Dreaming skipped: {reason}',
      dreamRevertOk: 'Reverted {runId}',
      dreamStatusLine: 'status: {status} · core items {core}',
      dreamReasonLabel: 'Reason',
      dreamDuration: 'Duration',
      dreamErrors: 'Errors',
      dreamingEnabled: 'Enable Dreaming',
      dreamingEnabledHint: 'When off, no automatic consolidation and no floating-core maintenance (manual runs still work).',
      dreamingIntervalHours: 'Dreaming interval (hours)',
      dreamingIntervalHoursHint: 'Minimum gap for a deep pass when nothing new arrived.',
      dreamingMinNewMemories: 'New-memory trigger',
      dreamingMinNewMemoriesHint: 'Trigger a pass when this many short-term memories are new or changed.',
      dreamingHeatThreshold: 'Heat-change trigger',
      dreamingHeatThresholdHint: 'Run Dreaming when this many memories change their effective-hit count or last-hit time, not only when bodies change.',
      dreamingRunsPerDay: 'Max runs per day',
      dreamingRunsPerDayHint: 'Keeps Dreaming from spending too much model budget.',
      coreMaxItems: 'Core item limit',
      coreMaxItemsHint: 'How many floating-core items to keep (1–10).',
      coreMaxBytes: 'Core injection budget (B)',
      coreMaxBytesHint: 'Maximum bytes the floating core may take in a snapshot; 0 = unlimited.',
      coreItemMaxBytes: 'Per-item limit (B)',
      coreItemMaxBytesHint: 'Maximum bytes for one floating-core body.',
      usageHalfLifeDays: 'Activity half-life (days)',
      usageHalfLifeDaysHint: 'How fast the weight of the last effective reference decays.',
      hitStatsMode: 'Hit statistics usage',
      hitStatsModeHint: 'Observe only counts and displays hits; switch to enforce once paraphrase under-counting and ID mis-counting are validated.',
      hitModeObserve: 'Observe (no archiving)',
      hitModeEnforce: 'Drive archiving',
      hitObserveNote: 'Hit statistics: observing — counted and displayed only, never used for automatic archiving.',
      hitReasons: 'Hit sources: assistant {assistant} · user re-mention {user} · both {both}',
      archiveOverflowNote: '(capacity: {count} least-active memories moved to archive)',
      hitEnforceNote: 'Hit statistics: enforcing — activity and eviction order include hit counts.',
      usageDailyHitCap: 'Daily hit cap per memory',
      usageDailyHitCapHint: 'How many effective hits one memory may count per day, to avoid self-reinforcement.',
      activityGraceHours: 'Activity grace window (hours)',
      activityGraceHoursHint: 'Memories referenced/updated inside this window are not archived by capacity pressure (except under severe overflow).',
      archiveRecallLimit: 'Recall result limit',
      archiveRecallLimitHint: 'Default number of archived memories memory_recall returns.',
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
      // v2.0
      coreMaxItems: 10,
      coreMaxBytes: 1600,
      coreItemMaxBytes: 600,
      usageHalfLifeDays: 30,
      usageDailyHitCap: 5,
      hitStatsMode: 'observe',
      activityGraceHours: 24,
      dreamingEnabled: true,
      dreamingIntervalHours: 24,
      dreamingMinNewMemories: 6,
      dreamingHeatThreshold: 3,
      dreamingRunsPerDay: 2,
      archiveRecallLimit: 20,
    };

    const FIELD_DEFS = [
      { key: 'injectIndex', kind: 'boolean', label: 'indexInject', hint: 'indexInjectHint' },
      { key: 'autoSummary', kind: 'boolean', label: 'autoSummary', hint: 'autoSummaryHint' },
      { key: 'scopeMaxBytes', kind: 'number', min: 0, label: 'scopeMaxBytes', hint: 'scopeMaxBytesHint' },
      { key: 'maxBytes', kind: 'number', min: 3000, label: 'maxBytes', hint: 'maxBytesHint' },
      { key: 'maxActiveMemories', kind: 'number', min: 1, label: 'maxActiveMemories', hint: 'maxActiveMemoriesHint' },
      { key: 'keepSummaryVersions', kind: 'number', min: 1, label: 'keepSummaryVersions', hint: 'keepSummaryVersionsHint' },
      { key: 'indexMaxBytes', kind: 'number', min: 0, label: 'indexMaxBytes', hint: 'indexMaxBytesHint' },
      { key: 'indexMaxTokens', kind: 'number', min: 0, label: 'indexMaxTokens', hint: 'indexMaxTokensHint' },
      { key: 'coreMaxItems', kind: 'number', min: 1, label: 'coreMaxItems', hint: 'coreMaxItemsHint' },
      { key: 'coreMaxBytes', kind: 'number', min: 0, label: 'coreMaxBytes', hint: 'coreMaxBytesHint' },
      { key: 'coreItemMaxBytes', kind: 'number', min: 120, label: 'coreItemMaxBytes', hint: 'coreItemMaxBytesHint' },
      { key: 'usageHalfLifeDays', kind: 'number', min: 1, label: 'usageHalfLifeDays', hint: 'usageHalfLifeDaysHint' },
      { key: 'hitStatsMode', kind: 'select', options: [{ value: 'observe', label: 'hitModeObserve' }, { value: 'enforce', label: 'hitModeEnforce' }], label: 'hitStatsMode', hint: 'hitStatsModeHint' },
      { key: 'usageDailyHitCap', kind: 'number', min: 1, label: 'usageDailyHitCap', hint: 'usageDailyHitCapHint' },
      { key: 'activityGraceHours', kind: 'number', min: 0, label: 'activityGraceHours', hint: 'activityGraceHoursHint' },
      { key: 'archiveRecallLimit', kind: 'number', min: 1, label: 'archiveRecallLimit', hint: 'archiveRecallLimitHint' },
      { key: 'dreamingEnabled', kind: 'boolean', label: 'dreamingEnabled', hint: 'dreamingEnabledHint' },
      { key: 'dreamingIntervalHours', kind: 'number', min: 1, label: 'dreamingIntervalHours', hint: 'dreamingIntervalHoursHint' },
      { key: 'dreamingMinNewMemories', kind: 'number', min: 1, label: 'dreamingMinNewMemories', hint: 'dreamingMinNewMemoriesHint' },
      { key: 'dreamingHeatThreshold', kind: 'number', min: 1, label: 'dreamingHeatThreshold', hint: 'dreamingHeatThresholdHint' },
      { key: 'dreamingRunsPerDay', kind: 'number', min: 1, label: 'dreamingRunsPerDay', hint: 'dreamingRunsPerDayHint' },
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
      // v2.0
      const [sortMode, setSortMode] = useState('activity');
      const [coreEditing, setCoreEditing] = useState(null);
      const [coreHistoryFor, setCoreHistoryFor] = useState(null);
      const [archiveQuery, setArchiveQuery] = useState('');
      const [archiveData, setArchiveData] = useState(null);
      const [dreamForce, setDreamForce] = useState(false);
      // 所有 hook 必须在任何条件 return 之前调用：冷库自动刷新用 ref，避免在
      // workspaceOnly 的提前返回之后注册 hook。
      const archiveReloadRef = useRef(() => {});
      useEffect(() => {
        if (status.status !== 'ready' || !status.data) return;
        if (status.data.workspaceAllowed === false) return;
        if (status.data.hostAuth === 'unavailable') return;
        archiveReloadRef.current();
      }, [status.status, status.data?.archive?.total]);

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
        if (totalBytes > 0 && Number.isFinite(scopeBytes) && Number.isFinite(totalBytes) && totalBytes < scopeBytes + 2000) {
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

      /* ---------- v2.0 共用小工具 ---------- */
      const agoLabel = (iso) => {
        const ms = Date.parse(String(iso ?? ''));
        if (!Number.isFinite(ms)) return t('never');
        const days = (Date.now() - ms) / 86_400_000;
        if (days < 1) return t('today');
        if (days < 2) return t('yesterday');
        return format(t('daysAgo'), { days: Math.floor(days) });
      };
      const coreStats = data?.core ?? null;
      const coreItems = coreStats?.items ?? [];
      const usageStats = data?.usage ?? null;
      const limits = data?.limits ?? { maxActiveMemories: 200, coreMaxItems: 10, coreMaxBytes: 1600, archiveRecallLimit: 20 };
      const dreaming = data?.dreaming ?? null;
      const archiveSummary = data?.archive ?? { total: 0, active: 0, deleted: 0, bytes: 0 };
      const sortedActive = sortMode === 'time'
        ? [...activeEntries].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
        : activeEntries;

      const section = (key, title, hint, children, extra) => h('section', {
        key,
        style: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 },
      }, [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 } }, [
          h('div', { key: 'copy' }, [
            h('h3', { key: 'title', style: { margin: 0, fontSize: 15, fontWeight: 600 } }, title),
            hint ? h('div', { key: 'hint', style: { color: COLORS.muted, fontSize: 12, lineHeight: 1.5, marginTop: 3 } }, hint) : null,
          ]),
          extra ? h('div', { key: 'extra', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } }, extra) : null,
        ]),
        ...(Array.isArray(children) ? children : [children]),
      ]);

      /** 读取冷库列表（全部来自后端真实状态）。 */
      const loadArchive = async (query = '') => {
        if (typeof memoryAction !== 'function' || !hostWritable) return null;
        try {
          const result = await memoryAction('archive', { action: 'list', query, limit: 50 });
          setArchiveData(result);
          return result;
        } catch (error) {
          setActionMsg({ text: format(t('actionFailed'), { error: String(error?.message ?? error) }), ok: false });
          return null;
        }
      };

      // 用普通赋值而不是 hook：这里在 workspaceOnly 提前返回之后，不能再注册 hook。
      archiveReloadRef.current = () => { void loadArchive(''); };

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
          setActionMsg({ text: format(t('actionFailed'), { error: t('filesUnavailable') }), ok: false });
          return;
        }
        setActionBusy(true);
        setActionMsg(null);
        try {
          const result = await memoryAction(kind, payload);
          if (kind === 'dream' && result?.skipped) {
            setActionMsg({ text: format(t('dreamRunSkipped'), { reason: result.reason ?? '—' }), ok: false });
            setConfirm(null);
            await refreshStatus();
            return;
          }
          if (result?.changed === false && kind !== 'history' && kind !== 'archive' && kind !== 'dream') {
            setActionMsg({ text: t('noChange'), ok: true });
            setConfirm(null);
            await refreshStatus();
            if (kind === 'core') await loadArchive('');
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
                    : kind === 'core'
                      ? (payload.action === 'delete'
                        ? format(t('coreDeleted'), { id: payload.id ?? '' })
                        : payload.action === 'restore'
                          ? t('coreSaved')
                          : payload.action === 'update' && payload.pinned !== undefined
                            ? (payload.pinned ? t('corePin') : t('coreUnpin'))
                            : t('coreSaved'))
                      : kind === 'dream'
                        ? (payload.action === 'revert'
                          ? format(t('dreamRevertOk'), { runId: payload.runId })
                          : format(t('dreamRunOk'), { status: result?.run?.status ?? '—' }))
                        : kind === 'archive'
                          ? (payload.action === 'restore'
                            ? format(t('archiveRestored'), { id: payload.id })
                            : payload.action === 'demote'
                              ? format(t('archiveDemoted'), { id: payload.id })
                              : t('noChange'))
                          : format(t('rollbackOk'), { version: result?.version ?? payload.version });
          let finalText = text;
          if ((kind === 'archive' || kind === 'restore') && (result?.overflowArchived ?? 0) > 0) {
            finalText += 
              format(t('archiveOverflowNote'), { count: result.overflowArchived });
          }
          setActionMsg({ text: finalText, ok: true });
          setConfirm(null);
          await refreshStatus();
          if (kind === 'archive' || kind === 'forget' || kind === 'restore' || kind === 'core') {
            await loadArchive(kind === 'archive' && payload.action === 'list' ? (payload.query ?? '') : '');
          }
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
            kind === 'active' ? actionButton(t('archiveDemoteBtn'), () => { void runAction('archive', { action: 'demote', id: entry.id }); }, 'normal') : null,
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
            kind === 'active' && entry.activity
              ? h('div', { key: 'activity', style: { color: COLORS.faint, fontSize: 11, marginTop: 2 } },
                format(t('activityLabel'), {
                  score: Math.round(entry.activity.score),
                  hits: entry.activity.hits,
                  ago: agoLabel(entry.activity.lastActiveAt),
                }))
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
          h('div', { key: 'label-row', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 } }, [
            h('div', { key: 'label', style: { color: COLORS.muted, fontSize: 12 } }, `${t('activeList')}（${activeEntries.length}）`),
            h('div', { key: 'sort', style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
              h('span', { key: 'text', style: { color: COLORS.faint, fontSize: 11 } }, t('sortLabel')),
              actionButton(t('sortActivity'), () => setSortMode('activity'), sortMode === 'activity' ? 'normal' : 'normal', false),
              actionButton(t('sortTime'), () => setSortMode('time'), 'normal', false),
            ]),
          ]),
          sortedActive.length === 0 ? emptyLine(t('noEntries')) : h('div', null, sortedActive.map((entry) => entryRow(entry, 'active'))),
          h('div', { key: 'hit-mode', style: { color: COLORS.faint, fontSize: 11, marginTop: 6, lineHeight: 1.5 } },
            data?.activity?.mode === 'enforce' ? t('hitEnforceNote') : t('hitObserveNote')),
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

      /* ---------- v2.0：记忆总览 ---------- */
      const overviewSection = !data ? null : section('overview', t('overviewTitle'), t('overviewHint'), [
        h('div', { key: 'grid', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 } }, [
          h(Metric, { key: 'short', label: t('layerShort'), value: activeEntries.length, suffix: `/ ${limits.maxActiveMemories}` }),
          h(Metric, { key: 'archive', label: t('layerArchive'), value: archiveSummary.total, suffix: `· ${archiveSummary.bytes ?? 0} B` }),
          h(Metric, { key: 'long', label: t('layerLong'), value: data.summaryBytes ?? 0, suffix: 'B' }),
          h(Metric, { key: 'core', label: t('layerCore'), value: coreItems.length, suffix: `/ ${limits.coreMaxItems}` }),
          h(Metric, { key: 'hits', label: t('layerHits'), value: usageStats?.todayHits ?? 0, suffix: `· ${usageStats?.totalHits ?? 0}` }),
          h(Metric, {
            key: 'dream',
            label: t('dreamLastRun'),
            value: dreaming?.lastRun?.finishedAt ? displayTime(dreaming.lastRun.finishedAt).slice(11) : t('never'),
          }),
        ]),
        h('div', { key: 'dream-line', style: { color: COLORS.muted, fontSize: 12, marginTop: 10, lineHeight: 1.6 } },
          format(t('dreamStatusLine'), {
            status: dreaming?.due?.due ? t('dreamDue') : t('dreamIdle'),
            core: coreItems.length,
          })),
        h('div', { key: 'hit-reasons', style: { color: COLORS.faint, fontSize: 11, marginTop: 2, lineHeight: 1.5 } },
          format(t('hitReasons'), {
            assistant: usageStats?.reasons?.assistant ?? 0,
            user: usageStats?.reasons?.user ?? 0,
            both: usageStats?.reasons?.both ?? 0,
          })),
      ]);

      /* ---------- v2.0：浮动核心记忆 ---------- */
      const coreEditorForm = () => {
        if (!coreEditing) return null;
        return h('div', { key: 'core-editor', style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0 4px' } }, [
          h('div', { key: 'head', style: { color: COLORS.muted, fontSize: 12 } },
            coreEditing.isNew ? t('coreNewTitle') : t('coreEditTitle')),
          h('input', {
            key: 'title',
            value: coreEditing.title,
            placeholder: t('coreTitleLabel'),
            style: fieldStyle,
            onChange: (event) => setCoreEditing((prev) => ({ ...prev, title: event.target.value })),
          }),
          h('textarea', {
            key: 'body',
            value: coreEditing.body,
            rows: 4,
            placeholder: t('coreBodyLabel'),
            style: { ...fieldStyle, resize: 'vertical' },
            onChange: (event) => setCoreEditing((prev) => ({ ...prev, body: event.target.value })),
          }),
          h('input', {
            key: 'sources',
            value: coreEditing.sources,
            placeholder: t('coreSourcesLabel'),
            style: fieldStyle,
            onChange: (event) => setCoreEditing((prev) => ({ ...prev, sources: event.target.value })),
          }),
          h('div', { key: 'actions', style: { display: 'flex', gap: 8 } }, [
            actionButton(t('coreSave'), () => {
              const payload = coreEditing.isNew
                ? { action: 'add', title: coreEditing.title, body: coreEditing.body, sources: coreEditing.sources }
                : { action: 'update', id: coreEditing.id, title: coreEditing.title, body: coreEditing.body, sources: coreEditing.sources };
              setCoreEditing(null);
              void runAction('core', payload);
            }, 'normal'),
            actionButton(t('cancelBtn'), () => setCoreEditing(null), 'normal'),
          ]),
        ]);
      };

      const coreHistoryList = (item) => {
        const records = coreHistoryFor?.items ?? [];
        return h('div', { key: `core-history-${item.id}`, style: { padding: '8px 0 4px' } }, [
          h('div', { key: 'title', style: { color: COLORS.muted, fontSize: 12, marginBottom: 4 } }, `${t('coreHistoryTitle')}（${records.length}）`),
          records.length === 0
            ? h('div', { key: 'empty', style: { color: COLORS.faint, fontSize: 12 } }, t('coreHistoryEmpty'))
            : h('div', { key: 'list', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, records.map((record) => h('div', {
              key: record.seq,
              style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
            }, [
              h('div', { key: 'text', style: { color: COLORS.muted, fontSize: 11, lineHeight: 1.5 } },
                `${record.seq}. ${displayTime(record.ts)} · ${record.op} · ${record.reason || '—'}`),
              record.previous
                ? actionButton(t('coreRestoreBtn'), () => {
                  setCoreHistoryFor(null);
                  void runAction('core', { action: 'restore', id: item.id, seq: record.seq });
                }, 'normal')
                : null,
            ]))),
        ]);
      };

      const coreRow = (item) => {
        const isEditing = coreEditing?.id === item.id;
        const isHistory = coreHistoryFor?.id === item.id;
        const isConfirming = confirm?.kind === 'core' && confirm.id === item.id;
        const row = h('div', {
          key: `core-${item.id}`,
          style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: `1px solid ${COLORS.border}` },
        }, [
          h('div', { key: 'top', style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 } }, [
            h('div', { key: 'copy', style: { minWidth: 0 } }, [
              h('div', { key: 'title', style: { color: COLORS.text, fontSize: 13, fontWeight: 600 } },
                `${item.title || t('coreNewTitle')}${item.pinned ? ` · ${t('corePinned')}` : ''}`),
              h('div', { key: 'body', style: { color: COLORS.muted, fontSize: 12, lineHeight: 1.6, marginTop: 3, whiteSpace: 'pre-wrap' } }, item.body),
              h('div', { key: 'meta', style: { color: COLORS.faint, fontSize: 11, marginTop: 3 } },
                `${t('coreSources')}: ${(item.sources ?? []).join(', ') || '—'} · ${format(t('coreSourceCount'), { count: (item.sources ?? []).length })}${item.updatedAt ? ` · ${displayTime(item.updatedAt)}` : ''}`),
            ]),
            h('div', { key: 'actions', style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' } }, [
              actionButton(t('editBtn'), () => {
                setCoreHistoryFor(null);
                setCoreEditing({ id: item.id, title: item.title, body: item.body, sources: (item.sources ?? []).join(', '), isNew: false });
              }, 'normal'),
              actionButton(item.pinned ? t('coreUnpin') : t('corePin'), () => {
                void runAction('core', { action: 'update', id: item.id, pinned: !item.pinned });
              }, 'normal'),
              actionButton(t('coreHistoryBtn'), () => {
                setCoreEditing(null);
                void (async () => {
                  if (typeof memoryAction !== 'function') return;
                  try {
                    const result = await memoryAction('core', { action: 'history', id: item.id });
                    setCoreHistoryFor({ id: item.id, items: (result?.history ?? []).slice().reverse() });
                  } catch (error) {
                    setActionMsg({ text: format(t('actionFailed'), { error: String(error?.message ?? error) }), ok: false });
                  }
                })();
              }, 'normal'),
              isConfirming
                ? actionButton(t('coreConfirmDelete'), () => {
                  void runAction('core', { action: 'delete', id: item.id });
                }, 'danger')
                : actionButton(t('coreDelete'), () => setConfirm({ kind: 'core', id: item.id }), 'danger'),
              isConfirming ? actionButton(t('cancelBtn'), () => setConfirm(null), 'normal') : null,
            ].filter(Boolean)),
          ]),
        ]);
        const extras = [];
        if (isEditing) extras.push(coreEditorForm());
        if (isHistory) extras.push(coreHistoryList(item));
        if (extras.length === 0) return row;
        return h('div', { key: `core-wrap-${item.id}` }, [row, ...extras]);
      };

      const coreSection = !data ? null : section('core', t('coreTitle'), format(t('coreHint'), { max: limits.coreMaxItems }), [
        h('div', { key: 'meta', style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 } }, [
          h('span', { key: 'count', style: { color: COLORS.muted, fontSize: 12 } },
            `${coreItems.length} / ${limits.coreMaxItems}`),
          h('span', { key: 'budget', style: { color: COLORS.faint, fontSize: 11 } },
            format(t('coreBudget'), { bytes: coreStats?.bytes ?? 0, max: limits.coreMaxBytes > 0 ? limits.coreMaxBytes : t('unlimited') })),
          coreStats?.pinned ? h('span', { key: 'pinned', style: { color: COLORS.faint, fontSize: 11 } }, `${t('corePinned')} ${coreStats.pinned}`) : null,
          h('span', { key: 'note', style: { color: COLORS.faint, fontSize: 11 } }, t('corePinnedNote')),
        ]),
        coreItems.length === 0 ? emptyLine(t('coreEmpty')) : h('div', null, coreItems.map(coreRow)),
        coreEditing?.isNew ? coreEditorForm() : null,
      ], [
        actionButton(t('coreAddBtn'), () => {
          setCoreHistoryFor(null);
          setCoreEditing({ id: '', title: '', body: '', sources: '', isNew: true });
        }, 'normal'),
      ]);

      /* ---------- v2.0：冷库 Archive ---------- */
      const archiveItems = archiveData?.items ?? [];
      const archiveSection = !data ? null : section('archive', t('archiveTitle'), t('archiveHint'), [
        h('div', { key: 'search', style: { display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' } }, [
          h('input', {
            key: 'input',
            value: archiveQuery,
            placeholder: t('archiveSearchPlaceholder'),
            style: { ...fieldStyle, flex: '1 1 220px', minWidth: 160 },
            onChange: (event) => setArchiveQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void loadArchive(archiveQuery);
            },
          }),
          h('button', {
            key: 'go',
            type: 'button',
            disabled: actionBusy || !hostWritable,
            onClick: () => void loadArchive(archiveQuery),
            style: { background: COLORS.accent, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer' },
          }, t('archiveSearchBtn')),
          actionButton(t('archiveClear'), () => { setArchiveQuery(''); void loadArchive(''); }, 'normal'),
        ]),
        h('div', { key: 'total', style: { color: COLORS.muted, fontSize: 12, marginBottom: 6 } },
          format(t('archiveTotal'), { count: archiveData?.total ?? archiveSummary.total ?? 0, bytes: archiveSummary.bytes ?? 0 })),
        hostWritable ? null : h('div', { key: 'nohost', style: { color: COLORS.faint, fontSize: 11, marginBottom: 6 } }, t('archiveNoHost')),
        archiveItems.length === 0
          ? emptyLine(archiveQuery ? t('archiveSearchEmpty') : t('archiveEmpty'))
          : h('div', null, archiveItems.map((entry) => h('div', {
            key: `archive-${entry.id}`,
            style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: `1px solid ${COLORS.border}` },
          }, [
            h('div', { key: 'body', style: { minWidth: 0 } }, [
              h('div', { key: 'id', style: { color: COLORS.text, fontSize: 12, fontFamily: 'var(--dsw-alias-font-mono, ui-monospace, monospace)' } },
                `${entry.id} · ${displayTime(entry.createdAt)}`),
              h('div', { key: 'summary', style: { color: COLORS.muted, fontSize: 12, lineHeight: 1.5, marginTop: 2 } }, entry.summary || '—'),
              h('div', { key: 'archived', style: { color: COLORS.faint, fontSize: 11, marginTop: 2 } },
                `${entry.archivedAt ? `${entry.archivedAt}${entry.archiveReason ? ` · ${entry.archiveReason}` : ''}` : ''}`),
            ]),
            h('div', { key: 'actions' }, [
              actionButton(t('archiveRestoreBtn'), () => { void runAction('archive', { action: 'restore', id: entry.id }); }, 'normal'),
            ]),
          ]))),
      ]);

      /* ---------- v2.0：Dreaming ---------- */
      const dreamRuns = dreaming?.runs ?? [];
      const dreamingSection = !data ? null : section('dream', t('dreamTitle'), t('dreamHint'), [
        h('div', { key: 'status', style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 } }, [
          h('span', { key: 'due', style: { color: dreaming?.due?.due ? COLORS.success : COLORS.muted, fontSize: 12 } },
            dreaming?.due?.due ? t('dreamDue') : t('dreamIdle')),
          h('span', { key: 'reason', style: { color: COLORS.faint, fontSize: 11 } }, dreaming?.due?.reason ?? ''),
          h('span', { key: 'runs', style: { color: COLORS.faint, fontSize: 11 } },
            `${t('dreamLastRun')}: ${dreaming?.lastRun?.finishedAt ? displayTime(dreaming.lastRun.finishedAt) : t('never')}`),
        ]),
        h('div', { key: 'actions', style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 } }, [
          h('label', { key: 'force', style: { display: 'flex', gap: 6, alignItems: 'center', color: COLORS.muted, fontSize: 12 } }, [
            h('input', {
              key: 'box',
              type: 'checkbox',
              checked: dreamForce,
              onChange: (event) => setDreamForce(event.target.checked),
            }),
            t('dreamForce'),
          ]),
          actionButton(t('dreamRun'), () => { void runAction('dream', { action: 'run', force: dreamForce }); }, 'normal'),
        ]),
        h('div', { key: 'runs-title', style: { color: COLORS.muted, fontSize: 12, margin: '6px 0 4px' } }, t('dreamRuns')),
        dreamRuns.length === 0
          ? emptyLine(t('dreamNoRuns'))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } }, dreamRuns.map((run) => {
            const isConfirming = confirm?.kind === 'dream' && confirm.id === run.runId;
            return h('div', {
              key: run.runId,
              style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: `1px solid ${COLORS.border}` },
            }, [
              h('div', { key: 'text', style: { minWidth: 0 } }, [
                h('div', { key: 'head', style: { color: COLORS.text, fontSize: 12 } },
                  `${displayTime(run.finishedAt || run.startedAt)} · ${run.status} · ${format(t('dreamOps'), { add: run.add ?? 0, update: run.update ?? 0, remove: run.remove ?? 0 })} · ${t('dreamReasonLabel')} ${run.reason || '—'}`),
                run.errors?.length
                  ? h('div', { key: 'err', style: { color: COLORS.danger, fontSize: 11, marginTop: 2 } }, `${t('dreamErrors')}: ${run.errors.join('; ')}`)
                  : null,
              ]),
              run.snapshotDir
                ? (isConfirming
                  ? h('div', { key: 'confirm', style: { display: 'flex', gap: 6 } }, [
                    actionButton(t('dreamConfirmRevert'), () => { void runAction('dream', { action: 'revert', runId: run.runId }); }, 'danger'),
                    actionButton(t('cancelBtn'), () => setConfirm(null), 'normal'),
                  ])
                  : actionButton(t('dreamRevert'), () => setConfirm({ kind: 'dream', id: run.runId }), 'normal'))
                : null,
            ]);
          })),
        actionMsg ? h('div', { key: 'msg', style: { color: actionMsg.ok ? COLORS.success : COLORS.danger, fontSize: 12, marginTop: 8 } }, actionMsg.text) : null,
      ]);

      const configContent = (() => {
        if (snapshot.status === 'loading') return h('div', { style: { color: COLORS.muted, fontSize: 13 } }, t('loading'));
        if (snapshot.status === 'unavailable') return h('div', { style: { color: COLORS.muted, fontSize: 13 } }, t('unavailable'));

        const controls = FIELD_DEFS.map((field) => {
          let control;
          if (field.kind === 'boolean') {
            control = h(Toggle, {
              checked: Boolean(readValue(field.key)),
              disabled: !snapshot.writable || busy,
              label: t(field.label),
              onChange: (checked) => setDraft((previous) => ({ ...previous, [field.key]: checked })),
            });
          } else if (field.kind === 'select') {
            const current = readValue(field.key) ?? field.options[0].value;
            control = h('select', {
              value: String(current),
              disabled: !snapshot.writable || busy,
              'aria-label': t(field.label),
              onChange: (event) => setDraft((previous) => ({ ...previous, [field.key]: event.target.value })),
              style: {
                width: 200,
                boxSizing: 'border-box',
                background: COLORS.surfaceAlt,
                border: `1px solid ${errors[field.key] ? COLORS.danger : COLORS.border}`,
                borderRadius: 8,
                color: COLORS.text,
                padding: '8px 10px',
                fontSize: 13,
              },
            }, field.options.map((option) => h('option', { key: option.value, value: option.value }, t(option.label))));
          } else {
            control = h('input', {
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
          }
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

        overviewSection,

        coreSection,

        longTermContent,

        data ? h('section', { key: 'entries', style: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 } }, [
          h('h3', { key: 'title', style: { margin: '0 0 2px', fontSize: 15, fontWeight: 600 } }, t('entriesTitle')),
          h('div', { key: 'hint', style: { color: COLORS.muted, fontSize: 12, marginBottom: 6, lineHeight: 1.5 } }, t('softDeleteHint')),
          entriesContent,
        ]) : null,

        archiveSection,

        dreamingSection,

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

      // 未拿到 Host 下发的 privateWorkspace 时保持空值：页面退回只读，不猜测工作区。
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
      // 工作区判断在拿到 Host 返回的 privateWorkspace 后做，不在代码里写死任何路径。
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
            // v2.0：浮动核心 / 命中 / 冷库 / Dreaming / 上限，全部来自 Host 真实状态
            core: host.core ?? null,
            usage: host.usage ?? null,
            activity: host.activity ?? null,
            archive: host.archive ?? null,
            dreaming: host.dreaming ?? null,
            limits: host.limits ?? null,
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
          for (const base of [MEMORY_ABS_DIR, MEMORY_DIR]) {
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
          for (const base of [MEMORY_ABS_DIR, MEMORY_DIR]) {
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
            // 文件回退模式下拿不到命中/核心/Dreaming 的真实状态：显式留空，避免伪造数据。
            core: null,
            usage: null,
            activity: null,
            archive: { total: parseEntries(archiveRaw).length, bytes: archiveRaw.length },
            dreaming: null,
            limits: null,
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
          core: null,
          usage: null,
          activity: null,
          archive: null,
          dreaming: null,
          limits: null,
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
