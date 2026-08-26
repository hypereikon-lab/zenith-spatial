import { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";

import {
  CloudProjectError,
  CloudProjectRepository,
  type CloudProjectSession,
  type CloudProjectSummary,
} from "../runtime/cloud-project-repository.js";
import { loadProjectArchive, saveProjectArchive } from "../runtime/project-persistence.js";
import { useEffectRunner, useRuntime, useWorkbenchSnapshot } from "./runtime-bridge.js";

export function CloudProjectControl() {
  const run = useEffectRunner();
  const { workbench } = useRuntime();
  const snapshot = useWorkbenchSnapshot();
  const [session, setSession] = useState<CloudProjectSession | null>(null);
  const [projects, setProjects] = useState<ReadonlyArray<CloudProjectSummary>>([]);
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [status, setStatus] = useState("Checking private Site access…");

  const refresh = useCallback(async () => {
    try {
      const next = await run(Effect.flatMap(CloudProjectRepository, (repository) => repository.list));
      setProjects(next);
      setStatus(
        next.length === 0
          ? "No private projects saved yet."
          : `${next.length} private project${next.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setStatus(readableError(error));
    }
  }, [run]);

  useEffect(() => {
    let mounted = true;
    void run(Effect.flatMap(CloudProjectRepository, (repository) => repository.session))
      .then((next) => {
        if (!mounted) return;
        setSession(next);
        setStatus(
          next.signedIn
            ? "Private storage is connected."
            : next.available
              ? "Sign in to access projects from other devices."
              : "",
        );
      })
      .catch((error: unknown) => {
        if (mounted) setStatus(readableError(error));
      });
    return () => {
      mounted = false;
    };
  }, [run]);

  useEffect(() => {
    if (open && session?.signedIn) void refresh();
  }, [open, refresh, session?.signedIn]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function saveCurrentProject() {
    const project = snapshot.document.project;
    const expectedRevision = projects.find((candidate) => candidate.projectId === project.id)?.revision ?? 0;
    setBusyAction("save");
    setStatus("Building an exact project archive…");
    try {
      const saved = await run(
        Effect.gen(function* () {
          const archive = yield* saveProjectArchive;
          const repository = yield* CloudProjectRepository;
          return yield* repository.save({
            projectId: project.id,
            title: project.metadata.title,
            schemaVersion: project.schemaVersion,
            expectedRevision,
            archive,
          });
        }),
      );
      setProjects((current) => [saved, ...current.filter((candidate) => candidate.projectId !== saved.projectId)]);
      setStatus(`Saved revision ${saved.revision} with ${formatBytes(saved.archiveBytes)} of embedded media.`);
    } catch (error) {
      const message = readableError(error);
      setStatus(message);
      await run(workbench.notice("error", message, "site-save")).catch(() => undefined);
      if (error instanceof CloudProjectError && error.status === 409) await refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function loadPrivateProject(project: CloudProjectSummary) {
    if (
      !window.confirm(`Load “${project.title}” revision ${project.revision}? Unsaved local changes will be replaced.`)
    )
      return;
    setBusyAction(`load:${project.projectId}`);
    setStatus(`Loading ${project.title}…`);
    try {
      const restored = await run(
        Effect.gen(function* () {
          const repository = yield* CloudProjectRepository;
          const archive = yield* repository.load(project.projectId);
          return yield* loadProjectArchive(archive);
        }),
      );
      setStatus(
        restored.migrated
          ? `Loaded and migrated ${project.title} from private storage.`
          : `Loaded ${project.title} revision ${project.revision} with its exact media.`,
      );
    } catch (error) {
      const message = readableError(error);
      setStatus(message);
      await run(workbench.notice("error", message, "site-load")).catch(() => undefined);
    } finally {
      setBusyAction(null);
    }
  }

  async function deletePrivateProject(project: CloudProjectSummary) {
    if (
      !window.confirm(
        `Delete the private copy of “${project.title}”? The project currently open in Zenith is unchanged.`,
      )
    )
      return;
    setBusyAction(`delete:${project.projectId}`);
    try {
      await run(
        Effect.flatMap(CloudProjectRepository, (repository) => repository.delete(project.projectId, project.revision)),
      );
      setProjects((current) => current.filter((candidate) => candidate.projectId !== project.projectId));
      setStatus(`Deleted the private copy of ${project.title}.`);
    } catch (error) {
      const message = readableError(error);
      setStatus(message);
      await run(workbench.notice("error", message, "site-delete")).catch(() => undefined);
      if (error instanceof CloudProjectError && error.status === 409) await refresh();
    } finally {
      setBusyAction(null);
    }
  }

  if (!session?.available) return null;
  const activeRemote = projects.find((project) => project.projectId === snapshot.document.project.id);
  return (
    <>
      <button className="button ghost site-access-button" type="button" onClick={() => setOpen(true)}>
        <span className={session.signedIn ? "site-state is-ready" : "site-state"} aria-hidden="true" />
        Site{activeRemote ? ` · r${activeRemote.revision}` : ""}
      </button>
      {open ? (
        <div className="modal-backdrop site-project-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="site-project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="site-project-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>ZENITH / PRIVATE SITE</span>
                <h2 id="site-project-title">Cloud projects</h2>
              </div>
              <button className="button ghost" type="button" autoFocus onClick={() => setOpen(false)}>
                Close
              </button>
            </header>
            {session.signedIn && session.user ? (
              <>
                <div className="site-account-row">
                  <span className="site-account-mark">Z</span>
                  <div>
                    <strong>{session.user.name ?? session.user.email}</strong>
                    <small>{session.user.email}</small>
                  </div>
                  <a className="button ghost" href={session.signOutPath}>
                    Sign out
                  </a>
                </div>
                <div className="site-current-project">
                  <div>
                    <span>CURRENT WORKSTATION</span>
                    <strong>{snapshot.document.project.metadata.title}</strong>
                    <small>
                      {snapshot.document.project.compositions.length} composition
                      {snapshot.document.project.compositions.length === 1 ? "" : "s"} · exact media archive
                    </small>
                  </div>
                  <button
                    className="button"
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void saveCurrentProject()}
                  >
                    {busyAction === "save" ? "Saving…" : activeRemote ? "Save New Revision" : "Save to Site"}
                  </button>
                </div>
                <div className="site-project-list" aria-busy={busyAction !== null}>
                  <div className="site-project-list-heading">
                    <span>PRIVATE PROJECTS</span>
                    <button
                      className="button ghost"
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() => void refresh()}
                    >
                      Refresh
                    </button>
                  </div>
                  {projects.length === 0 ? (
                    <div className="site-project-empty compact">
                      <strong>No remote projects</strong>
                      <p>Save the current workstation to reopen its Plates and Image Takes on another device.</p>
                    </div>
                  ) : (
                    projects.map((project) => (
                      <article
                        className={
                          project.projectId === snapshot.document.project.id
                            ? "site-project-row is-current"
                            : "site-project-row"
                        }
                        key={project.projectId}
                      >
                        <div>
                          <strong>{project.title}</strong>
                          <small>
                            r{project.revision} · {formatBytes(project.archiveBytes)} · {formatDate(project.updatedAt)}
                          </small>
                        </div>
                        <div>
                          <button
                            className="button"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => void loadPrivateProject(project)}
                          >
                            {busyAction === `load:${project.projectId}` ? "Loading…" : "Load"}
                          </button>
                          <button
                            className="button ghost danger"
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => void deletePrivateProject(project)}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="site-project-empty">
                <strong>One private spatial workspace</strong>
                <p>Use ChatGPT sign-in so source images, Plate Commits and Image Takes remain yours.</p>
                <a className="button" href={session.signInPath}>
                  Sign in with ChatGPT
                </a>
              </div>
            )}
            <footer aria-live="polite">{status}</footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string")
    return error.message;
  return "The private Site operation could not be completed.";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
