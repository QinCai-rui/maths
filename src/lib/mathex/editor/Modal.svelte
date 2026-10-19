<script lang="ts">
  import { Dialog } from "bits-ui";
  import X from "@lucide/svelte/icons/x";
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    title: string;
    kicker?: string;
    description?: string;
    /** Element to portal into, so the dialog keeps the editor's theme tokens. */
    portal?: HTMLElement | null;
    wide?: boolean;
    children: Snippet;
    footer?: Snippet;
    onClose?: () => void;
  }

  let {
    open = $bindable(),
    title,
    kicker,
    description,
    portal,
    wide = false,
    children,
    footer,
    onClose
  }: Props = $props();
</script>

<Dialog.Root
  bind:open
  onOpenChange={(value) => {
    if (!value) onClose?.();
  }}
>
  <Dialog.Portal to={portal || "body"}>
    <Dialog.Overlay class="mx-modal-overlay" />
    <Dialog.Content class="mx-modal {wide ? 'wide' : ''}">
      <header class="mx-modal-head">
        <div>
          {#if kicker}<p class="mx-modal-kicker">{kicker}</p>{/if}
          <Dialog.Title class="mx-modal-title">{title}</Dialog.Title>
          {#if description}<Dialog.Description class="mx-modal-description">{description}</Dialog.Description>{/if}
        </div>
        <Dialog.Close class="mx-modal-close" aria-label="Close"><X /></Dialog.Close>
      </header>
      <div class="mx-modal-body">{@render children()}</div>
      {#if footer}<footer class="mx-modal-foot">{@render footer()}</footer>{/if}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>

<style>
  :global(.mx-modal-overlay) {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(10 12 16 / 45%);
  }
  :global(.mx-modal) {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 61;
    display: flex;
    flex-direction: column;
    width: min(28rem, calc(100vw - 2rem));
    max-height: min(88dvh, 44rem);
    transform: translate(-50%, -50%);
    border: 1px solid var(--mx-line);
    border-radius: 12px;
    background: var(--mx-surface);
    color: var(--mx-text);
    box-shadow: var(--mx-shadow-pop);
  }
  :global(.mx-modal.wide) {
    width: min(36rem, calc(100vw - 2rem));
  }
  :global(.mx-modal:focus-visible) {
    outline: none;
  }
  .mx-modal-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.1rem 0.75rem;
  }
  .mx-modal-kicker {
    margin-bottom: 0.2rem;
    color: var(--mx-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  :global(.mx-modal-title) {
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 1.3;
  }
  :global(.mx-modal-description) {
    margin-top: 0.35rem;
    color: var(--mx-muted);
    font-size: 0.85rem;
    line-height: 1.5;
  }
  :global(.mx-modal-close) {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    flex: none;
    margin: -0.2rem -0.3rem 0 0;
    border-radius: var(--mx-radius);
    color: var(--mx-muted);
  }
  :global(.mx-modal-close:hover) {
    background: var(--mx-subtle);
    color: var(--mx-text);
  }
  :global(.mx-modal-close svg) {
    width: 1rem;
    height: 1rem;
  }
  .mx-modal-body {
    min-height: 0;
    overflow-y: auto;
    padding: 0 1.1rem 1rem;
  }
  .mx-modal-body:empty {
    display: none;
  }
  .mx-modal-foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1.1rem;
    border-top: 1px solid var(--mx-line);
    border-radius: 0 0 12px 12px;
    background: var(--mx-subtle);
  }
</style>
