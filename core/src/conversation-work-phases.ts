import { withInferredWorkPhases as inferMessage, withInferredTurnWorkPhases as inferTurn, type WorkPhasePart } from 'multi-agents-sdk/conversations/work-phases';
import { isAppMcpServerName } from './product';
type Message = { role?: string; kind?: string; parts?: readonly WorkPhasePart[] };
const isBookkeepingTool = (part: WorkPhasePart) => part.metadata?.workPhase === 'bookkeeping'
  || (isAppMcpServerName(part.metadata?.server) && typeof part.metadata?.tool === 'string' && ['finish-turn', 'set-status'].includes(part.metadata.tool.replaceAll('_', '-')));
export function withInferredWorkPhases<T extends Message>(message: T): T { return inferMessage(message, isBookkeepingTool); }
export function withInferredTurnWorkPhases<T extends Message>(messages: T[]): T[] { return inferTurn(messages, isBookkeepingTool); }
