import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LiveScreen from "../../../components/live-screen";
import { isAdminSession } from "../../../lib/security";

export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  if (!isAdminSession((await cookies()).get("vc_admin")?.value)) redirect("/admin");
  const { event } = await searchParams;
  if (!event) redirect("/admin");
  return <LiveScreen eventId={event} />;
}
