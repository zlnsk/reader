"use client";
import { useEffect } from "react";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

export default function SWRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`${BP}/sw.js`, { scope: `${BP}/` }).catch(() => {});
  }, []);
  return null;
}
