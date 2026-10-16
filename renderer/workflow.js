(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SlateWorkflow = factory();
}(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  const STATUSES = new Set(['active', 'waiting', 'followup']);
  const ESTIMATES = new Set([0, 30, 45, 60]);
  const PLAN_KINDS = new Set(['day', 'week', 'later']);

  function dateKey(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function validDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return dateKey(date) === value ? value : '';
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function keyDate(value) {
    const key = validDateKey(value);
    if (!key) return new Date(NaN);
    const [year, month, day] = key.split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function weekKey(value = new Date()) {
    const date = typeof value === 'string' && validDateKey(value) ? keyDate(value) : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return dateKey(date);
  }

  function timestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return NaN;
    return Date.parse(value);
  }

  function normalizeTodo(todo, now = new Date()) {
    const item = todo && typeof todo === 'object' ? todo : {};
    const today = dateKey(now);
    const originalFocus = String(item.focusDate || '');
    let focusDate = validDateKey(originalFocus);
    // Migration is persisted by the caller. An expired valid date never becomes today's focus.
    if (!originalFocus && item.pinnedToday === true) focusDate = today;
    const followupTime = timestamp(item.followupAt);
    const completedAt = item.done === true ? positiveNumber(item.completedAt) : 0;
    let planKind = PLAN_KINDS.has(item.planKind) ? item.planKind : 'later';
    let planDate = planKind === 'day' ? validDateKey(item.planDate) : '';
    let planWeek = planKind === 'week' ? weekKey(validDateKey(item.planWeek)) : '';
    // New records have an explicit plan, even when it is "later". Pinning one of
    // them for today must not silently rewrite its original day/week plan.
    if (!Object.prototype.hasOwnProperty.call(item, 'planKind')) {
      const deadlineTime = timestamp(item.deadline);
      planDate = focusDate
        || (Number.isFinite(deadlineTime) ? dateKey(deadlineTime) : '')
        || (Number.isFinite(followupTime) ? dateKey(followupTime) : '')
        || (completedAt > 0 ? dateKey(completedAt) : '');
      planKind = planDate ? 'day' : 'later';
    }
    if ((planKind === 'day' && !planDate) || (planKind === 'week' && !planWeek)) planKind = 'later';
    if (planKind !== 'day') planDate = '';
    if (planKind !== 'week') planWeek = '';
    const estimate = Number(item.estimateMinutes);
    let notes = String(item.notes || '').slice(0, 6000);
    // Do not leave an emoji cut in half at the text limit.
    if (notes.length && /[\uD800-\uDBFF]/.test(notes[notes.length - 1])) notes = notes.slice(0, -1);
    return {
      ...item,
      status: STATUSES.has(item.status) ? item.status : 'active',
      followupAt: Number.isFinite(followupTime) ? new Date(followupTime).toISOString() : '',
      followupRemindedAt: positiveNumber(item.followupRemindedAt),
      focusDate,
      focusOrder: Math.floor(positiveNumber(item.focusOrder)),
      pinnedToday: item.done !== true && Boolean(today && focusDate === today),
      completedAt,
      planKind,
      planDate,
      planWeek,
      // Migration never invents when an older task was added to its plan.
      planAddedAt: positiveNumber(item.planAddedAt),
      notes,
      estimateMinutes: ESTIMATES.has(estimate) ? estimate : 0,
    };
  }

  function setPlan(todo, kind, now = new Date(), selectedDate = '') {
    if (!PLAN_KINDS.has(kind)) throw new TypeError('任务安排无效');
    const currentTime = new Date(now).getTime();
    if (!Number.isFinite(currentTime)) throw new TypeError('任务安排日期无效');
    if (selectedDate && !validDateKey(selectedDate)) throw new TypeError('任务安排日期无效');
    const item = normalizeTodo(todo, now);
    const planDate = kind === 'day' ? (selectedDate || dateKey(now)) : '';
    const planWeek = kind === 'week' ? weekKey(selectedDate || now) : '';
    // A focus for another day is stale; moving an item away from today's plan
    // must also remove its current focus, otherwise it would stay in Today.
    const keepFocus = kind === 'day' && planDate === dateKey(now) && item.focusDate === dateKey(now);
    return {
      ...item,
      planKind: kind,
      planDate,
      planWeek,
      planAddedAt: positiveNumber(currentTime),
      focusDate: keepFocus ? item.focusDate : '',
      focusOrder: keepFocus ? item.focusOrder : 0,
      pinnedToday: item.done !== true && keepFocus,
    };
  }

  function isInPeriod(todo, period = 'day', now = new Date()) {
    if (!todo || !PLAN_KINDS.has(period)) return false;
    const item = normalizeTodo(todo, now);
    const today = dateKey(now);
    if (!today) return false;
    if (period === 'later') {
      const nextWeek = dateKey(reviewRange('week', now).end);
      return item.planKind === 'later'
        || (item.planKind === 'day' && item.planDate >= nextWeek)
        || (item.planKind === 'week' && item.planWeek >= nextWeek);
    }
    const range = reviewRange(period, now);
    const firstKey = dateKey(range.start);
    const endKey = dateKey(range.end);
    const focusInPeriod = Boolean(item.focusDate && item.focusDate >= firstKey && item.focusDate < endKey);
    const dayInPeriod = item.planKind === 'day' && item.planDate >= firstKey && item.planDate < endKey;
    const weekInPeriod = period === 'week' && item.planKind === 'week' && item.planWeek === firstKey;
    // Carry unfinished plans forward until the user completes or reschedules
    // them. Completed work stays with its original plan, not every future day.
    const unfinishedPastPlan = item.done !== true && (
      (item.planKind === 'day' && item.planDate < firstKey)
      || (item.planKind === 'week' && item.planWeek < weekKey(now))
    );
    return focusInPeriod || dayInPeriod || weekInPeriod || unfinishedPastPlan;
  }

  function periodStats(items, period = 'day', now = new Date()) {
    const stats = { total: 0, completed: 0, pending: 0, waiting: 0, followup: 0, overdue: 0, added: 0 };
    if (!PLAN_KINDS.has(period) || !dateKey(now)) return stats;
    const currentTime = new Date(now).getTime();
    const range = period === 'later' ? null : reviewRange(period, now);
    const today = dateKey(now);
    const currentWeek = weekKey(now);
    for (const source of Array.isArray(items) ? items : []) {
      const item = normalizeTodo(source, now);
      if (!isInPeriod(item, period, now)) continue;
      stats.total += 1;
      if (item.done === true) stats.completed += 1;
      else {
        stats.pending += 1;
        if (item.status === 'waiting') stats.waiting += 1;
        if (item.status === 'followup') stats.followup += 1;
        const deadlineTime = timestamp(item.deadline);
        const followupTime = timestamp(item.followupAt);
        if ((item.planKind === 'day' && item.planDate < today)
          || (item.planKind === 'week' && item.planWeek < currentWeek)
          || (Number.isFinite(deadlineTime) && deadlineTime < currentTime)
          || (Number.isFinite(followupTime) && followupTime < currentTime)) stats.overdue += 1;
      }
      if (range && item.planAddedAt >= range.start.getTime()
        && item.planAddedAt < range.end.getTime() && item.planAddedAt <= currentTime) stats.added += 1;
    }
    return stats;
  }

  function isFocus(todo, now = new Date()) {
    const today = dateKey(now);
    return Boolean(todo && todo.done !== true && today && validDateKey(todo.focusDate) === today);
  }

  function setFocus(todo, on, now = new Date(), order = 0) {
    const item = normalizeTodo(todo, now);
    const focusDate = on ? dateKey(now) : '';
    return {
      ...item,
      focusDate,
      focusOrder: on ? Math.floor(positiveNumber(order)) : 0,
      pinnedToday: item.done !== true && Boolean(focusDate),
    };
  }

  function completeTodo(todo, on, now = new Date()) {
    const item = normalizeTodo(todo, now);
    const done = on === true;
    const completedAt = done
      ? (item.done === true ? item.completedAt : positiveNumber(new Date(now).getTime()))
      : 0;
    return {
      ...item,
      done,
      completedAt,
      pinnedToday: !done && Boolean(item.focusDate && item.focusDate === dateKey(now)),
    };
  }

  function sortTasks(items, now = new Date()) {
    return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
      const leftFocus = isFocus(left, now);
      const rightFocus = isFocus(right, now);
      if (leftFocus !== rightFocus) return leftFocus ? -1 : 1;
      if (leftFocus && rightFocus) {
        const focusDifference = positiveNumber(left.focusOrder) - positiveNumber(right.focusOrder);
        if (focusDifference) return focusDifference;
      }
      const doneDifference = Number(left?.done === true) - Number(right?.done === true);
      if (doneDifference) return doneDifference;
      const leftDeadline = timestamp(left?.deadline);
      const rightDeadline = timestamp(right?.deadline);
      const safeLeftDeadline = Number.isFinite(leftDeadline) ? leftDeadline : Infinity;
      const safeRightDeadline = Number.isFinite(rightDeadline) ? rightDeadline : Infinity;
      if (safeLeftDeadline !== safeRightDeadline) return safeLeftDeadline - safeRightDeadline;
      const leftCreatedAt = Number(left?.createdAt);
      const rightCreatedAt = Number(right?.createdAt);
      const safeLeftCreatedAt = Number.isFinite(leftCreatedAt) ? leftCreatedAt : Infinity;
      const safeRightCreatedAt = Number.isFinite(rightCreatedAt) ? rightCreatedAt : Infinity;
      if (safeLeftCreatedAt !== safeRightCreatedAt) return safeLeftCreatedAt - safeRightCreatedAt;
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    });
  }

  function focusTasks(items, now = new Date()) {
    return sortTasks((Array.isArray(items) ? items : []).filter(item => isFocus(item, now)), now);
  }

  function reviewRange(period, now) {
    const start = new Date(now);
    if (!Number.isFinite(start.getTime())) throw new TypeError('复盘日期无效');
    start.setHours(0, 0, 0, 0);
    if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + (period === 'week' ? 7 : 1));
    return { start, end };
  }

  function markdownText(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
  }

  function taskLine(item, range) {
    const details = [];
    if (item.estimateMinutes) details.push(`预计 ${item.estimateMinutes} 分钟`);
    const deadlineTime = timestamp(item.deadline);
    if (Number.isFinite(deadlineTime)) {
      details.push(`截止 ${dateKey(deadlineTime)}${deadlineTime < range.start.getTime() ? '（逾期）' : ''}`);
    }
    const followupTime = timestamp(item.followupAt);
    if (Number.isFinite(followupTime)) {
      details.push(`跟进 ${dateKey(followupTime)}${followupTime < range.start.getTime() ? '（逾期）' : ''}`);
    }
    let line = `- [${item.done === true ? 'x' : ' '}] ${markdownText(item.text || '未命名任务')}`;
    if (details.length) line += `（${details.join('；')}）`;
    if (item.notes) line += `\n  记录：${markdownText(item.notes)}`;
    return line;
  }

  function makeReview(items, period = 'day', now = new Date()) {
    const kind = period === 'week' ? 'week' : 'day';
    const range = reviewRange(kind, now);
    const startTime = range.start.getTime();
    const endTime = range.end.getTime();
    const lastDay = new Date(range.end);
    lastDay.setDate(lastDay.getDate() - 1);
    const firstKey = dateKey(range.start);
    const lastKey = dateKey(lastDay);
    const sourceItems = Array.isArray(items) ? items : [];
    const normalized = sourceItems.map(item => normalizeTodo(item, now));
    const completed = normalized.filter(item => item.done === true && item.completedAt > 0 && item.completedAt >= startTime && item.completedAt < endTime);
    const relevant = normalized.filter((item, index) => {
      if (item.done === true) return false;
      // Explicit day/week plans now participate in the review. Keep older
      // unpersisted input compatible until the caller saves its migration.
      if (Object.prototype.hasOwnProperty.call(sourceItems[index] || {}, 'planKind') && isInPeriod(item, kind, now)) return true;
      const focusDate = validDateKey(item.focusDate);
      if (focusDate && focusDate >= firstKey && focusDate <= lastKey) return true;
      // A missed deadline/follow-up still needs attention; future weeks do not enter this review.
      const deadlineTime = timestamp(item.deadline);
      const followupTime = timestamp(item.followupAt);
      return (Number.isFinite(deadlineTime) && deadlineTime < endTime)
        || (Number.isFinite(followupTime) && followupTime < endTime);
    });
    const unknownCompleted = normalized.filter(item => item.done === true && item.completedAt === 0).length;
    const title = kind === 'week' ? '每周复盘' : '每日复盘';
    const cycle = kind === 'week' ? `${firstKey} 至 ${lastKey}（周一至周日）` : firstKey;
    const lines = [`# ${title} · ${kind === 'week' ? `${firstKey} 至 ${lastKey}` : firstKey}`, '', `记录周期：${cycle}`, '', '## 已完成', ''];
    if (completed.length) {
      completed.sort((left, right) => left.completedAt - right.completedAt);
      lines.push(...completed.map(item => taskLine(item, range)));
    } else lines.push('- 本周期暂无已记录完成时间的事项。');
    if (unknownCompleted) {
      lines.push('', `历史记录说明：另有 ${unknownCompleted} 条已完成事项未记录完成时间，未计入本周期成果。`);
    }
    [['active', '待处理'], ['waiting', '等待反馈'], ['followup', '持续跟进']].forEach(([status, label]) => {
      lines.push('', `## ${label}`, '');
      const section = sortTasks(relevant.filter(item => item.status === status), now);
      if (section.length) lines.push(...section.map(item => taskLine(item, range)));
      else lines.push('- 暂无本周期需要处理的事项。');
    });
    lines.push('', '## 阻滞原因与下一步', '', '- 阻滞原因：', '- 下一步：', '', `## ${kind === 'week' ? '下周计划' : '次日计划'}`, '', '- [ ] ', '');
    return lines.join('\n');
  }

  return { dateKey, weekKey, normalizeTodo, setPlan, isInPeriod, periodStats, isFocus, setFocus, completeTodo, sortTasks, focusTasks, makeReview };
}));
