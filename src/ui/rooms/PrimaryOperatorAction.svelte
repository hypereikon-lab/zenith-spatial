<script lang="ts">
  import { onMount } from "svelte";
  import type { OperatorId } from "../../artifacts/artifact-types.js";
  import { disabledReasonForOperator, getOperator } from "../../app/operator-registry.js";
  import { refreshOperatorPreflightStatus } from "../../app/operator-preflight.js";
  import { executeOperator } from "../../app/workbench-operator-commands.js";
  import { ActionButton } from "../primitives/index.js";

  let {
    operatorId,
    label,
    note,
  }: {
    operatorId: OperatorId;
    label?: string;
    note?: string;
  } = $props();

  let operator = $derived(getOperator(operatorId));
  let disabledReason = $derived(disabledReasonForOperator(operator));
  let buttonLabel = $derived(label || operator.label);

  onMount(() => {
    if (operator.preflight?.services?.length) {
      void refreshOperatorPreflightStatus();
    }
  });
</script>

<div class="stage-action" data-execution-mode={operator.executionMode || "command"} data-operator-kind={operator.kind}>
  <ActionButton
    tone="operator"
    disabled={Boolean(disabledReason)}
    aria-describedby={disabledReason ? `${operatorId}-stage-disabled` : undefined}
    onclick={() => executeOperator(operatorId)}
  >
    {buttonLabel}
  </ActionButton>
  {#if disabledReason}
    <small class="disabled-reason" id={`${operatorId}-stage-disabled`}>{disabledReason}</small>
  {:else if note}
    <small>{note}</small>
  {/if}
</div>
