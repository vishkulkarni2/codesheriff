export interface CorpusEntry {
  id: string;
  category: "auth" | "hallucination" | "logic" | "secret";
  label: "vulnerable" | "safe";
  language: string;
  code: string;
  description: string;
  expectedRuleIds?: string[];
}
