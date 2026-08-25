<script lang="ts">
  import { workbench } from "../artifacts/artifact-store.svelte.js";
  import type { ArtifactSlotId, JobState } from "../artifacts/artifact-types.js";
  import {
    cancelWorkbenchJob,
    retryWorkbenchJob,
    toggleWorkbenchJobDetails,
  } from "../app/workbench-job-commands.js";
  import { ActionButton } from "./primitives/index.js";

  const visibleJobs = $derived(workbench.jobs.slice(0, 3));

  function canCancel(job: JobState): boolean {
    return Boolean(job.serverJobId && job.busy && (job.status === "queued" || job.status === "running"));
  }

  function canRetry(job: JobState): boolean {
    return !job.busy && (job.status === "failed" || job.status === "cancelled");
  }

  function jobStatus(job: JobState): string {
    if (job.status === "succeeded") return "Succeeded";
    if (job.status === "failed") return "Failed";
    if (job.status === "cancelled") return "Cancelled";
    if (job.status === "queued") return "Queued";
    return "Running";
  }

  function artifactList(ids: ArtifactSlotId[] | undefined): string {
    return ids?.length ? ids.join(", ") : "none";
  }

  function timeLabel(value: string | undefined): string {
    if (!value) return "not recorded";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
</script>

{#if workbench.jobs.length > 0}
  <section class="job-strip" aria-label="Job progress">
    {#each visibleJobs as job (job.id)}
      <article data-status={job.status} class:open={job.detailsOpen}>
        <div class="job-strip-header">
          <div>
            <strong>{job.label}</strong>
            <span>{jobStatus(job)} | {job.stage}</span>
          </div>
          <div class="job-actions">
            <ActionButton tone="secondary" onclick={() => toggleWorkbenchJobDetails(job.id)}>
              {job.detailsOpen ? "Hide details" : "Details"}
            </ActionButton>
            {#if canCancel(job)}
              <ActionButton tone="secondary" onclick={() => cancelWorkbenchJob(job.id)}>Cancel job</ActionButton>
            {/if}
            {#if canRetry(job)}
              <ActionButton tone="secondary" onclick={() => retryWorkbenchJob(job.id)}>Retry</ActionButton>
            {/if}
          </div>
        </div>
        {#if job.progress !== null}
          <progress max="1" value={job.progress} aria-label={`${job.label} progress`}></progress>
        {/if}
        {#if job.detailsOpen}
          <dl class="job-details" aria-label={`${job.label} job details`}>
            <div>
              <dt>Job id</dt>
              <dd>{job.serverJobId || job.id}</dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd>{job.operatorId}</dd>
            </div>
            <div>
              <dt>Inputs</dt>
              <dd>{artifactList(job.inputArtifactIds)}</dd>
            </div>
            <div>
              <dt>Outputs</dt>
              <dd>{artifactList(job.outputArtifactIds)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{timeLabel(job.createdAt)}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{timeLabel(job.finishedAt)}</dd>
            </div>
            {#if job.error}
              <div class="job-detail-error">
                <dt>Error</dt>
                <dd>{job.error}</dd>
              </div>
            {/if}
          </dl>
        {/if}
      </article>
    {/each}
  </section>
{/if}
