import { App, normalizePath, TFile } from "obsidian";
import {
  todayISO,
  toWikilink,
  updateFrontmatter,
} from "../schema/frontmatter";
import type { ProjectService } from "./projectService";
import type { LogService } from "./logService";
import type { Habit, HabitFrequency, HabitState, Log } from "../schema/types";
import { openOrFocusFile, OpenMode, SidebarLeafCache } from "../utils/openFile";
import { periodKeyFromISO } from "../utils/habits";

export interface CreateHabitInput {
  title: string;
  project: string;
  frequency: HabitFrequency;
  target?: number;
  goal?: string;
  milestone?: string;
  tags?: string[];
  body?: string;
}

export class HabitService {
  constructor(
    private app: App,
    private projects: ProjectService,
    private logs: LogService,
    private getOpenMode: () => OpenMode = () => "sidebar",
    private sidebarCache?: SidebarLeafCache,
    private allocateCode: () => Promise<string | undefined> = () => Promise.resolve(undefined)
  ) {}

  habitFolder(projectName: string): string {
    return normalizePath(`${this.projects.projectFolder(projectName)}/habits`);
  }

  archiveFolder(projectName: string): string {
    return normalizePath(`${this.projects.projectFolder(projectName)}/archive`);
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|#^[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  private uniquePath(folder: string, base: string): string {
    const safe = this.sanitizeFileName(base) || "Habit";
    let candidate = normalizePath(`${folder}/${safe}.md`);
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = normalizePath(`${folder}/${safe} ${n}.md`);
      n++;
    }
    return candidate;
  }

  async createHabit(input: CreateHabitInput): Promise<TFile> {
    const projectName = input.project.trim();
    if (!projectName) throw new Error("Project required for habit");
    await this.projects.createProject(projectName);
    const folder = this.habitFolder(projectName);
    await this.projects.ensureFolder(folder);

    const path = this.uniquePath(folder, input.title);
    const code = await this.allocateCode();
    const target = Math.max(1, Math.round(input.target ?? 1));
    const fm: string[] = ["---", "kind: habit", `project: "${toWikilink(projectName)}"`];
    if (input.milestone) fm.push(`milestone: "${toWikilink(input.milestone)}"`);
    fm.push(`frequency: ${input.frequency}`);
    fm.push(`target: ${target}`);
    if (input.goal && input.goal.trim()) fm.push(`goal: ${JSON.stringify(input.goal.trim())}`);
    fm.push("state: active");
    if (input.tags && input.tags.length > 0) {
      fm.push(`tags: [${input.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
    }
    fm.push(`created: ${todayISO()}`);
    fm.push("order: 1");
    if (code) fm.push(`code: ${code}`);
    fm.push("---", "");
    if (input.body && input.body.trim()) {
      fm.push(input.body.trim(), "");
    }

    return await this.app.vault.create(path, fm.join("\n"));
  }

  private getFile(habit: Habit): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(habit.path);
    return file instanceof TFile ? file : null;
  }

  async updateField(habit: Habit, key: string, value: unknown): Promise<void> {
    const file = this.getFile(habit);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (value == null || value === "") delete fm[key];
      else fm[key] = value;
    });
  }

  async setFrequency(habit: Habit, frequency: HabitFrequency): Promise<void> {
    await this.updateField(habit, "frequency", frequency);
  }

  async setTarget(habit: Habit, target: number): Promise<void> {
    const v = Math.max(1, Math.round(target));
    await this.updateField(habit, "target", v);
  }

  async setGoal(habit: Habit, goal: string | undefined): Promise<void> {
    await this.updateField(habit, "goal", goal && goal.trim() ? goal.trim() : undefined);
  }

  async setTitle(habit: Habit, title: string): Promise<void> {
    await this.updateField(habit, "title", title);
  }

  async setTags(habit: Habit, tags: string[]): Promise<void> {
    await this.updateField(habit, "tags", tags);
  }

  async setMilestone(habit: Habit, milestone: string | undefined): Promise<void> {
    const file = this.getFile(habit);
    if (!file) return;
    await updateFrontmatter(this.app, file, (fm) => {
      if (!milestone) delete fm["milestone"];
      else fm["milestone"] = toWikilink(milestone);
    });
  }

  async setProject(habit: Habit, projectName: string): Promise<void> {
    const file = this.getFile(habit);
    if (!file) return;
    await this.projects.createProject(projectName);
    const newFolder = this.habitFolder(projectName);
    await this.projects.ensureFolder(newFolder);
    const newPath = normalizePath(`${newFolder}/${file.name}`);
    if (newPath !== file.path) {
      await this.app.fileManager.renameFile(file, newPath);
    }
    const moved = this.app.vault.getAbstractFileByPath(newPath);
    if (moved instanceof TFile) {
      await updateFrontmatter(this.app, moved, (fm) => {
        fm["project"] = toWikilink(projectName);
      });
    }
  }

  async setState(habit: Habit, state: HabitState): Promise<void> {
    if (state === "archived") {
      await this.archive(habit);
      return;
    }
    if (habit.archived) {
      await this.unarchive(habit);
    }
    await this.updateField(habit, "state", state);
  }

  async setOrder(habit: Habit, order: number): Promise<void> {
    await this.updateField(habit, "order", order);
  }

  async archive(habit: Habit): Promise<void> {
    const file = this.getFile(habit);
    if (!file) return;
    const archiveFolder = this.archiveFolder(habit.project);
    await this.projects.ensureFolder(archiveFolder);
    const newPath = normalizePath(`${archiveFolder}/${file.name}`);
    await updateFrontmatter(this.app, file, (fm) => {
      fm["state"] = "archived";
      fm["archived"] = true;
    });
    const refreshed = this.app.vault.getAbstractFileByPath(file.path);
    if (refreshed instanceof TFile) {
      await this.app.fileManager.renameFile(refreshed, newPath);
    }
  }

  async unarchive(habit: Habit): Promise<void> {
    const file = this.getFile(habit);
    if (!file) return;
    const habitFolder = this.habitFolder(habit.project);
    await this.projects.ensureFolder(habitFolder);
    await updateFrontmatter(this.app, file, (fm) => {
      fm["state"] = "active";
      fm["archived"] = false;
    });
    const refreshed = this.app.vault.getAbstractFileByPath(file.path);
    if (refreshed instanceof TFile) {
      const newPath = normalizePath(`${habitFolder}/${file.name}`);
      await this.app.fileManager.renameFile(refreshed, newPath);
    }
  }

  async deleteHabit(habit: Habit): Promise<void> {
    const file = this.getFile(habit);
    if (!file) return;
    await this.app.fileManager.trashFile(file);
  }

  /**
   * Records one completion ("tick") for the habit at the given moment (defaults to now).
   * Always creates a new log — habits with target > 1 expect multiple ticks per period.
   */
  async logCompletion(
    habit: Habit,
    _allLogs: Log[],
    when: Date = new Date()
  ): Promise<TFile | null> {
    void _allLogs;
    const file = await this.logs.createLog(habit.project, {
      timestamp: when,
      tags: ["habit"],
    });
    await updateFrontmatter(this.app, file, (fm) => {
      fm["habit"] = toWikilink(habit.name);
    });
    return file;
  }

  /**
   * Removes the most-recent completion log for this habit. Prefers a log on the
   * same calendar day as `when`; falls back to the most-recent log in the
   * same period (week/month) if the cursor day has none. Logs the search context
   * to the console so failed clicks are diagnosable.
   */
  async removeCompletion(habit: Habit, allLogs: Log[], when: Date): Promise<void> {
    const targetDay = toISO(when).slice(0, 10);
    const targetPeriod = periodKeyFromISO(toISO(when), habit.frequency);
    const habitLogs = allLogs.filter((l) => l.habit === habit.name);
    const sameDay = habitLogs
      .filter((l) => l.timestamp.slice(0, 10) === targetDay)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const samePeriod = habitLogs
      .filter((l) => targetPeriod && periodKeyFromISO(l.timestamp, habit.frequency) === targetPeriod)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const newest = sameDay[0] ?? samePeriod[0];
    if (!newest) {
      console.warn("removeCompletion: no log found for habit", {
        habit: habit.name,
        targetDay,
        targetPeriod,
        habitLogCount: habitLogs.length,
      });
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(newest.path);
    if (!(file instanceof TFile)) {
      throw new Error(`Log file not found at ${newest.path}`);
    }
    await this.app.fileManager.trashFile(file);
  }

  /**
   * Removes every completion log inside the same frequency-period as `when`.
   * Used by the heatmap "clear this period" interaction.
   */
  async clearPeriod(habit: Habit, allLogs: Log[], when: Date): Promise<void> {
    const targetPeriod = periodKeyFromISO(toISO(when), habit.frequency);
    if (!targetPeriod) return;
    const matches = allLogs.filter(
      (l) => l.habit === habit.name && periodKeyFromISO(l.timestamp, habit.frequency) === targetPeriod
    );
    for (const log of matches) {
      const file = this.app.vault.getAbstractFileByPath(log.path);
      if (file instanceof TFile) {
        await this.app.fileManager.trashFile(file);
      }
    }
  }

  async openInNewLeaf(habit: Habit, modeOverride?: OpenMode): Promise<void> {
    const file = this.getFile(habit);
    if (!file) return;
    await openOrFocusFile(
      this.app,
      file,
      modeOverride ?? this.getOpenMode(),
      this.sidebarCache
    );
  }
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:${s}`;
}
