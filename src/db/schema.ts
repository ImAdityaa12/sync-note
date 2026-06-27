import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Better Auth core schema (identity layer).
 *
 * Property names (camelCase) must stay aligned with Better Auth's expected
 * model fields; the string arguments are the snake_case Postgres column names.
 * Generated to match better-auth@1.6.
 *
 * Per-document roles (Owner / Editor / Viewer) live on `document_members`
 * below, not on the global user record.
 */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/* -------------------------------------------------------------------------- */
/*  Documents domain                                                          */
/*                                                                            */
/*  Postgres is the durable sync peer, not what the editor UI waits on. The   */
/*  client (IndexedDB) is the source of truth; these tables persist the op    */
/*  log, snapshots, and per-document membership/roles.                        */
/* -------------------------------------------------------------------------- */

export const documentRole = pgEnum("document_role", [
  "owner",
  "editor",
  "viewer",
]);

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Untitled"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * Per-user access to a document. The owner is also a row here (role "owner"),
 * so every authorization check funnels through a single table. The composite
 * primary key enforces one membership per (document, user).
 */
export const documentMembers = pgTable(
  "document_members",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: documentRole("role").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.userId] })]
);

/**
 * Durable, append-only CRDT operation log. `id` is the client-generated op uuid
 * so re-pushing the same op is idempotent. `seq` is a server-assigned monotonic
 * cursor used by clients to pull "everything since N". `byteSize` is recorded so
 * payload size can be bounded/audited.
 */
export const documentOps = pgTable(
  "document_ops",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    op: jsonb("op").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("document_ops_doc_seq_idx").on(table.documentId, table.seq)]
);

/**
 * Point-in-time version snapshots for time-travel. `state` is the materialized
 * document at capture; `uptoSeq` records the op cursor so a restore can be
 * expressed as forward ops rather than a destructive overwrite.
 */
export const documentSnapshots = pgTable("document_snapshots", {
  id: text("id").primaryKey(),
  documentId: text("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  label: text("label"),
  state: jsonb("state").notNull(),
  uptoSeq: bigint("upto_seq", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
