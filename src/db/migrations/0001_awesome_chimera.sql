CREATE TYPE "public"."document_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "document_members" (
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "document_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "document_members_document_id_user_id_pk" PRIMARY KEY("document_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"author_id" text NOT NULL,
	"seq" bigserial NOT NULL,
	"op" jsonb NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"created_by" text NOT NULL,
	"label" text,
	"state" jsonb NOT NULL,
	"upto_seq" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_members" ADD CONSTRAINT "document_members_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_members" ADD CONSTRAINT "document_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ops" ADD CONSTRAINT "document_ops_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ops" ADD CONSTRAINT "document_ops_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_snapshots" ADD CONSTRAINT "document_snapshots_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_ops_doc_seq_idx" ON "document_ops" USING btree ("document_id","seq");