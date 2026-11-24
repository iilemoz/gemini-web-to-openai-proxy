export { canonicalize } from './CanonicalSerializer.js';
export {
  generateUnifiedDiff,
  formatColoredDiff,
  type DiffHunk,
  type DiffChange
} from './DiffGenerator.js';
export {
  ApprovalManager,
  type CanonicalApprovalRecord,
  type WorkspaceIdentity,
  type ExpectedValidation
} from './ApprovalManager.js';
