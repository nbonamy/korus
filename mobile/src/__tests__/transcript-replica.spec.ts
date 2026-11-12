import { describe, expect, it } from 'vitest';
import { TranscriptReplicas } from '../transcript-replica';
import { conversation, conversationPatch, textMessage } from './support/conversation';

const base = conversation('agent', { provider: 'cursor', conversation: 'chat', messages: [textMessage('first', 'user', 'Hello')] });
const append = (revision: number, id: string) => conversationPatch(base, revision, [{ op: 'spliceMessages', start: revision - 1, deleteCount: 0, messages: [textMessage(id, 'assistant', id)] }]);
const ids = (entry: ReturnType<TranscriptReplicas['apply']>) => entry?.frame.payload.snapshot.state.messages.map(message => message.id);

describe('transcript conversations', () => {
  it('starts from a snapshot, follows patches across transfers and tolerates overlapping batches', () => {
    const replicas = new TranscriptReplicas();
    expect(ids(replicas.apply('identity', { epoch: 'journal', revision: 2 }, [base, append(2, 'second')]))).toStrictEqual(['first', 'second']);
    const next = replicas.apply('identity', { epoch: 'journal', revision: 3 }, [append(2, 'second'), append(3, 'third')]);
    expect(ids(next)).toStrictEqual(['first', 'second', 'third']);
    expect(next?.checkpoint).toStrictEqual({ epoch: 'journal', revision: 3 });
  });
  it('asks for a reset after a missed revision, another journal or a transfer that falls short of its checkpoint', () => {
    const replicas = new TranscriptReplicas();
    replicas.apply('identity', { epoch: 'journal', revision: 1 }, [base]);
    expect(replicas.apply('identity', { epoch: 'journal', revision: 3 }, [append(3, 'third')])).toBeNull();
    expect(replicas.apply('identity', { epoch: 'journal', revision: 2 }, [append(2, 'second')])).toBeNull();
    replicas.apply('identity', { epoch: 'journal', revision: 1 }, [base]);
    expect(replicas.apply('identity', { epoch: 'other', revision: 2 }, [append(2, 'second')])).toBeNull();
    expect(replicas.apply('identity', { epoch: 'journal', revision: 5 }, [base])).toBeNull();
  });
  it('does not keep an agent conversation from a replaced session', () => {
    const replicas = new TranscriptReplicas();
    replicas.apply('old-session', { epoch: 'journal', revision: 1 }, [base]);
    replicas.apply('new-session', { epoch: 'journal', revision: 1 }, [base]);
    expect(replicas.apply('old-session', { epoch: 'journal', revision: 2 }, [append(2, 'second')])).toBeNull();
  });
});
