<script lang="ts">
  import { Select as SelectPrimitive } from "bits-ui";
  import {
    SelectContent,
    SelectGroup,
    SelectGroupHeading,
    SelectItem,
    SelectTrigger,
  } from "$lib/components/ui/select/index.js";
  import FieldShell from "./FieldShell.svelte";
  import type { SelectFieldGroup, SelectFieldOption } from "./types.js";

  let {
    id,
    label,
    value,
    options = [],
    groups = [],
    note = "",
    ariaLabel = "",
    disabled = false,
    class: className = "",
    onchange,
  }: {
    id?: string;
    label: string;
    value: string;
    options?: SelectFieldOption[];
    groups?: SelectFieldGroup[];
    note?: string;
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    onchange?: (value: string) => void;
  } = $props();

  function selectedLabel(): string {
    return (
      options.find((option) => option.value === value)?.label ||
      groups.flatMap((group) => group.options).find((option) => option.value === value)?.label ||
      value
    );
  }

  const rootItems = $derived([
    ...options,
    ...groups.flatMap((group) => group.options),
  ]);

  function handleValueChange(nextValue: string): void {
    onchange?.(nextValue);
  }
</script>

<FieldShell for={id} {label} {note} class={`zenith-select-field ${className}`}>
  <SelectPrimitive.Root type="single" {value} {disabled} items={rootItems} onValueChange={handleValueChange}>
    <SelectTrigger {id} class="zenith-select-control w-full" aria-label={ariaLabel || label}>
      <span data-slot="select-value">{selectedLabel()}</span>
    </SelectTrigger>
    <SelectContent class="zenith-select-content">
      {#if options.length > 0}
        <SelectGroup>
          {#each options as option}
            <SelectItem value={option.value} label={option.label} disabled={option.disabled} />
          {/each}
        </SelectGroup>
      {/if}
      {#each groups as group}
        {#if group.options.length > 0}
          <SelectGroup>
            <SelectGroupHeading>{group.label}</SelectGroupHeading>
            {#each group.options as option}
              <SelectItem value={option.value} label={option.label} disabled={option.disabled} />
            {/each}
          </SelectGroup>
        {/if}
      {/each}
    </SelectContent>
  </SelectPrimitive.Root>
</FieldShell>
