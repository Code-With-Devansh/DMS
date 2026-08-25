CREATE TYPE "public"."case_status" AS ENUM('OPEN', 'UNDER_INVESTIGATION', 'CHARGESHEETED', 'IN_TRIAL', 'CLOSED', 'ARCHIVED'); 
CREATE TABLE "case_assignments" (
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_on_case" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid NOT NULL,
	CONSTRAINT "case_assignments_case_id_user_id_key" UNIQUE("case_id","user_id")
);
 
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" "case_status" DEFAULT 'OPEN' NOT NULL,
	"classification" "classification" NOT NULL,
	"jurisdiction" text NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"legal_hold_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_case_number_key" UNIQUE("case_number")
);
 
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action; 
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action; 
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action; 
CREATE INDEX "case_assignments_case_id_idx" ON "case_assignments" USING btree ("case_id"); 
CREATE INDEX "case_assignments_user_id_idx" ON "case_assignments" USING btree ("user_id"); 
CREATE INDEX "case_assignments_role_on_case_idx" ON "case_assignments" USING btree ("role_on_case"); 
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("status"); 
CREATE INDEX "cases_classification_idx" ON "cases" USING btree ("classification"); 
CREATE INDEX "cases_jurisdiction_idx" ON "cases" USING btree ("jurisdiction"); 
CREATE INDEX "cases_created_by_idx" ON "cases" USING btree ("created_by"); 
CREATE INDEX "cases_updated_at_idx" ON "cases" USING btree ("updated_at");