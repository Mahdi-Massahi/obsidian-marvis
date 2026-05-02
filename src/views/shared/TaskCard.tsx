import * as React from "react";
import { Menu, Notice } from "obsidian";
import type { Task } from "../../schema/types";
import { usePlugin } from "../context";
import { parseDate, fmtShort, formatAge } from "../../utils/dates";
import { Icon } from "./Icon";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  task: Task;
  compact?: boolean;
  draggableProps?: React.HTMLAttributes<HTMLDivElement>;
  innerRef?: (el: HTMLDivElement | null) => void;
  style?: React.CSSProperties;
}

export const TaskCard: React.FC<Props> = ({ task, compact, draggableProps, innerRef, style }) => {
  const { app, settings, taskService, store } = usePlugin();
  const projects = store((s) => s.projects);
  const project = task.project ? Object.values(projects).find((p) => p.name === task.project) : undefined;
  const status = settings.statuses.find((s) => s.id === task.status);
  const priority = settings.priorities.find((p) => p.id === task.priority);
  const due = parseDate(task.due);

  const longPressFiredRef = React.useRef(false);
  const longPressTimerRef = React.useRef<number | null>(null);
  const pressStartRef = React.useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pressStartRef.current = null;
  };

  const buildAndShowMenu = (x: number, y: number) => {
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Open task")
        .setIcon("external-link")
        .onClick(() => {
          void taskService.openInNewLeaf(task);
        })
    );
    menu.addItem((item) =>
      item
        .setTitle("Open in new tab")
        .setIcon("plus-square")
        .onClick(() => {
          void taskService.openInNewLeaf(task, "tab");
        })
    );
    menu.addSeparator();
    if (task.archived) {
      menu.addItem((item) =>
        item
          .setTitle("Unarchive")
          .setIcon("archive-restore")
          .onClick(() => {
            void taskService.unarchive(task);
          })
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle("Archive")
          .setIcon("archive")
          .onClick(() => {
            void taskService.archive(task);
          })
      );
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle("Delete task…")
        .setIcon("trash")
        .onClick(() => {
          new ConfirmModal(
            app,
            "Delete task",
            `Permanently delete "${task.title}"? This moves the file to the system or vault trash.`,
            async () => {
              try {
                await taskService.deleteTask(task);
                new Notice(`Deleted "${task.title}"`);
              } catch (err) {
                console.error(err);
                new Notice("Failed to delete task — see console");
              }
            }
          ).open();
        })
    );
    menu.showAtPosition({ x, y });
  };

  const onClick = (e: React.MouseEvent) => {
    if (longPressFiredRef.current) {
      // The long-press already opened the menu — swallow the click that
      // typically follows pointerup so the task doesn't also open.
      longPressFiredRef.current = false;
      e.preventDefault();
      return;
    }
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest("[data-no-open]")) return;
    const overrideMode = e.metaKey || e.ctrlKey ? "tab" : undefined;
    void taskService.openInNewLeaf(task, overrideMode);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    buildAndShowMenu(e.clientX, e.clientY);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Only handle touch (and pen). Mouse keeps the regular onContextMenu path.
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    if ((e.target as HTMLElement).closest("[data-no-open]")) return;
    cancelLongPress();
    pressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      const start = pressStartRef.current;
      pressStartRef.current = null;
      if (!start) return;
      longPressFiredRef.current = true;
      try {
        (navigator as { vibrate?: (n: number) => void }).vibrate?.(8);
      } catch {
        /* ignore */
      }
      buildAndShowMenu(start.x, start.y);
    }, 500);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = pressStartRef.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > 64 /* 8px */) cancelLongPress();
  };

  const accent = project?.color ?? "var(--background-modifier-border)";
  const cardStyle: React.CSSProperties = {
    ...style,
    ["--kp-card-stripe" as string]: accent,
    ["--kp-card-border" as string]: accent,
  };

  return (
    <div
      ref={innerRef}
      className={`kp-card ${compact ? "kp-card--compact" : ""}`}
      style={cardStyle}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...draggableProps}
      onPointerDown={(e) => {
        (draggableProps?.onPointerDown as
          | ((ev: React.PointerEvent) => void)
          | undefined)?.(e);
        onPointerDown(e);
      }}
      onPointerMove={(e) => {
        (draggableProps?.onPointerMove as
          | ((ev: React.PointerEvent) => void)
          | undefined)?.(e);
        onPointerMove(e);
      }}
      onPointerUp={(e) => {
        (draggableProps?.onPointerUp as
          | ((ev: React.PointerEvent) => void)
          | undefined)?.(e);
        cancelLongPress();
      }}
      onPointerCancel={(e) => {
        (draggableProps?.onPointerCancel as
          | ((ev: React.PointerEvent) => void)
          | undefined)?.(e);
        cancelLongPress();
      }}
      onPointerLeave={(e) => {
        (draggableProps?.onPointerLeave as
          | ((ev: React.PointerEvent) => void)
          | undefined)?.(e);
        cancelLongPress();
      }}
    >
      <div className="kp-card__head">
        <div className="kp-card__title">
          {task.code && <span className="kp-code">{task.code}</span>}
          {task.title}
        </div>
        {priority && (
          <span className="kp-chip kp-chip--priority" style={{ color: priority.color }}>
            {priority.label}
          </span>
        )}
      </div>
      {task.excerpt && !compact && (
        <div className="kp-card__excerpt">{task.excerpt}</div>
      )}
      {(status || due || task.milestone || task.tags.length > 0) && (
        <div className="kp-card__meta">
          {status && !compact && (
            <span className="kp-chip kp-chip--status" style={{ color: status.color }}>
              {status.label}
            </span>
          )}
          {due && (
            <span className={`kp-chip kp-chip--due ${isOverdue(due) ? "kp-chip--overdue" : ""}`}>
              {fmtShort(due)}
            </span>
          )}
          {task.milestone && (
            <span className="kp-chip kp-chip--milestone">
              <Icon name="flag" size={11} />
              {task.milestone}
            </span>
          )}
          {task.tags.slice(0, compact ? 1 : 3).map((tag) => (
            <span key={tag} className="kp-chip kp-chip--tag">
              #{tag}
            </span>
          ))}
          {task.updated && (
            <span className="kp-card__age" title="Last updated">
              <Icon name="clock" size={11} />
              {formatAge(task.updated)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

function isOverdue(d: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}
