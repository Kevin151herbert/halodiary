import { setClockAction } from "./actions";

/**
 * Moves the demo clock. The diary advances on the server either way; if the response is slow to come back
 * (a cold or busy server), reload instead of leaving the button spinning.
 */
export async function moveClock(hours: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<"slow">((resolve) => {
    timer = setTimeout(() => resolve("slow"), 20_000);
  });
  try {
    const r = await Promise.race([setClockAction(hours).then(() => "ok" as const), slow]);
    if (r === "slow") window.location.reload();
  } catch {
    window.location.reload();
  } finally {
    clearTimeout(timer);
  }
}
