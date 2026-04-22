import { ProjectWorkspace } from "@/components/ProjectWorkspace";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; vid: string }>;
}) {
  const { id, vid } = await params;
  return <ProjectWorkspace projectId={id} videoId={vid} />;
}
