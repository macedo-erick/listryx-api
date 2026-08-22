CREATE TABLE "list" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(10) DEFAULT 'open' NOT NULL,
	"template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "list_status_check" CHECK ("list"."status" IN ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "list_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"text" varchar(500) NOT NULL,
	"normalized_text" varchar(500) GENERATED ALWAYS AS (lower(btrim(text))) STORED,
	"quantity" numeric(10, 2),
	"unit_price" numeric(12, 2),
	"checked" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "list_template_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"text" varchar(500) NOT NULL,
	"default_quantity" numeric(10, 2),
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list" ADD CONSTRAINT "list_template_id_list_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."list_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_item" ADD CONSTRAINT "list_item_list_id_list_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_template_item" ADD CONSTRAINT "list_template_item_template_id_list_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."list_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_list_owner_status" ON "list" USING btree ("owner_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_list_item_list_id" ON "list_item" USING btree ("list_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_list_item_normalized_text" ON "list_item" USING btree ("normalized_text") WHERE unit_price IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_list_template_owner_id" ON "list_template" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "idx_list_template_item_template_id" ON "list_template_item" USING btree ("template_id","sort_order");