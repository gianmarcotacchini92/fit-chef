"use client";

import { useEffect } from "react";

export function PwaRegistration() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_FIT_STATIC !== "true" || !("serviceWorker" in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
      console.warn("[fit-chef:offline] service_worker_unavailable");
    });
  }, []);
  return null;
}
