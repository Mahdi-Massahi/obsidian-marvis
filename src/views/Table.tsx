import * as React from "react";
import { FilterBar } from "./shared/FilterBar";
import { TaskTable } from "./table/TaskTable";
import { ProjectTable } from "./table/ProjectTable";
import { MilestoneTable } from "./table/MilestoneTable";
import { Icon, IconName } from "./shared/Icon";

type Tab = "tasks" | "projects" | "milestones";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "tasks", label: "Tasks", icon: "check" },
  { id: "projects", label: "Projects", icon: "folder" },
  { id: "milestones", label: "Milestones", icon: "flag" },
];

export const TableRoot: React.FC = () => {
  const [tab, setTab] = React.useState<Tab>("tasks");

  const toolbar = (
    <>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`kp-btn kp-btn--ghost ${tab === t.id ? "is-active" : ""}`}
          onClick={() => setTab(t.id)}
        >
          <Icon name={t.icon} size={13} />
          <span>{t.label}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="kp-view kp-view--table">
      <FilterBar activeView="table" toolbar={toolbar} />
      {tab === "tasks" && <TaskTable />}
      {tab === "projects" && <ProjectTable />}
      {tab === "milestones" && <MilestoneTable />}
    </div>
  );
};
