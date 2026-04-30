export type ProjectMember = { id: string; name: string; role: string };

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  members: ProjectMember[];
};

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: number;
  resourceCount: number;
  imageCount: number;
  labelSetCount: number;
};
