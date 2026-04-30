import { MediaLibraryPage } from "@/components/MediaLibraryPage";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MediaLibraryPage projectId={id} />;
}
