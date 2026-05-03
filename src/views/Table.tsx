import * as React from "react";
import { FilterBar } from "./shared/FilterBar";
import { TaskTable } from "./table/TaskTable";
import { ProjectTable } from "./table/ProjectTable";
import { MilestoneTable } from "./table/MilestoneTable";
import { LogTable } from "./table/LogTable";
import { EventTable } from "./table/EventTable";
import { Icon, IconName } from "./shared/Icon";

type Tab = "tasks" | "projects" | "milestones" | "events" | "logs";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "tasks", label: "Tasks", icon: "check" },
  { id: "projects", label: "Projects", icon: "folder" },
  { id: "milestones", label: "Milestones", icon: "flag" },
  { id: "events", label: "Events", icon: "calendar" },
  { id: "logs", label: "Logs", icon: "notebook" },
];

export const TableRoot: React.FC = () => {
  const [tab, setTab] = React.useState<Tab>("tasks");

  const toolbar = (
    <div className="kp-segmented">
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`kp-segmented__btn ${tab === t.id ? "is-active" : ""}`}
          onClick={() => setTab(t.id)}
          title={t.label}
        >
          <Icon name={t.icon} size={13} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="kp-view kp-view--table">
      <FilterBar
        activeView="table"
        toolbar={toolbar}
        showCalendarSync={tab === "events"}
      />
      {tab === "tasks" && <TaskTable />}
      {tab === "projects" && <ProjectTable />}
      {tab === "milestones" && <MilestoneTable />}
      {tab === "events" && <EventTable />}
      {tab === "logs" && <LogTable />}
    </div>
  );
};
