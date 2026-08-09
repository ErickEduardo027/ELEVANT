"use client";

import { useEffect } from "react";

const MOTION_SELECTOR = "[data-reveal], [data-motion-media]";
const PARALLAX_SELECTOR = "[data-parallax]";
const MOTION_SETTLE_MS = 780;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function MotionOrchestrator() {
  useEffect(() => {
    const root = document.documentElement;
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(MOTION_SELECTOR),
    );
    const parallaxElements = Array.from(
      document.querySelectorAll<HTMLElement>(PARALLAX_SELECTOR),
    );
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktopQuery = window.matchMedia("(min-width: 64rem)");
    const canObserve = "IntersectionObserver" in window;
    let stopMotion: (() => void) | undefined;

    const revealImmediately = () => {
      root.classList.remove("motion-ready");
      elements.forEach((element) => {
        element.classList.add("is-revealed", "is-motion-settled");
      });
      parallaxElements.forEach((element) => {
        element.style.setProperty("--motion-parallax-y", "0px");
      });
    };

    const startMotion = () => {
      elements.forEach((element) => {
        element.classList.remove("is-revealed", "is-motion-settled");
      });
      root.classList.add("motion-ready");

      const groupedElements = new Map<string, HTMLElement[]>();
      elements.forEach((element) => {
        const group = element.dataset.motionGroup;
        if (!group) return;
        const members = groupedElements.get(group) ?? [];
        members.push(element);
        groupedElements.set(group, members);
      });

      const settleTimers = new Map<HTMLElement, number>();
      const markRevealed = (element: HTMLElement) => {
        if (element.classList.contains("is-revealed")) return;
        element.classList.add("is-revealed");
        const timer = window.setTimeout(() => {
          element.classList.add("is-motion-settled");
          settleTimers.delete(element);
        }, MOTION_SETTLE_MS);
        settleTimers.set(element, timer);
      };

      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;

            const target = entry.target as HTMLElement;
            const group = target.dataset.motionGroup;
            const revealTargets =
              group && desktopQuery.matches
                ? (groupedElements.get(group) ?? [target])
                : [target];

            revealTargets.forEach((element) => {
              markRevealed(element);
              revealObserver.unobserve(element);
            });
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
      );

      elements.forEach((element) => revealObserver.observe(element));

      const activeParallax = new Set<HTMLElement>();
      let frameId: number | null = null;

      const updateParallax = () => {
        frameId = null;
        const viewportHeight = Math.max(window.innerHeight, 1);
        const mobileFactor = window.innerWidth < 768 ? 0.5 : 1;

        activeParallax.forEach((element) => {
          const bounds = element.getBoundingClientRect();
          const elementCenter = bounds.top + bounds.height / 2;
          const travel = (viewportHeight + bounds.height) / 2;
          const progress = clamp(
            (viewportHeight / 2 - elementCenter) / Math.max(travel, 1),
            -1,
            1,
          );
          const distance = Number.parseFloat(element.dataset.parallax ?? "0");
          const offset = progress * distance * mobileFactor;
          element.style.setProperty(
            "--motion-parallax-y",
            `${offset.toFixed(2)}px`,
          );
        });
      };

      const scheduleParallax = () => {
        if (frameId !== null || activeParallax.size === 0) return;
        frameId = window.requestAnimationFrame(updateParallax);
      };

      const parallaxObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const target = entry.target as HTMLElement;
            if (entry.isIntersecting) activeParallax.add(target);
            else activeParallax.delete(target);
          });
          scheduleParallax();
        },
        { rootMargin: "25% 0px", threshold: 0 },
      );

      parallaxElements.forEach((element) => parallaxObserver.observe(element));
      window.addEventListener("scroll", scheduleParallax, { passive: true });
      window.addEventListener("resize", scheduleParallax, { passive: true });

      return () => {
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        settleTimers.forEach((timer) => window.clearTimeout(timer));
        revealObserver.disconnect();
        parallaxObserver.disconnect();
        window.removeEventListener("scroll", scheduleParallax);
        window.removeEventListener("resize", scheduleParallax);
        root.classList.remove("motion-ready");
      };
    };

    const syncMotionPreference = () => {
      stopMotion?.();
      stopMotion = undefined;

      if (motionQuery.matches || !canObserve) {
        revealImmediately();
        return;
      }

      stopMotion = startMotion();
    };

    motionQuery.addEventListener("change", syncMotionPreference);
    syncMotionPreference();

    return () => {
      motionQuery.removeEventListener("change", syncMotionPreference);
      stopMotion?.();
      root.classList.remove("motion-ready");
    };
  }, []);

  return null;
}
