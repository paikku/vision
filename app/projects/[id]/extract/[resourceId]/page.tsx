import { FrameExtractionPage } from "@/components/FrameExtractionPage";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; resourceId: string }>;
}) {
  const { id, resourceId } = await params;
  return <FrameExtractionPage projectId={id} resourceId={resourceId} />;
}
