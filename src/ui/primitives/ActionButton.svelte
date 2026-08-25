<script lang="ts">
  import { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";
  import type { Snippet } from "svelte";

  type ActionTone = "operator" | "secondary" | "danger" | "ghost";
  type ActionDensity = "default" | "compact" | "icon" | "icon-compact";

  let {
    tone = "secondary",
    density = "default",
    selected = false,
    class: className,
    children,
    ...restProps
  }: Omit<ButtonProps, "variant" | "size"> & {
    tone?: ActionTone;
    density?: ActionDensity;
    selected?: boolean;
    children?: Snippet;
  } = $props();

  function buttonVariant(tone: ActionTone): ButtonVariant {
    if (tone === "operator") return "default";
    if (tone === "danger") return "destructive";
    if (tone === "ghost") return "ghost";
    return "secondary";
  }

  function buttonSize(density: ActionDensity): ButtonSize {
    if (density === "compact") return "sm";
    if (density === "icon") return "icon";
    if (density === "icon-compact") return "icon-sm";
    return "default";
  }
</script>

<Button
  variant={buttonVariant(tone)}
  size={buttonSize(density)}
  class={cn(
    "zenith-action min-w-0 tracking-normal no-underline",
    tone === "operator" &&
      "operator-action border-primary/60 bg-primary text-primary-foreground hover:bg-primary/90",
    tone === "secondary" &&
      "secondary-action border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
    tone === "danger" && "danger-action border-destructive/50 bg-destructive/15 text-destructive",
    tone === "ghost" && "bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    density === "compact" && "compact-action text-xs",
    selected && "selected border-primary/70 bg-primary/15 text-foreground",
    className,
  )}
  data-tone={tone}
  data-density={density}
  data-selected={selected ? "true" : undefined}
  {...restProps}
>
  {@render children?.()}
</Button>
