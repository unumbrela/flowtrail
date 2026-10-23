import { useSidebarStore } from "@/store/SidebarStore";
import { cn } from "@/util/utils";
import { SidebarContent } from "./SidebarContent";

function Sidebar() {
  const collapsed = useSidebarStore((state) => state.collapsed);

  return (
    <aside
      className={cn(
        "fixed hidden h-screen max-h-screen min-h-screen overflow-y-auto overflow-x-hidden border-r border-border/60 bg-slate-elevation2 lg:block",
        {
          "w-60": !collapsed,
          "w-16": collapsed,
        },
      )}
    >
      <SidebarContent useCollapsedState />
    </aside>
  );
}

export { Sidebar };
