import Leaderboard from "../../components/leaderboard";
export default async function Page({ searchParams }: { searchParams: Promise<{ adminEvent?: string; screen?: string }> }) {
  const params = await searchParams; return <Leaderboard adminEventId={params.adminEvent} screen={params.screen === "1"} />;
}
