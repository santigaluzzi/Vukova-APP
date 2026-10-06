"use client";
import {BranchGeofenceSettings} from "./branch-geofence-settings";

import * as React from "react";
import {
  ArrowUpRight,
  BadgeDollarSign,
  Bell,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPin,
  Plus,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
  UserRound,
  UsersRound,
  WalletCards,
} from "lucide-react";

import { can, canAny, scopeBranchIds, encodeBranchScope, roleLabels, type EmployeeRole } from "@/lib/permissions";
import type { MemberState } from "@/lib/member-analytics";
import { ImportedMembers, ImportedAttendance, SheetsConnection } from "@/app/imported-data";
import { FinanceDashboard } from "@/app/finance-dashboard";
import { CollectionsDashboard } from "@/app/collections-dashboard";
import { MemberPaymentForm } from "@/app/member-payment-form";
import { PayrollDashboard } from "@/app/payroll-dashboard";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type View =
  | "overview"
  | "members"
  | "attendance"
  | "payments"
  | "finance"
  | "payroll"
  | "team"
  | "settings";

type Viewer = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: EmployeeRole;
  roleLabel: string;
  branchScope: string;
} | null;

type AdminDashboardProps = {
  viewer: Viewer;
  setupRequired: boolean;
  databaseError?: string;
};

type EmployeeSummary = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  role: EmployeeRole;
  roleLabel: string;
  branchScope: string;
  branchName: string;
  active: boolean;
  createdAt: string;
};

type EmployeeForm = {
  displayName: string;
  username: string;
  email: string;
  role: EmployeeRole;
  branchScope: string;
  password: string;
  confirmPassword: string;
};

type OverviewMembersData = {
  members: Array<{ branchId: string; service: string; status: MemberState }>;
  today: string;
  viewBranch: string;
};

const branchData = [
  { id: "branch-victoria", name: "Victoria", tone: "bg-[#b6e557]", short: "VI" },
  { id: "branch-acassuso", name: "Acassuso", tone: "bg-[#75d8c8]", short: "AC" },
  { id: "branch-vilo", name: "Vilo", tone: "bg-[#f4bd6b]", short: "VI" },
  { id: "branch-olivos", name: "Olivos", tone: "bg-[#8fa8ee]", short: "OL" },
  { id: "branch-delta", name: "Delta", tone: "bg-[#e18cbd]", short: "DE" },
];

const branchOptions = [
  { id: "branch-delta", name: "Vukova Delta" },
  { id: "branch-victoria", name: "Vukova Victoria" },
  { id: "branch-acassuso", name: "Vukova Acassuso" },
  { id: "branch-olivos", name: "Vukova Olivos" },
  { id: "branch-vilo", name: "Vukova Vilo" },
];

const employeeRoleOptions: Array<{ value: EmployeeRole; label: string; detail: string }> = [
  { value: "admin", label: "Administrador general", detail: "Acceso ilimitado a todas las sedes" },
  { value: "branch_manager", label: "Coordinador / encargado de sede", detail: "Acceso completo a la sede asignada, incluidos finanzas y usuarios" },
  { value: "administrative", label: "Administrativo", detail: "Acceso completo a la sede asignada, incluidos finanzas y usuarios" },
  { value: "teacher", label: "Profesor", detail: "Socios y asistencias de sus sedes, más sus propias horas y sueldo" },
];

const navItems: Array<{
  id: View;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "operacion" | "gestion";
  permissions?: string[];
}> = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard, group: "operacion", permissions: ["overview.read"] },
  { id: "members", label: "Socios", icon: UsersRound, group: "operacion", permissions: ["members.read", "members.manage"] },
  { id: "attendance", label: "Asistencias", icon: ClipboardCheck, group: "operacion", permissions: ["attendance.manage"] },
  { id: "payments", label: "Cobros", icon: CreditCard, group: "operacion", permissions: ["payments.manage", "payments.register"] },
  { id: "finance", label: "Finanzas", icon: WalletCards, group: "gestion", permissions: ["finance.manage"] },
  { id: "payroll", label: "Horas y sueldos", icon: CalendarClock, group: "operacion", permissions: ["payroll.self"] },
  { id: "team", label: "Usuarios y permisos", icon: UserCog, group: "gestion", permissions: ["users.manage"] },
  { id: "settings", label: "Configuración", icon: Settings2, group: "gestion", permissions: ["settings.manage"] },
];

const roleRows = employeeRoleOptions.map((option, index) => ({
  role: option.label, scope: option.value === "admin" ? "Todas las sedes" : option.value === "teacher" ? "Una o más sedes" : "Una sede asignada",
  detail: option.detail, tone: ["bg-[#b6e557] text-[#25331c]", "bg-[#ffe4bb] text-[#724b1e]", "bg-[#dce8ff] text-[#274473]", "bg-[#f4d7ec] text-[#754f6d]"][index],
}));

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-AR").format(value);
}

export default function AdminDashboard({ viewer, setupRequired, databaseError }: AdminDashboardProps) {
  if (databaseError) return <AuthScreen setupRequired={false} databaseError={databaseError} />;
  if (!viewer) return <AuthScreen setupRequired={setupRequired} />;

  return <AuthenticatedDashboard viewer={viewer} />;
}

function AuthenticatedDashboard({ viewer }: { viewer: NonNullable<Viewer> }) {
  const [activeView, setActiveView] = React.useState<View>("members");
  const allowedBranches = branchOptions.filter(branch => scopeBranchIds(viewer.branchScope).includes(branch.id));
  const [selectedBranch, setSelectedBranch] = React.useState(allowedBranches.length === 1 ? allowedBranches[0].id : "all");
  const [paymentStartMode, setPaymentStartMode] = React.useState<"new_member" | "renewal" | "installment">("renewal");
  const [paymentMemberId, setPaymentMemberId] = React.useState("");
  const [paymentKey, setPaymentKey] = React.useState(0);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [membersRevision, setMembersRevision] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);

  const displayName = viewer.displayName;
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3200);
  }

  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("logout");
      window.location.reload();
    } catch {
      showNotice("No se pudo cerrar la sesión. Intentá nuevamente.");
    }
  }

  const visibleNavItems = navItems.filter((item) => !item.permissions || canAny(viewer.role, item.permissions));

  function navigateTo(view: View) {
    const item = navItems.find((candidate) => candidate.id === view);
    if (item?.permissions && !canAny(viewer.role, item.permissions)) {
      showNotice("Tu rol no tiene permisos para esa sección.");
      return;
    }
    setActiveView(view);
  }

  function startNewMember() {
    if (!can(viewer.role, "payments.manage")) return;
    setPaymentStartMode("new_member");
    setPaymentMemberId("");
    setPaymentKey(value => value + 1);
    setActiveView("members");
    setPaymentOpen(true);
  }

  function startMemberPayment(memberId: string, mode: "renewal" | "installment") {
    if (!canAny(viewer.role, ["payments.manage", "payments.register"])) return;
    setPaymentMemberId(memberId);
    setPaymentStartMode(mode);
    setPaymentKey(value => value + 1);
    setActiveView("members");
    setPaymentOpen(true);
  }

  const currentTitle = navItems.find((item) => item.id === activeView)?.label ?? "Resumen";
  const selectedBranchName = selectedBranch === "all"
    ? (viewer.role === "admin" ? "Todas las sedes" : "Mis sedes")
    : branchOptions.find((branch) => branch.id === selectedBranch)?.name.replace("Vukova ", "") ?? "Sede asignada";
  const filterableViews: View[] = ["overview", "members", "attendance", "payments", "finance", "team", "payroll"];

  if (!allowedBranches.length) return <div className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-xl font-semibold">Falta asignar tu sede</h1><p>Pedile al administrador general que seleccione tu sede en Usuarios y permisos.</p><Button onClick={logout}>Cerrar sesión</Button></div>;

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="offcanvas" className="border-sidebar-border bg-[#102033]">
        <SidebarHeader className="border-b border-white/10 p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#b6e557] text-lg font-black text-[#102033] shadow-[0_0_0_5px_rgba(182,229,87,0.12)]">
              V
            </div>
            <div>
              <p className="text-base font-semibold tracking-tight text-white">Vukova</p>
              <p className="text-xs font-medium text-[#a9bacb]">Administración</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-3 py-4">
          <SidebarGroup className="p-0">
            <SidebarGroupLabel className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8297aa]">
              Operación
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNavItems.filter((item) => item.group === "operacion").map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeView === item.id}
                      className="h-11 rounded-xl px-3 text-[#c6d2de] hover:bg-white/10 hover:text-white data-[active=true]:bg-[#b6e557] data-[active=true]:text-[#17251b]"
                    >
                      <button type="button" onClick={() => navigateTo(item.id)}>
                        <item.icon className="size-[18px]" />
                        <span>{item.label}</span>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-7 p-0">
            <SidebarGroupLabel className="px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8297aa]">
              Gestión
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleNavItems.filter((item) => item.group === "gestion").map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={activeView === item.id}
                      className="h-11 rounded-xl px-3 text-[#c6d2de] hover:bg-white/10 hover:text-white data-[active=true]:bg-[#b6e557] data-[active=true]:text-[#17251b]"
                    >
                      <button type="button" onClick={() => navigateTo(item.id)}>
                        <item.icon className="size-[18px]" />
                        <span>{item.label}</span>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] p-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#dce8ff] text-xs font-bold text-[#274473]">
              {initials || "VP"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <p className="truncate text-xs text-[#9eb1c3]">{viewer.roleLabel}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={logout} className="size-8 shrink-0 rounded-lg text-[#9eb1c3] hover:bg-white/10 hover:text-white" title="Cerrar sesión">
              <LogOut className="size-4" />
              <span className="sr-only">Cerrar sesión</span>
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-h-svh bg-[#f5f7fa]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-[#dde4eb] bg-[#f5f7fa]/95 px-5 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="text-[#516476] md:hidden" />
            <div>
              <p className="hidden text-xs font-medium uppercase tracking-[0.16em] text-[#8192a3] sm:block">Panel administrativo</p>
              <h1 className="text-xl font-bold tracking-tight text-[#15273a]">{currentTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" disabled={allowedBranches.length < 2} aria-label={`Filtrar información por sede: ${selectedBranchName}`} title={allowedBranches.length > 1 ? "Filtrar información por sede" : "Tu cuenta está asignada a esta sede"} className="h-10 max-w-[156px] gap-2 border-[#dbe3ea] bg-white px-2.5 text-xs text-[#516476] shadow-sm hover:bg-white md:max-w-none md:px-3 md:text-sm">
                  <MapPin className="size-4 shrink-0 text-[#7890a4]" />
                  <span className="truncate">{selectedBranchName}</span>
                  <ChevronDown className="size-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Mostrar información de</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={selectedBranch} onValueChange={setSelectedBranch}>
                  {allowedBranches.length > 1 && <DropdownMenuRadioItem value="all">{viewer.role === "admin" ? "Todas las sedes" : "Mis sedes"}</DropdownMenuRadioItem>}
                  {allowedBranches.map((branch) => <DropdownMenuRadioItem key={branch.id} value={branch.id}>{branch.name.replace("Vukova ", "")}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" className="rounded-xl text-[#617487] hover:bg-white hover:text-[#15273a]">
              <Bell className="size-[18px]" />
              <span className="sr-only">Notificaciones</span>
            </Button>
            <div className="flex size-9 items-center justify-center rounded-full bg-[#102033] text-xs font-bold text-white">{initials || "VP"}</div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1500px] flex-1 px-5 py-7 md:px-8 md:py-9">
          {filterableViews.includes(activeView) && <div className="mb-6 rounded-xl border border-[#dce4eb] bg-white p-4 text-sm text-[#516476]">Filtro activo: <span className="font-semibold text-[#25394c]">{selectedBranchName}</span>. Se aplica a la información de esta sección y se conserva al cambiar de pantalla.</div>}
          {activeView === "overview" && can(viewer.role, "overview.read") && (
            <><p className="mb-4 text-sm text-[#718294]">El conteo se actualiza con los socios activos de gimnasio del padrón y el mes en curso.</p><OverviewView selectedBranch={selectedBranch} onNewMember={startNewMember} onNavigate={navigateTo} /></>
          )}
          {activeView === "members" && (
            <ImportedMembers key={membersRevision} branchFilter={selectedBranch} onNewMember={can(viewer.role, "members.manage") ? startNewMember : undefined} onPayment={startMemberPayment} />
          )}
          {activeView === "attendance" && <ImportedAttendance branchFilter={selectedBranch} />}
          {activeView === "payments" && <CollectionsDashboard branchFilter={selectedBranch} />}
          {activeView === "finance" && <FinanceDashboard branchFilter={selectedBranch} allowedBranchIds={allowedBranches.map(branch => branch.id)} />}
          {activeView === "payroll" && <PayrollDashboard viewer={viewer} branchFilter={selectedBranch} />}
          {activeView === "team" && <TeamView viewer={viewer} branchFilter={selectedBranch} onNotice={showNotice} />}
          {activeView === "settings" && <>{can(viewer.role, "settings.global") && <SheetsConnection />}<SettingsView branchScope={viewer.branchScope} role={viewer.role} /></>}
        </div>
      </SidebarInset>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{paymentStartMode === "new_member" ? "Venta a un nuevo socio" : paymentStartMode === "installment" ? "Cobrar cuota" : "Renovar plan"}</DialogTitle><DialogDescription>Registro de pago desde la ficha del socio</DialogDescription></DialogHeader>{paymentOpen && <MemberPaymentForm key={paymentKey} mode={paymentStartMode} memberId={paymentMemberId} branchFilter={selectedBranch} onSaved={message => {setPaymentOpen(false);setMembersRevision(r=>r+1);showNotice(message);}} />}</DialogContent></Dialog>
      {notice && (
        <div className="fixed right-5 bottom-5 z-50 flex items-center gap-3 rounded-xl bg-[#102033] px-4 py-3 text-sm font-medium text-white shadow-xl" role="status">
          <Check className="size-4 text-[#b6e557]" />
          {notice}
        </div>
      )}
    </SidebarProvider>
  );
}

function AuthScreen({ setupRequired, databaseError }: { setupRequired: boolean; databaseError?: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(databaseError ?? null);
  const [form, setForm] = React.useState({ displayName: "", username: "", password: "", confirmPassword: "" });
  const setupKeyInput = React.useRef<HTMLInputElement>(null);
  const activationKey = React.useRef("");
  React.useEffect(() => {
    if (!setupRequired) return;
    const key = new URLSearchParams(window.location.hash.slice(1)).get("activation");
    if (key) {
      activationKey.current = key;
      if (setupKeyInput.current) setupKeyInput.current.value = key;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [setupRequired]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setupRequired ? { ...form, setupKey: setupKeyInput.current?.value || activationKey.current } : { username: form.username, password: form.password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "No se pudo completar la operación.");
        return;
      }
      window.location.reload();
    } catch {
      setError("No se pudo conectar con Vukova. Intentá nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#102033] px-5 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] bg-white shadow-[0_30px_90px_rgba(3,14,27,0.35)] lg:grid-cols-[0.9fr_1.1fr]">
        <section className="relative hidden overflow-hidden bg-[#172c43] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-24 size-64 rounded-full border-[36px] border-[#b6e557]/15" />
          <div className="absolute -bottom-28 -left-24 size-72 rounded-full border-[42px] border-[#75d8c8]/10" />
          <div>
            <div className="flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-[#b6e557] text-xl font-black text-[#102033]">V</div><span className="text-lg font-semibold">Vukova</span></div>
            <p className="mt-16 max-w-sm text-4xl font-bold leading-[1.08] tracking-[-0.05em]">La operación de todas tus sedes, bajo control.</p>
            <p className="mt-5 max-w-sm text-[15px] leading-6 text-[#b6c6d5]">Socios, cobros, asistencias y finanzas con permisos claros para cada persona del equipo.</p>
          </div>
          <div className="relative flex items-center gap-3 text-sm text-[#b6c6d5]"><ShieldCheck className="size-5 text-[#b6e557]" />Sesiones individuales y acciones auditables</div>
        </section>
        <section className="flex items-center justify-center p-7 sm:p-12">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-[#102033] text-lg font-black text-[#b6e557]">V</div><span className="text-lg font-bold text-[#15273a]">Vukova</span></div></div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#7890a4]">Administración</p>
            <h1 className="mt-3 text-3xl font-bold tracking-[-0.04em] text-[#15273a]">{setupRequired ? "Crear cuenta administradora" : "Ingresar a Vukova"}</h1>
            <p className="mt-3 text-[15px] leading-6 text-[#718294]">{setupRequired ? "Esta será la primera cuenta y tendrá acceso total para configurar el equipo." : "Usá tu usuario y contraseña de Vukova para continuar."}</p>
            {databaseError ? <div className="mt-6 rounded-xl border border-[#f1c7c7] bg-[#fff5f5] p-3 text-sm leading-5 text-[#9b4a4a]">{databaseError}</div> : <form onSubmit={submit} className="mt-7 space-y-5">
              {setupRequired && <label className="block space-y-2 text-sm font-medium text-[#34495c]">Código privado de activación<Input ref={setupKeyInput} type="password" autoComplete="off" placeholder="Incluido en tu enlace de activación" required /><span className="block text-xs font-normal text-[#718294]">Solo se usa una vez, para crear la primera cuenta administradora.</span></label>}
              {setupRequired && <label className="block space-y-2 text-sm font-medium text-[#34495c]">Nombre completo<Input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Ej. Santiago Galuzzi" autoFocus /></label>}
              <label className="block space-y-2 text-sm font-medium text-[#34495c]">Usuario<Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="santiago.galuzzi" autoFocus={!setupRequired} autoComplete="username" /></label>
              <label className="block space-y-2 text-sm font-medium text-[#34495c]">Contraseña<Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 12 caracteres" minLength={setupRequired ? 12 : undefined} maxLength={128} autoComplete={setupRequired ? "new-password" : "current-password"} required /></label>
              {setupRequired && <label className="block space-y-2 text-sm font-medium text-[#34495c]">Repetir contraseña<Input type="password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} placeholder="Repetí la contraseña" autoComplete="new-password" /></label>}
              {error && <div className="rounded-xl border border-[#f1c7c7] bg-[#fff5f5] p-3 text-sm leading-5 text-[#9b4a4a]" role="alert">{error}</div>}
              <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl bg-[#102033] text-white hover:bg-[#1d3752]">{busy ? "Procesando…" : setupRequired ? "Crear cuenta y entrar" : "Ingresar"}</Button>
            </form>}
            {!databaseError && setupRequired && <p className="mt-5 text-xs leading-5 text-[#8a99a7]">Después podrás crear cuentas individuales y asignarles un rol y una sede.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function OverviewView({ selectedBranch, onNewMember, onNavigate }: { selectedBranch: string; onNewMember: () => void; onNavigate: (view: View) => void }) {
  const [membersData, setMembersData] = React.useState<OverviewMembersData | null>(null);
  const [loadError, setLoadError] = React.useState<{ branch: string; message: string } | null>(null);
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/members?branch=${encodeURIComponent(selectedBranch)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const body = await response.json() as OverviewMembersData & { error?: string };
        if (!response.ok) throw new Error(body.error || "No se pudo actualizar el padrón de socios.");
        return body;
      })
      .then(body => { setMembersData(body); setLoadError(null); })
      .catch(error => { if (error.name !== "AbortError") setLoadError({ branch: selectedBranch, message: error.message }); });
    return () => controller.abort();
  }, [selectedBranch, revision]);

  const visibleBranches = selectedBranch === "all" ? branchData : branchData.filter(branch => branch.id === selectedBranch);
  const dataReady = membersData?.viewBranch === selectedBranch;
  const branchCounts = new Map(visibleBranches.map(branch => [branch.id, 0]));
  if (dataReady) {
    for (const member of membersData.members) {
      if (member.service === "gym" && (member.status === "active" || member.status === "new") && branchCounts.has(member.branchId)) {
        branchCounts.set(member.branchId, (branchCounts.get(member.branchId) ?? 0) + 1);
      }
    }
  }
  const activeBranches = visibleBranches.map(branch => ({ ...branch, count: branchCounts.get(branch.id) ?? 0 }));
  const total = activeBranches.reduce((sum, branch) => sum + branch.count, 0);
  const visibleLabel = selectedBranch === "all" ? "Todas las sedes" : visibleBranches[0]?.name ?? "Sede asignada";
  const currentError = loadError?.branch === selectedBranch ? loadError.message : null;
  const currentDate = membersData?.today ? new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${membersData.today}T12:00:00Z`)) : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="mb-2 text-sm font-medium text-[#738698]">{dataReady && currentDate ? `Activos calculados al ${currentDate}` : currentError ? "No se pudo actualizar el padrón" : "Actualizando socios activos…"}</p>
          <h2 className="text-3xl font-bold tracking-[-0.04em] text-[#15273a] md:text-4xl">La operación, en un solo lugar.</h2>
          <p className="mt-2 max-w-xl text-[15px] leading-6 text-[#65788b]">El núcleo administrativo de Vukova empieza con socios, cobros, asistencias y permisos claros para cada sede.</p>
        </div>
        <Button onClick={onNewMember} className="h-11 rounded-xl bg-[#102033] px-5 text-white shadow-[0_8px_18px_rgba(16,32,51,0.16)] hover:bg-[#1d3752]">
          <Plus className="size-4" />
          Nuevo socio
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Socios activos de gimnasio" value={dataReady ? formatNumber(total) : "—"} detail={dataReady ? (selectedBranch === "all" ? "5 sedes · excluye pileta" : `${visibleLabel} · excluye pileta`) : currentError ? "No se pudo leer el padrón actual" : "Cargando datos actuales"} icon={UsersRound} tone="lime" />
        <MetricCard label="Pagos a vencer" value="—" detail="Se calcula al cargar socios" icon={CalendarClock} tone="blue" />
        <MetricCard label="Asistencias de hoy" value="—" detail="Manual, QR y NFC" icon={ClipboardCheck} tone="amber" />
        <MetricCard label="Caja del mes" value="—" detail="Bruto, costos y neto" icon={BadgeDollarSign} tone="pink" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_0.9fr]">
        <Card className="overflow-hidden border-[#dce4eb] bg-white shadow-[0_14px_36px_rgba(24,48,72,0.06)]">
          <CardHeader className="border-b border-[#edf1f4] pb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg text-[#15273a]">Socios activos por sede</CardTitle>
                <CardDescription className="mt-1">Gimnasio · estado del mes actual, con el mismo criterio que en Socios.</CardDescription>
              </div>
              <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setRevision(value => value + 1)} aria-label="Actualizar socios activos">Actualizar</Button><Badge className="bg-[#edf6d7] text-[#456423] hover:bg-[#edf6d7]">{visibleLabel}</Badge></div>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="mb-6 flex h-3 overflow-hidden rounded-full bg-[#edf1f4]">
              {dataReady && total > 0 && activeBranches.map((branch) => <div key={branch.name} className={branch.tone} style={{ width: `${(branch.count / total) * 100}%` }} />)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeBranches.map((branch) => (
                <div key={branch.name} className="flex items-center justify-between gap-3 rounded-xl border border-[#e8edf1] bg-[#fbfcfd] p-3.5">
                  <div className="flex items-center gap-3">
                    <div className={`flex size-9 items-center justify-center rounded-lg text-[11px] font-bold text-[#203346] ${branch.tone}`}>{branch.short}</div>
                    <div><p className="text-sm font-semibold text-[#263b4f]">{branch.name}</p><p className="text-xs text-[#8292a1]">Sede habilitada</p></div>
                  </div>
                  <span className="text-lg font-bold text-[#15273a]">{dataReady ? formatNumber(branch.count) : "—"}</span>
                </div>
              ))}
            </div>
            {currentError ? <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{currentError}</p> : <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#f4f7fa] p-3 text-xs leading-5 text-[#718294]"><CircleAlert className="mt-0.5 size-4 shrink-0 text-[#d3953e]" />Se cuentan los estados Activo y Nuevo. Renovación no se suma hasta confirmar continuidad. Los registros de pileta quedan excluidos.</div>}
          </CardContent>
        </Card>

        <Card className="border-[#dce4eb] bg-[#102033] text-white shadow-[0_14px_36px_rgba(24,48,72,0.12)]">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between"><CardTitle className="text-lg text-white">Próximos pasos</CardTitle><SlidersHorizontal className="size-5 text-[#9eb2c5]" /></div>
            <CardDescription className="text-[#a9bacb]">La base está lista para empezar a cargar operación real.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChecklistItem title="Configurar cuentas y permisos" active onClick={() => onNavigate("team")} />
            <ChecklistItem title="Cargar socios y planes" onClick={() => onNavigate("members")} />
            <ChecklistItem title="Registrar medios de cobro" onClick={() => onNavigate("settings")} />
            <ChecklistItem title="Activar asistencias por sede" onClick={() => onNavigate("attendance")} />
            <div className="mt-5 border-t border-white/10 pt-5"><p className="text-xs leading-5 text-[#9eb2c5]">Cada empleado tendrá una cuenta propia y el sistema registrará quién realizó cada acción.</p></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="border-[#dce4eb] bg-white shadow-[0_14px_36px_rgba(24,48,72,0.06)]">
          <CardHeader><CardTitle className="text-lg text-[#15273a]">Actividad reciente</CardTitle><CardDescription>El historial aparecerá al comenzar la carga.</CardDescription></CardHeader>
          <CardContent><div className="flex items-center gap-4 rounded-xl border border-dashed border-[#d6e0e8] bg-[#fbfcfd] p-5"><div className="flex size-10 items-center justify-center rounded-xl bg-[#e8f2ff] text-[#4576bb]"><ShieldCheck className="size-5" /></div><div><p className="text-sm font-semibold text-[#263b4f]">Auditoría preparada</p><p className="mt-1 text-sm text-[#778999]">Cada alta, pago, asistencia y cambio de permiso quedará asociado a una cuenta.</p></div></div></CardContent>
        </Card>
        <Card className="border-[#dce4eb] bg-white shadow-[0_14px_36px_rgba(24,48,72,0.06)]">
          <CardHeader><CardTitle className="text-lg text-[#15273a]">Accesos rápidos</CardTitle><CardDescription>Acciones frecuentes de administración.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2"><QuickAction icon={UserRound} label="Agregar socio" onClick={onNewMember} /><QuickAction icon={CreditCard} label="Registrar pago" onClick={() => onNavigate("payments")} /><QuickAction icon={ClipboardCheck} label="Cargar asistencia" onClick={() => onNavigate("attendance")} /><QuickAction icon={UserCog} label="Administrar equipo" onClick={() => onNavigate("team")} /></CardContent>
        </Card>
      </div>
    </div>
  );
}

function TeamView({ viewer, branchFilter, onNotice }: { viewer: NonNullable<Viewer>; branchFilter: string; onNotice: (message: string) => void }) {
  const availableBranches = branchOptions.filter(branch => scopeBranchIds(viewer.branchScope).includes(branch.id));
  const availableRoles = employeeRoleOptions.filter(role => viewer.role === "admin" || !["admin", "branch_manager"].includes(role.value));
  const initialForm = (): EmployeeForm => ({ displayName: "", username: "", email: "", role: "administrative", branchScope: availableBranches.find(branch => branch.id === branchFilter)?.id ?? availableBranches[0]?.id ?? "[]", password: "", confirmPassword: "" });
  const [employees, setEmployees] = React.useState<EmployeeSummary[]>([]);
  const [loading, setLoading] = React.useState(true), [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState<EmployeeSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null), [revision, setRevision] = React.useState(0);
  const [form, setForm] = React.useState<EmployeeForm>(initialForm);
  React.useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    fetch(`/api/employees?branch=${encodeURIComponent(branchFilter)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const payload = await response.json() as { employees?: EmployeeSummary[]; error?: string }; if (!response.ok) throw new Error(payload.error ?? "No se pudieron cargar las cuentas."); return payload; })
      .then(payload => setEmployees(payload.employees ?? []))
      .catch(error => { if (error.name !== "AbortError") setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchFilter, revision]);
  function openCreateDialog() { setEditing(null); setError(null); setForm(initialForm()); setOpen(true); }
  function openEditDialog(employee: EmployeeSummary) { setEditing(employee); setError(null); setForm({ ...initialForm(), ...employee, email: employee.email ?? "", password: "", confirmPassword: "" }); setOpen(true); }
  function changeRole(role: EmployeeRole) {
    const ids = scopeBranchIds(form.branchScope).filter(id => availableBranches.some(branch => branch.id === id));
    setForm({ ...form, role, branchScope: role === "admin" ? "all" : role === "teacher" && form.role !== "admin" ? encodeBranchScope(ids) : ids[0] ?? availableBranches[0]?.id ?? "[]" });
  }
  function toggleBranch(id: string, checked: boolean) {
    const ids = scopeBranchIds(form.branchScope);
    setForm({ ...form, branchScope: encodeBranchScope(checked ? [...new Set([...ids, id])] : ids.filter(branch => branch !== id)) });
  }
  async function submitEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await fetch("/api/employees", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { id: editing.id, role: form.role, branchScope: form.branchScope, ...(form.password || form.confirmPassword ? { password: form.password, confirmPassword: form.confirmPassword } : {}) } : form) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No se pudo guardar la cuenta.");
      setOpen(false); setRevision(value => value + 1);
      onNotice(editing ? form.password ? `Contraseña de ${editing.displayName} restablecida. Debe iniciar sesión nuevamente.` : `Permisos de ${editing.displayName} actualizados.` : `Cuenta de ${form.displayName} creada.`);
    } catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar la cuenta."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-3xl font-bold tracking-[-0.04em] text-[#15273a]">Usuarios y permisos</h2><p className="mt-2 max-w-2xl text-[15px] leading-6 text-[#65788b]">Asigná un rol y las sedes donde trabaja cada persona. Los cambios se aplican a sus próximos accesos a datos.</p></div><Button onClick={openCreateDialog} className="h-11 rounded-xl bg-[#102033] text-white hover:bg-[#1d3752]"><Plus className="size-4" />Agregar empleado</Button></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{roleRows.map(row => <Card key={row.role} className="border-[#dce4eb] bg-white"><CardHeader><span className={`w-fit rounded-full px-2.5 py-1 text-sm font-semibold ${row.tone}`}>{row.role}</span><CardTitle className="mt-2 text-base text-[#263b4f]">{row.scope}</CardTitle><CardDescription className="leading-6">{row.detail}</CardDescription></CardHeader></Card>)}</div>
    {viewer.role !== "admin" && <p className="text-sm text-[#65788b]">Podés administrar cuentas cuyo acceso esté limitado a tu sede. Las cuentas compartidas entre sedes las administra el administrador general.</p>}
    <Card className="border-[#dce4eb] bg-white"><CardHeader><CardTitle>Cuentas de empleados</CardTitle><CardDescription>Editá los permisos o restablecé la contraseña de una cuenta existente.</CardDescription></CardHeader><CardContent>
      {error && !open && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      {loading ? <p className="py-8 text-center text-sm">Cargando cuentas…</p> : !employees.length ? <p className="py-8 text-center text-sm text-[#65788b]">No hay cuentas para esta selección.</p> : <Table><TableHeader><TableRow><TableHead>Empleado</TableHead><TableHead>Usuario</TableHead><TableHead>Rol</TableHead><TableHead>Sedes</TableHead><TableHead>Estado</TableHead><TableHead><span className="sr-only">Acciones</span></TableHead></TableRow></TableHeader><TableBody>{employees.map(employee => <TableRow key={employee.id}><TableCell><p className="font-semibold">{employee.displayName}</p>{employee.email && <p className="text-sm text-[#8292a1]">{employee.email}</p>}</TableCell><TableCell>{employee.username}</TableCell><TableCell><Badge className="bg-[#e8f2ff] text-[#355b8c]">{employee.roleLabel}</Badge></TableCell><TableCell className="max-w-64 whitespace-normal">{employee.branchName}</TableCell><TableCell>{employee.active ? "Activo" : "Inactivo"}</TableCell><TableCell><Button variant="outline" size="sm" disabled={employee.id === viewer.id || employee.role === "branch_manager" && viewer.role !== "admin"} onClick={() => openEditDialog(employee)}>{employee.id === viewer.id ? "Tu cuenta" : "Editar cuenta"}</Button></TableCell></TableRow>)}</TableBody></Table>}
    </CardContent></Card>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="max-h-[90vh] overflow-y-auto border-[#dce4eb] bg-white sm:max-w-[580px]"><DialogHeader><DialogTitle>{editing ? `Cuenta de ${editing.displayName}` : "Agregar empleado"}</DialogTitle><DialogDescription>{editing ? "Modificá sus sedes y permisos o asignale una nueva contraseña." : "Creá un usuario y una contraseña propios para esta persona."}</DialogDescription></DialogHeader>
      <form onSubmit={submitEmployee} className="space-y-5">
        {!editing && <><div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-sm font-medium">Nombre completo<Input required value={form.displayName} onChange={event => setForm({ ...form, displayName: event.target.value })} autoFocus /></label><label className="block space-y-2 text-sm font-medium">Usuario<Input required value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} autoComplete="username" /></label></div><label className="block space-y-2 text-sm font-medium">Email (opcional)<Input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} autoComplete="email" /></label></>}
        <label className="block space-y-2 text-sm font-medium">Rol<select value={form.role} onChange={event => changeRole(event.target.value as EmployeeRole)} className="h-10 w-full rounded-md border border-[#d9e1e8] bg-white px-3 text-sm">{availableRoles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
        <p className="rounded-lg bg-[#f4f7fa] p-3 text-sm text-[#516476]">{employeeRoleOptions.find(role => role.value === form.role)?.detail}</p>
        {form.role === "admin" ? <p className="text-sm font-medium">Alcance: todas las sedes</p> : form.role === "teacher" ? <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">Sedes del profesor</legend>{availableBranches.length > 1 && <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={availableBranches.every(branch => scopeBranchIds(form.branchScope).includes(branch.id))} onCheckedChange={checked => setForm({ ...form, branchScope: encodeBranchScope(checked === true ? availableBranches.map(branch => branch.id) : []) })} />Todas las sedes disponibles</label>}<div className="grid gap-3 sm:grid-cols-2">{availableBranches.map(branch => <label key={branch.id} className="flex items-center gap-2 text-sm"><Checkbox checked={scopeBranchIds(form.branchScope).includes(branch.id)} onCheckedChange={checked => toggleBranch(branch.id, checked === true)} />{branch.name}</label>)}</div></fieldset> : <label className="block space-y-2 text-sm font-medium">Sede asignada<select required value={form.branchScope} onChange={event => setForm({ ...form, branchScope: event.target.value })} className="h-10 w-full rounded-md border border-[#d9e1e8] bg-white px-3 text-sm"><option value="[]" disabled>Seleccionar sede</option>{availableBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        {!editing && <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-sm font-medium">Contraseña inicial<Input required type="password" minLength={12} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 12 caracteres" autoComplete="new-password" /></label><label className="block space-y-2 text-sm font-medium">Repetir contraseña<Input required type="password" value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} autoComplete="new-password" /></label></div>}
        {editing && <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 text-sm font-medium">Restablecer contraseña (opcional)</legend><p className="text-xs text-[#65788b]">Si completás estos campos, las sesiones abiertas de esta cuenta se cerrarán.</p><div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-sm font-medium">Nueva contraseña<Input type="password" minLength={12} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} placeholder="Mínimo 12 caracteres" autoComplete="new-password" /></label><label className="block space-y-2 text-sm font-medium">Repetir contraseña<Input type="password" minLength={12} value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })} autoComplete="new-password" /></label></div></fieldset>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || !scopeBranchIds(form.branchScope).length} className="bg-[#102033] text-white">{busy ? "Guardando…" : editing ? "Guardar permisos" : "Crear cuenta"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </div>;
}

function SettingsView({ branchScope, role }: { branchScope: string; role: EmployeeRole }) {
  return <div className="space-y-7"><div><p className="mb-2 text-sm font-medium text-[#738698]">Reglas de negocio</p><h2 className="text-3xl font-bold tracking-[-0.04em] text-[#15273a]">Configuración</h2><p className="mt-2 max-w-2xl text-[15px] leading-6 text-[#65788b]">Precios, recargos, costos de proveedores y reglas de renovación se administrarán sin modificar el código.</p></div><div className="grid gap-4 lg:grid-cols-3"><SettingCard icon={Building2} title="Sedes" detail={branchOptions.filter(branch => scopeBranchIds(branchScope).includes(branch.id)).map(branch => branch.name).join(", ")} /><SettingCard icon={CreditCard} title="Planes y precios" detail="Catálogo de gimnasio, pileta y yoga" /><SettingCard icon={SlidersHorizontal} title="Costos de tarjeta" detail="Proveedor, período, comisión, IVA y acreditación" /></div>{(role === "admin" || role === "branch_manager") && <BranchGeofenceSettings />}</div>;
}

function PlaceholderView({ icon: Icon, title, description, action, onAction }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; action: string; onAction: () => void }) {
  return <div className="flex min-h-[520px] items-center justify-center"><Card className="w-full max-w-xl border-[#dce4eb] bg-white text-center shadow-[0_14px_36px_rgba(24,48,72,0.06)]"><CardContent className="flex flex-col items-center px-8 py-14"><div className="flex size-16 items-center justify-center rounded-2xl bg-[#e8f2ff] text-[#4576bb]"><Icon className="size-8" /></div><h2 className="mt-6 text-2xl font-bold tracking-tight text-[#15273a]">{title}</h2><p className="mt-3 max-w-md text-[15px] leading-6 text-[#718294]">{description}</p><Button onClick={onAction} variant="outline" className="mt-7 rounded-xl border-[#cfd9e2]">{action}<ArrowUpRight className="size-4" /></Button></CardContent></Card></div>;
}

function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string; detail: string; icon: React.ComponentType<{ className?: string }>; tone: "lime" | "blue" | "amber" | "pink" }) {
  const tones = { lime: "bg-[#edf6d7] text-[#66873a]", blue: "bg-[#e8f2ff] text-[#4576bb]", amber: "bg-[#fff2dd] text-[#bc7b2d]", pink: "bg-[#f9e7f4] text-[#a76898]" };
  return <Card className="border-[#dce4eb] bg-white shadow-[0_12px_28px_rgba(24,48,72,0.05)]"><CardContent className="flex items-start justify-between gap-4 p-5"><div><p className="text-sm font-medium text-[#718294]">{label}</p><p className="mt-2 text-3xl font-bold tracking-[-0.04em] text-[#15273a]">{value}</p><p className="mt-2 text-xs text-[#8796a4]">{detail}</p></div><div className={`flex size-10 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="size-5" /></div></CardContent></Card>;
}

function ChecklistItem({ title, active = false, onClick }: { title: string; active?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-3 text-left transition hover:bg-white/[0.1]"><span className={`flex size-5 items-center justify-center rounded-full border ${active ? "border-[#b6e557] bg-[#b6e557] text-[#22301c]" : "border-[#6d8294] text-transparent"}`}><Check className="size-3" /></span><span className="flex-1 text-sm font-medium text-[#dce6ef]">{title}</span><ArrowUpRight className="size-4 text-[#8297aa]" /></button>;
}

function QuickAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return <Button variant="outline" onClick={onClick} className="h-12 justify-start gap-3 rounded-xl border-[#e0e7ed] bg-[#fbfcfd] text-[#41566a] hover:bg-[#f2f6f9]"><Icon className="size-4 text-[#718ca5]" />{label}</Button>;
}

function SettingCard({ icon: Icon, title, detail }: { icon: React.ComponentType<{ className?: string }>; title: string; detail: string }) {
  return <Card className="border-[#dce4eb] bg-white shadow-[0_12px_28px_rgba(24,48,72,0.05)]"><CardContent className="flex items-start gap-4 p-5"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#edf6d7] text-[#66873a]"><Icon className="size-5" /></div><div><p className="font-semibold text-[#263b4f]">{title}</p><p className="mt-1 text-sm leading-5 text-[#8292a1]">{detail}</p></div></CardContent></Card>;
}
