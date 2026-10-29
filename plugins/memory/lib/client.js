// dsh-memory-scoped Web client bundle: the independent "私人工作区记忆" settings page.
//
// The bundle identity MUST equal the npm package name (`dsh-memory-scoped`):
// client-modules keys the boot graph by the resolved package name, so the
// upstream id (`@dsh-external/dsh-memory`) would never materialize on this fork.
//
// The page never touches Markdown. Every read/write goes to the host route
// `/_dsh/memory/console`, which is authenticated and bound to the private
// workspace scope.
window.__ModuleLoader__.load({
  id: 'dsh-memory-scoped',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    var NS = 'dsh-memory-scoped'
    var API = '/_dsh/memory/console'

    var en = {
      lang: 'en',
      nav: 'Workspace memory',
      title: 'Workspace memory',
      subtitle: 'Manage only the private workspace memory library.',
      tabs: { memory: 'Long-term memory', curator: 'Curation log', settings: 'Parameters' },
      refresh: 'Refresh',
      loading: 'Loading…',
      loadFailed: 'Could not load memory',
      retry: 'Retry',
      summary: 'Injected summary',
      summaryMeta: 'v{version} · {bytes} bytes · {time}',
      expand: 'Expand',
      collapse: 'Collapse',
      history: 'Versions',
      add: 'Add memory',
      search: 'Search content, tags or id',
      allTags: 'All tags',
      sortRecent: 'Newest first',
      sortOldest: 'Oldest first',
      sortImportant: 'Importance',
      showArchived: 'Include archived',
      showDeleted: 'Show deleted',
      deletedTag: 'Deleted',
      deletedAt: 'Deleted at',
      entries: '{count} entries',
      noEntries: 'No matching memory entries.',
      selectEntry: 'Select a memory entry to inspect it.',
      unknownSource: 'Source unknown',
      source: 'Source',
      recordedBy: 'Recorded by',
      importance: 'Importance',
      createdAt: 'Created',
      updatedAt: 'Last updated',
      session: 'Source session',
      evidence: 'Evidence',
      archived: 'Archived',
      edit: 'Edit',
      delete: 'Delete',
      restore: 'Restore',
      detailHistory: 'Change history',
      noHistory: 'No recorded changes.',
      save: 'Save',
      cancel: 'Cancel',
      saving: 'Saving…',
      confirmDeleteTitle: 'Delete this memory?',
      confirmDeleteBody: 'This entry will be removed from raw memory and from the injected summary immediately. It can be restored from its change history.',
      confirmDelete: 'Delete',
      addTitle: 'Add a memory',
      editTitle: 'Edit memory',
      content: 'Content',
      tags: 'Tags (comma separated)',
      bytes: '{bytes} / 2000 bytes',
      duplicateWarning: 'An identical entry already exists. Save again to add it anyway.',
      addAnyway: 'Add anyway',
      summaryHistoryTitle: 'Summary versions',
      summaryHistoryEmpty: 'No retained summary versions.',
      restoreSummary: 'Restore this version',
      confirmRestoreSummary: 'Restore summary v{version}? The current summary is archived first.',
      curatorRunning: 'Curation in progress',
      curatorIdle: 'Idle',
      lastRun: 'Last run',
      lastStatus: 'Status',
      totalTurns: 'Effective turns (since this build)',
      totalTurnsNote: 'Upgrade-era turns were not recorded; this counter starts with this build.',
      pendingTurns: 'Pending turns',
      nextIn: 'Next run in',
      turnsUnit: '{count} turns',
      llmCalls: 'LLM calls',
      llmFailures: 'LLM failures',
      emptyRuns: 'Empty results',
      summaryVersion: 'Summary version',
      summaryUpdated: 'Summary updated',
      pendingSessions: 'Tracked sessions',
      noPending: 'No tracked sessions yet.',
      curatorRuns: 'Curation runs',
      runId: 'Run',
      trigger: 'Trigger',
      duration: 'Duration',
      ops: 'Added / updated / merged',
      dropped: 'Rejected',
      error: 'Error',
      noRuns: 'No curation runs recorded yet.',
      noRunsNote: 'The run log starts with this build; earlier aggregate counters remain in diagnostics.json.',
      curateNow: 'Curate now',
      confirmCurate: 'Run curation now? This calls the model once and may add memory entries.',
      curating: 'Curating…',
      paramsTitle: 'Curation and injection parameters',
      paramsHint: 'Values are saved through the DSH settings service and take effect immediately (no DSH restart). Changes are checked against the current revision so two windows cannot silently overwrite each other.',
      recommended: 'Recommended',
      defaultValue: 'Default',
      restoreDefaults: 'Restore recommended defaults',
      confirmRestore: 'Apply the recommended values below?',
      overridden: 'Overridden',
      live: 'Live',
      lockTitle: 'Protected settings (read-only here)',
      lockHint: 'These settings define the security boundary or the storage location. Edit them in the profile patch and reload the plugin.',
      saved: 'Saved.',
      noChanges: 'No changes to save.',
      recommendedApplied: 'Recommended defaults applied.',
      conflict: 'Another window changed this data. Refreshed with the latest values.',
      summaryRefreshed: 'Summary refreshed.',
      summaryRefreshFailed: 'Summary refresh failed; consolidation was still queued.',
      created: 'Memory added.',
      updated: 'Memory updated.',
      deleted: 'Memory deleted. It can be restored from history.',
      restored: 'Memory restored.',
      summaryRestored: 'Summary version restored.',
      sessionLive: 'loaded',
      sessionUnverified: 'not registered by this plugin',
      sourceTypes: {
        user_statement: 'User statement',
        session_task: 'Completed session task',
        file_fact: 'File/tool fact',
        assistant_claim: 'Assistant claim (unverified)',
        model_tool: 'Written by the model',
        manual: 'Manual action',
        import: 'Imported',
        unknown: 'Source unknown'
      },
      recordedBys: {
        curator: 'Curator',
        model_tool: 'Model tool',
        manual: 'Manual add',
        manual_edit: 'Manual edit',
        import: 'Import',
        unknown: 'Unknown'
      },
      statuses: { ok: 'Success', empty: 'Empty result', failed: 'Failed', skipped: 'Skipped' },
      triggers: { threshold: 'Turn threshold', orphan: 'Idle-session flush', manual: 'Manual' },
      legacyRun: 'legacy aggregate',
    }

    var zh = {
      lang: 'zh',
      nav: '私人工作区记忆',
      title: '私人工作区记忆',
      subtitle: '只管理私人工作区的独立记忆库。',
      tabs: { memory: '长期记忆', curator: '整理记录', settings: '参数设置' },
      refresh: '刷新',
      loading: '加载中…',
      loadFailed: '记忆读取失败',
      retry: '重试',
      summary: '当前注入摘要',
      summaryMeta: 'v{version} · {bytes} 字节 · {time}',
      expand: '展开',
      collapse: '收起',
      history: '历史版本',
      add: '新增记忆',
      search: '搜索正文、标签或 ID',
      allTags: '全部分类',
      sortRecent: '最近创建',
      sortOldest: '最早创建',
      sortImportant: '重要程度',
      showArchived: '显示已归档',
      showDeleted: '显示已删除',
      deletedTag: '已删除',
      deletedAt: '删除时间',
      entries: '共 {count} 条',
      noEntries: '没有匹配的记忆。',
      selectEntry: '选择一条记忆查看详情。',
      unknownSource: '来源未知',
      source: '来源',
      recordedBy: '记录方式',
      importance: '重要程度',
      createdAt: '创建时间',
      updatedAt: '最近修改',
      session: '来源会话',
      evidence: '来源证据',
      archived: '已归档',
      edit: '编辑',
      delete: '删除',
      restore: '恢复',
      detailHistory: '修改历史',
      noHistory: '没有记录到修改。',
      save: '保存',
      cancel: '取消',
      saving: '保存中…',
      confirmDeleteTitle: '确认删除这条记忆？',
      confirmDeleteBody: '删除后，该条目会立即从 raw memory 和注入摘要中移除；之后可以从修改历史中恢复。',
      confirmDelete: '确认删除',
      addTitle: '新增一条记忆',
      editTitle: '编辑记忆',
      content: '正文',
      tags: '标签（逗号分隔）',
      bytes: '{bytes} / 2000 字节',
      duplicateWarning: '已存在相同内容的记忆。再次保存将强制新增。',
      addAnyway: '仍然新增',
      summaryHistoryTitle: '摘要历史版本',
      summaryHistoryEmpty: '没有保留的摘要版本。',
      restoreSummary: '恢复此版本',
      confirmRestoreSummary: '恢复摘要 v{version}？当前摘要会先归档。',
      curatorRunning: '正在整理',
      curatorIdle: '空闲',
      lastRun: '最近一次整理',
      lastStatus: '状态',
      totalTurns: '累计有效回合（本版本起）',
      totalTurnsNote: '升级前的回合没有记录，本计数从当前版本开始。',
      pendingTurns: '待整理回合',
      nextIn: '距下次整理',
      turnsUnit: '{count} 回合',
      llmCalls: 'LLM 调用',
      llmFailures: '调用失败',
      emptyRuns: '空结果次数',
      summaryVersion: '摘要版本',
      summaryUpdated: '摘要更新时间',
      pendingSessions: '跟踪的会话',
      noPending: '还没有跟踪到会话。',
      curatorRuns: '整理任务',
      runId: '任务',
      trigger: '触发方式',
      duration: '耗时',
      ops: '新增 / 更新 / 合并',
      dropped: '来源不足被拒',
      error: '错误',
      noRuns: '还没有整理记录。',
      noRunsNote: '整理日志从当前版本开始记录；升级前的汇总统计仍保留在 diagnostics.json。',
      curateNow: '立即整理',
      confirmCurate: '现在整理一次？这会调用一次模型，可能会新增记忆。',
      curating: '整理中…',
      paramsTitle: '整理与注入参数',
      paramsHint: '通过 DSH 设置服务保存，保存后即时生效，无需重启 DSH。保存时校验当前修订号，避免两个窗口互相覆盖。',
      recommended: '推荐值',
      defaultValue: '默认',
      restoreDefaults: '恢复推荐默认值',
      confirmRestore: '应用以下推荐值？',
      overridden: '已覆盖',
      live: '即时生效',
      lockTitle: '受保护设置（此处只读）',
      lockHint: '这些设置决定安全边界或存储位置。请修改 profile patch 并重新加载插件。',
      saved: '已保存。',
      noChanges: '没有需要保存的修改。',
      recommendedApplied: '已应用推荐默认值。',
      conflict: '数据已被另一个窗口修改，已刷新为最新值。',
      summaryRefreshed: '摘要已刷新。',
      summaryRefreshFailed: '摘要本地刷新失败，已排队等待后台整合。',
      created: '记忆已新增。',
      updated: '记忆已更新。',
      deleted: '记忆已删除，可从历史中恢复。',
      restored: '记忆已恢复。',
      summaryRestored: '摘要版本已恢复。',
      sessionLive: '已加载',
      sessionUnverified: '未经本插件登记',
      sourceTypes: {
        user_statement: '用户明确陈述',
        session_task: '真实会话任务',
        file_fact: '文件/工具资料',
        assistant_claim: '助手说法（未核实）',
        model_tool: '会话内模型写入',
        manual: '手动操作',
        import: '导入',
        unknown: '来源未知'
      },
      recordedBys: {
        curator: '自动整理',
        model_tool: '模型工具',
        manual: '手动新增',
        manual_edit: '手动编辑',
        import: '导入',
        unknown: '未知'
      },
      statuses: { ok: '成功', empty: '空结果', failed: '失败', skipped: '已跳过' },
      triggers: { threshold: '回合阈值', orphan: '空闲会话兜底', manual: '手动' },
      legacyRun: '旧版汇总',
    }

    // ---------------------------------------------------------------------
    // Utilities
    // ---------------------------------------------------------------------

    function fmtTime(value) {
      if (!value) return '—'
      try {
        return new Date(value).toLocaleString()
      } catch {
        return String(value)
      }
    }

    function fmtStamp(value) {
      return typeof value === 'string' && value.length > 0 ? value : '—'
    }

    function fmtBytes(bytes) {
      var n = Number(bytes) || 0
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    function fmtDuration(run) {
      if (!run || !run.startedAt) return '—'
      var end = run.endedAt || Date.now()
      var ms = Math.max(0, end - run.startedAt)
      return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'
    }

    function fmt(template, values) {
      var text = String(template)
      for (var key in values) text = text.replace('{' + key + '}', String(values[key]))
      return text
    }

    function importanceDots(value) {
      var n = Math.min(3, Math.max(0, Number(value) || 0))
      var out = ''
      for (var i = 0; i < 3; i += 1) out += i < n ? '●' : '○'
      return out
    }

    /** Nested copy that is not addressed with dotted locale keys. */
    function dict(t) {
      return t('lang') === 'zh' ? zh : en
    }

    function sourceClass(type) {
      if (type === 'user_statement') return 'mf-badge mf-badge-user'
      if (type === 'session_task') return 'mf-badge mf-badge-task'
      if (type === 'file_fact') return 'mf-badge mf-badge-file'
      if (type === 'assistant_claim') return 'mf-badge mf-badge-claim'
      if (type === 'model_tool') return 'mf-badge mf-badge-model'
      if (type === 'manual') return 'mf-badge mf-badge-manual'
      return 'mf-badge mf-badge-unknown'
    }

    async function apiGet(path) {
      var response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      var body = await response.json().catch(function () { return undefined })
      if (!response.ok || body === undefined || body.ok !== true) {
        var message = body && body.error && body.error.message ? body.error.message : 'HTTP ' + response.status
        var error = new Error(message)
        error.code = body && body.error ? body.error.code : 'request-failed'
        error.status = response.status
        throw error
      }
      return body.value
    }

    async function apiPost(payload) {
      var response = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      })
      var body = await response.json().catch(function () { return undefined })
      if (!response.ok || body === undefined || body.ok !== true) {
        var message = body && body.error && body.error.message ? body.error.message : 'HTTP ' + response.status
        var error = new Error(message)
        error.code = body && body.error ? body.error.code : 'request-failed'
        error.status = response.status
        throw error
      }
      return body.value
    }

    // ---------------------------------------------------------------------
    // Shared UI pieces
    // ---------------------------------------------------------------------

    function SummaryText(props) {
      var text = String(props.text || '')
      if (text.trim().length === 0) return h('p', { className: 'mf-muted' }, props.emptyLabel || '—')
      return h('div', { className: 'mf-summary' }, text.split('\n').map(function (line, index) {
        if (/^# /.test(line)) return h('h3', { key: index }, line.slice(2))
        if (/^## /.test(line)) return h('h4', { key: index }, line.slice(3))
        if (/^- /.test(line)) return h('div', { key: index, className: 'mf-bullet' }, '• ' + line.slice(2))
        if (/^v\d+\s*$/.test(line)) return h('div', { key: index, className: 'mf-version' }, line.trim())
        if (line.trim().length === 0) return h('div', { key: index, className: 'mf-gap' })
        return h('p', { key: index }, line)
      }))
    }

    /** Skip the fixed preamble/version line when previewing the summary. */
    function summarySections(text) {
      var lines = String(text || '').split('\n')
      var start = lines.findIndex(function (line) { return /^## /.test(line) })
      return (start >= 0 ? lines.slice(start) : lines).join('\n')
    }

    function Modal(props) {
      return h('div', { className: 'mf-overlay', role: 'dialog', 'aria-modal': 'true', onMouseDown: function (event) { if (event.target === event.currentTarget) props.onClose() } },
        h('div', { className: 'mf-modal' + (props.wide ? ' mf-modal-wide' : '') },
          h('div', { className: 'mf-modal-head' },
            h('h3', null, props.title),
            h('button', { type: 'button', className: 'mf-icon-btn', onClick: props.onClose, 'aria-label': props.closeLabel || 'Close' }, '×')),
          h('div', { className: 'mf-modal-body' }, props.children)))
    }

    function Notice(props) {
      if (!props.notice) return null
      return h('div', { className: 'mf-notice ' + (props.notice.type === 'error' ? 'mf-notice-error' : 'mf-notice-ok'), role: 'status' },
        h('span', null, props.notice.text),
        h('button', { type: 'button', className: 'mf-icon-btn', onClick: props.onClose, 'aria-label': 'Close' }, '×'))
    }

    // ---------------------------------------------------------------------
    // Long-term memory
    // ---------------------------------------------------------------------

    function SummaryCard(props) {
      var t = props.t
      var [open, setOpen] = React.useState(false)
      var [history, setHistory] = React.useState(false)
      var s = props.summary
      return h('section', { className: 'mf-card mf-summary-card' },
        h('div', { className: 'mf-card-head' },
          h('div', null,
            h('h3', null, t('summary')),
            h('div', { className: 'mf-muted mf-small' }, fmt(t('summaryMeta'), { version: s.version, bytes: s.bytes, time: fmtTime(s.updatedAt) }))),
          h('div', { className: 'mf-row' },
            h('button', { type: 'button', className: 'mf-btn mf-btn-ghost', onClick: function () { setHistory(true) } }, t('history')),
            h('button', { type: 'button', className: 'mf-btn mf-btn-ghost', onClick: function () { setOpen(!open) } }, open ? t('collapse') : t('expand')))),
        open ? h(SummaryText, { text: s.text, emptyLabel: '—' }) : h('div', { className: 'mf-summary-preview' },
          h(SummaryText, { text: summarySections(s.text), emptyLabel: '—' })),
        history ? h(SummaryHistoryDialog, { t: t, versions: s.history, onClose: function () { setHistory(false) }, onRestore: props.onRestoreSummary }) : null)
    }

    function SummaryHistoryDialog(props) {
      var t = props.t
      var [pending, setPending] = React.useState(null)
      return h(Modal, { title: t('summaryHistoryTitle'), onClose: props.onClose, closeLabel: t('cancel'), wide: true },
        props.versions.length === 0 ? h('p', { className: 'mf-muted' }, t('summaryHistoryEmpty')) :
          h('div', { className: 'mf-history-list' }, props.versions.map(function (item) {
            return h('div', { key: item.file, className: 'mf-history-row' },
              h('div', null,
                h('strong', null, 'v' + item.version),
                h('span', { className: 'mf-muted mf-small' }, ' · ' + fmtTime(item.mtime) + ' · ' + fmtBytes(item.bytes))),
              h('button', { type: 'button', className: 'mf-btn mf-btn-ghost', onClick: function () { setPending(item) } }, t('restoreSummary')))
          })),
        pending === null ? null : h('div', { className: 'mf-confirm' },
          h('p', null, fmt(t('confirmRestoreSummary'), { version: pending.version })),
          h('div', { className: 'mf-row mf-row-end' },
            h('button', { type: 'button', className: 'mf-btn', onClick: function () { setPending(null) } }, t('cancel')),
            h('button', { type: 'button', className: 'mf-btn mf-btn-danger', onClick: function () { props.onRestore(pending.version); setPending(null); props.onClose() } }, t('restoreSummary')))))
    }

    function EntryRow(props) {
      var entry = props.entry
      var t = props.t
      var L = dict(t)
      var p = entry.provenance || {}
      var sourceText = L.sourceTypes[p.sourceType] || L.sourceTypes.unknown
      return h('button', {
        type: 'button',
        className: 'mf-entry' + (props.active ? ' mf-entry-active' : ''),
        onClick: props.onSelect
      },
        h('div', { className: 'mf-entry-top' },
          h('span', { className: 'mf-entry-ts' }, fmtStamp(entry.ts)),
          h('span', { className: importanceDots(entry.importance) === '○○○' ? 'mf-dots mf-dots-low' : 'mf-dots', title: t('importance') }, importanceDots(entry.importance))),
        h('div', { className: 'mf-entry-content' }, entry.content),
        h('div', { className: 'mf-entry-tags' },
          (entry.tags || []).slice(0, 4).map(function (tag) { return h('span', { key: tag, className: 'mf-tag' }, tag) }),
          h('span', { className: sourceClass(p.sourceType) }, sourceText),
          entry.deleted ? h('span', { className: 'mf-tag mf-tag-danger' }, t('deletedTag')) : null,
          entry.archived ? h('span', { className: 'mf-tag mf-tag-muted' }, t('archived')) : null))
    }

    function DetailMeta(props) {
      var t = props.t
      var L = dict(t)
      var entry = props.entry
      var p = entry.provenance || {}
      var rows = [
        ['id', entry.id],
        [t('source'), L.sourceTypes[p.sourceType] || L.sourceTypes.unknown],
        [t('recordedBy'), L.recordedBys[p.recordedBy] || L.recordedBys.unknown],
        [t('importance'), importanceDots(entry.importance) + ' (' + entry.importance + ')'],
        [t('createdAt'), fmtStamp(entry.ts)],
        [t('updatedAt'), fmtStamp(p.updatedAt)],
        [t('session'), p.sourceSessionId || '—'],
        [t('archived'), entry.archived ? t('archived') : '—']
      ]
      if (entry.deleted) rows.push([t('deletedAt'), fmtStamp(entry.deletedAt)])
      return h('dl', { className: 'mf-meta' }, rows.map(function (row, index) {
        return h('div', { key: index, className: 'mf-meta-row' },
          h('dt', null, row[0]),
          h('dd', { title: String(row[1]) }, row[1]))
      }))
    }

    function EntryDetail(props) {
      var t = props.t
      var L = dict(t)
      var entry = props.entry
      var detail = props.detail
      var p = entry.provenance || {}
      var deleted = entry.deleted === true
      return h('section', { className: 'mf-card mf-detail' },
        h('div', { className: 'mf-detail-head' },
          h('div', null,
            h('h3', null, L.sourceTypes[p.sourceType] || L.sourceTypes.unknown),
            h('div', { className: 'mf-muted mf-small' }, entry.id)),
          h('div', { className: 'mf-row' },
            deleted
              ? h('button', { type: 'button', className: 'mf-btn mf-btn-primary', onClick: function () { props.onRestoreEntry({ id: entry.id }) } }, t('restore'))
              : h('button', { type: 'button', className: 'mf-btn mf-btn-ghost', onClick: function () { props.onEdit(entry) } }, t('edit')),
            deleted ? null : h('button', { type: 'button', className: 'mf-btn mf-btn-danger-ghost', onClick: function () { props.onDelete(entry) } }, t('delete')))),
        deleted ? h('div', { className: 'mf-notice mf-notice-warn' }, t('deletedTag')) : null,
        h('div', { className: 'mf-detail-content' }, entry.content),
        p.evidence ? h('div', { className: 'mf-evidence' },
          h('div', { className: 'mf-muted mf-small' }, t('evidence')),
          h('blockquote', null, p.evidence)) : null,
        h(DetailMeta, { t: t, entry: entry }),
        h('div', { className: 'mf-history-title' }, t('detailHistory')),
        detail === null ? h('p', { className: 'mf-muted' }, t('loading')) :
          detail.history.length === 0 ? h('p', { className: 'mf-muted' }, t('noHistory')) :
            h('div', { className: 'mf-history-list' }, detail.history.map(function (row, index) {
              return h('div', { key: index, className: 'mf-history-row' },
                h('div', { className: 'mf-history-text' },
                  h('strong', null, row.op + ' · ' + fmtStamp(row.ts)),
                  h('div', { className: 'mf-history-content' }, row.content)),
                h('button', { type: 'button', className: 'mf-btn mf-btn-ghost', onClick: function () { props.onRestoreEntry(row) } }, t('restore')))
            })))
    }

    function EditDialog(props) {
      var t = props.t
      var editing = props.entry
      var [content, setContent] = React.useState(editing ? editing.content : '')
      var [tags, setTags] = React.useState(editing ? (editing.tags || []).join(', ') : '')
      var [importance, setImportance] = React.useState(editing ? editing.importance : 1)
      var bytes = (function () { try { return new TextEncoder().encode(content).length } catch { return content.length } })()
      var invalid = content.trim().length === 0 || bytes > 2000
      return h(Modal, { title: editing ? t('editTitle') : t('addTitle'), onClose: props.onClose, closeLabel: t('cancel'), wide: true },
        h('label', { className: 'mf-field' },
          h('span', null, t('content')),
          h('textarea', {
            className: 'mf-textarea',
            value: content,
            rows: 8,
            maxLength: 2000,
            onChange: function (event) { setContent(event.target.value) }
          }),
          h('span', { className: 'mf-muted mf-small' }, fmt(t('bytes'), { bytes: bytes }))),
        h('label', { className: 'mf-field' },
          h('span', null, t('tags')),
          h('input', { className: 'mf-input', value: tags, onChange: function (event) { setTags(event.target.value) } })),
        h('label', { className: 'mf-field' },
          h('span', null, t('importance')),
          h('select', { className: 'mf-input', value: importance, onChange: function (event) { setImportance(Number(event.target.value)) } },
            [0, 1, 2, 3].map(function (value) { return h('option', { key: value, value: value }, value + ' ' + importanceDots(value)) }))),
        props.duplicate ? h('div', { className: 'mf-notice mf-notice-warn' }, t('duplicateWarning')) : null,
        props.error ? h('div', { className: 'mf-notice mf-notice-error' }, props.error) : null,
        h('div', { className: 'mf-row mf-row-end' },
          h('button', { type: 'button', className: 'mf-btn', onClick: props.onClose }, t('cancel')),
          h('button', {
            type: 'button',
            className: 'mf-btn mf-btn-primary',
            disabled: invalid || props.busy,
            onClick: function () {
              props.onSave({
                content: content.trim(),
                tags: tags.split(',').map(function (tag) { return tag.trim() }).filter(Boolean),
                importance: importance,
                allowDuplicate: props.duplicate === true
              })
            }
          }, props.busy ? t('saving') : (props.duplicate ? t('addAnyway') : t('save')))))
    }

    function DeleteDialog(props) {
      var t = props.t
      return h(Modal, { title: t('confirmDeleteTitle'), onClose: props.onClose, closeLabel: t('cancel') },
        h('p', null, t('confirmDeleteBody')),
        h('blockquote', { className: 'mf-quote' }, props.entry.content),
        props.error ? h('div', { className: 'mf-notice mf-notice-error' }, props.error) : null,
        h('div', { className: 'mf-row mf-row-end' },
          h('button', { type: 'button', className: 'mf-btn', onClick: props.onClose }, t('cancel')),
          h('button', { type: 'button', className: 'mf-btn mf-btn-danger', disabled: props.busy, onClick: props.onConfirm }, props.busy ? t('saving') : t('confirmDelete'))))
    }

    // ---------------------------------------------------------------------
    // Curation log
    // ---------------------------------------------------------------------

    function StatusBadge(props) {
      var L = dict(props.t)
      var status = props.status || 'skipped'
      return h('span', { className: 'mf-status mf-status-' + status }, L.statuses[status] || status)
    }

    function CuratorPanel(props) {
      var t = props.t
      var L = dict(t)
      var curator = props.curator
      var [expanded, setExpanded] = React.useState(null)
      var running = Array.isArray(curator.running) ? curator.running : []
      var last = curator.lastRun
      return h('div', { className: 'mf-panel' },
        h('div', { className: 'mf-cards' },
          h('div', { className: 'mf-card mf-stat' },
            h('div', { className: 'mf-muted' }, t('curatorRunning')),
            h('div', { className: 'mf-stat-value' }, running.length > 0 ? t('curatorRunning') : t('curatorIdle')),
            running.length > 0 ? h('div', { className: 'mf-small mf-muted' }, running.map(function (run) { return run.sessionId }).join(', ')) : null),
          h('div', { className: 'mf-card mf-stat' },
            h('div', { className: 'mf-muted' }, t('lastRun')),
            h('div', { className: 'mf-stat-value' }, last ? fmtTime(last.endedAt || last.startedAt) : '—'),
            last ? h(StatusBadge, { t: t, status: last.status }) : null),
          h('div', { className: 'mf-card mf-stat' },
            h('div', { className: 'mf-muted' }, t('totalTurns')),
            h('div', { className: 'mf-stat-value' }, String(curator.lifetimeTurns || 0)),
            h('div', { className: 'mf-small mf-muted' }, t('totalTurnsNote'))),
          h('div', { className: 'mf-card mf-stat' },
            h('div', { className: 'mf-muted' }, t('nextIn')),
            h('div', { className: 'mf-stat-value' }, fmt(t('turnsUnit'), { count: curator.nextIn })),
            h('div', { className: 'mf-small mf-muted' }, 'every ' + curator.everyTurns)),
          h('div', { className: 'mf-card mf-stat' },
            h('div', { className: 'mf-muted' }, t('llmCalls')),
            h('div', { className: 'mf-stat-value' }, String(curator.llm.calls || 0)),
            h('div', { className: 'mf-small mf-muted' }, t('llmFailures') + ': ' + (curator.llm.failures || 0))),
          h('div', { className: 'mf-card mf-stat' },
            h('div', { className: 'mf-muted' }, t('summaryVersion')),
            h('div', { className: 'mf-stat-value' }, 'v' + (curator.summary.version || 0)),
            h('div', { className: 'mf-small mf-muted' }, fmtTime(curator.summary.updatedAt)))),
        h('div', { className: 'mf-row mf-row-between' },
          h('h3', null, t('pendingSessions')),
          h('button', { type: 'button', className: 'mf-btn', disabled: props.busy || running.length > 0, onClick: props.onCurateNow }, props.busy ? t('curating') : t('curateNow'))),
        curator.sessions.length === 0 ? h('p', { className: 'mf-muted' }, t('noPending')) :
          h('table', { className: 'mf-table' },
            h('thead', null, h('tr', null,
              h('th', null, 'Session'), h('th', null, t('pendingTurns')), h('th', null, t('nextIn')),
              h('th', null, t('lastRun')), h('th', null, ''))),
            h('tbody', null, curator.sessions.map(function (session) {
              return h('tr', { key: session.id },
                h('td', null, h('code', null, session.shortId), session.live ? h('span', { className: 'mf-tag mf-tag-live' }, t('sessionLive')) : null,
                  session.owned ? null : h('span', { className: 'mf-tag mf-tag-warn' }, t('sessionUnverified'))),
                h('td', null, String(session.pendingTurns)),
                h('td', null, fmt(t('turnsUnit'), { count: session.remaining })),
                h('td', null, session.lastCuratedAt ? fmtTime(session.lastCuratedAt) : '—'),
                h('td', null, session.attempts > 0 ? h('span', { className: 'mf-muted' }, 'attempts ' + session.attempts) : ''))
            }))),
        h('h3', null, t('curatorRuns')),
        curator.runs.length === 0 ? h('div', null, h('p', { className: 'mf-muted' }, t('noRuns')), h('p', { className: 'mf-muted mf-small' }, t('noRunsNote'))) :
          h('div', { className: 'mf-runs' }, curator.runs.map(function (run) {
            var open = expanded === run.runId
            return h('div', { key: run.runId, className: 'mf-run' },
              h('button', { type: 'button', className: 'mf-run-head', onClick: function () { setExpanded(open ? null : run.runId) } },
                h('span', { className: 'mf-run-time' }, fmtTime(run.startedAt)),
                h(StatusBadge, { t: t, status: run.status }),
                h('span', { className: 'mf-muted' }, L.triggers[run.trigger] || run.trigger),
                run.legacy ? h('span', { className: 'mf-tag' }, t('legacyRun')) : null,
                h('span', { className: 'mf-muted mf-small' }, '+' + (run.adds || 0) + ' / ~' + (run.updates || 0) + ' / ⇄' + (run.merges || 0)),
                h('span', { className: 'mf-muted mf-small' }, fmtDuration(run))),
              open ? h('div', { className: 'mf-run-body' },
                h('div', { className: 'mf-small' }, t('runId') + ': ' + run.runId + ' · ' + t('duration') + ': ' + fmtDuration(run) + ' · LLM: ' + (run.llmCalls || 0) + '/' + (run.llmFailures || 0)),
                h('div', { className: 'mf-small' }, t('ops') + ': ' + (run.adds || 0) + ' / ' + (run.updates || 0) + ' / ' + (run.merges || 0) + ' · ' + t('emptyRuns') + ': ' + (run.status === 'empty' ? 1 : 0) + ' · ' + t('dropped') + ': ' + (run.dropped || 0)),
                run.addedIds && run.addedIds.length > 0 ? h('div', { className: 'mf-small' }, '+ ' + run.addedIds.join(', ')) : null,
                run.updatedIds && run.updatedIds.length > 0 ? h('div', { className: 'mf-small' }, '~ ' + run.updatedIds.join(', ')) : null,
                run.mergedIds && run.mergedIds.length > 0 ? h('div', { className: 'mf-small' }, '⇄ ' + run.mergedIds.join(', ')) : null,
                run.error ? h('div', { className: 'mf-notice mf-notice-error' }, run.error) : null) : null)
          })),
        h('div', { className: 'mf-muted mf-small' }, 'summary v' + (curator.summary.version || 0) + ' · ' + fmtTime(curator.summary.updatedAt) + (curator.lastError ? ' · ' + curator.lastError : '')))
    }

    // ---------------------------------------------------------------------
    // Parameters
    // ---------------------------------------------------------------------

    function fieldLabel(field, lang) {
      return lang === 'zh' ? field.labelZh : field.labelEn
    }

    function fieldHint(field, lang) {
      return lang === 'zh' ? field.hintZh : field.hintEn
    }

    function SettingsPanel(props) {
      var t = props.t
      var lang = t('lang')
      var settings = props.settings
      var [draft, setDraft] = React.useState(null)
      var [baseline, setBaseline] = React.useState(null)
      var [confirm, setConfirm] = React.useState(null)
      var [error, setError] = React.useState(null)

      React.useEffect(function () {
        if (settings === null) return
        var next = {}
        settings.fields.forEach(function (field) { next[field.key] = field.value })
        setDraft(next)
        setBaseline(next)
        setError(null)
      }, [settings ? settings.revision : null])

      function values() {
        return draft || {}
      }

      function dirty() {
        if (draft === null || baseline === null) return false
        for (var key in draft) if (draft[key] !== baseline[key]) return true
        return false
      }

      function invalid() {
        if (draft === null) return false
        for (var key in draft) {
          if (draft[key] === '') return true
          if (typeof draft[key] === 'number' && !Number.isFinite(draft[key])) return true
        }
        return false
      }

      function setValue(key, value) {
        var next = {}
        for (var name in values()) next[name] = values()[name]
        next[key] = value
        setDraft(next)
        setError(null)
      }

      function buildPatch(target, full) {
        var set = {}
        settings.fields.forEach(function (field) {
          if (full === true || target[field.key] !== baseline[field.key]) set[field.key] = target[field.key]
        })
        return set
      }

      async function save(target, full) {
        var set = buildPatch(target || values(), full === true)
        if (Object.keys(set).length === 0) {
          props.onNotice({ type: 'ok', text: t('noChanges') })
          return
        }
        try {
          await props.onSave(set, settings.revision)
          props.onNotice({ type: 'ok', text: t('saved') })
          setError(null)
          if (props.onSaved) await props.onSaved()
        } catch (failure) {
          if (failure.code === 'settings-conflict') {
            props.onConflict()
          } else {
            setError(failure.message)
          }
        }
      }

      if (settings === null || draft === null) return h('p', { className: 'mf-muted' }, t('loading'))

      return h('div', { className: 'mf-panel' },
        h('h3', null, t('paramsTitle')),
        h('p', { className: 'mf-muted mf-small' }, t('paramsHint')),
        error ? h('div', { className: 'mf-notice mf-notice-error' }, error) : null,
        h('div', { className: 'mf-param-grid' }, settings.fields.map(function (field) {
          var value = values()[field.key]
          var changed = value !== baseline[field.key]
          return h('div', { key: field.key, className: 'mf-param' + (changed ? ' mf-param-changed' : '') },
            h('div', { className: 'mf-param-head' },
              h('label', { htmlFor: 'mf-' + field.key }, fieldLabel(field, lang)),
              h('div', { className: 'mf-row' },
                field.overridden ? h('span', { className: 'mf-tag mf-tag-warn' }, t('overridden')) : null,
                h('span', { className: 'mf-tag mf-tag-live' }, t('live')))),
            field.kind === 'boolean'
              ? h('button', {
                  id: 'mf-' + field.key,
                  type: 'button',
                  role: 'switch',
                  'aria-checked': value === true,
                  className: 'mf-switch' + (value === true ? ' mf-switch-on' : ''),
                  onClick: function () { setValue(field.key, value !== true) }
                }, h('span', { className: 'mf-switch-knob' }), h('span', null, value === true ? 'ON' : 'OFF'))
              : h('input', {
                  id: 'mf-' + field.key,
                  className: 'mf-input',
                  type: 'number',
                  min: field.min,
                  max: field.max,
                  step: 1,
                  value: value,
                  onChange: function (event) {
                    var raw = event.target.value
                    setValue(field.key, raw === '' ? '' : Number(raw))
                  }
                }),
            h('div', { className: 'mf-small mf-muted' }, fieldHint(field, lang)),
            h('div', { className: 'mf-small mf-muted' },
              (field.min !== undefined ? field.min + '–' + field.max + ' · ' : '') +
              t('recommended') + ': ' + String(field.recommended) + ' · ' + t('defaultValue') + ': ' + String(field.defaultValue)))
        })),
        h('div', { className: 'mf-row mf-row-end mf-sticky-actions' },
          h('button', { type: 'button', className: 'mf-btn', disabled: !dirty() || props.busy, onClick: function () { setDraft(Object.assign({}, baseline)) } }, t('cancel')),
          h('button', { type: 'button', className: 'mf-btn', disabled: props.busy, onClick: function () {
            var target = {}
            settings.fields.forEach(function (field) { target[field.key] = field.recommended })
            setConfirm(target)
          } }, t('restoreDefaults')),
          h('button', { type: 'button', className: 'mf-btn mf-btn-primary', disabled: !dirty() || props.busy || invalid(), onClick: function () { save() } }, props.busy ? t('saving') : t('save'))),
        h('h3', null, t('lockTitle')),
        h('p', { className: 'mf-muted mf-small' }, t('lockHint')),
        h('div', { className: 'mf-locked' }, props.locked.map(function (row) {
          var value = row.key === 'embeddingApiKey' ? (row.configured ? 'configured' : 'not configured') : (Array.isArray(row.value) ? row.value.join(', ') || '—' : String(row.value === null || row.value === undefined ? '—' : row.value))
          return h('div', { key: row.key, className: 'mf-locked-row' },
            h('div', null, h('strong', null, lang === 'zh' ? row.zh : row.en), h('div', { className: 'mf-small mf-muted' }, lang === 'zh' ? row.reasonZh : row.reasonEn)),
            h('code', { className: 'mf-locked-value' }, value))
        })),
        confirm === null ? null : h(Modal, { title: t('restoreDefaults'), onClose: function () { setConfirm(null) }, closeLabel: t('cancel') },
          h('p', null, t('confirmRestore')),
          h('ul', { className: 'mf-diff' }, settings.fields.filter(function (field) { return confirm[field.key] !== field.value }).map(function (field) {
            return h('li', { key: field.key }, fieldLabel(field, lang) + ': ' + String(field.value) + ' → ' + String(confirm[field.key]))
          })),
          h('div', { className: 'mf-row mf-row-end' },
            h('button', { type: 'button', className: 'mf-btn', onClick: function () { setConfirm(null) } }, t('cancel')),
            h('button', { type: 'button', className: 'mf-btn mf-btn-primary', onClick: function () { setDraft(confirm); setConfirm(null); save(confirm, true) } }, t('save')))))
    }

    // ---------------------------------------------------------------------
    // Page
    // ---------------------------------------------------------------------

    function MemorySection(props) {
      var t = props.t
      var L = dict(t)
      var [tab, setTab] = React.useState('memory')
      var [snapshot, setSnapshot] = React.useState(null)
      var [error, setError] = React.useState(null)
      var [loading, setLoading] = React.useState(true)
      var [notice, setNotice] = React.useState(null)
      var [query, setQuery] = React.useState('')
      var [tag, setTag] = React.useState('')
      var [sort, setSort] = React.useState('recent')
      var [archived, setArchived] = React.useState(false)
      var [showDeleted, setShowDeleted] = React.useState(false)
      var [selected, setSelected] = React.useState(null)
      var [detail, setDetail] = React.useState(null)
      var [detailLoading, setDetailLoading] = React.useState(false)
      var [editing, setEditing] = React.useState(null)
      var [deleting, setDeleting] = React.useState(null)
      var [dialogBusy, setDialogBusy] = React.useState(false)
      var [dialogError, setDialogError] = React.useState(null)
      var [duplicate, setDuplicate] = React.useState(false)
      var alive = React.useRef(true)

      React.useEffect(function () {
        alive.current = true
        load(false)
        var timer = setInterval(function () { if (!document.hidden) load(true) }, 15000)
        function onVisible() { if (!document.hidden) load(true) }
        document.addEventListener('visibilitychange', onVisible)
        return function () {
          alive.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      async function load(silent) {
        if (!silent) setLoading(true)
        try {
          var value = await apiGet(API)
          if (!alive.current) return
          setSnapshot(value)
          setError(null)
          if (selected !== null) {
            var present = value.entries.some(function (entry) { return entry.id === selected.id }) ||
              (value.deleted || []).some(function (entry) { return entry.id === selected.id })
            if (!present) {
              setSelected(null)
              setDetail(null)
            }
          }
        } catch (failure) {
          if (!alive.current) return
          setError(failure.message)
        } finally {
          if (alive.current) setLoading(false)
        }
      }

      async function selectEntry(entry) {
        setSelected(entry)
        setDetail(null)
        setDetailLoading(true)
        try {
          var value = await apiGet(API + '/entry?id=' + encodeURIComponent(entry.id))
          if (alive.current) setDetail(value)
        } catch (failure) {
          if (alive.current) setNotice({ type: 'error', text: failure.message })
        } finally {
          if (alive.current) setDetailLoading(false)
        }
      }

      async function runMutation(payload, successText) {
        setDialogBusy(true)
        setDialogError(null)
        try {
          var value = await apiPost(payload)
          if (alive.current) {
            setNotice({ type: 'ok', text: successText })
            setEditing(null)
            setDeleting(null)
            setDuplicate(false)
            await load(true)
            if (payload.action === 'delete') {
              setSelected(null)
              setDetail(null)
            } else if (selected !== null) {
              await selectEntry(selected)
            }
          }
          return value
        } catch (failure) {
          if (failure.code === 'duplicate-entry' && payload.action === 'add') {
            setDuplicate(true)
          } else {
            setDialogError(failure.message)
          }
          return null
        } finally {
          if (alive.current) setDialogBusy(false)
        }
      }

      async function saveSettings(set, revision) {
        return apiPost({ action: 'settings-save', set: set, expectedRevision: revision })
      }

      async function restoreSummary(version) {
        try {
          await apiPost({ action: 'restore-summary', version: version, confirm: true })
          setNotice({ type: 'ok', text: t('summaryRestored') })
          await load(true)
        } catch (failure) {
          setNotice({ type: 'error', text: failure.message })
        }
      }

      async function curateNow() {
        if (!window.confirm(t('confirmCurate'))) return
        setDialogBusy(true)
        try {
          await apiPost({ action: 'curate-now' })
          setNotice({ type: 'ok', text: t('summaryRefreshed') })
          await load(true)
        } catch (failure) {
          setNotice({ type: 'error', text: failure.message })
        } finally {
          setDialogBusy(false)
        }
      }

      var entries = snapshot ? snapshot.entries : []
      var deletedEntries = snapshot && showDeleted ? (snapshot.deleted || []).map(function (entry) {
        var copy = {}
        for (var key in entry) copy[key] = entry[key]
        copy.deleted = true
        return copy
      }) : []
      var filtered = React.useMemo(function () {
        var list = entries.concat(deletedEntries).filter(function (entry) {
          if (!archived && entry.archived) return false
          if (tag !== '' && (entry.tags || []).indexOf(tag) < 0) return false
          if (query.trim().length > 0) {
            var needle = query.trim().toLowerCase()
            var haystack = (entry.content + ' ' + (entry.tags || []).join(' ') + ' ' + entry.id).toLowerCase()
            if (haystack.indexOf(needle) < 0) return false
          }
          return true
        })
        list.sort(function (left, right) {
          if (sort === 'oldest') return String(left.ts).localeCompare(String(right.ts))
          if (sort === 'important') return (right.importance - left.importance) || String(right.ts).localeCompare(String(left.ts))
          return String(right.ts).localeCompare(String(left.ts))
        })
        return list
      }, [entries, deletedEntries, archived, tag, query, sort])

      if (loading && snapshot === null) return h('div', { className: 'mf-root mf-center' }, h('div', { className: 'mf-spinner' }), h('p', { className: 'mf-muted' }, t('loading')))
      if (error !== null && snapshot === null) {
        return h('div', { className: 'mf-root mf-center' },
          h('h2', null, t('loadFailed')),
          h('p', { className: 'mf-muted' }, error),
          h('button', { type: 'button', className: 'mf-btn mf-btn-primary', onClick: function () { load(false) } }, t('retry')))
      }

      return h('div', { className: 'mf-root' },
        h('header', { className: 'mf-header' },
          h('div', null,
            h('h2', null, t('title')),
            h('p', { className: 'mf-muted' }, t('subtitle') + ' ' + (snapshot ? snapshot.scope.label : ''))),
          h('button', { type: 'button', className: 'mf-btn mf-btn-ghost', onClick: function () { load(false) } }, t('refresh'))),
        h('nav', { className: 'mf-tabs', role: 'tablist' }, ['memory', 'curator', 'settings'].map(function (key) {
          return h('button', {
            key: key,
            type: 'button',
            role: 'tab',
            'aria-selected': tab === key,
            className: 'mf-tab' + (tab === key ? ' mf-tab-active' : ''),
            onClick: function () { setTab(key) }
          }, L.tabs[key])
        })),
        h(Notice, { notice: notice, onClose: function () { setNotice(null) } }),
        snapshot === null ? null : h('div', { className: 'mf-body' },
          tab === 'memory' ? h('div', { className: 'mf-memory' },
            h(SummaryCard, { t: t, summary: snapshot.summary, onRestoreSummary: restoreSummary }),
            h('div', { className: 'mf-toolbar' },
              h('input', { className: 'mf-input mf-search', placeholder: t('search'), value: query, onChange: function (event) { setQuery(event.target.value) } }),
              h('select', { className: 'mf-input mf-select', value: tag, onChange: function (event) { setTag(event.target.value) } },
                h('option', { value: '' }, t('allTags')),
                (snapshot.tags || []).map(function (item) { return h('option', { key: item.name, value: item.name }, item.name + ' (' + item.count + ')') })),
              h('select', { className: 'mf-input mf-select', value: sort, onChange: function (event) { setSort(event.target.value) } },
                h('option', { value: 'recent' }, t('sortRecent')),
                h('option', { value: 'oldest' }, t('sortOldest')),
                h('option', { value: 'important' }, t('sortImportant'))),
              h('label', { className: 'mf-check' }, h('input', { type: 'checkbox', checked: archived, onChange: function (event) { setArchived(event.target.checked) } }), t('showArchived')),
              h('label', { className: 'mf-check' }, h('input', { type: 'checkbox', checked: showDeleted, onChange: function (event) { setShowDeleted(event.target.checked) } }), t('showDeleted')),
              h('button', { type: 'button', className: 'mf-btn mf-btn-primary mf-add-btn', onClick: function () { setEditing({ mode: 'add' }); setDialogError(null); setDuplicate(false) } }, t('add'))),
            h('div', { className: 'mf-count mf-muted mf-small' }, fmt(t('entries'), { count: filtered.length })),
            h('div', { className: 'mf-columns' },
              h('div', { className: 'mf-list' }, filtered.length === 0 ? h('p', { className: 'mf-muted' }, t('noEntries')) : filtered.map(function (entry) {
                return h(EntryRow, { key: entry.id, t: t, entry: entry, active: selected !== null && selected.id === entry.id, onSelect: function () { selectEntry(entry) } })
              })),
              h('div', { className: 'mf-detail-col' }, selected === null ? h('p', { className: 'mf-muted mf-pad' }, t('selectEntry')) :
                h(EntryDetail, {
                  t: t,
                  entry: selected,
                  detail: detailLoading ? null : detail,
                  onEdit: function (entry) { setEditing({ mode: 'edit', entry: entry }); setDialogError(null); setDuplicate(false) },
                  onDelete: function (entry) { setDeleting(entry); setDialogError(null) },
                  onRestoreEntry: function (row) { runMutation({ action: 'restore-entry', id: row.id ?? selected.id }, t('restored')) }
                })))) : null,
          tab === 'curator' ? h(CuratorPanel, { t: t, curator: snapshot.curator, busy: dialogBusy, onCurateNow: curateNow }) : null,
          tab === 'settings' ? h(SettingsPanel, {
            t: t,
            settings: snapshot.settings,
            locked: snapshot.locked,
            busy: dialogBusy,
            onSave: saveSettings,
            onSaved: function () { return load(true) },
            onConflict: function () { setNotice({ type: 'error', text: t('conflict') }); load(true) },
            onNotice: setNotice
          }) : null),
        editing === null ? null : h(EditDialog, {
          t: t,
          entry: editing.mode === 'edit' ? editing.entry : null,
          busy: dialogBusy,
          error: dialogError,
          duplicate: duplicate,
          onClose: function () { setEditing(null); setDuplicate(false) },
          onSave: function (values) {
            if (editing.mode === 'add') {
              runMutation({ action: 'add', content: values.content, tags: values.tags, importance: values.importance, allowDuplicate: values.allowDuplicate }, t('created'))
            } else {
              runMutation({
                action: 'update',
                id: editing.entry.id,
                content: values.content,
                tags: values.tags,
                importance: values.importance,
                expectedEntryRevision: editing.entry.revision
              }, t('updated'))
            }
          }
        }),
        deleting === null ? null : h(DeleteDialog, {
          t: t,
          entry: deleting,
          busy: dialogBusy,
          error: dialogError,
          onClose: function () { setDeleting(null) },
          onConfirm: function () { runMutation({ action: 'delete', id: deleting.id, confirm: true, expectedEntryRevision: deleting.revision }, t('deleted')) }
        }))
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    var CSS = [
      '.mf-root{--mf-bg:var(--dsw-alias-bg-base,#fff);--mf-layer:var(--dsw-alias-bg-layer-1,#f7f8fa);--mf-layer2:var(--dsw-alias-bg-layer-2,#eef1f5);--mf-border:var(--dsw-alias-border-l1,#dfe3e8);--mf-border2:var(--dsw-alias-border-l2,#c9d0d8);--mf-text:var(--dsw-alias-label-primary,#1f2329);--mf-muted:var(--dsw-alias-label-secondary,#69707a);--mf-brand:var(--dsw-alias-brand-primary,#3b6ef5);--mf-danger:var(--dsw-alias-state-error-primary,#d64545);--mf-ok:var(--dsw-alias-state-success-primary,#2e9e5b);--mf-warn:var(--dsw-alias-state-warn-primary,#b7791f);color:var(--mf-text);background:var(--mf-bg);display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px}',
      '.mf-root *{box-sizing:border-box}',
      '.mf-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 22px 10px}',
      '.mf-header h2{margin:0;font-size:18px;line-height:26px;font-weight:600}',
      '.mf-header p{margin:4px 0 0;font-size:12px}',
      '.mf-muted{color:var(--mf-muted)}',
      '.mf-small{font-size:12px;line-height:18px}',
      '.mf-tabs{display:flex;gap:4px;padding:0 22px;border-bottom:1px solid var(--mf-border)}',
      '.mf-tab{appearance:none;border:0;background:transparent;color:var(--mf-muted);padding:9px 12px;border-bottom:2px solid transparent;cursor:pointer;font:inherit}',
      '.mf-tab-active{color:var(--mf-text);border-bottom-color:var(--mf-brand);font-weight:600}',
      '.mf-body{flex:1;min-height:0;overflow:auto;padding:14px 22px 24px}',
      '.mf-memory{display:flex;flex-direction:column;gap:12px}',
      '.mf-card{background:var(--mf-layer);border:1px solid var(--mf-border);border-radius:10px;padding:12px 14px}',
      '.mf-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
      '.mf-card h3{margin:0 0 4px;font-size:14px;line-height:20px}',
      '.mf-summary-card .mf-summary{padding:8px 10px;border:1px solid var(--mf-border);border-radius:8px;background:var(--mf-bg);max-height:220px;overflow:auto;font-family:var(--dsh-code-font-family,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:12px;line-height:19px}',
      '.mf-summary-preview{padding:8px 10px;border:1px dashed var(--mf-border2);border-radius:8px;background:var(--mf-bg);max-height:150px;overflow:hidden}',
      '.mf-summary-preview .mf-summary{max-height:132px;overflow:hidden;border:0;padding:0;background:transparent}',
      '.mf-summary h3,.mf-summary h4{margin:6px 0 2px;font-size:12px}',
      '.mf-summary p{margin:2px 0;white-space:pre-wrap}',
      '.mf-bullet{padding-left:4px;white-space:pre-wrap}',
      '.mf-version{color:var(--mf-muted);font-size:11px;margin-top:4px}',
      '.mf-gap{height:5px}',
      '.mf-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.mf-row-between{justify-content:space-between;margin-top:14px}',
      '.mf-row-end{justify-content:flex-end;margin-top:12px}',
      '.mf-btn{appearance:none;border:1px solid var(--mf-border2);background:var(--mf-bg);color:var(--mf-text);border-radius:7px;padding:5px 11px;font:inherit;font-size:12px;line-height:20px;cursor:pointer;white-space:nowrap}',
      '.mf-btn:hover{border-color:var(--mf-brand)}',
      '.mf-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.mf-btn-primary{background:var(--mf-brand);border-color:var(--mf-brand);color:#fff}',
      '.mf-btn-ghost{border-color:transparent;background:transparent;color:var(--mf-muted)}',
      '.mf-btn-danger{background:var(--mf-danger);border-color:var(--mf-danger);color:#fff}',
      '.mf-btn-danger-ghost{border-color:transparent;background:transparent;color:var(--mf-danger)}',
      '.mf-icon-btn{appearance:none;border:0;background:transparent;color:var(--mf-muted);font-size:18px;line-height:18px;cursor:pointer;padding:2px 6px}',
      '.mf-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.mf-add-btn{margin-left:auto}',
      '.mf-input{appearance:none;border:1px solid var(--mf-border2);background:var(--mf-bg);color:var(--mf-text);border-radius:7px;padding:6px 9px;font:inherit;font-size:12px;line-height:18px;min-width:0}',
      '.mf-input:focus{outline:2px solid color-mix(in srgb,var(--mf-brand) 35%,transparent);outline-offset:1px}',
      '.mf-search{flex:1;min-width:150px}',
      '.mf-select{max-width:128px}',
      '.mf-check{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--mf-muted);white-space:nowrap}',
      '.mf-count{margin-top:2px}',
      '.mf-columns{display:grid;grid-template-columns:minmax(220px,34%) 1fr;gap:12px;align-items:start}',
      '.mf-list{display:flex;flex-direction:column;gap:6px;max-height:430px;overflow:auto;padding-right:2px}',
      '.mf-entry{appearance:none;text-align:left;border:1px solid var(--mf-border);background:var(--mf-layer);border-radius:8px;padding:9px 10px;cursor:pointer;color:var(--mf-text);font:inherit}',
      '.mf-entry:hover{border-color:var(--mf-border2);background:var(--mf-bg)}',
      '.mf-entry-active{border-color:var(--mf-brand);background:var(--mf-bg);box-shadow:0 0 0 1px var(--mf-brand) inset}',
      '.mf-entry-top{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--mf-muted)}',
      '.mf-entry-content{font-size:12px;line-height:18px;margin:5px 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}',
      '.mf-entry-tags{display:flex;gap:4px;flex-wrap:wrap;align-items:center}',
      '.mf-tag{display:inline-flex;align-items:center;border-radius:999px;padding:1px 7px;background:var(--mf-layer2);color:var(--mf-muted);font-size:10px;line-height:16px;white-space:nowrap}',
      '.mf-tag-danger{background:color-mix(in srgb,var(--mf-danger) 12%,transparent);color:var(--mf-danger)}',
      '.mf-tag-muted{opacity:.7}',
      '.mf-tag-warn{background:color-mix(in srgb,var(--mf-warn) 16%,transparent);color:var(--mf-warn)}',
      '.mf-tag-live{background:color-mix(in srgb,var(--mf-ok) 16%,transparent);color:var(--mf-ok)}',
      '.mf-dots{letter-spacing:1px;color:var(--mf-warn);font-size:10px}',
      '.mf-dots-low{color:var(--mf-muted)}',
      '.mf-badge{display:inline-flex;align-items:center;border-radius:999px;padding:1px 7px;font-size:10px;line-height:16px;border:1px solid transparent}',
      '.mf-badge-user{background:color-mix(in srgb,var(--mf-brand) 13%,transparent);color:var(--mf-brand)}',
      '.mf-badge-task{background:color-mix(in srgb,var(--mf-ok) 14%,transparent);color:var(--mf-ok)}',
      '.mf-badge-file{background:color-mix(in srgb,var(--mf-warn) 15%,transparent);color:var(--mf-warn)}',
      '.mf-badge-claim{background:color-mix(in srgb,var(--mf-danger) 12%,transparent);color:var(--mf-danger)}',
      '.mf-badge-model,.mf-badge-manual{background:var(--mf-layer2);color:var(--mf-text)}',
      '.mf-badge-unknown{background:var(--mf-layer2);color:var(--mf-muted)}',
      '.mf-detail{position:relative}',
      '.mf-detail-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}',
      '.mf-detail-content{white-space:pre-wrap;word-break:break-word;line-height:20px;padding:10px 12px;border:1px solid var(--mf-border);border-radius:8px;background:var(--mf-bg);margin:8px 0}',
      '.mf-evidence blockquote,.mf-quote{margin:4px 0;padding:6px 10px;border-left:3px solid var(--mf-border2);background:var(--mf-bg);color:var(--mf-muted);white-space:pre-wrap;word-break:break-word;font-size:12px}',
      '.mf-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;margin:8px 0}',
      '.mf-meta-row{display:flex;flex-direction:column;min-width:0}',
      '.mf-meta dt{color:var(--mf-muted);font-size:11px}',
      '.mf-meta dd{margin:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mf-history-title{margin:14px 0 6px;font-size:12px;font-weight:600}',
      '.mf-history-list{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto}',
      '.mf-history-row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;border:1px solid var(--mf-border);border-radius:7px;padding:7px 9px;background:var(--mf-bg)}',
      '.mf-history-text{min-width:0}',
      '.mf-history-content{font-size:12px;color:var(--mf-muted);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}',
      '.mf-pad{padding:8px}',
      '.mf-panel{display:flex;flex-direction:column;gap:10px;padding-bottom:70px}',
      '.mf-panel h3{margin:8px 0 0;font-size:14px}',
      '.mf-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
      '.mf-stat{padding:10px 12px}',
      '.mf-stat-value{font-size:16px;font-weight:600;line-height:24px;margin-top:2px}',
      '.mf-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.mf-table th{text-align:left;color:var(--mf-muted);font-weight:500;border-bottom:1px solid var(--mf-border);padding:5px 6px}',
      '.mf-table td{padding:5px 6px;border-bottom:1px solid var(--mf-border);vertical-align:top}',
      '.mf-table code{font-size:11px}',
      '.mf-runs{display:flex;flex-direction:column;gap:5px}',
      '.mf-run{border:1px solid var(--mf-border);border-radius:7px;background:var(--mf-layer);overflow:hidden}',
      '.mf-run-head{appearance:none;border:0;background:transparent;width:100%;display:flex;align-items:center;gap:10px;padding:7px 9px;color:var(--mf-text);font:inherit;font-size:12px;cursor:pointer;text-align:left}',
      '.mf-run-body{padding:7px 10px 9px;border-top:1px solid var(--mf-border);background:var(--mf-bg);display:flex;flex-direction:column;gap:4px}',
      '.mf-run-time{min-width:120px}',
      '.mf-status{border-radius:999px;padding:1px 7px;font-size:10px;line-height:16px;background:var(--mf-layer2);color:var(--mf-muted)}',
      '.mf-status-ok{background:color-mix(in srgb,var(--mf-ok) 15%,transparent);color:var(--mf-ok)}',
      '.mf-status-failed{background:color-mix(in srgb,var(--mf-danger) 14%,transparent);color:var(--mf-danger)}',
      '.mf-status-empty{background:var(--mf-layer2);color:var(--mf-muted)}',
      '.mf-param-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}',
      '.mf-param{border:1px solid var(--mf-border);border-radius:8px;padding:10px 12px;background:var(--mf-layer);display:flex;flex-direction:column;gap:5px}',
      '.mf-param-changed{border-color:var(--mf-brand)}',
      '.mf-param-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}',
      '.mf-param-head label{font-size:12px;font-weight:600;flex:1;min-width:120px}',
      '.mf-param .mf-input{width:100%}',
      '.mf-switch{appearance:none;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--mf-border2);background:var(--mf-bg);border-radius:999px;padding:3px 8px 3px 4px;color:var(--mf-muted);font:inherit;font-size:11px;cursor:pointer;width:max-content}',
      '.mf-switch-knob{width:14px;height:14px;border-radius:50%;background:var(--mf-muted);display:inline-block}',
      '.mf-switch-on{border-color:var(--mf-brand);color:var(--mf-brand)}',
      '.mf-switch-on .mf-switch-knob{background:var(--mf-brand)}',
      '.mf-sticky-actions{position:sticky;bottom:0;background:linear-gradient(transparent,var(--mf-bg) 35%);padding:10px 0 4px}',
      '.mf-locked{display:flex;flex-direction:column;gap:6px}',
      '.mf-locked-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border:1px solid var(--mf-border);border-radius:7px;padding:7px 10px;background:var(--mf-layer)}',
      '.mf-locked-value{font-size:11px;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mf-muted)}',
      '.mf-diff{margin:6px 0;padding-left:18px;font-size:12px;line-height:20px}',
      '.mf-overlay{position:fixed;inset:0;background:rgba(20,24,32,.38);display:flex;align-items:center;justify-content:center;z-index:1000;padding:24px}',
      '.mf-modal{background:var(--mf-bg);border:1px solid var(--mf-border);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.22);width:min(520px,100%);max-height:86vh;display:flex;flex-direction:column}',
      '.mf-modal-wide{width:min(680px,100%)}',
      '.mf-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--mf-border)}',
      '.mf-modal-head h3{margin:0;font-size:14px}',
      '.mf-modal-body{padding:14px 16px;overflow:auto}',
      '.mf-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}',
      '.mf-field>span:first-child{font-size:12px;font-weight:600}',
      '.mf-textarea{width:100%;resize:vertical;border:1px solid var(--mf-border2);border-radius:7px;background:var(--mf-bg);color:var(--mf-text);padding:8px 9px;font:inherit;font-size:12px;line-height:19px}',
      '.mf-textarea:focus{outline:2px solid color-mix(in srgb,var(--mf-brand) 35%,transparent);outline-offset:1px}',
      '.mf-notice{display:flex;align-items:center;justify-content:space-between;gap:8px;border-radius:7px;padding:7px 10px;margin:8px 22px 0;font-size:12px}',
      '.mf-notice-ok{background:color-mix(in srgb,var(--mf-ok) 12%,transparent);color:var(--mf-ok)}',
      '.mf-notice-error{background:color-mix(in srgb,var(--mf-danger) 12%,transparent);color:var(--mf-danger)}',
      '.mf-notice-warn{background:color-mix(in srgb,var(--mf-warn) 14%,transparent);color:var(--mf-warn);margin:8px 0}',
      '.mf-confirm{border-top:1px solid var(--mf-border);margin-top:10px;padding-top:8px}',
      '.mf-center{align-items:center;justify-content:center;min-height:280px;gap:8px}',
      '.mf-spinner{width:22px;height:22px;border:2px solid var(--mf-border2);border-top-color:var(--mf-brand);border-radius:50%;animation:mf-spin .8s linear infinite}',
      '@keyframes mf-spin{to{transform:rotate(360deg)}}',
      '@media (max-width:760px){.mf-columns{grid-template-columns:1fr}.mf-cards,.mf-param-grid{grid-template-columns:1fr}.mf-meta{grid-template-columns:1fr}}'
    ].join('\n')

    // ---------------------------------------------------------------------
    // Mount
    // ---------------------------------------------------------------------

    exports.inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { en: en, zh: zh }) }, 'dsh-memory-scoped: locale')
      ctx.effect(function () {
        var style = document.createElement('style')
        style.id = 'dsh-memory-scoped-console-style'
        style.textContent = CSS
        document.head.appendChild(style)
        return function () { style.remove() }
      }, 'dsh-memory-scoped: styles')
      var t = ctx.locale.bind(NS)
      ctx.effect(function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'scoped-memory',
            order: 60,
            label: function () { return t('nav') },
            locale: NS
          }, MemorySection)
        })
      }, 'dsh-memory-scoped: settings section')
    }

    exports.apply = apply
    return module.exports
  }
})
