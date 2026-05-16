import * as React from "react";
import { Menu, Notice } from "obsidian";
import type { Habit } from "../../schema/types";
import { HABIT_FREQUENCY_LABEL, HABIT_STATE_LABEL } from "../../schema/types";
import { usePlugin } from "../context";
import { selectLogList } from "../../index/store";
import { Icon } from "./Icon";
import { ConfirmModal } from "./ConfirmModal";
import { completionCounts, computeStreak } from "../../utils/habits";

interface Props {
  habit: Habit;
  compact?: boolean;
}

export const HabitCard: React.FC<Props> = ({ habit, compact }) => {
  const { app, store, habitService } = usePlugin();
  const projects = store((s) => s.projects);
  const logs = store(selectLogList);
  const project = Object.values(projects).find((p) => p.name === habit.project);

  const streak = React.useMemo(
    () => computeStreak(habit, completionCounts(habit, logs), new Date()),
    [habit, logs]
  );
  const cadence = `${habit.target}× ${HABIT_FREQUENCY_LABEL[habit.frequency].toLowerCase()}`;

  const buildAndShowMenu = (x: number, y: number) => {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Open habit")
        .setIcon("external-link")
        .onClick(() => {
          void habitService.openInNewLeaf(habit);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Mark done today")
        .setIcon("check")
        .onClick(() => {
          void habitService.logCompletion(habit, logs).then(() => {
            new Notice(`Marked ${habit.title} done`);
          });
        })
    );
    menu.addSeparator();
    if (habit.state === "paused") {
      menu.addItem((item) =>
        item
          .setTitle("Resume")
          .setIcon("play")
          .onClick(() => {
            void habitService.setState(habit, "active");
          })
      );
    } else if (habit.state === "active") {
      menu.addItem((item) =>
        item
          .setTitle("Pause")
          .setIcon("pause")
          .onClick(() => {
            void habitService.setState(habit, "paused");
          })
      );
    }
    if (habit.archived) {
      menu.addItem((item) =>
        item
          .setTitle("Unarchive")
          .setIcon("archive-restore")
          .onClick(() => {
            void habitService.unarchive(habit);
          })
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle("Archive")
          .setIcon("archive")
          .onClick(() => {
            void habitService.archive(habit);
          })
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Delete habit…")
        .setIcon("trash")
        .onClick(() => {
          new ConfirmModal(
            app,
            "Delete habit",
            `Permanently delete "${habit.title}"? This moves the file to the system or vault trash.`,
            async () => {
              try {
                await habitService.deleteHabit(habit);
                new Notice(`Deleted "${habit.title}"`);
              } catch (err) {
                console.error(err);
                new Notice("Failed to delete habit — see console");
              }
            }
          ).open();
        })
    );
    menu.showAtPosition({ x, y });
  };

  const onClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-open]")) return;
    const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
    void habitService.openInNewLeaf(habit, overrideMode);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    buildAndShowMenu(e.clientX, e.clientY);
  };

  const accent = project?.color ?? "var(--background-modifier-border)";
  const cardStyle: React.CSSProperties = {
    ["--kp-card-stripe" as string]: accent,
    ["--kp-card-border" as string]: accent,
  };

  return (
    <div
      data-habit-path={habit.path}
      className={`kp-card kp-habit-card ${compact ? "kp-card--compact" : ""} ${
        habit.state === "paused" ? "is-paused" : ""
      }`}
      style={cardStyle}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div className="kp-card__head">
        <div className="kp-card__title">
          {habit.code && <span className="kp-code">{habit.code}</span>}
          {habit.title}
        </div>
        <span className="kp-chip kp-chip--frequency">
          <Icon name="repeat" size={11} />
          <span className="kp-chip__label">{cadence}</span>
        </span>
      </div>
      {habit.goal && !compact && <div className="kp-card__excerpt">{habit.goal}</div>}
      <div className="kp-card__meta">
        <span className="kp-chip kp-habit-card__streak" title="Current streak">
          <Icon name="flame" size={11} />
          <span className="kp-chip__label">{streak.current}</span>
        </span>
        {habit.state !== "active" && (
          <span className="kp-chip">
            <span className="kp-chip__label">{HABIT_STATE_LABEL[habit.state]}</span>
          </span>
        )}
        {habit.milestone && (
          <span className="kp-chip kp-chip--milestone">
            <Icon name="flag" size={11} />
            <span className="kp-chip__label">{habit.milestone}</span>
          </span>
        )}
        {habit.tags.slice(0, compact ? 1 : 3).map((tag) => (
          <span key={tag} className="kp-chip kp-chip--tag">
            <span className="kp-chip__label">#{tag}</span>
          </span>
        ))}
      </div>
    </div>
  );
};
