import { useEffect, useRef, useState } from "react";

import { compositionReadiness, selectedComposition, selectedPlateCommit } from "../../domain/project.js";
import type { GenerationJob } from "../../domain/schema.js";
import { importImageTake, importPlateCommit } from "../../runtime/browser-workbench-commands.js";
import {
  changeGenerationDirection,
  chooseImageTake,
  choosePlateCommit,
  chooseRoom,
} from "../../runtime/workspace-commands.js";
import {
  cancelGeneration,
  recoverGenerationJobs,
  refreshGenerationStatus,
  requestPaidGenerationConfirmation,
  runConfirmedGeneration,
} from "../../runtime/generation-commands.js";
import { useEffectRunner, useRuntime, useWorkbenchSnapshot } from "../runtime-bridge.js";
import { useMediaUrl } from "../use-media-url.js";

export function GenerateRoom() {
  const snapshot = useWorkbenchSnapshot();
  const { workbench } = useRuntime();
  const run = useEffectRunner();
  const composition = selectedComposition(snapshot.document);
  const commit = selectedPlateCommit(composition);
  const readiness = compositionReadiness(composition);
  const commitAsset = commit ? snapshot.document.project.assets[commit.mediaAssetId] : null;
  const commitUrl = useMediaUrl(commitAsset);
  const plateInput = useRef<HTMLInputElement>(null);
  const takeInput = useRef<HTMLInputElement>(null);
  const confirmTrigger = useRef<HTMLButtonElement>(null);
  const confirmDialog = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState(composition.generationDirection);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Checking local generation boundary…");

  useEffect(() => {
    setDirection(composition.generationDirection);
  }, [composition.id, composition.generationDirection]);

  useEffect(() => {
    let active = true;
    void run(refreshGenerationStatus)
      .then(async (service) => {
        if (!active) return;
        setStatus(
          service.configured
            ? `${service.provider} · ${service.model} is configured server-side.`
            : "Image generation is unavailable until the server-side Runway secret is configured.",
        );
        await run(recoverGenerationJobs);
      })
      .catch((error: unknown) => {
        if (active) report(error, "generation-status");
      });
    return () => {
      active = false;
    };
  }, [run]);

  useEffect(() => {
    if (!confirmOpen) return;
    const dialog = confirmDialog.current;
    if (!dialog) return;
    dialog.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...dialog!.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])",
        ),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      confirmTrigger.current?.focus({ preventScroll: true });
    };
  }, [confirmOpen]);

  async function openPaidConfirmation() {
    try {
      await run(changeGenerationDirection(direction, composition.generationStrategy));
      setConfirmOpen(true);
    } catch (error) {
      report(error, "generation-direction");
    }
  }

  async function startPaidJob() {
    setRunning(true);
    setStatus("Issuing one-time confirmation grant for the pinned input digest…");
    try {
      const grant = await run(requestPaidGenerationConfirmation);
      setConfirmOpen(false);
      setStatus("Paid job created. Listening to server-authoritative progress…");
      const job = await run(runConfirmedGeneration(grant.grant));
      setStatus(
        job.status === "succeeded"
          ? "Image Take retrieved, pinned to its Plate Commit, and opened in Review."
          : job.status === "cancelled"
            ? "Generation cancelled."
            : (job.error?.message ?? `Generation ended in ${job.status}.`),
      );
    } catch (error) {
      report(error, "generation");
    } finally {
      setRunning(false);
    }
  }

  async function importCommit(file: File | undefined) {
    if (!file) return;
    try {
      const imported = await run(importPlateCommit(file));
      setStatus(`${imported.label} imported without altering its pixels.`);
    } catch (error) {
      report(error, "plate-import");
    }
  }

  async function importTake(file: File | undefined) {
    if (!file) return;
    try {
      const imported = await run(importImageTake(file));
      setStatus(`${imported.label} imported and opened in spatial Review.`);
    } catch (error) {
      report(error, "take-import");
    }
  }

  function report(error: unknown, scope: string) {
    const message = readableError(error);
    setStatus(message);
    void run(workbench.notice("error", message, scope)).catch(() => undefined);
  }

  const activeJobs = snapshot.jobs.filter((job) => job.compositionId === composition.id);
  const latestJob = activeJobs[0] ?? null;
  const configured = snapshot.environment.generationConfigured === true;
  const canRequest = configured && readiness.canGenerate && direction.trim().length > 0 && !running;

  return (
    <section className="workstation generate-room" aria-label="Generate Image Takes">
      <aside className="panel tool-rail">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">Input</span>
            <h2>Plate Commits</h2>
          </div>
          <strong>{composition.plateCommits.length}</strong>
        </header>
        <div className="revision-list">
          {[...composition.plateCommits].reverse().map((candidate) => {
            const selected = candidate.id === composition.selectedPlateCommitId;
            return (
              <button
                key={candidate.id}
                type="button"
                className={selected ? "revision-row is-selected" : "revision-row"}
                onClick={() => {
                  void run(choosePlateCommit(candidate.id));
                }}
              >
                <span>{selected ? "PIN" : "COM"}</span>
                <strong>{candidate.label}</strong>
                <small>
                  {candidate.draft.raster.width} × {candidate.draft.raster.height}
                  <br />
                  {shortDate(candidate.createdAt)}
                </small>
              </button>
            );
          })}
        </div>
        <button className="button ghost full" type="button" onClick={() => plateInput.current?.click()}>
          Import Plate Sketch
        </button>
        <input
          ref={plateInput}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            void importCommit(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <div className="panel-section">
          <h3>Appearance references</h3>
          <p className="technical-note">
            Integrated strategy sends up to 15 ordered source images as appearance references. Strict strategy sends
            only the exact Plate Commit.
          </p>
          <div className="source-chip-list">
            {composition.sourceAssetIds.map((assetId, index) => (
              <span key={assetId}>
                {String(index + 1).padStart(2, "0")}{" "}
                {snapshot.document.project.assets[assetId]?.filename ?? "Missing source"}
              </span>
            ))}
          </div>
        </div>
      </aside>

      <div className="viewport-column">
        <div className="viewport-toolbar">
          <div>
            <span className="eyebrow">GENERATE / EXACT INPUT</span>
            <h1>Image Direction</h1>
          </div>
          <span className={configured ? "service-badge is-ready" : "service-badge"}>
            {configured ? "RUNWAY READY" : "RUNWAY OFFLINE"}
          </span>
        </div>
        <div className="generation-stage">
          <div
            className="input-proof"
            style={{ aspectRatio: commit ? `${commit.draft.raster.width} / ${commit.draft.raster.height}` : "1 / 1" }}
          >
            {commitUrl ? (
              <img src={commitUrl} alt="Exact immutable Plate Sketch input" />
            ) : (
              <div className="empty-viewport">
                <strong>No Plate Commit</strong>
                <span>Return to Compose and commit the exact raster.</span>
              </div>
            )}
            {commit ? (
              <div className="proof-label">
                <span>IMMUTABLE INPUT</span>
                <strong>{commit.label}</strong>
                <small>{commit.id}</small>
              </div>
            ) : null}
          </div>
        </div>
        <div className="viewport-status">
          <span className="status-dot" aria-hidden="true" />
          <output>{status}</output>
          <span>
            {latestJob
              ? `${latestJob.stage} · ${Math.round(latestJob.progress * 100)}%`
              : "No paid call occurs until confirmation"}
          </span>
        </div>
      </div>

      <aside className="panel inspector">
        <header className="panel-heading">
          <div>
            <span className="eyebrow">Direction</span>
            <h2>Generation</h2>
          </div>
          <strong>01×</strong>
        </header>
        <div className="inspector-scroll">
          <div className="panel-section">
            <h3>Strategy</h3>
            <div className="segmented">
              <button
                type="button"
                className={composition.generationStrategy === "integrated" ? "is-active" : ""}
                onClick={() => void run(changeGenerationDirection(direction, "integrated"))}
              >
                Integrated
              </button>
              <button
                type="button"
                className={composition.generationStrategy === "strict" ? "is-active" : ""}
                onClick={() => void run(changeGenerationDirection(direction, "strict"))}
              >
                Strict
              </button>
            </div>
            <label className="field-stack">
              <span>Artist direction</span>
              <textarea
                rows={8}
                value={direction}
                placeholder="Describe subject continuity, material, light, and atmosphere…"
                onChange={(event) => setDirection(event.currentTarget.value)}
                onBlur={() => void run(changeGenerationDirection(direction, composition.generationStrategy))}
              />
            </label>
            <p className="technical-note">
              Direction cannot override carrier geometry, committed placement, or raster dimensions.
            </p>
          </div>

          {latestJob ? (
            <JobCard
              job={latestJob}
              onCancel={() =>
                void run(cancelGeneration(latestJob.id)).catch((error: unknown) => report(error, "job-cancel"))
              }
            />
          ) : null}

          <div className="panel-section">
            <h3>Image Takes</h3>
            <div className="take-list">
              {[...composition.imageTakes].reverse().map((take) => (
                <button
                  key={take.id}
                  type="button"
                  className={take.id === composition.selectedImageTakeId ? "take-row is-selected" : "take-row"}
                  onClick={() => void run(chooseImageTake(take.id)).then(() => run(chooseRoom("review")))}
                >
                  <span>{take.kind === "generated" ? "GEN" : "IMP"}</span>
                  <strong>{take.label}</strong>
                  <small>
                    {take.plateCommitId === composition.selectedPlateCommitId ? "current commit" : "earlier commit"}
                  </small>
                </button>
              ))}
            </div>
            <button className="button ghost full" type="button" onClick={() => takeInput.current?.click()}>
              Import Image Take
            </button>
            <input
              ref={takeInput}
              className="visually-hidden"
              type="file"
              accept="image/*"
              onChange={(event) => {
                void importTake(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </div>
        </div>
        <div className="commit-block">
          <button
            ref={confirmTrigger}
            className="button primary full"
            type="button"
            disabled={!canRequest}
            onClick={() => void openPaidConfirmation()}
          >
            {running ? "Generation running…" : configured ? "Generate Image Take" : "Generation unavailable"}
          </button>
          {!configured ? (
            <small>Set the Runway secret on the local server. Secrets never enter this browser bundle.</small>
          ) : (
            <small>One paid `gpt_image_2` output. Confirmation is bound to the exact input digest.</small>
          )}
        </div>
      </aside>

      {confirmOpen && commit ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmOpen(false);
          }}
        >
          <div
            ref={confirmDialog}
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paid-confirm-title"
            aria-describedby="paid-confirm-description"
            tabIndex={-1}
          >
            <span className="eyebrow">PAID ACTION</span>
            <h2 id="paid-confirm-title">Generate one Image Take?</h2>
            <p id="paid-confirm-description">
              This will submit the pinned Plate Commit and artist direction to Runway using <strong>gpt_image_2</strong>
              .
            </p>
            <dl className="confirmation-grid">
              <div>
                <dt>Plate Commit</dt>
                <dd>{commit.label}</dd>
              </div>
              <div>
                <dt>Raster</dt>
                <dd>
                  {commit.draft.raster.width} × {commit.draft.raster.height}
                </dd>
              </div>
              <div>
                <dt>Strategy</dt>
                <dd>{composition.generationStrategy}</dd>
              </div>
              <div>
                <dt>Outputs</dt>
                <dd>1 high-quality image</dd>
              </div>
            </dl>
            <p className="warning-copy">
              This action can incur provider charges. The one-time grant expires and cannot be replayed with altered
              input.
            </p>
            <div className="dialog-actions">
              <button className="button ghost" type="button" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="button" onClick={() => void startPaidJob()}>
                Confirm paid generation
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function JobCard({ job, onCancel }: { job: GenerationJob; onCancel: () => void }) {
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className="job-card">
      <div>
        <span className={`job-state ${job.status}`}>{job.status.toUpperCase()}</span>
        <strong>{job.stage}</strong>
        <small>{job.id}</small>
      </div>
      <div className="progress-track">
        <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
      </div>
      <div className="job-meta">
        <span>{Math.round(job.progress * 100)}%</span>
        {active ? (
          <button className="tool-button danger" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <span>
            {job.outputs.length} output{job.outputs.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string")
    return error.message;
  return "Generation operation failed.";
}
