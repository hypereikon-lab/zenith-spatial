<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import FieldShell from "./FieldShell.svelte";

  let {
    id,
    label,
    value,
    note = "",
    ariaLabel = "",
    disabled = false,
    class: className = "",
    oninput,
    onchange,
  }: {
    id?: string;
    label: string;
    value: string;
    note?: string;
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    oninput?: (value: string) => void;
    onchange?: (value: string) => void;
  } = $props();
</script>

<FieldShell for={id} {label} {note} class={`zenith-color-field ${className}`}>
  <Input
    {id}
    class="zenith-color-control"
    aria-label={ariaLabel || undefined}
    type="color"
    {value}
    {disabled}
    oninput={(event) => oninput?.((event.currentTarget as HTMLInputElement).value)}
    onchange={(event) => onchange?.((event.currentTarget as HTMLInputElement).value)}
  />
</FieldShell>
