import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const authAttempts = sqliteTable("auth_attempts", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  resetAt: integer("reset_at").notNull(),
});

export const employees = sqliteTable(
  "employees",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations").notNull(),
    role: text("role").notNull(),
    branchScope: text("branch_scope").notNull().default("all"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_employees_username").on(table.username),
    index("idx_employees_role").on(table.role),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_employee_id").on(table.employeeId),
    index("idx_sessions_expires_at").on(table.expiresAt),
  ],
);

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex("uq_branches_code").on(table.code)],
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    homeBranchId: text("home_branch_id").references(() => branches.id),
    status: text("status").notNull().default("active"),
    service: text("service"),
    planName: text("plan_name"),
    planStartsOn: text("plan_starts_on"),
    planEndsOn: text("plan_ends_on"),
    ...timestamps,
  },
  (table) => [
    index("idx_members_status").on(table.status),
    index("idx_members_home_branch_id").on(table.homeBranchId),
    index("idx_members_plan_ends_on").on(table.planEndsOn),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("ARS"),
    method: text("method").notNull(),
    terminal: text("terminal"),
    cardInstallments: integer("card_installments"),
    salesPlanScenarioId: text("sales_plan_scenario_id").references(() => salesPlanScenarios.id),
    requestId: text("request_id"),
    saleKind: text("sale_kind"),
    saleBranchId: text("sale_branch_id").references(() => branches.id),
    planId: text("plan_id"),
    planLabel: text("plan_label"),
    coverageStartsOn: text("coverage_starts_on"),
    coverageMonths: integer("coverage_months"),
    coverageInstallments: integer("coverage_installments"),
    installmentNumber: integer("installment_number"),
    grossAmountCents: integer("gross_amount_cents"),
    costsCents: integer("costs_cents"),
    netAmountCents: integer("net_amount_cents"),
    dueOn: text("due_on"),
    paidOn: text("paid_on"),
    accreditedOn: text("accredited_on"),
    status: text("status").notNull().default("pending"),
    createdByEmployeeId: text("created_by_employee_id").references(() => employees.id),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("uq_payments_request_id").on(table.requestId),
    index("idx_payments_member_id").on(table.memberId),
    index("idx_payments_status").on(table.status),
    index("idx_payments_paid_on").on(table.paidOn),
  ],
);

export const attendance = sqliteTable(
  "attendance",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
    branchId: text("branch_id").notNull().references(() => branches.id),
    method: text("method").notNull(),
    checkedInAt: text("checked_in_at").notNull(),
    recordedByEmployeeId: text("recorded_by_employee_id").references(() => employees.id),
    ...timestamps,
  },
  (table) => [
    index("idx_attendance_member_id").on(table.memberId),
    index("idx_attendance_branch_id").on(table.branchId),
    index("idx_attendance_checked_in_at").on(table.checkedInAt),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadataJson: text("metadata_json"),
    ...timestamps,
  },
  (table) => [
    index("idx_audit_logs_employee_id").on(table.employeeId),
    index("idx_audit_logs_created_at").on(table.createdAt),
    index("idx_audit_logs_entity_action").on(table.entityType, table.entityId, table.action),
  ],
);

// Imported facts retain their source and uncertain values for human review.
export const sheetRosters = sqliteTable("sheet_rosters", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  sourceSheetId: integer("source_sheet_id").notNull(),
  sourceSpreadsheetId: text("source_spreadsheet_id").notNull().default("1uGZ-DU16NWo6PpI1xrtMEDMUAFoWAG1KdVfYDqCuU8s"),
  sourceDetailsJson: text("source_details_json").notNull().default("{}"),
  missingSince: text("missing_since"),
  sourceRow: integer("source_row").notNull(),
  sourceName: text("source_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  service: text("service").notNull(),
  sourceState: text("source_state").notNull(),
  historyJson: text("history_json").notNull(),
  reviewJson: text("review_json").notNull(),
  importedAt: text("imported_at").notNull(),
  archivedAt: text("archived_at"),
}, (t) => [uniqueIndex("uq_sheet_rosters_member").on(t.memberId), index("idx_sheet_rosters_name").on(t.normalizedName, t.service)]);

export const sheetImports = sqliteTable("sheet_imports", {
  id: text("id").primaryKey(),
  branchId: text("branch_id").references(() => branches.id),
  kind: text("kind").notNull(),
  sheetName: text("sheet_name").notNull(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  sheetId: integer("sheet_id").notNull(),
  period: text("period").notNull(),
  recordCount: integer("record_count").notNull(),
  reviewJson: text("review_json").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const sheetAttendance = sqliteTable("sheet_attendance", {
  id: text("id").primaryKey(),
  importId: text("import_id").notNull(),
  normalizedName: text("normalized_name").notNull(),
  sourceName: text("source_name").notNull(),
  attendedOn: text("attended_on").notNull(),
  marker: text("marker").notNull(),
  sourceRowsJson: text("source_rows_json").notNull(),
  version: text("version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("idx_sheet_attendance_period").on(t.importId), index("idx_sheet_attendance_name").on(t.normalizedName)]);

export const sheetNameLinks = sqliteTable("sheet_name_links", {
  normalizedName: text("normalized_name").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  linkedBy: text("linked_by").notNull().references(() => employees.id),
  linkedAt: text("linked_at").notNull(),
});

export const sheetBranchNameLinks = sqliteTable("sheet_branch_name_links", {
  branchId: text("branch_id").notNull().references(() => branches.id),
  normalizedName: text("normalized_name").notNull(),
  memberId: text("member_id").notNull().references(() => members.id),
  linkedBy: text("linked_by").notNull().references(() => employees.id),
  linkedAt: text("linked_at").notNull(),
}, (t) => [primaryKey({columns:[t.branchId,t.normalizedName]})]);

export const sheetTokens = sqliteTable("sheet_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
});

export const sheetMemberAliases = sqliteTable("sheet_member_aliases", {
  normalizedName: text("normalized_name").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  recordedAt: text("recorded_at").notNull(),
});

// Provisional active status does not create a second member or a financial plan.
export const sheetActiveVisitors = sqliteTable("sheet_active_visitors", {
  normalizedName: text("normalized_name").primaryKey(),
  sourceName: text("source_name").notNull(),
  status: text("status").notNull().default("active"),
  declaredAt: text("declared_at").notNull(),
});

export const sheetCorrections = sqliteTable("sheet_corrections", {
  id: text("id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  changesJson: text("changes_json").notNull(),
  appliedAt: text("applied_at").notNull(),
});

// Preserve events that would otherwise disappear when a monthly N/R/B is replaced by A.
export const memberMonthEvents = sqliteTable("member_month_events", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  period: text("period").notNull(),
  kind: text("kind").notNull(),
  observedAt: text("observed_at").notNull(),
}, t => [index("idx_member_month_events_period").on(t.period, t.memberId)]);

export const renewalScenarios = sqliteTable("renewal_scenarios", {
  id: text("id").primaryKey(),
  memberId: text("member_id").notNull().references(() => members.id),
  period: text("period").notNull(),
  dueOn: text("due_on").notNull(),
  planId: text("plan_id").notNull(),
  method: text("method").notNull(),
  amountCents: integer("amount_cents").notNull(),
  probability: integer("probability").notNull().default(100),
  cardCostBps: integer("card_cost_bps"),
  included: integer("included", { mode: "boolean" }).notNull().default(true),
  updatedBy: text("updated_by").notNull().references(() => employees.id),
  updatedAt: text("updated_at").notNull(),
}, t => [uniqueIndex("uq_renewal_scenarios_member_period").on(t.memberId, t.period)]);

// Monthly sales targets retain the selected catalogue prices and cost rates as a period snapshot.
export const salesPlanScenarios = sqliteTable("sales_plan_scenarios", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  saleOn: text("sale_on").notNull(),
  planStartsOn: text("plan_starts_on"),
  branchId: text("branch_id").notNull().references(() => branches.id),
  planId: text("plan_id").notNull(),
  planLabel: text("plan_label").notNull(),
  service: text("service").notNull(),
  currency: text("currency").notNull(),
  months: integer("months").notNull(),
  installments: integer("installments").notNull(),
  method: text("method").notNull(),
  terminal: text("terminal"),
  cardInstallments: integer("card_installments"),
  quantity: integer("quantity").notNull(),
  amountCents: integer("amount_cents").notNull(),
  surchargeBps: integer("surcharge_bps").notNull(),
  salesVatPpm: integer("sales_vat_ppm").notNull().default(210000),
  collectionFeePpm: integer("collection_fee_ppm"),
  collectionFeeVatPpm: integer("collection_fee_vat_ppm"),
  financingFeePpm: integer("financing_fee_ppm"),
  financingFeeVatPpm: integer("financing_fee_vat_ppm"),
  otherCostPpm: integer("other_cost_ppm"),
  otherTaxPpm: integer("other_tax_ppm"),
  iibbRetentionPpm: integer("iibb_retention_ppm"),
  fixedCostCents: integer("fixed_cost_cents"),
  accreditationDays: integer("accreditation_days"),
  provider: text("provider"),
  memberId: text("member_id").references(() => members.id),
  origin: text("origin").notNull().default("projection"),
  updatedBy: text("updated_by").notNull().references(() => employees.id),
  updatedAt: text("updated_at").notNull(),
}, t => [index("idx_sales_plan_scenarios_period").on(t.period, t.branchId)]);

export const monthlyPlanOffers = sqliteTable("monthly_plan_offers", {
  id:text("id").primaryKey(),period:text("period").notNull(),branchId:text("branch_id").notNull().references(()=>branches.id),
  planKey:text("plan_key").notNull(),label:text("label").notNull(),service:text("service").notNull(),currency:text("currency").notNull(),
  months:integer("months").notNull(),installments:integer("installments").notNull(),amountCents:integer("amount_cents").notNull(),
  methodsJson:text("methods_json").notNull(),surchargeBps:integer("surcharge_bps").notNull(),active:integer("active").notNull().default(1),
  updatedBy:text("updated_by").notNull().references(()=>employees.id),updatedAt:text("updated_at").notNull(),
},t=>[uniqueIndex("uq_monthly_offer").on(t.period,t.branchId,t.planKey)]);

export const workEntries = sqliteTable("work_entries", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  branchId: text("branch_id").notNull().references(() => branches.id),
  workOn: text("work_on").notNull(),
  minutes: integer("minutes").notNull(),
  workRole: text("work_role").notNull(),
  note: text("note").notNull().default(""),
  ...timestamps,
}, table => [uniqueIndex("uq_work_employee_branch_day").on(table.employeeId, table.branchId, table.workOn), index("idx_work_branch_day").on(table.branchId, table.workOn)]);

export const hourlyRates = sqliteTable("hourly_rates", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull().references(() => employees.id),
  branchId: text("branch_id").notNull().references(() => branches.id),
  effectiveFrom: text("effective_from").notNull(),
  amountCents: integer("amount_cents").notNull(),
  updatedBy: text("updated_by").notNull().references(() => employees.id),
  ...timestamps,
}, table => [uniqueIndex("uq_hourly_employee_branch_date").on(table.employeeId, table.branchId, table.effectiveFrom)]);

export const payrollMonthSettings = sqliteTable("payroll_month_settings", {
  id: text("id").primaryKey(), branchId: text("branch_id").notNull().references(() => branches.id),
  period: text("period").notNull(), commissionBps: integer("commission_bps").notNull(),
  updatedBy: text("updated_by").notNull().references(() => employees.id), ...timestamps,
}, table => [uniqueIndex("uq_payroll_branch_period").on(table.branchId, table.period)]);

export const payrollBonuses = sqliteTable("payroll_bonuses", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull().references(() => employees.id),
  branchId: text("branch_id").notNull().references(() => branches.id), period: text("period").notNull(),
  eligible: integer("eligible", { mode: "boolean" }).notNull(),
  updatedBy: text("updated_by").notNull().references(() => employees.id), ...timestamps,
}, table => [uniqueIndex("uq_payroll_bonus_employee_branch_period").on(table.employeeId, table.branchId, table.period)]);

export const workSchedules = sqliteTable("work_schedules", {
  id:text("id").primaryKey(),employeeId:text("employee_id").notNull().references(()=>employees.id),
  branchId:text("branch_id").notNull().references(()=>branches.id),effectiveFrom:text("effective_from").notNull(),
  slotsJson:text("slots_json").notNull(),updatedBy:text("updated_by").notNull().references(()=>employees.id),...timestamps,
},t=>[uniqueIndex("uq_work_schedule_date").on(t.employeeId,t.branchId,t.effectiveFrom)]);

export const workShiftChanges = sqliteTable("work_shift_changes", {
  id:text("id").primaryKey(),employeeId:text("employee_id").notNull().references(()=>employees.id),
  branchId:text("branch_id").notNull().references(()=>branches.id),workOn:text("work_on").notNull(),
  kind:text("kind").notNull(),patchJson:text("patch_json").notNull(),shiftStart:integer("shift_start"),shiftEnd:integer("shift_end"),reason:text("reason").notNull(),
  status:text("status").notNull().default("pending"),decidedBy:text("decided_by").references(()=>employees.id),decisionNote:text("decision_note"),decidedAt:text("decided_at"),...timestamps,
},t=>[index("idx_shift_changes_date").on(t.branchId,t.workOn),uniqueIndex("uq_pending_shift_change").on(t.employeeId,t.branchId,t.workOn).where(sql`status = 'pending'`)]);

export const workDayOverrides = sqliteTable("work_day_overrides", {
  id:text("id").primaryKey(),employeeId:text("employee_id").notNull().references(()=>employees.id),branchId:text("branch_id").notNull().references(()=>branches.id),
  workOn:text("work_on").notNull(),slotsJson:text("slots_json").notNull(),updatedBy:text("updated_by").notNull().references(()=>employees.id),...timestamps,
},t=>[uniqueIndex("uq_work_override_day").on(t.employeeId,t.branchId,t.workOn)]);

export const workShiftRecords = sqliteTable("work_shift_records", {
  id:text("id").primaryKey(),employeeId:text("employee_id").notNull().references(()=>employees.id),branchId:text("branch_id").notNull().references(()=>branches.id),
  workOn:text("work_on").notNull(),startHour:integer("start_hour").notNull(),endHour:integer("end_hour").notNull(),status:text("status").notNull(),
  confirmedAt:text("confirmed_at"),distanceMeters:integer("distance_meters"),accuracyMeters:integer("accuracy_meters"),
  updatedBy:text("updated_by").notNull().references(()=>employees.id),note:text("note").notNull().default(""),...timestamps,
},t=>[uniqueIndex("uq_work_record_turn").on(t.employeeId,t.branchId,t.workOn,t.startHour,t.endHour),index("idx_work_record_date").on(t.branchId,t.workOn)]);

export const branchWorkLocations = sqliteTable("branch_work_locations", {
  branchId:text("branch_id").primaryKey().references(()=>branches.id),latitude:real("latitude").notNull(),longitude:real("longitude").notNull(),
  radiusMeters:integer("radius_meters").notNull().default(100),updatedBy:text("updated_by").notNull().references(()=>employees.id),...timestamps,
});

export const branchGeofences = sqliteTable("branch_geofences", {
  branchId:text("branch_id").primaryKey().references(()=>branches.id),address:text("address").notNull(),
  latitude:real("latitude"),longitude:real("longitude"),radiusMeters:integer("radius_meters").notNull().default(100),
  updatedBy:text("updated_by").references(()=>employees.id),...timestamps,
});
