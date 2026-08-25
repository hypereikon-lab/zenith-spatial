<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button/variants.js";
  import { cn } from "$lib/utils.js";
  import UploadIcon from "@lucide/svelte/icons/upload";
  import type { Snippet } from "svelte";

  let {
    id,
    label,
    accept,
    multiple = false,
    disabled = false,
    describedBy,
    compact = false,
    class: className = "",
    children,
    onchange,
  }: {
    id: string;
    label: string;
    accept?: string;
    multiple?: boolean;
    disabled?: boolean;
    describedBy?: string;
    compact?: boolean;
    class?: string;
    children?: Snippet;
    onchange?: (event: Event) => void;
  } = $props();
</script>

<label
  class={cn("file-import zenith-file-import", compact && "compact", disabled && "disabled", className)}
  for={id}
  aria-disabled={disabled ? "true" : undefined}
>
  <span
    class={cn(
      buttonVariants({ variant: "secondary", size: compact ? "sm" : "default" }),
      "zenith-file-import-button w-full cursor-pointer",
      disabled && "pointer-events-none",
    )}
  >
    <UploadIcon aria-hidden="true" />
    {#if children}
      {@render children()}
    {:else}
      {label}
    {/if}
  </span>
  <input
    class="sr-only"
    {id}
    type="file"
    {accept}
    {multiple}
    {disabled}
    {onchange}
    aria-label={label}
    aria-describedby={describedBy}
  />
</label>
