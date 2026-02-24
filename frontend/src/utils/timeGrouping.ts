export interface TimeGroup {
  key: string;
  label: string | null; // null => recent (no label needed)
  startTime: number; // milliseconds ago (inclusive)
  endTime: number; // milliseconds ago (exclusive)
}

/**
 * Gets the appropriate time group for a given timestamp.
 * Simplified categories: today (no label), yesterday, a few days ago, a week ago,
 * a few weeks ago, a month ago, a few months ago, a year ago, a few years ago
 */
export function getTimeGroup(createdAt: string): TimeGroup {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const msAgo = Math.max(0, now - created);

  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const monthMs = Math.round(30.5 * dayMs);
  const yearMs = Math.round(365.25 * dayMs);

  const daysAgo = msAgo / dayMs;

  // Less than 1 day: no label (recent)
  if (daysAgo < 1) {
    return {
      key: "today",
      label: null,
      startTime: 0,
      endTime: dayMs,
    };
  }

  // 1-2 days: "yesterday"
  if (daysAgo < 2) {
    return {
      key: "yesterday",
      label: "yesterday",
      startTime: dayMs,
      endTime: 2 * dayMs,
    };
  }

  // 2-7 days: "a few days ago"
  if (daysAgo < 7) {
    return {
      key: "few-days-ago",
      label: "a few days ago",
      startTime: 2 * dayMs,
      endTime: weekMs,
    };
  }

  // 7-14 days: "a week ago"
  if (daysAgo < 14) {
    return {
      key: "week-ago",
      label: "a week ago",
      startTime: weekMs,
      endTime: 2 * weekMs,
    };
  }

  // 14 days - 1 month: "a few weeks ago"
  if (daysAgo < 30) {
    return {
      key: "few-weeks-ago",
      label: "a few weeks ago",
      startTime: 2 * weekMs,
      endTime: monthMs,
    };
  }

  // 1-2 months: "a month ago"
  const monthsAgo = msAgo / monthMs;
  if (monthsAgo < 2) {
    return {
      key: "month-ago",
      label: "a month ago",
      startTime: monthMs,
      endTime: 2 * monthMs,
    };
  }

  // 2-12 months: "a few months ago"
  if (monthsAgo < 12) {
    return {
      key: "few-months-ago",
      label: "a few months ago",
      startTime: 2 * monthMs,
      endTime: yearMs,
    };
  }

  // 1-2 years: "a year ago"
  const yearsAgo = msAgo / yearMs;
  if (yearsAgo < 2) {
    return {
      key: "year-ago",
      label: "a year ago",
      startTime: yearMs,
      endTime: 2 * yearMs,
    };
  }

  // 2+ years: "a few years ago"
  return {
    key: "few-years-ago",
    label: "a few years ago",
    startTime: 2 * yearMs,
    endTime: Infinity,
  };
}

/**
 * Groups agents by last activity (lastPromptAt) or creation (createdAt)
 * using simplified time categories.
 */
export function groupAgentsByTime<
  T extends { createdAt?: Date | string | null; lastPromptAt?: Date | string | null }
>(agents: T[]): Array<{ group: TimeGroup; agents: T[] }> {
  const groupMap = new Map<string, { group: TimeGroup; agents: T[] }>();

  for (const agent of agents) {
    const raw = agent.lastPromptAt || agent.createdAt;
    if (!raw) continue;

    const iso = raw instanceof Date ? raw.toISOString() : raw;
    const group = getTimeGroup(iso);

    const existing = groupMap.get(group.key);
    if (existing) {
      existing.group.startTime = Math.min(existing.group.startTime, group.startTime);
      existing.group.endTime = Math.max(existing.group.endTime, group.endTime);
      existing.agents.push(agent);
    } else {
      groupMap.set(group.key, { group, agents: [agent] });
    }
  }

  // Sort agents within each group by lastPromptAt desc (most recent first)
  const getTime = (a: T) => {
    const raw = a.lastPromptAt || a.createdAt;
    if (!raw) return 0;
    return raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  };
  for (const entry of groupMap.values()) {
    entry.agents.sort((a, b) => getTime(b) - getTime(a));
  }

  // Sort groups by start time (ascending = most recent first)
  return Array.from(groupMap.values()).sort(
    (a, b) => a.group.startTime - b.group.startTime
  );
}
