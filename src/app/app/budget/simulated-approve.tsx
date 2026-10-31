"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { btn } from "@/components/ui";
import { approveBudgetSimulatedAction } from "../actions";

export function SimulatedApprove({ month, cap, disabled, primary }: { month: string; cap: number; disabled: boolean; primary: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={disabled || pending}
      className={`${primary ? btn.primary : btn.ghost} w-full py-3`}
      onClick={() =>
        start(async () => {
          await approveBudgetSimulatedAction(month, cap);
          router.push("/app/budget?approved=simulated");
        })
      }
    >
      {pending ? "Approving…" : "Approve (simulated payment)"}
    </button>
  );
}
