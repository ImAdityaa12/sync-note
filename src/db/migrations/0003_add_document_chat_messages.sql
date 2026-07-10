CREATE TYPE "public"."ai_chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "document_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "ai_chat_role" NOT NULL,
	"task" text,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_chat_messages" ADD CONSTRAINT "document_chat_messages_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chat_messages" ADD CONSTRAINT "document_chat_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_chat_messages_doc_user_idx" ON "document_chat_messages" USING btree ("document_id","user_id","created_at");