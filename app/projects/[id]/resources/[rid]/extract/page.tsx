import { FrameExtractionPage } from "@/components/FrameExtractionPage";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; rid: string }>;
}) {
  const { id, rid } = await params;
  return <FrameExtractionPage projectId={id} resourceId={rid} />;
}
