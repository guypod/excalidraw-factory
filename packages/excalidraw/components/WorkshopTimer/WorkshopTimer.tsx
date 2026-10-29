import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import { KEYS } from "@excalidraw/common";

import { atom, editorJotaiStore, useAtomValue } from "../../editor-jotai";
import { t } from "../../i18n";
import { useApp } from "../App";
import { CloseIcon } from "../icons";

import "./WorkshopTimer.scss";

import type { AppClassProperties } from "../../types";

export const DEFAULT_TIMER_MINUTES = 5;
export const MAX_TIMER_MINUTES = 180;

/**
 * Every editor shares one jotai store, so the open timer records which editor
 * opened it and only that editor shows it.
 */
export const workshopTimerAtom = atom<{
  editorId: AppClassProperties["id"];
} | null>(null);

export type TimerStatus = "idle" | "running" | "paused" | "expired";

/** `m:ss`, or `h:mm:ss` from an hour up */
export const formatTimerDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
};

/** whole minutes in range, or null when the input is not a usable duration */
export const parseTimerMinutes = (value: string) => {
  const minutes = Number(value);
  return Number.isInteger(minutes) &&
    minutes >= 1 &&
    minutes <= MAX_TIMER_MINUTES
    ? minutes
    : null;
};

export const WorkshopTimer = () => {
  const app = useApp();
  const timer = useAtomValue(workshopTimerAtom);

  if (timer?.editorId !== app.id) {
    return null;
  }

  return (
    <WorkshopTimerPanel
      onClose={() => app.updateEditorAtom(workshopTimerAtom, null)}
    />
  );
};

const WorkshopTimerPanel = ({ onClose }: { onClose: () => void }) => {
  const app = useApp();
  const [minutesInput, setMinutesInput] = useState(
    String(DEFAULT_TIMER_MINUTES),
  );
  const [status, setStatus] = useState<TimerStatus>("idle");
  // time left when not running; while running, `endsAt` is the source of truth
  const [remainingMs, setRemainingMs] = useState(DEFAULT_TIMER_MINUTES * 60000);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  // only state changes are announced, never the ticking time
  const [announcement, setAnnouncement] = useState("");
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const minutesInputRef = useRef<HTMLInputElement>(null);

  // the user asked for the timer, so take them to it once. Nothing later in
  // the timer's life, expiry included, moves focus
  useEffect(() => {
    minutesInputRef.current?.focus();
  }, []);

  // the interval belongs to this panel, so closing the timer or unmounting
  // the editor stops it
  useEffect(() => {
    if (status !== "running" || endsAt === null) {
      return;
    }
    const tick = () => {
      const left = endsAt - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        setEndsAt(null);
        setStatus("expired");
        setAnnouncement(t("workshopTimer.announceExpired"));
      } else {
        setRemainingMs(left);
      }
    };
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [status, endsAt]);

  const minutes = parseTimerMinutes(minutesInput);

  const start = () => {
    if (minutes === null) {
      return;
    }
    const duration = minutes * 60000;
    setRemainingMs(duration);
    setEndsAt(Date.now() + duration);
    setStatus("running");
    setAnnouncement(
      t("workshopTimer.announceStarted", {
        duration: formatTimerDuration(duration),
      }),
    );
  };

  const pause = () => {
    if (endsAt !== null) {
      setRemainingMs(Math.max(0, endsAt - Date.now()));
    }
    setEndsAt(null);
    setStatus("paused");
    setAnnouncement(t("workshopTimer.announcePaused"));
  };

  const resume = () => {
    setEndsAt(Date.now() + remainingMs);
    setStatus("running");
    setAnnouncement(t("workshopTimer.announceResumed"));
  };

  const reset = () => {
    setEndsAt(null);
    setRemainingMs((minutes ?? DEFAULT_TIMER_MINUTES) * 60000);
    setStatus("idle");
    setAnnouncement(t("workshopTimer.announceReset"));
    // the Reset button goes away, so hand focus to Start rather than lose it
    requestAnimationFrame(() => startButtonRef.current?.focus());
  };

  const close = () => {
    onClose();
    app.focusContainer();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === KEYS.ESCAPE) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const displayMs =
    status === "idle" && minutes !== null ? minutes * 60000 : remainingMs;

  return (
    <section
      className={clsx("WorkshopTimer", {
        "WorkshopTimer--expired": status === "expired",
      })}
      aria-label={t("workshopTimer.title")}
      data-testid="workshop-timer"
      onKeyDown={onKeyDown}
    >
      <div className="WorkshopTimer__header">
        <span className="WorkshopTimer__title">{t("workshopTimer.title")}</span>
        <button
          type="button"
          className="WorkshopTimer__icon-button"
          onClick={close}
          aria-label={t("workshopTimer.close")}
          title={`${t("workshopTimer.close")} (Esc)`}
        >
          {CloseIcon}
        </button>
      </div>
      <div className="WorkshopTimer__time" data-testid="workshop-timer-time">
        {formatTimerDuration(displayMs)}
      </div>
      {status === "expired" && (
        <div className="WorkshopTimer__expired">
          {t("workshopTimer.expired")}
        </div>
      )}
      {status === "idle" && (
        <label className="WorkshopTimer__minutes">
          <span>{t("workshopTimer.minutes")}</span>
          <input
            ref={minutesInputRef}
            type="number"
            min={1}
            max={MAX_TIMER_MINUTES}
            step={1}
            value={minutesInput}
            aria-invalid={minutes === null}
            onChange={(event) => setMinutesInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === KEYS.ENTER) {
                event.preventDefault();
                start();
              }
            }}
          />
        </label>
      )}
      <div className="WorkshopTimer__actions">
        {status === "idle" && (
          <button
            ref={startButtonRef}
            type="button"
            className="WorkshopTimer__button"
            onClick={start}
            disabled={minutes === null}
          >
            {t("workshopTimer.start")}
          </button>
        )}
        {status === "running" && (
          <button
            type="button"
            className="WorkshopTimer__button"
            onClick={pause}
          >
            {t("workshopTimer.pause")}
          </button>
        )}
        {status === "paused" && (
          <button
            type="button"
            className="WorkshopTimer__button"
            onClick={resume}
          >
            {t("workshopTimer.resume")}
          </button>
        )}
        {status !== "idle" && (
          <button
            type="button"
            className="WorkshopTimer__button"
            onClick={reset}
          >
            {t("workshopTimer.reset")}
          </button>
        )}
      </div>
      <div
        className="WorkshopTimer__sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="workshop-timer-announcement"
      >
        {announcement}
      </div>
    </section>
  );
};

/** opens the timer panel. The timer is local to this browser tab */
export const openWorkshopTimer = (app: AppClassProperties) => {
  app.updateEditorAtom(workshopTimerAtom, { editorId: app.id });
};

/** closes the timer when its editor goes away */
export const closeWorkshopTimerForEditor = (
  editorId: AppClassProperties["id"],
) => {
  if (editorJotaiStore.get(workshopTimerAtom)?.editorId === editorId) {
    editorJotaiStore.set(workshopTimerAtom, null);
  }
};
