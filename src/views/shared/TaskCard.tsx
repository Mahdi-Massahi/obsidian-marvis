import * as React from "react";
import type { Task } from "../../schema/types";
import { usePlugin } from "../context";
import { parseDate, fmtShort } from "../../utils/dates";
import { Icon } from "./Icon";

interface Props {
  task: Task;
  compact?: boolean;
  draggableProps?: React.HTMLAttributes<HTMLDivElement>;
  innerRef?: (el: HTMLDivElement | null) => void;
  style?: React.CSSProperties;
}

export const TaskCard: React.FC<Props> = ({ task, compact, draggableProps, innerRef, style }) => {
  const { settings, taskService, store } = usePlugin();
  const projects = store((s) => s.projects);
  const project = task.project ? Object.values(projects).find((p) => p.name === task.project) : undefined;
  const status = settings.statuses.find((s) => s.id === task.status);
  const priority = settings.priorities.find((p) => p.id === task.priority);
  const due = parseDate(task.due);

  const onClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest("[data-no-open]")) return;
    void taskService.openInNewLeaf(task);
  };

  const stripeColor = project?.color ?? "var(--background-modifier-border)";
  const cardStyle: React.CSSProperties = {
    ...style,
    ["--kp-card-stripe" as string]: stripeColor,
  };

  return (
    <div
      ref={innerRef}
      className={`kp-card ${compact ? "kp-card--compact" : ""}`}
      style={cardStyle}
      onClick={onClick}
      {...draggableProps}
    >
      <div className="kp-card__head">
        <div className="kp-card__title">{task.title}</div>
        {priority && (
          <span className="kp-chip kp-chip--priority" style={{ color: priority.color }}>
            {priority.label}
          </span>
        )}
      </div>
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
