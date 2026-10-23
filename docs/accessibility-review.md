# Review accessibility before a release

Use this checklist alongside the CI reports. A green automated scan is not proof
that a page meets WCAG 2.2 AA.

1. Open each changed task in light and dark themes. Check its normal, hover,
   focus, selected, error, and success states.
2. Inspect axe's `incomplete` findings in the browser report. Record whether each
   needs a fix or additional testing.
3. Complete the task using only Tab, Shift+Tab, Enter, Space, arrow keys, and
   Escape. Confirm that focus remains visible and follows a useful order.
4. Open and close dialogs. Confirm that keyboard focus enters the dialog, stays
   inside it, and returns to the control that opened it.
5. Check text contrast. Normal text needs at least 4.5:1. Large text needs at
   least 3:1. Disabled controls have different requirements.
6. Check important control boundaries, icons, and focus indicators against their
   adjacent colours. Check for at least 3:1 non-text contrast where WCAG requires it.
   Do not use colour alone to communicate an answer or an error.
7. Use 200% browser zoom and a viewport equivalent to 320 CSS pixels. Check that
   controls and text remain usable without page-wide horizontal scrolling.
8. Enable reduced motion. Check that answer effects, transitions, and confetti
   respect the preference.
9. Use a screen reader to navigate headings, landmarks, labels, questions,
   validation errors, and game-state changes. Confirm that timers do not drown
   out useful announcements.
10. Read mathematical notation with a screen reader and enter an expression with
    the keyboard. Confirm that the spoken expression preserves its meaning.
11. For sketch-pad changes, confirm that drawing is not the only way to complete
    the maths task and that essential information has a text alternative.
12. For printing changes, inspect the exported PDF's reading order, selectable
    text, mathematical notation, clipping, and pagination. Do not infer PDF
    accessibility from a passing web-page scan.

Record the pages, states, browser, assistive technology, and unresolved failures
in the release review. Do not mark untested criteria as passing.
