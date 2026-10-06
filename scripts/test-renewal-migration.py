"""Exercise the historical correction with populated, foreign-key-checked data."""
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
for migration in sorted((root / "drizzle").glob("*.sql")):
    if migration.name.startswith("0014_"):
        correction = migration.read_text()
        break
    db.executescript(migration.read_text())

def insert(table, values):
    columns = ",".join(values)
    db.execute(f"INSERT INTO {table} ({columns}) VALUES ({','.join('?' for _ in values)})", tuple(values.values()))

member = "sheet-5f9ec1de5cc8e377daee28ea75451a9c6d3fb6904eb482049fde5578dad9b2fa"
sale = "e26f9718-ccf6-4d28-896e-14408ded7197"
insert("employees", dict(id="test-operator", username="migration-test", display_name="Test", password_hash="unused", password_salt="unused", password_iterations=1, role="general_admin"))
insert("branches", dict(id="test-branch", name="Test", code="TEST"))
insert("members", dict(id=member, full_name="Test member", plan_starts_on="2026-09-29", plan_ends_on="2027-03-29"))
insert("sales_plan_scenarios", dict(id=sale, period="2026-09", sale_on="2026-09-29", branch_id="test-branch", plan_id="gym-6-2", plan_label="Test plan", service="gym", currency="ARS", months=6, installments=2, method="cash", quantity=1, amount_cents=36000000, surcharge_bps=0, member_id=member, origin="member_sale", updated_by="test-operator", updated_at="2026-09-29"))
insert("payments", dict(id="test-payment", member_id=member, amount_cents=36000000, method="cash", paid_on="2026-09-29", due_on="2026-09-29", coverage_starts_on="2026-09-29", installment_number=1, sales_plan_scenario_id=sale))
db.executescript(correction)
assert db.execute("SELECT sale_on,plan_starts_on FROM sales_plan_scenarios WHERE id=?", (sale,)).fetchone() == ("2026-09-29", "2026-09-19")
assert db.execute("SELECT paid_on,due_on,coverage_starts_on,amount_cents FROM payments WHERE id='test-payment'").fetchone() == ("2026-09-29", "2026-09-19", "2026-09-19", 36000000)
assert db.execute("SELECT plan_starts_on,plan_ends_on FROM members WHERE id=?", (member,)).fetchone() == ("2026-09-19", "2027-03-19")
assert db.execute("SELECT employee_id FROM audit_logs WHERE id='owner-confirmed-renewal-start-20260919'").fetchone() == ("test-operator",)
assert not db.execute("PRAGMA foreign_key_check").fetchall()
print("PASS: populated renewal migration preserves receipt and amount, corrects coverage, and records valid audit reference.")
