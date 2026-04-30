import * as React from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePlugin } from "./context";
import { FilterBar } from "./shared/FilterBar";
import { TaskCard } from "./shared/TaskCard";
import { Icon, IconName } from "./shared/Icon";
import { applyFilter } from "../filter/filterEngine";
import type { Task } from "../schema/types";
import { between } from "../utils/fractionalIndex";

type GroupBy = "status" | "priority" | "milestone";

export const KanbanRoot: React.FC = () => {
  const { store, settings, taskService } = usePlugin();
  const tasksMap = store((s) => s.tasks);
  const filter = store((s) => s.filter);
  const milestones = store((s) => s.milestones);

  const [groupBy, setGroupBy] = React.useState<GroupBy>(settings.defaultKanbanGroupBy);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const allTasks = React.useMemo(() => Object.values(tasksMap), [tasksMap]);
  const filtered = React.useMemo(() => applyFilter(allTasks, filter), [allTasks, filter]);

  const columns = React.useMemo(() => buildColumns(filtered, groupBy, settings, milestones), [
    filtered,
    groupBy,
    settings,
    milestones,
  ]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const taskById = React.useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of filtered) m.set(t.id, t);
    return m;
  }, [filtered]);

  const onDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) {
      setActiveId(null);
      return;
    }
    const activeTask = taskById.get(active.id as string);
    if (!activeTask) {
      setActiveId(null);
      return;
    }

    const overId = over.id as string;
    let targetColumnId: string;
    let overTaskId: string | null = null;
    if (overId.startsWith("col:")) {
      targetColumnId = overId.slice(4);
    } else {
      const overTask = taskById.get(overId);
      if (!overTask) {
        setActiveId(null);
        return;
      }
      overTaskId = overTask.id;
      targetColumnId = columnIdFor(overTask, groupBy);
    }

    const sourceColumnId = columnIdFor(activeTask, groupBy);
    const targetCol = columns.find((c) => c.id === targetColumnId);
    if (!targetCol) {
      setActiveId(null);
      return;
    }

    const peers = targetCol.tasks.filter((t) => t.id !== activeTask.id);
    let insertIdx = peers.length;
    if (overTaskId) {
      const idx = peers.findIndex((t) => t.id === overTaskId);
      if (idx >= 0) {
        const activeRect = active.rect.current.translated;
        const overRect = over.rect;
        const droppedBelowMidpoint =
          activeRect != null &&
          activeRect.top + activeRect.height / 2 >
            overRect.top + overRect.height / 2;
        insertIdx = droppedBelowMidpoint ? idx + 1 : idx;
      }
    }
    const prev = peers[insertIdx - 1]?.order;
    const next = peers[insertIdx]?.order;
    const newOrder = between(prev, next);

    // Optimistic in-memory update so the UI reflects the move instantly.
    const optimistic: Task = { ...activeTask, order: newOrder };
    if (groupBy === "status" && targetColumnId !== "__none") {
      optimistic.status = targetColumnId;
    } else if (groupBy === "priority") {
      optimistic.priority = targetColumnId === "__none" ? undefined : targetColumnId;
    } else if (groupBy === "milestone") {
      optimistic.milestone =
        targetColumnId === "__unassigned" ? undefined : targetColumnId;
    }
    store.getState().upsertTask(optimistic);
    setActiveId(null);

    // Persist to disk in the background; the indexer will re-sync afterwards.
    void (async () => {
      if (sourceColumnId !== targetColumnId) {
        await applyGroupChange(activeTask, groupBy, targetColumnId, taskService);
      }
      await taskService.setOrder(activeTask, newOrder);
    })();
  };

  const groupIcon: Record<GroupBy, IconName> = {
    status: "status",
    priority: "priority",
    milestone: "flag",
  };
  const toolbar = (
    <>
      {(["status", "priority", "milestone"] as GroupBy[]).map((g) => (
        <button
          key={g}
          className={`kp-btn kp-btn--ghost ${groupBy === g ? "is-active" : ""}`}
          onClick={() => setGroupBy(g)}
        >
          <Icon name={groupIcon[g]} size={13} />
          <span>{g}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="kp-view kp-view--kanban">
      <FilterBar activeView="kanban" toolbar={toolbar} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="kp-kanban__board">
          {columns.map((col) => (
            <KanbanColumn key={col.id} column={col} groupBy={groupBy} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeId && taskById.get(activeId) ? (
            <TaskCard task={taskById.get(activeId)!} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
};

interface Column {
  id: string;
  label: string;
  color?: string;
  tasks: Task[];
}

function columnIdFor(task: Task, groupBy: GroupBy): string {
  if (groupBy === "status") return task.status;
  if (groupBy === "priority") return task.priority ?? "__none";
  return task.milestone ?? "__unassigned";
}

async function applyGroupChange(
  task: Task,
  groupBy: GroupBy,
  newColId: string,
  taskService: import("../services/taskService").TaskService
): Promise<void> {
  if (groupBy === "status") await taskService.setStatus(task, newColId);
  else if (groupBy === "priority")
    await taskService.setPriority(task, newColId === "__none" ? "" : newColId);
  else await taskService.setMilestone(task, newColId === "__unassigned" ? undefined : newColId);
}

function buildColumns(
  tasks: Task[],
  groupBy: GroupBy,
  settings: import("../settings").KanbanPlusSettings,
  milestones: Record<string, import("../schema/types").Milestone>
): Column[] {
  const sorted = tasks.slice().sort((a, b) => a.order - b.order);
  if (groupBy === "status") {
    const map = new Map<string, Task[]>();
    for (const s of settings.statuses) map.set(s.id, []);
    for (const t of sorted) {
      if (!map.has(t.status)) map.set(t.status, []);
      map.get(t.status)!.push(t);
    }
    return Array.from(map.entries()).map(([id, list]) => {
      const def = settings.statuses.find((s) => s.id === id);
      return { id, label: def?.label ?? id, color: def?.color, tasks: list };
    });
  }
  if (groupBy === "priority") {
    const map = new Map<string, Task[]>();
    map.set("__none", []);
    for (const p of settings.priorities) map.set(p.id, []);
    for (const t of sorted) {
      const key = t.priority ?? "__none";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).map(([id, list]) => {
      if (id === "__none") return { id, label: "No priority", color: undefined, tasks: list };
      const def = settings.priorities.find((p) => p.id === id);
      return { id, label: def?.label ?? id, color: def?.color, tasks: list };
    });
  }
  const map = new Map<string, Task[]>();
  map.set("__unassigned", []);
  for (const m of Object.values(milestones)) map.set(m.name, []);
  for (const t of sorted) {
    const key = t.milestone ?? "__unassigned";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return Array.from(map.entries()).map(([id, list]) => ({
    id,
    label: id === "__unassigned" ? "Unassigned" : id,
    tasks: list,
  }));
}

interface ColProps {
  column: Column;
  groupBy: GroupBy;
}

const KanbanColumn: React.FC<ColProps> = ({ column, groupBy }) => {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });
  const colStyle = {
    ["--kp-col-dot" as string]: column.color ?? "var(--text-faint)",
  } as React.CSSProperties;
  return (
    <div className={`kp-col ${isOver ? "is-over" : ""}`} ref={setNodeRef} style={colStyle}>
      <div className="kp-col__header">
        <span className="kp-col__title">{column.label}</span>
        <span className="kp-col__count">{column.tasks.length}</span>
      </div>
      <SortableContext items={column.tasks.map((t) => t.id)}>
        <div className="kp-col__body">
          <NewTaskGhost columnId={column.id} groupBy={groupBy} />
          {column.tasks.map((task) => (
            <SortableCard key={task.id} task={task} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
};

interface GhostProps {
  columnId: string;
  groupBy: GroupBy;
}

const NewTaskGhost: React.FC<GhostProps> = ({ columnId, groupBy }) => {
  const { taskService, settings, store } = usePlugin();
  const filter = store((s) => s.filter);
  const projects = store((s) => s.projects);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const reset = () => {
    setTitle("");
    setEditing(false);
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      reset();
      return;
    }
    const baseProject =
      filter.projects[0] ??
      Object.values(projects)[0]?.name ??
      "Inbox";

    const input: Parameters<typeof taskService.createTask>[0] = {
      title: t,
      project: baseProject,
      status: settings.statuses[1]?.id ?? settings.statuses[0]?.id ?? "todo",
    };
    if (groupBy === "status" && columnId !== "__none") input.status = columnId;
    if (groupBy === "priority" && columnId !== "__none") input.priority = columnId;
    if (groupBy === "milestone" && columnId !== "__unassigned") input.milestone = columnId;

    try {
      await taskService.createTask(input);
    } catch (e) {
      console.error(e);
    }
    reset();
  };

  if (!editing) {
    return (
      <div
        className="kp-card kp-card--ghost"
        onClick={() => setEditing(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <span className="kp-card__ghost-label">+ New task</span>
      </div>
    );
  }

  return (
    <div className="kp-card kp-card--ghost-editing">
      <input
        ref={inputRef}
        type="text"
        className="kp-card__ghost-input"
        placeholder="Task title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            reset();
          }
        }}
        onBlur={() => {
          if (!title.trim()) reset();
        }}
      />
    </div>
  );
};

const SortableCard: React.FC<{ task: Task }> = ({ task }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    visibility: isDragging ? "hidden" : "visible",
  };
  return (
    <TaskCard
      task={task}
      innerRef={setNodeRef}
      style={style}
      draggableProps={{ ...attributes, ...listeners }}
    />
  );
};
