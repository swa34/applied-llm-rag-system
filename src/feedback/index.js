/**
 * Feedback Learning Module
 *
 * Provides continuous improvement through user feedback analysis.
 *
 * Components:
 * - FeedbackLearning: Main system for analyzing feedback and adjusting retrieval
 * - CommentScorer: Hybrid regex+LLM comment analysis
 *
 * @author Scott Allen
 */

export { default as CommentScorer } from './commentScorer.js';
export { default as FeedbackLearning } from './feedbackLearning.js';

