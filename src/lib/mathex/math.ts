import { all, create } from "mathjs";

// A single mathjs instance shared by the calculator logic and its LaTeX
// helpers (creating `all` is not free, so avoid doing it per module).
export const math = create(all);
