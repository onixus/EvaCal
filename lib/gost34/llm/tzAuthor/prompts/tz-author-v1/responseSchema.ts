export interface TzAuthorResponse {
  nodeId: string;
  paragraphs: string[];
  questions: Array<{
    gapPath: string;
    question: string;
  }>;
  refusedGapPaths: string[];
}
