import AdminDashboard from "./admin-dashboard";
import { getCurrentEmployee, hasEmployees, authErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  let viewer: Awaited<ReturnType<typeof getCurrentEmployee>> = null;
  let setupRequired = false;
  let databaseError: string | undefined;
  try {
    viewer = await getCurrentEmployee();
    setupRequired = !(await hasEmployees());
  } catch (error) {
    databaseError = authErrorMessage(error);
  }
  return <AdminDashboard viewer={viewer} setupRequired={setupRequired} databaseError={databaseError} />;
}
