/** Keyboard and background isolation for the custom Basic Facts dialogs. */
export function modalFocus(dialog: HTMLElement) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const hidden: { element: HTMLElement; inert: boolean }[] = [];
  const overflow = document.body.style.overflow;
  let branch: HTMLElement = dialog;
  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        hidden.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }
  document.body.style.overflow = "hidden";

  const controls = () =>
    Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]'
      )
    ).filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));

  function trap(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const elements = controls();
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault();
      first.focus();
    }
  }

  dialog.addEventListener("keydown", trap);
  queueMicrotask(() => {
    if (dialog.isConnected) (controls()[0] ?? dialog).focus();
  });
  return {
    destroy() {
      dialog.removeEventListener("keydown", trap);
      for (const { element, inert } of hidden) element.inert = inert;
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    }
  };
}
