<script lang="ts">
  import { Slider } from "$lib/components/ui/slider/index.js";
  import FieldShell from "./FieldShell.svelte";

  let {
    id,
    label,
    value,
    min,
    max,
    step,
    note = "",
    labelHidden = false,
    ariaLabel = "",
    disabled = false,
    class: className = "",
    oninput,
  }: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    note?: string;
    labelHidden?: boolean;
    ariaLabel?: string;
    disabled?: boolean;
    class?: string;
    oninput?: (value: number) => void;
  } = $props();

  const sliderValue = $derived([value]);
  let userInputActive = false;
  let lastEmittedValue: number | null = null;

  function beginUserInput(): void {
    userInputActive = true;
    lastEmittedValue = null;
  }

  function endUserInput(): void {
    userInputActive = false;
    lastEmittedValue = null;
  }

  function handleValueChange(nextValue: number[]): void {
    const next = nextValue[0];
    if (!userInputActive || !Number.isFinite(next)) return;
    if (lastEmittedValue !== null && Math.abs(next - lastEmittedValue) <= 0.000001) return;
    lastEmittedValue = next;
    oninput?.(next);
  }
</script>

<FieldShell for={id} {label} {note} {labelHidden} class={`zenith-range-field ${className}`}>
  <Slider
    {id}
    class="zenith-range-control w-full"
    aria-label={ariaLabel || label}
    {min}
    {max}
    {step}
    value={sliderValue}
    {disabled}
    onpointerdown={beginUserInput}
    onpointerup={endUserInput}
    onpointercancel={endUserInput}
    onkeydown={beginUserInput}
    onkeyup={endUserInput}
    onfocusout={endUserInput}
    onValueChange={handleValueChange}
  />
</FieldShell>
