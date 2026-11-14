import API from "./client";
import type { HierarchyRepair } from "../types/generated/tasks";

export type { HierarchyRepair, HierarchyRepairValue } from "../types/generated/tasks";

export const getHierarchyRepairs = () => API.get<{ hierarchy_repairs: HierarchyRepair[] }>("/projects/hierarchy-repairs");
