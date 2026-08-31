// 分类匹配约束：一个网页可关联多个一级目标，但每个一级目标最多保留一条具体路径。

import type { BrowseRecord, MatchEntry } from "../types.js";

function isMoreSpecific(match: MatchEntry): number {
  if (match.subtaskId) return 2;
  if (match.taskId) return 1;
  return 0;
}

function shouldReplace(current: MatchEntry, candidate: MatchEntry): boolean {
  const currentHasTask = !!current.taskId;
  const candidateHasTask = !!candidate.taskId;
  if (currentHasTask !== candidateHasTask) return candidateHasTask;
  if (candidate.relevance !== current.relevance) return candidate.relevance > current.relevance;
  return isMoreSpecific(candidate) > isMoreSpecific(current);
}

export function normalizeMatches(matches: readonly MatchEntry[]): MatchEntry[] {
  const byGoal = new Map<string, MatchEntry>();
  for (const match of matches) {
    if (!match || typeof match.goalId !== "string" || !match.goalId) continue;
    const current = byGoal.get(match.goalId);
    if (!current || shouldReplace(current, match)) byGoal.set(match.goalId, match);
  }
  return [...byGoal.values()].sort((a, b) => b.relevance - a.relevance);
}

export function syncRecordPrimaryMatch(record: BrowseRecord): void {
  const matches = normalizeMatches(record.matches || []);
  record.matches = matches;
  const main = matches[0];
  if (!main) return;
  record.category = "goal:" + main.goalId;
  record.relevance = main.relevance;
  record.findings = main.findings;
  record.notes = main.notes;
}
