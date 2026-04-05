export type InterviewMode = 'Product Sense' | 'Analytics' | 'Leadership / Behavioral';

export type WeaknessTag = 
  | 'wrong_mode' | 'too_broad' | 'too_big_solution' | 'vague_feature' 
  | 'too_many_ideas' | 'weak_metric' | 'poor_breakdown' | 'no_goal_defined' 
  | 'froze_before_answering' | 'abstract_language' | 'no_concrete_details' 
  | 'mixed_product_and_analytics' | 'overexplained' | 'underexplained';

export type StrengthTag = 
  | 'strong_user_selection' | 'strong_problem_identification' | 'good_solution_sizing' 
  | 'strong_metric_definition' | 'clean_breakdown' | 'good_tradeoff_reasoning' 
  | 'strong_recovery_after_stuck' | 'concrete_feature_design' | 'clear_mode_selection';

export interface Score {
  modeSelection: number;
  structure: number;
  clarity: number;
  focus: number;
  concreteness: number;
  solutionSizingOrMetricLogic: number;
  recoveryUnderPressure: number;
}

export interface DrillRep {
  id: string;
  prompt: string;
  expectedMode: InterviewMode;
  userSelectedMode: InterviewMode;
  userAnswer: string;
  timeTakenSeconds: number;
  critique: string;
  correctedAnswer: string;
  mistakeTags: WeaknessTag[];
  strengthTags: StrengthTag[];
  microLesson: string;
  scores: Partial<Score>;
  retryPrompt?: string;
  retryAnswer?: string;
  retryComparison?: string;
  retryRemainingGap?: string;
  retryScores?: Partial<Score>;
  retryMistakeTags?: WeaknessTag[];
  retryStrengthTags?: StrengthTag[];
}

export interface DrillSession {
  id: string;
  date: string;
  mode: InterviewMode | 'Mixed';
  reps: DrillRep[];
}
