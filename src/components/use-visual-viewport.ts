"use client";

import { useEffect, useState } from "react";

export interface VisualViewportBox {
  /** Synlig höjd (ovanför tangentbordet när visualViewport krymper). */
  height: number;
  /** Offset från layout-toppen – iOS kan scrolla visual viewport. */
  offsetTop: number;
}

/**
 * Följer visual viewport så fixed UI kan sitta ovanför det virtuella
 * tangentbordet. Fungerar på iOS Safari och Android Chrome utan 100vh-hack.
 */
export function useVisualViewport(): VisualViewportBox {
  const [box, setBox] = useState<VisualViewportBox>({ height: 0, offsetTop: 0 });

  useEffect(() => {
    const apply = () => {
      const vv = window.visualViewport;
      setBox({
        height: Math.round(vv?.height ?? window.innerHeight),
        offsetTop: Math.round(vv?.offsetTop ?? 0),
      });
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, []);

  return box;
}
