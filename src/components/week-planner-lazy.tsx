"use client";

// Bryntum's script and styles load only when the planner is on screen, after the page has shown.
import dynamic from "next/dynamic";
import { Bone } from "./skeleton";

export const WeekPlanner = dynamic(() => import("./week-planner").then((m) => m.WeekPlanner), {
  ssr: false,
  loading: () => <Bone className="h-[560px] rounded-3xl" />,
});
