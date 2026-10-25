import { useEffect, useState } from "react";

export function formatElapsedTime(startedAt: number, now: number): string {
  const totalSeconds = Math.floor((now - startedAt) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return hours > 0 ? String(hours).padStart(2, "0") + ":" + clock : clock;
}

export function useElapsedTime(startedAt: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return formatElapsedTime(startedAt, now);
}
