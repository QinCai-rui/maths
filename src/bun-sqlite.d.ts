declare module "bun:sqlite" {
  export class Database {
    constructor(path: string, options?: { create?: boolean });
    run(query: string): void;
    query<T, Params extends unknown[] = unknown[]>(query: string): {
      all(...params: Params): T[];
      run(...params: Params): void;
    };
  }
}
