"use client";

import type { ComponentPropsWithoutRef, MouseEvent } from "react";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Närmaste overflow-scroller (förhandsvisningens ruta) – annars fönstret. */
function nearestOverflowParent(el: Element): HTMLElement | null {
  let parent = el.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      parent.scrollHeight > parent.clientHeight + 1
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

export function SmoothSectionLink({
  href,
  onClick,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (typeof href !== "string" || !href.startsWith("#") || href.length < 2) return;

    const id = decodeURIComponent(href.slice(1));
    const target = document.getElementById(id);
    // Saknad sektion (t.ex. dold kontakt) ska inte 404:a – stanna kvar.
    e.preventDefault();
    if (!target) return;

    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    const scroller = nearestOverflowParent(target);

    if (scroller) {
      const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      const top =
        scroller.scrollTop +
        (target.getBoundingClientRect().top - scroller.getBoundingClientRect().top) -
        margin;
      scroller.scrollTo({ top, behavior });
      return;
    }

    target.scrollIntoView({ behavior, block: "start" });
  }

  return <a {...props} href={href} onClick={handleClick} />;
}
