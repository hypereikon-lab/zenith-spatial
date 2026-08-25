<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import FieldShell from "./FieldShell.svelte";

  let {
    id,
    label,
    value,
    min = undefined,
    max = undefined,
    step = undefined,
    note = "",
    ariaLabel = "",
    disabled = false,
    class: className = "",
    oninput,
    onchange,
  }: {
    id?: string;
    label: string;
    value: number;
    min?: number | string;
    max?: number | string;
    step?: number | string;
    note?: string;
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    oninput?: (value: number) => void;
    onchange?: (value: number) => void;
  } = $props();

  function emitNumber(event: Event, handler?: (value: number) => void): void {
    const nextValue = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(nextValue)) handler?.(nextValue);
  }
</script>

<FieldShell for={id} {label} {note} class={`zenith-number-field ${className}`}>
  <Input
    {id}
    class="zenith-number-control"
    aria-label={ariaLabel || undefined}
    type="number"
    {min}
    {max}
    {step}
    {value}
    {disabled}
    oninput={(event) => emitNumber(event, oninput)}
    onchange={(event) => emitNumber(event, onchange)}
  />
</FieldShell>
