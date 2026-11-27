/**
 * 短期记忆活跃度排序与容量淘汰选择（v2.0）。
 *
 * 规则（对应架构要求）：
 * - 主排序：最后一次有效引用 / 实质性内容更新时间的指数衰减；
 * - 辅助：有效引用频率（对数压缩）与重要度，只能在小范围内打破接近的排序；
 * - 淘汰：容量溢出时搬走“最不活跃”的条目，而不是最旧的条目；
 *   最近活跃过的条目与重要度为 3 的记忆受保护窗口保护。
 *
 * 纯函数，无 IO，无 DSH 依赖。
 * @module dsh-memory-feiyu/activity
 */

const DAY_MS = 86_400_000;

/** 解析时间为毫秒；无效返回 0。 */
export function parseMs(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 计算单条记忆的活跃度。
 * @param {object} entry 原始记忆
 * @param {{lastHitAt?:string, contentUpdatedAt?:string, hits?:number}|undefined} usageRecord
 * @param {{now?:number|Date, halfLifeDays?:number}} [options]
 * @returns {{score:number, lastActiveAt:string, hits:number, importance:number, decay:number, ageDays:number}}
 */
export function activityOf(entry, usageRecord, options = {}) {
  const nowMs = parseMs(options.now ?? Date.now()) || Date.now();
  const halfLifeDays = Math.max(0.5, Number(options.halfLifeDays) || 30);
  const hitMs = parseMs(usageRecord?.lastHitAt);
  const updatedMs = parseMs(usageRecord?.contentUpdatedAt)
    || parseMs(entry?.updatedAt)
    || parseMs(entry?.createdAt);
  const lastMs = Math.max(hitMs, updatedMs);
  const ageDays = lastMs > 0 ? Math.max(0, (nowMs - lastMs) / DAY_MS) : 3650;
  const decay = Math.pow(0.5, ageDays / halfLifeDays);
  const hits = Math.max(0, Number(usageRecord?.hits) || 0);
  const importance = Math.max(0, Math.min(3, Number(entry?.importance ?? 1) || 0));
  // 主项权重 1000，辅助项合计上限 92：频繁引用与重要度只能在接近的衰减区间内打破平局。
  const score = decay * 1000 + Math.min(Math.log1p(hits) * 8, 80) + importance * 4;
  return {
    score: Math.round(score * 1000) / 1000,
    lastActiveAt: lastMs > 0 ? new Date(lastMs).toISOString() : '',
    hits,
    importance,
    decay: Math.round(decay * 10000) / 10000,
    ageDays: Math.round(ageDays * 100) / 100,
  };
}

/**
 * 按活跃度降序排列，返回带 activity 字段的新数组。
 * @param {Array<object>} entries
 * @param {Record<string, object>|Map<string, object>} usageMap
 * @param {{now?:number|Date, halfLifeDays?:number}} [options]
 */
export function rankByActivity(entries, usageMap, options = {}) {
  const lookup = (id) => {
    if (!usageMap) return undefined;
    if (typeof usageMap.get === 'function') return usageMap.get(id);
    return usageMap[id];
  };
  return [...(entries ?? [])]
    .map((entry) => ({ ...entry, activity: activityOf(entry, lookup(entry.id), options) }))
    .sort((a, b) => {
      if (b.activity.score !== a.activity.score) return b.activity.score - a.activity.score;
      const aTime = parseMs(a.activity.lastActiveAt);
      const bTime = parseMs(b.activity.lastActiveAt);
      if (aTime !== bTime) return bTime - aTime;
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      return 0;
    });
}

/**
 * 选出应搬进冷库的条目（最不活跃优先）。
 *
 * @param {Array<object>} entries 当前活动条目
 * @param {Record<string, object>|Map<string, object>} usageMap
 * @param {{now?:number|Date, halfLifeDays?:number, graceHours?:number, count:number, keepNewest?:number}} options
 * @returns {Array<object>} 选中的条目（按淘汰顺序）
 */
export function selectArchiveCandidates(entries, usageMap, options = {}) {
  const count = Math.max(0, Math.floor(Number(options.count) || 0));
  if (count === 0) return [];
  const nowMs = parseMs(options.now ?? Date.now()) || Date.now();
  const graceMs = Math.max(0, Number(options.graceHours ?? 24)) * 3_600_000;
  // 显式排除集合：例如刚被用户恢复的条目，容量约束不应该立刻把它又搬走。
  const protectedIds = new Set(options.protectIds ?? []);
  // 调用方已显式保护某条时，不再额外保留"最新一条"——否则容量约束可能无法收敛。
  const keepNewest = protectedIds.size > 0 ? 0 : Math.max(1, Math.floor(Number(options.keepNewest ?? 1)));
  const ranked = rankByActivity(entries, usageMap, { now: nowMs, halfLifeDays: options.halfLifeDays })
    .filter((item) => !protectedIds.has(item.id));

  const isProtected = (item) => {
    if (item.activity.importance >= 3) return true;
    const last = parseMs(item.activity.lastActiveAt);
    return graceMs > 0 && last > 0 && nowMs - last < graceMs;
  };

  const free = ranked.filter((item) => !isProtected(item));
  const frozen = ranked.filter((item) => isProtected(item));

  // 完全不活跃的条目按活跃度升序；同样活跃时更旧的先走。
  free.sort((a, b) => {
    if (a.activity.score !== b.activity.score) return a.activity.score - b.activity.score;
    const aTime = parseMs(a.activity.lastActiveAt);
    const bTime = parseMs(b.activity.lastActiveAt);
    if (aTime !== bTime) return aTime - bTime;
    return a.id < b.id ? -1 : 1;
  });

  const selected = free.slice(0, count);
  if (selected.length >= count) return selected;

  // 受保护条目也放不下时（严重超容），才动它们，但永远保留最新创建的那条。
  const byCreatedAsc = [...frozen].sort((a, b) => {
    const aTime = parseMs(a.createdAt);
    const bTime = parseMs(b.createdAt);
    if (aTime !== bTime) return aTime - bTime;
    return a.id < b.id ? -1 : 1;
  });
  const evictable = byCreatedAsc.slice(0, Math.max(0, byCreatedAsc.length - keepNewest));
  evictable.sort((a, b) => {
    if (a.activity.score !== b.activity.score) return a.activity.score - b.activity.score;
    return parseMs(a.activity.lastActiveAt) - parseMs(b.activity.lastActiveAt);
  });
  for (const item of evictable) {
    if (selected.length >= count) break;
    selected.push(item);
  }
  return selected;
}

/** 供 UI 使用的活跃度标签。 */
export function describeActivity(activity) {
  if (!activity) return '';
  const days = activity.ageDays;
  const ago = days < 1 ? '今天' : days < 2 ? '昨天' : `${Math.floor(days)} 天前`;
  return `活跃度 ${activity.score.toFixed(0)} · 命中 ${activity.hits} · ${ago}`;
}
