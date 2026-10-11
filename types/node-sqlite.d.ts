/**
 * Minimal typings for Node's built-in SQLite module (node:sqlite), which the
 * installed @types/node predates. Covers only what lib/recordings-library.ts
 * uses: opening a database read-only and running prepared queries.
 */
declare module 'node:sqlite' {
  type SqlValue = null | number | bigint | string | Uint8Array;

  interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  class StatementSync {
    all(...params: SqlValue[]): Record<string, SqlValue>[];
    get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
  }

  class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
