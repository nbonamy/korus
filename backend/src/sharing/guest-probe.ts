import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { generateKeyPair } from '@libp2p/crypto/keys';
import { decodeConversationInvitation, type ShareRelay } from '@workspace/core/conversation-sharing';
import { product } from '@workspace/core/product';
import { GuestConversationClient } from './guest-client';
import { GuestConversationTransport } from './guest-transport';

type ProbeResult = {
  status: 'acknowledged' | 'failed';
  stage: 'configuration' | 'connect' | 'join' | 'propose' | 'cleanup' | 'complete';
  connectMs?: number;
  joinMs?: number;
  sentAtUtc?: string;
  acknowledgedAtUtc?: string;
  sendToAckMs?: number;
  proposalId?: string;
  error?: string;
};

/** One real guest suggestion, with no transcript reads, provider execution or automatic retries.
 * Only allowlisted diagnostics leave this boundary: never return raw transport errors or grants.
 */
export async function probeSharedChat(invitation: string, relay: ShareRelay = product.companionRelay): Promise<ProbeResult> {
  const result: ProbeResult = { status: 'failed', stage: 'configuration' };
  const link = decodeConversationInvitation(invitation, relay);
  if (!link) return { ...result, error: 'TEST_SHARED_LINK must contain a valid shared-chat invitation.' };
  let transport: GuestConversationTransport | undefined;
  let client: GuestConversationClient | undefined;
  const elapsed = (start: number) => Number((performance.now() - start).toFixed(3));
  try {
    result.stage = 'connect';
    transport = new GuestConversationTransport(await generateKeyPair('Ed25519'), relay);
    const connectStart = performance.now();
    const opened = await transport.open(link);
    result.connectMs = elapsed(connectStart);
    if (opened.status !== 'ready') {
      result.error = `Guest route is ${opened.status}.`;
      throw new Error('Guest route unavailable.');
    }
    client = new GuestConversationClient(opened.stream);
    result.stage = 'join';
    const joinStart = performance.now();
    await client.join(link, 'Relay performance probe');
    result.joinMs = elapsed(joinStart);
    result.stage = 'propose';
    result.proposalId = randomUUID();
    result.sentAtUtc = new Date().toISOString();
    const sendStart = performance.now();
    const receipt = await client.propose({ id: result.proposalId, text: result.sentAtUtc });
    result.sendToAckMs = elapsed(sendStart);
    result.acknowledgedAtUtc = new Date().toISOString();
    if (receipt.id !== result.proposalId || receipt.text !== result.sentAtUtc || receipt.status !== 'pending') {
      throw new Error('Unexpected suggestion acknowledgment.');
    }
    result.status = 'acknowledged';
    result.stage = 'complete';
  } catch {
    result.error ??= `Shared-chat probe failed during ${result.stage}.`;
  } finally {
    client?.close();
    try { await transport?.stop(); }
    catch { result.status = 'failed'; result.stage = 'cleanup'; result.error = 'Shared-chat probe cleanup failed.'; }
  }
  return result;
}
