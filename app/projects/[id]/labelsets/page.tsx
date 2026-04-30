import { LabelSetsPage } from "@/components/LabelSetsPage";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LabelSetsPage projectId={id} />;
}
