<script lang="ts">
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import FieldShell from "./FieldShell.svelte";

  let {
    id,
    label,
    value = $bindable(""),
    rows = 4,
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
    rows?: number | string;
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

<FieldShell for={id} {label} {note} class={`zenith-textarea-field ${className}`}>
  <Textarea
    {id}
    class="zenith-textarea-control"
    aria-label={ariaLabel || undefined}
    {rows}
    {placeholder}
    {disabled}
    {readonly}
    bind:value
    oninput={(event) => oninput?.((event.currentTarget as HTMLTextAreaElement).value)}
    onchange={(event) => onchange?.((event.currentTarget as HTMLTextAreaElement).value)}
  />
</FieldShell>
