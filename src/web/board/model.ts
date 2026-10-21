import type { BoardConfiguration } from "../../shared/board.js";
import type { Thread } from "../api.js";

export type ProjectBoardData = {
  projectId: string;
  revision: number;
  configuration: BoardConfiguration;
};
export type BoardItem = {
  thread: Thread;
  assignmentVersion: string;
  assignments: Array<{
    id: string;
    userId: string;
    name: string;
    revision: number;
    annotationIds: string[];
  }>;
};
export type BoardPage = {
  columnId: string;
  boardRevision: number;
  items: BoardItem[];
  total: number;
  nextOffset: number | null;
};
export type BoardAction =
  | {
      type: "move";
      columnId: string;
      state?: "open" | "in_progress" | "ready_for_review" | "resolved" | "declined";
    }
  | { type: "assign"; userId: string | null }
  | { type: "archive"; archived: boolean };
