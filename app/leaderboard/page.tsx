import Leaderboard from "../../components/leaderboard";
import { redirect } from "next/navigation";
export default async function Page({ searchParams }: { searchParams: Promise<{ adminEvent?: string; screen?: string }> }) {
  const params = await searchParams;
  if (params.screen === "1") redirect(params.adminEvent ? `/admin/screen?event=${encodeURIComponent(params.adminEvent)}` : "/leaderboard");
  return <Leaderboard />;
}
