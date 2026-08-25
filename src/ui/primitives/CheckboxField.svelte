<script lang="ts">
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import { cn } from "$lib/utils.js";

  let {
    id,
    label,
    checked,
    note = "",
    disabled = false,
    class: className = "",
    onchange,
  }: {
    id?: string;
    label: string;
    checked: boolean;
    note?: string;
    disabled?: boolean;
    class?: string;
    onchange?: (checked: boolean) => void;
  } = $props();

  let localChecked = $state(false);

  $effect(() => {
    localChecked = checked;
  });

  function handleCheckedChange(nextChecked: boolean): void {
    localChecked = nextChecked;
    onchange?.(nextChecked);
  }
</script>

<div
  class={cn("zenith-checkbox-field flex min-w-0 items-start gap-2", className)}
  data-checked={localChecked ? "true" : "false"}
>
  <Checkbox {id} bind:checked={localChecked} {disabled} aria-label={label} onCheckedChange={handleCheckedChange} />
  <Label for={id} class="zenith-checkbox-label grid min-w-0 gap-0.5 text-xs font-semibold text-muted-foreground">
    <span>{label}</span>
    {#if note}
      <small class="font-mono text-[10px] leading-tight text-muted-foreground/70">{note}</small>
    {/if}
  </Label>
</div>
