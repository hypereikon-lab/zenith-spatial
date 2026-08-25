<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
  import FieldShell from "./FieldShell.svelte";

  let {
    id,
    label,
    value = $bindable(""),
    note = "",
    placeholder = "",
    ariaLabel = "",
    disabled = false,
    readonly = false,
    class: className = "",
    oninput,
    onchange,
  }: {
    id?: string;
    label: string;
    value: string;
    note?: string;
    placeholder?: string;
    ariaLabel?: string;
    disabled?: boolean;
    readonly?: boolean;
    class?: string;
    oninput?: (value: string) => void;
    onchange?: (value: string) => void;
  } = $props();
</script>

<FieldShell for={id} {label} {note} class={`zenith-text-field ${className}`}>
  <Input
    {id}
    class="zenith-text-control"
    aria-label={ariaLabel || undefined}
    type="text"
    {placeholder}
    {disabled}
    {readonly}
    bind:value
    oninput={(event) => oninput?.((event.currentTarget as HTMLInputElement).value)}
    onchange={(event) => onchange?.((event.currentTarget as HTMLInputElement).value)}
  />
</FieldShell>
