export type Policy = {
  general: number;
  visualDesign?: number;
  productWorkflow?: number;
  usabilityAccessibility?: number;
};
export type Member = {
  id: string;
  name: string;
  email?: string;
  active: boolean;
  removedAt?: string | null;
  owner: boolean;
  primaryOwner?: boolean;
  role?: string;
  can_resolve?: boolean;
  classification?: string;
  expertise?: string[];
  policy?: Policy;
  policy_version?: number;
  project_policy?: Policy | null;
};
