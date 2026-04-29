import { LabelingWorkspace } from "@/components/LabelingWorkspace";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; lsid: string }>;
}) {
  const { id, lsid } = await params;
  return <LabelingWorkspace projectId={id} labelsetId={lsid} />;
}
