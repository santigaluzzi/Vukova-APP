import { getCurrentEmployee, hasEmployees, authErrorMessage } from "@/lib/auth";

export async function GET() {
  try {
    const employee = await getCurrentEmployee();
    return Response.json({
      authenticated: Boolean(employee),
      setupRequired: !(await hasEmployees()),
      user: employee,
    });
  } catch (error) {
    return Response.json({ authenticated: false, setupRequired: false, error: authErrorMessage(error) }, { status: 503 });
  }
}
