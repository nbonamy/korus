import { randomUUID } from 'node:crypto';
import { product } from '@workspace/core/product';
import {
  activeCodeReviewRound,
  codeReviewLedger,
  isCodeReviewStartInput,
  type CodeReviewAutomationSettings,
  type CodeReviewDecisionInput,
  type CodeReviewDiscussionInput,
  type CodeReviewFinding,
  type CodeReviewFindingInput,
  type CodeReviewFindingUpdateInput,
  type CodeReviewRound,
  type CodeReviewSession,
  type CodeReviewStartInput,
} from '@workspace/core/code-review';
import type { BackendCodeReviewResult } from '@workspace/core/backend-driver';
import type { Agent, AppSnapshot, BackendSession, CreateAgentInput } from '@workspace/core/contracts';
import type { AgentCreationOptions } from '../agents/agent-creation-service';
import type { ReviewToolHandlers } from './review-tool-registry';
import { ReviewGit, type ReviewGitPort } from './review-git';

export type AutomaticReviewStartInput = Omit<CodeReviewStartInput, 'threadMode' | 'automation'>
  & Partial<Pick<CodeReviewAutomationSettings, 'maxPriority' | 'maxRounds' | 'autoCommit'>>;

export type CodeReviewToolPort = {
  createReviewToolContext(agentId: string, sessionId: string, handlers: ReviewToolHandlers): { id: string; url: string };
  closeReviewToolContext(contextId: string): void;
};

export type CodeReviewServiceOptions = {
  snapshot: AppSnapshot;
  createAgent(input: CreateAgentInput, options?: AgentCreationOptions): Agent;
  tools: CodeReviewToolPort;
  runReview(
    agent: Agent,
    prompt: string,
    reviewMcpServerUrl: string,
    reviewerSession?: BackendSession,
  ): Promise<BackendCodeReviewResult>;
  resetReviewer(agent: Agent): Promise<void>;
  deleteReviewer(agent: Agent, handoff?: { targetAgentId: string; content: string }, retainConversation?: boolean): Promise<void>;
  saveReport(agent: Agent, session: CodeReviewSession): Promise<string>;
  changed(): Promise<void> | void;
  git?: ReviewGitPort;
  reportProgress?(agent: Agent, targetAgentId: string, content: string): void;
  now?: () => Date;
};

export class CodeReviewService {
  private readonly now: () => Date;
  private readonly activeRoundTurns = new Set<string>();
  private readonly activeInspections = new Set<string>();
  private readonly simulatedInspections = new WeakSet<CodeReviewSession>();
  private readonly reviewContexts = new WeakMap<CodeReviewSession, { id: string; url: string }>();
  private readonly git: ReviewGitPort;

  constructor(private readonly options: CodeReviewServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.git = options.git ?? new ReviewGit();
    for (const agent of options.snapshot.agents) {
      const session = agent.codeReview;
      if (session?.automation?.state === 'running') {
        session.automation.state = 'paused';
        session.automation.reason = 'Automatic review was interrupted. Inspect the files and commits before continuing manually.';
        session.status = 'failed';
        const round = activeCodeReviewRound(session);
        round.status = 'failed';
        round.error = session.automation.reason;
      }
      if (session && session.status !== 'finished') this.reviewToolContext(agent, session);
    }
  }

  startAutomatic(agent: Agent, input: AutomaticReviewStartInput): CodeReviewSession {
    if (agent.codeReview) throw new Error('Reviewers cannot launch another automatic review.');
    if (agent.sessionKind === 'quickChat') throw new Error('Automatic review requires a project workspace.');
    const saved = this.options.snapshot.general.codeReviewDefaults?.automation;
    return this.start(agent, {
      scope: input.scope,
      backend: input.backend ?? agent.backend,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      instructions: input.instructions,
      threadMode: 'independent',
      automation: {
        enabled: true,
        maxPriority: input.maxPriority ?? saved?.maxPriority ?? 'p2',
        maxRounds: input.maxRounds ?? saved?.maxRounds ?? 3,
        autoCommit: input.autoCommit ?? false,
      },
    }, { rememberSettings: false });
  }

  start(agent: Agent, input: CodeReviewStartInput, options: { rememberSettings?: boolean } = {}): CodeReviewSession {
    if (!isCodeReviewStartInput(input)) throw new Error('Invalid code review settings.');
    if (!agent.folder) throw new Error('Code review requires an agent workspace.');
    if (input.threadMode === 'current' && !agent.backendSession) {
      throw new Error('The current thread is not available for review.');
    }
    if (input.scope.type === 'branch' && !input.scope.baseRef.trim()) {
      throw new Error('A branch review requires a base reference.');
    }
    const current = agent.codeReview;
    if (current) this.requireIdleRound(activeCodeReviewRound(current));
    if (
      current?.status === 'failed'
      && current.threadMode === 'independent'
      && current.reviewerAgentId === agent.id
      && input.threadMode === 'independent'
    ) {
      const target = this.options.snapshot.agents.find((candidate) => candidate.id === current.targetAgentId);
      if (!target) throw new Error('The review target is no longer available.');
      return this.restartFailedIndependentReview(target, agent, input);
    }
    if (current && current.status !== 'finished' && current.status !== 'failed') {
      throw new Error('This agent already has an active code review.');
    }
    const existing = this.options.snapshot.agents.find((candidate) => (
      candidate.codeReview?.targetAgentId === agent.id
      && candidate.codeReview.status !== 'finished'
      && candidate.codeReview.status !== 'failed'
    ));
    if (existing) throw new Error('This agent already has an active code review.');

    const reviewer = input.threadMode === 'current'
      ? agent
      : this.createIndependentReviewer(agent, input.backend ?? agent.backend);
    this.applySelection(reviewer, input);
    if (options.rememberSettings !== false) this.rememberSettings(reviewer, input);
    if (current?.status === 'failed') this.closeReviewToolContext(current);
    const session = this.newSession(agent, reviewer, input);
    const firstRound = activeCodeReviewRound(session);
    if (input.threadMode === 'current') firstRound.reviewerSession = agent.backendSession;
    reviewer.codeReview = session;
    void this.options.changed();
    void this.executeRound(
      reviewer,
      session,
      firstRound,
      firstRound.reviewerSession,
    );
    return session;
  }

  private restartFailedIndependentReview(
    target: Agent,
    reviewer: Agent,
    input: CodeReviewStartInput,
  ): CodeReviewSession {
    if (input.backend && input.backend !== reviewer.backend) {
      throw new Error('Start a new review to change the backend of an existing reviewer.');
    }
    const previous = reviewer.codeReview;
    if (previous) this.closeReviewToolContext(previous);
    if (previous?.automation?.state === 'manual') {
      input = { ...input, automation: { ...previous.automation, enabled: false } };
    }
    const session = this.newSession(target, reviewer, input);
    if (previous?.automation?.state === 'manual') session.automation = { ...previous.automation, commits: [...previous.automation.commits] };
    this.applySelection(reviewer, input);
    reviewer.codeReview = session;
    void this.options.changed();
    void this.resetAndExecuteRound(reviewer, session, activeCodeReviewRound(session));
    return session;
  }

  private async resetAndExecuteRound(
    reviewer: Agent,
    session: CodeReviewSession,
    round: CodeReviewRound,
  ): Promise<void> {
    const wasAutomatic = session.automation?.state === 'running';
    this.activeRoundTurns.add(round.id);
    try {
      await this.options.resetReviewer(reviewer);
    } catch (error) {
      if (reviewer.codeReview !== session) return;
      round.status = 'failed';
      round.error = error instanceof Error ? error.message : String(error);
      round.completedAt = this.timestamp();
      session.status = 'failed';
      session.updatedAt = round.completedAt;
      if (session.automation?.state === 'running') await this.pauseAutomatic(reviewer, session, round.error);
      await this.options.changed();
      return;
    } finally {
      this.activeRoundTurns.delete(round.id);
    }
    if (reviewer.codeReview !== session || (wasAutomatic && session.automation?.state === 'paused')) return;
    await this.executeRound(reviewer, session, round, undefined);
  }

  decide(agent: Agent, input: CodeReviewDecisionInput): void {
    const { session, finding } = this.findFinding(agent, input);
    this.requireArbitration(session);
    if (session.automation?.state === 'running') throw new Error('Switch to manual before selecting findings.');
    const decidedAt = this.timestamp();
    finding.decision = input.decision === 'select'
      ? { state: 'selected', decidedAt }
      : {
          state: 'rejected',
          decidedAt,
          ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        };
    finding.updatedAt = decidedAt;
    session.updatedAt = decidedAt;
  }

  discuss(agent: Agent, input: CodeReviewDiscussionInput): void {
    const { session, round, finding } = this.findFinding(agent, input);
    this.requireArbitration(session);
    if (session.automation?.state === 'running') throw new Error('Switch to manual before discussing findings.');
    this.requireIdleRound(round);
    const question = requiredText(input.question, 'A finding question is required.');
    const createdAt = this.timestamp();
    finding.discussion.push({ id: randomUUID(), author: 'user', body: question, createdAt });
    finding.updatedAt = createdAt;
    session.updatedAt = createdAt;
    void this.options.changed();
    void this.executeDiscussion(agent, session, round, finding, question);
  }

  submit(agent: Agent, sessionId: string): void {
    const session = this.findSession(agent, sessionId);
    if (session.automation?.state === 'running') throw new Error('Switch to manual before submitting a manual round.');
    this.requireArbitration(session);
    const round = activeCodeReviewRound(session);
    this.requireIdleRound(round);
    const submittedAt = this.timestamp();
    for (const finding of round.findings) {
      if (finding.decision.state === 'undecided') {
        finding.decision = { state: 'selected', decidedAt: submittedAt };
        finding.updatedAt = submittedAt;
      }
    }
    round.status = 'submitted';
    session.status = round.findings.some((finding) => (
      finding.decision.state === 'selected' && finding.remediation.state !== 'fixed'
    ))
      ? 'fixing'
      : 'readyToFinish';
    session.updatedAt = submittedAt;
    for (const finding of round.findings) {
      if (finding.remediation.state !== 'fixed') {
        finding.remediation = finding.decision.state === 'selected'
          ? { state: 'pending', queuedAt: submittedAt }
          : { state: 'skipped', startedAt: submittedAt };
      }
      finding.updatedAt = submittedAt;
    }
    if (session.status === 'readyToFinish') round.status = 'completed';
    void this.options.changed();
    if (session.status === 'fixing') void this.executeFixes(agent, session, round);
  }

  async finish(agent: Agent, sessionId: string): Promise<void> {
    const session = this.findSession(agent, sessionId);
    if (session.status !== 'readyToFinish') throw new Error('The review is not ready to finish.');
    const round = activeCodeReviewRound(session);
    this.requireIdleRound(round);
    const revision = session.updatedAt;
    const automatic = session.automation?.state === 'completed';
    const finishedAt = this.timestamp();
    this.activeRoundTurns.add(round.id);
    try {
      const reportPath = await this.options.saveReport(agent, structuredClone({
        ...session, status: 'finished', finishedAt, updatedAt: finishedAt,
      }));
      this.requireOpenReviewSession(session);
      if (session.status !== 'readyToFinish' || session.updatedAt !== revision
        || (automatic && session.automation?.state !== 'completed')) {
        throw new Error('The review changed while saving its report. Inspect it before finishing.');
      }
      if (session.threadMode === 'independent') {
        const target = this.options.snapshot.agents.find((candidate) => candidate.id === session.targetAgentId);
        await this.options.deleteReviewer(agent, target
          ? { targetAgentId: target.id, content: reviewHandoff(session, reportPath) }
          : undefined, true);
        this.closeReviewToolContext(session);
        return;
      }
      session.status = 'finished';
      session.finishedAt = finishedAt;
      session.updatedAt = finishedAt;
      this.closeReviewToolContext(session);
      delete agent.codeReview;
    } finally {
      this.activeRoundTurns.delete(round.id);
    }
  }

  /** The review agent commits its own reviewed work locally; Korus only verifies that HEAD advanced. */
  async commit(agent: Agent, sessionId: string): Promise<void> {
    const session = this.findSession(agent, sessionId);
    if (session.status !== 'readyToFinish') throw new Error('The review is not ready to commit.');
    const round = activeCodeReviewRound(session);
    this.requireIdleRound(round);
    const folder = agent.folder;
    if (!folder) throw new Error('The review agent has no folder to commit.');
    this.activeRoundTurns.add(round.id);
    try {
      const before = await this.git.inspect(folder);
      const hasChanges = await this.git.hasChanges(folder);
      this.requireOpenReviewSession(session);
      if (session.status !== 'readyToFinish' || session.activeRoundId !== round.id) {
        throw new Error('The review changed before committing. Inspect it before continuing.');
      }
      if (!hasChanges) return;
      const context = this.reviewToolContext(agent, session);
      const result = await this.options.runReview(agent, commitPrompt(), context.url, requiredReviewerSession(round));
      if (agent.codeReview !== session) return;
      agent.backendSession = result.reviewerSession;
      round.reviewerSession = result.reviewerSession;
      const after = await this.git.inspect(folder);
      if (after.head === before.head) throw new Error('The review agent did not create a commit. The review is unchanged.');
      // Persist the pre-commit baseline through the existing branch scope so fresh
      // rounds still inspect the reviewed work after it leaves the working tree.
      if (session.scope.type === 'uncommitted' && !session.automation?.baseRef) {
        session.scope = { type: 'branch', baseRef: before.head };
      }
    } finally {
      this.activeRoundTurns.delete(round.id);
    }
    await this.options.changed();
  }

  async switchToManual(agent: Agent, sessionId: string): Promise<void> {
    const session = this.findSession(agent, sessionId);
    const auto = session.automation;
    if (!auto || auto.state === 'manual') return;
    auto.enabled = false;
    auto.state = 'manual';
    delete auto.reason;
    session.updatedAt = this.timestamp();
    // Arbitration may have been saved while automatic remediation was still queued.
    const round = activeCodeReviewRound(session);
    if (session.status === 'fixing' && !this.activeRoundTurns.has(round.id)) {
      this.restoreManualArbitration(session, round);
    }
    await this.options.changed();
  }

  private restoreManualArbitration(session: CodeReviewSession, round: CodeReviewRound): void {
    for (const finding of round.findings) {
      if (finding.remediation.state === 'pending' || finding.remediation.state === 'fixing') {
        finding.remediation = { state: 'notStarted' };
      }
    }
    round.status = 'ready';
    session.status = 'ready';
  }

  async discard(agent: Agent, sessionId: string): Promise<void> {
    const session = this.findSession(agent, sessionId);
    if (session.automation?.state === 'running') {
      await this.pauseAutomatic(agent, session, 'Automatic review was stopped. Inspect the current changes before continuing manually.');
      return;
    }
    if (session.threadMode === 'independent') {
      await this.options.deleteReviewer(agent);
      this.closeReviewToolContext(session);
      return;
    }
    this.closeReviewToolContext(session);
    delete agent.codeReview;
    await this.options.changed();
  }

  closeForAgentRemoval(agent: Agent): void {
    if (agent.codeReview) this.closeReviewToolContext(agent.codeReview);
  }

  async reviewAgain(agent: Agent, sessionId: string): Promise<CodeReviewRound> {
    const session = this.findSession(agent, sessionId);
    if (session.status !== 'readyToFinish') throw new Error('Complete the current remediation before reviewing again.');
    const previousRound = activeCodeReviewRound(session);
    this.requireIdleRound(previousRound);
    const wasAutomatic = session.automation?.state === 'running';
    if (session.threadMode === 'independent') {
      this.activeRoundTurns.add(previousRound.id);
      try {
        await this.options.saveReport(agent, session);
        if (agent.codeReview !== session || (wasAutomatic && session.automation?.state !== 'running')) return previousRound;
        await this.options.resetReviewer(agent);
      }
      finally { this.activeRoundTurns.delete(previousRound.id); }
      if (agent.codeReview !== session || (wasAutomatic && session.automation?.state !== 'running')) return previousRound;
    }
    const round = this.newRound(session.rounds.length + 1);
    if (session.threadMode === 'current') round.reviewerSession = requiredReviewerSession(previousRound);
    session.rounds.push(round);
    session.activeRoundId = round.id;
    session.status = 'reviewing';
    session.updatedAt = round.startedAt;
    void this.options.changed();
    void this.executeRound(agent, session, round, round.reviewerSession);
    return round;
  }

  async resumeInterrupted(agent: Agent): Promise<void> {
    const session = agent.codeReview;
    if (!session) return;
    const round = activeCodeReviewRound(session);
    if (session.status === 'reviewing') {
      round.findings = [];
      if (session.threadMode === 'independent' && round.reviewerSession) {
        await this.options.resetReviewer(agent);
        delete round.reviewerSession;
      }
      delete round.completedAt;
      delete round.error;
      void this.options.changed();
      void this.executeRound(agent, session, round, round.reviewerSession);
      return;
    }
    if (session.status !== 'fixing') return;
    const resumedAt = this.timestamp();
    for (const finding of round.findings) {
      if (finding.remediation.state !== 'fixing') continue;
      finding.remediation = { state: 'pending', queuedAt: resumedAt };
      finding.updatedAt = resumedAt;
    }
    round.status = 'submitted';
    delete round.error;
    session.updatedAt = resumedAt;
    void this.options.changed();
    void this.executeFixes(agent, session, round);
  }

  activeInspectionRoundId(agent: Agent): string | undefined {
    const roundId = agent.codeReview?.activeRoundId;
    return roundId && this.activeInspections.has(roundId) ? roundId : undefined;
  }

  simulateInspection(agent: Agent, session: CodeReviewSession): void {
    if ((agent.status.type === 'working' || agent.status.type === 'awaitingInput'
      || (agent.codeReview && this.activeRoundTurns.has(agent.codeReview.activeRoundId)))
      && (!agent.codeReview || !this.simulatedInspections.has(agent.codeReview))) {
      throw new Error('Wait for the active agent turn before starting a review simulation.');
    }
    if (agent.codeReview) this.closeReviewToolContext(agent.codeReview);
    agent.codeReview = session;
    agent.status = { type: 'working' };
    this.simulatedInspections.add(session);
    this.activeInspections.add(session.activeRoundId);
    this.activeRoundTurns.add(session.activeRoundId);
    this.reviewToolContext(agent, session);
  }

  async interruptSimulatedInspection(agent: Agent): Promise<boolean> {
    const session = agent.codeReview;
    if (!session || !this.simulatedInspections.has(session)) return false;
    await this.handleTurnInterrupted(agent, session.activeRoundId);
    this.endSimulatedInspection(session);
    await this.options.changed();
    return true;
  }

  private endSimulatedInspection(session: CodeReviewSession): void {
    if (!this.simulatedInspections.delete(session)) return;
    this.activeInspections.delete(session.activeRoundId);
    this.activeRoundTurns.delete(session.activeRoundId);
    const reviewer = this.options.snapshot.agents.find(agent => agent.id === session.reviewerAgentId);
    if (reviewer?.codeReview === session) reviewer.status = { type: 'idle' };
  }

  async handleTurnInterrupted(agent: Agent, inspectionRoundId?: string): Promise<boolean> {
    const session = agent.codeReview;
    if (!session) return false;
    const round = activeCodeReviewRound(session);
    if (inspectionRoundId && round.id !== inspectionRoundId) return false;
    if (session.automation?.state === 'running') {
      await this.pauseAutomatic(agent, session, 'Automatic review was stopped. Inspect the current changes before continuing manually.');
      return true;
    }
    if (inspectionRoundId) {
      // A fully confirmed inspection may finish before the interrupt response arrives.
      if (session.status === 'ready' && round.inspectionCompletion) return false;
      const interruptedAt = this.timestamp();
      round.status = 'failed';
      round.error = 'Review stopped. Retry to complete the inspection.';
      round.completedAt = interruptedAt;
      session.status = 'failed';
      session.updatedAt = interruptedAt;
      await this.options.changed();
      return true;
    }
    const interruptedRemediation = session.status === 'fixing'
      || (
        session.status === 'failed'
        && round.status === 'failed'
        && round.findings.some((finding) => finding.remediation.state === 'fixing')
      );
    if (!interruptedRemediation) return false;

    const interruptedAt = this.timestamp();
    for (const finding of round.findings) {
      if (finding.remediation.state !== 'pending' && finding.remediation.state !== 'fixing') continue;
      finding.remediation = { state: 'notStarted' };
      finding.updatedAt = interruptedAt;
    }
    round.status = 'ready';
    delete round.completedAt;
    delete round.error;
    session.status = 'ready';
    session.updatedAt = interruptedAt;
    await this.options.changed();
    return true;
  }

  private async executeRound(
    agent: Agent,
    session: CodeReviewSession,
    round: CodeReviewRound,
    initialReviewerSession?: BackendSession,
  ): Promise<void> {
    const wasAutomatic = session.automation?.state === 'running';
    this.activeRoundTurns.add(round.id);
    this.activeInspections.add(round.id);
    delete round.inspectionCompletion;
    const context = this.reviewToolContext(agent, session);
    try {
      if (session.automation?.state === 'running') {
        if (!session.automation.baseRef) {
          Object.assign(session.automation, await this.git.prepare(agent.folder!, session.scope));
          await this.options.changed();
        } else await this.assertReviewWorkspace(agent, session, true);
        if ((session.automation.state !== 'running' && session.automation.enabled) || agent.codeReview !== session) return;
      }
      const result = await this.options.runReview(agent, reviewPrompt(session), context.url, initialReviewerSession);
      if (agent.codeReview !== session || round.status !== 'reviewing') {
        return;
      }
      agent.backendSession = result.reviewerSession;
      round.reviewerSession = result.reviewerSession;
      round.summary = result.text;
      if (wasAutomatic && session.automation?.state === 'paused') return;
      if (session.automation?.state === 'running') await this.assertReviewWorkspace(agent, session, true);
      const completion = (round as CodeReviewRound).inspectionCompletion;
      if (!completion || completion.findingCount !== round.findings.length) {
        throw new Error('The reviewer ended its turn without an accepted finish_review_round confirmation. Register each finding with report_finding, then call finish_review_round with the total current-round findingCount (including zero for a clean review).');
      }
      const completedAt = this.timestamp();
      round.status = 'ready';
      round.completedAt = completedAt;
      session.status = 'ready';
      session.updatedAt = completedAt;
    } catch (error) {
      if (agent.codeReview !== session || round.status !== 'reviewing') return;
      round.status = 'failed';
      round.error = error instanceof Error ? error.message : String(error);
      round.completedAt = this.timestamp();
      session.status = 'failed';
      session.updatedAt = round.completedAt;
      if (session.automation?.state === 'running') await this.pauseAutomatic(agent, session, round.error);
    } finally {
      this.activeInspections.delete(round.id);
      this.activeRoundTurns.delete(round.id);
    }
    await this.options.changed();
    if (agent.codeReview === session && session.automation?.state === 'running') await this.advanceAutomatic(agent, session);
  }

  private async executeDiscussion(
    agent: Agent,
    session: CodeReviewSession,
    round: CodeReviewRound,
    finding: CodeReviewFinding,
    question: string,
  ): Promise<void> {
    this.activeRoundTurns.add(round.id);
    const context = this.reviewToolContext(agent, session);
    try {
      const result = await this.options.runReview(
        agent,
        discussionPrompt(session, round, finding, question),
        context.url,
        requiredReviewerSession(round),
      );
      agent.backendSession = result.reviewerSession;
      round.reviewerSession = result.reviewerSession;
      const body = result.text.trim();
      if (!body) throw new Error('Reviewer did not answer the finding discussion.');
      const createdAt = this.timestamp();
      finding.discussion.push({ id: randomUUID(), author: 'reviewer', body, createdAt });
      finding.updatedAt = createdAt;
      session.updatedAt = createdAt;
    } catch {
      // A failed discussion turn leaves the user's question in the durable ledger.
    } finally {
      this.activeRoundTurns.delete(round.id);
    }
    await this.options.changed();
  }

  private async executeFixes(agent: Agent, session: CodeReviewSession, round: CodeReviewRound): Promise<void> {
    const wasAutomatic = session.automation?.state === 'running';
    this.activeRoundTurns.add(round.id);
    try {
      if (agent.codeReview !== session) return;
      const findings = round.findings.filter((candidate) => candidate.remediation.state === 'pending');
      if (findings.length > 0) {
        const startedAt = this.timestamp();
        for (const finding of findings) {
          finding.remediation = { state: 'fixing', startedAt };
          finding.updatedAt = startedAt;
        }
        session.updatedAt = startedAt;
        await this.options.changed();

        if (wasAutomatic && session.automation?.state !== 'running') {
          if (session.automation?.state === 'manual') {
            this.restoreManualArbitration(session, round);
            await this.options.changed();
          }
          return;
        }
        const context = this.reviewToolContext(agent, session);
        const result = await this.options.runReview(
          agent,
          fixPrompt(session, round, findings),
          context.url,
          requiredReviewerSession(round),
        );
        if (agent.codeReview !== session || session.status !== 'fixing') return;
        agent.backendSession = result.reviewerSession;
        round.reviewerSession = result.reviewerSession;
        const incomplete = findings.filter((finding) => {
          const current = this.findFindingInSession(session, finding.id);
          return current && current.remediation.state !== 'fixed';
        });
        if (incomplete.length > 0) {
          throw new Error(`Reviewer did not update ${incomplete.length} finding(s) to fixed: ${incomplete.map((finding) => finding.title).join(', ')}.`);
        }
        if (session.automation?.state === 'running') {
          if (findings.some(finding => finding.remediation.state !== 'fixed' || !finding.remediation.evidence?.trim())) {
            throw new Error('Validation evidence is missing. Inspect the fixes before continuing.');
          }
          let checkpoint = await this.assertReviewWorkspace(agent, session, false);
          if (agent.codeReview !== session) return;
          if (session.automation.state === 'running' && session.automation.autoCommit === true) {
            const committed = await this.git.commit(agent.folder!, checkpoint, round.number);
            checkpoint = committed;
            if (committed.commit) session.automation.commits.push(committed.commit);
          }
          Object.assign(session.automation, { head: checkpoint.head, branch: checkpoint.branch, fingerprint: checkpoint.fingerprint });
          await this.options.changed();
          if ((session.automation.state !== 'running' && session.automation.enabled) || agent.codeReview !== session) return;
        }
      }
      const completedAt = this.timestamp();
      const newFindings = round.findings.some((finding) => finding.remediation.state === 'notStarted');
      round.status = newFindings ? 'ready' : 'completed';
      if (newFindings) delete round.completedAt;
      else round.completedAt = completedAt;
      session.status = newFindings ? 'ready' : 'readyToFinish';
      session.updatedAt = completedAt;
    } catch (error) {
      if (session.status !== 'fixing') return;
      round.status = 'failed';
      round.error = error instanceof Error ? error.message : String(error);
      session.status = 'failed';
      session.updatedAt = this.timestamp();
      if (session.automation?.state === 'running') await this.pauseAutomatic(agent, session, round.error!);
    } finally {
      this.activeRoundTurns.delete(round.id);
    }
    await this.options.changed();
    if (agent.codeReview === session && session.automation?.state === 'running') {
      if (session.status === 'readyToFinish') {
        try { await this.reviewAgain(agent, session.id); }
        catch (error) { await this.pauseAutomatic(agent, session, error instanceof Error ? error.message : String(error)); }
      } else await this.pauseAutomatic(agent, session, 'New findings appeared during remediation. Inspect them before continuing.');
    }
  }

  private async advanceAutomatic(agent: Agent, session: CodeReviewSession): Promise<void> {
    const auto = session.automation!;
    const round = activeCodeReviewRound(session);
    try {
      const qualifying = round.findings.filter(finding => finding.priority <= auto.maxPriority);
      if (qualifying.length === 0) {
        round.status = 'completed';
        session.status = 'readyToFinish';
        auto.state = 'completed';
        await this.options.changed();
        if (!auto.enabled || agent.codeReview !== session) return;
        await this.finish(agent, session.id);
        await this.options.changed();
        return;
      }
      if (round.number >= auto.maxRounds) {
        await this.pauseAutomatic(agent, session, 'The automatic review round limit was reached with unresolved findings.');
        return;
      }
      const repeated = qualifying.some(finding => session.rounds.slice(0, -1).some(previous => previous.findings.some(prior =>
        prior.id === finding.id || (prior.title.toLowerCase().trim() === finding.title.toLowerCase().trim()
          && prior.location?.file === finding.location?.file))));
      if (repeated) {
        await this.pauseAutomatic(agent, session, 'A finding remains unresolved after remediation. Inspect it before another attempt.');
        return;
      }
      for (const finding of round.findings) {
        finding.decision = finding.priority <= auto.maxPriority
          ? { state: 'selected', decidedAt: this.timestamp() }
          : { state: 'undecided' };
      }
      // Do not record low-priority findings as user rejections in the cumulative ledger.
      const submittedAt = this.timestamp();
      for (const finding of round.findings) finding.remediation = finding.priority <= auto.maxPriority
        ? { state: 'pending', queuedAt: submittedAt } : { state: 'skipped', startedAt: submittedAt };
      round.status = 'submitted';
      session.status = 'fixing';
      await this.options.changed();
      if (auto.state === 'running' && agent.codeReview === session) await this.executeFixes(agent, session, round);
    } catch (error) {
      await this.pauseAutomatic(agent, session, error instanceof Error ? error.message : String(error));
    }
  }

  private async pauseAutomatic(agent: Agent, session: CodeReviewSession, reason: string): Promise<void> {
    const auto = session.automation;
    if (!auto || auto.state === 'paused' || auto.state === 'manual') return;
    auto.state = 'paused';
    auto.reason = reason;
    const round = activeCodeReviewRound(session);
    // An in-flight provider may still finish, but cannot commit or start another round.
    if (session.status === 'reviewing' || session.status === 'fixing') {
      session.status = 'failed';
      round.status = 'failed';
      round.error = reason;
    }
    await this.options.changed();
    try { this.options.reportProgress?.(agent, session.targetAgentId, reviewHandoff(session)); }
    catch { /* The durable paused ledger remains visible if its target cannot receive the report. */ }
  }

  private async assertReviewWorkspace(agent: Agent, session: CodeReviewSession, unchanged: boolean) {
    const actual = await this.git.inspect(agent.folder!);
    if (session.automation?.state !== 'running') return actual;
    if (actual.head !== session.automation!.head || actual.branch !== session.automation!.branch
      || (unchanged && actual.fingerprint !== session.automation!.fingerprint)) {
      throw new Error('The workspace changed outside remediation. Inspect the changes before continuing.');
    }
    return actual;
  }

  private applySelection(reviewer: Agent, input: CodeReviewStartInput): void {
    if (input.model === undefined && input.reasoningEffort === undefined) return;
    reviewer.backendDefaults = {
      ...reviewer.backendDefaults, kind: reviewer.backend,
      ...(input.model ? { model: input.model, userSelectedModel: true, reasoningEffort: reviewer.backend === 'antigravity' ? undefined : input.reasoningEffort } : {}),
      ...(reviewer.backend !== 'antigravity' && input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    };
  }

  private rememberSettings(reviewer: Agent, input: CodeReviewStartInput): void {
    // Only a new independent-reviewer setup is a preference; current-thread reviews and retries are not.
    if (input.threadMode === 'current') return;
    const previous = this.options.snapshot.general.codeReviewDefaults;
    this.options.snapshot.general.codeReviewDefaults = {
      backend: reviewer.backend,
      automation: input.automation ?? { enabled: false, maxPriority: previous?.automation.maxPriority ?? 'p2', maxRounds: previous?.automation.maxRounds ?? 3, ...(previous?.automation.autoCommit !== undefined ? { autoCommit: previous.automation.autoCommit } : {}) },
      providers: { ...previous?.providers, [reviewer.backend]: {
        ...(input.model ? { model: input.model } : {}), ...(reviewer.backend !== 'antigravity' && input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      } },
    };
  }

  private reviewToolContext(agent: Agent, session: CodeReviewSession): { id: string; url: string } {
    const existing = this.reviewContexts.get(session);
    if (existing) return existing;
    const context = this.options.tools.createReviewToolContext(agent.id, session.id, this.reviewToolHandlers(session));
    this.reviewContexts.set(session, context);
    return context;
  }

  private closeReviewToolContext(session: CodeReviewSession): void {
    this.endSimulatedInspection(session);
    const context = this.reviewContexts.get(session);
    if (!context) return;
    this.options.tools.closeReviewToolContext(context.id);
    this.reviewContexts.delete(session);
  }

  private reviewToolHandlers(session: CodeReviewSession): ReviewToolHandlers {
    return {
      finishReviewRound: (input) => this.finishReviewRound(session, input.findingCount),
      reportFinding: (input) => this.reportFinding(session, activeCodeReviewRound(session), input),
      updateFinding: (input) => this.updateFinding(session, input),
      deleteFinding: (input) => this.deleteFinding(session, input.findingId),
    };
  }

  private async finishReviewRound(session: CodeReviewSession, findingCount: number): Promise<{ roundId: string; findingCount: number }> {
    this.requireOpenReviewSession(session);
    const round = activeCodeReviewRound(session);
    if (!this.activeInspections.has(round.id) || session.status !== 'reviewing') {
      throw new Error('There is no active review inspection to finish.');
    }
    delete round.inspectionCompletion;
    if (!Number.isSafeInteger(findingCount) || findingCount < 0) throw new Error('findingCount must be a non-negative integer.');
    if (findingCount !== round.findings.length) {
      await this.options.changed();
      throw new Error(`You declared ${findingCount} findings, but ${round.findings.length} are registered in this round. Call report_finding for each missing finding (with its priority), reconcile existing findings with update_finding/delete_finding if needed, then call finish_review_round again with the total count across all priorities.`);
    }
    const completion = { findingCount, confirmedAt: this.timestamp() };
    round.inspectionCompletion = completion;
    session.updatedAt = completion.confirmedAt;
    try {
      await this.options.changed();
    } catch (error) {
      if (round.inspectionCompletion === completion) delete round.inspectionCompletion;
      throw error;
    }
    return { roundId: round.id, findingCount };
  }

  private async reportFinding(
    session: CodeReviewSession,
    round: CodeReviewRound,
    input: CodeReviewFindingInput,
  ): Promise<CodeReviewFinding> {
    this.requireOpenReviewSession(session);
    const now = this.timestamp();
    if (this.activeInspections.has(round.id)) delete round.inspectionCompletion;
    const prior = input.priorFindingId
      ? this.findFindingInSession(session, input.priorFindingId)
      : undefined;
    const finding: CodeReviewFinding = {
      id: prior?.id ?? randomUUID(),
      roundId: round.id,
      priority: input.priority,
      title: input.title,
      body: input.body,
      ...(input.location ? { location: { ...input.location } } : {}),
      decision: { state: 'selected', decidedAt: now },
      discussion: prior?.discussion.map((message) => ({ ...message })) ?? [],
      remediation: { state: 'notStarted' },
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    const existingIndex = round.findings.findIndex((candidate) => candidate.id === finding.id);
    if (existingIndex >= 0) round.findings.splice(existingIndex, 1, finding);
    else round.findings.push(finding);
    if (session.status === 'readyToFinish' || session.status === 'failed') {
      this.reopenRound(session, round);
    }
    session.updatedAt = now;
    await this.options.changed();
    return structuredClone(finding);
  }

  private async updateFinding(session: CodeReviewSession, input: CodeReviewFindingUpdateInput): Promise<CodeReviewFinding> {
    this.requireOpenReviewSession(session);
    const finding = this.findFindingInSession(session, input.findingId);
    if (!finding) throw new Error('Code review finding was not found.');
    const round = activeCodeReviewRound(session);
    if (this.activeInspections.has(round.id)) delete round.inspectionCompletion;
    if (input.status === 'fixed' && finding.remediation.state !== 'fixing') {
      throw new Error('Only a finding currently being fixed can be marked fixed.');
    }
    if (input.priority) finding.priority = input.priority;
    if (input.title) finding.title = input.title;
    if (input.body) finding.body = input.body;
    if (input.location) finding.location = { ...input.location };
    const updatedAt = this.timestamp();
    if (input.status === 'fixed') {
      finding.remediation = {
        state: 'fixed',
        completedAt: updatedAt,
        ...(input.evidence ? { evidence: input.evidence } : {}),
      };
    }
    finding.updatedAt = updatedAt;
    session.updatedAt = finding.updatedAt;
    await this.options.changed();
    return structuredClone(finding);
  }

  private async deleteFinding(session: CodeReviewSession, findingId: string): Promise<{ findingId: string; deleted: true }> {
    this.requireOpenReviewSession(session);
    if (!this.findFindingInSession(session, findingId)) throw new Error('Code review finding was not found.');
    for (const round of session.rounds) {
      if (this.activeInspections.has(round.id)) delete round.inspectionCompletion;
      round.findings = round.findings.filter((finding) => finding.id !== findingId);
    }
    session.updatedAt = this.timestamp();
    await this.options.changed();
    return { findingId, deleted: true };
  }

  private requireOpenReviewSession(session: CodeReviewSession): void {
    const reviewer = this.options.snapshot.agents.find((agent) => agent.id === session.reviewerAgentId);
    if (reviewer?.codeReview !== session || session.status === 'finished') {
      throw new Error('Review session is no longer open.');
    }
  }

  private reopenRound(session: CodeReviewSession, round: CodeReviewRound): void {
    if (session.status === 'failed') {
      for (const finding of round.findings) {
        if (finding.remediation.state === 'pending' || finding.remediation.state === 'fixing') {
          finding.remediation = { state: 'notStarted' };
        }
      }
    }
    round.status = 'ready';
    delete round.completedAt;
    delete round.error;
    session.status = 'ready';
  }

  private findFindingInSession(session: CodeReviewSession, findingId: string): CodeReviewFinding | undefined {
    for (let index = session.rounds.length - 1; index >= 0; index -= 1) {
      const finding = session.rounds[index]?.findings.find((candidate) => candidate.id === findingId);
      if (finding) return finding;
    }
    return undefined;
  }

  private newSession(target: Agent, reviewer: Agent, input: CodeReviewStartInput): CodeReviewSession {
    const createdAt = this.timestamp();
    const round = this.newRound(1, createdAt);
    return {
      id: randomUUID(),
      targetAgentId: target.id,
      reviewerAgentId: reviewer.id,
      scope: input.scope.type === 'branch'
        ? { type: 'branch', baseRef: input.scope.baseRef.trim() }
        : { type: 'uncommitted' },
      threadMode: input.threadMode,
      status: 'reviewing',
      ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
      activeRoundId: round.id,
      rounds: [round],
      ...(input.automation?.enabled ? { automation: { ...input.automation, state: 'running' as const, commits: [] } } : {}),
      createdAt,
      updatedAt: createdAt,
    };
  }

  private createIndependentReviewer(target: Agent, backend: Agent['backend']): Agent {
    const sourceDefaults = target.backendDefaults?.kind === backend
      ? target.backendDefaults
      : undefined;
    const reviewer = this.options.createAgent({
      name: 'Review',
      folder: target.folder ?? '',
      avatar: target.avatar,
      backend,
      teamId: target.teamId,
    }, { select: false, afterAgentId: target.id });
    // Start from the selected provider's saved defaults, then inherit compatible source overrides.
    if (sourceDefaults) reviewer.backendDefaults = { ...reviewer.backendDefaults, ...sourceDefaults };
    if (target.workspace) reviewer.workspace = structuredClone(target.workspace);
    if (target.openInApplication) reviewer.openInApplication = target.openInApplication;
    const gitStatus = this.options.snapshot.agentGitStatuses[target.id];
    if (gitStatus) this.options.snapshot.agentGitStatuses[reviewer.id] = structuredClone(gitStatus);
    return reviewer;
  }

  private newRound(number: number, startedAt = this.timestamp()): CodeReviewRound {
    return {
      id: randomUUID(),
      number,
      status: 'reviewing',
      findings: [],
      startedAt,
    };
  }

  private findSession(agent: Agent, sessionId: string): CodeReviewSession {
    const session = agent.codeReview?.id === sessionId ? agent.codeReview : undefined;
    if (!session) throw new Error('Code review session was not found.');
    return session;
  }

  private findFinding(agent: Agent, input: { sessionId: string; roundId: string; findingId: string }) {
    const session = this.findSession(agent, input.sessionId);
    const round = session.rounds.find((candidate) => candidate.id === input.roundId);
    if (!round) throw new Error('Code review round was not found.');
    const finding = round.findings.find((candidate) => candidate.id === input.findingId);
    if (!finding) throw new Error('Code review finding was not found.');
    return { session, round, finding };
  }

  private requireArbitration(session: CodeReviewSession): void {
    if (session.status !== 'ready') throw new Error('The review round is not ready for decisions.');
  }

  private requireIdleRound(round: CodeReviewRound): void {
    if (this.activeRoundTurns.has(round.id)) throw new Error('The reviewer is already responding in this round.');
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function reviewHandoff(session: CodeReviewSession, reportPath?: string): string {
  const report = reviewReport(session);
  const summary = report.split('\n')[0]!;
  const details = [report, ...(reportPath ? [`Review report: ${reportPath}`] : [])].join('\n');
  return `<context>\n${details.replace(/<\/context>/giu, '&lt;/context&gt;')}\n</context>\n\n${summary}`;
}

function reviewReport(session: CodeReviewSession): string {
  const latestFindings = new Map<string, CodeReviewFinding>();
  for (const round of session.rounds) {
    for (const finding of round.findings) latestFindings.set(finding.id, finding);
  }
  const remediated = [...latestFindings.values()].filter((finding) => finding.remediation.state === 'fixed');
  const remaining = [...latestFindings.values()].filter(finding => finding.remediation.state !== 'fixed');
  const headline = reviewOutcomeSummary(session, remediated.length, remaining);
  if (session.automation) {
    const auto = session.automation;
    return [
      headline,
      `${session.rounds.length} review round(s). Priority threshold: ${auto.maxPriority.toUpperCase()}.`,
      ...(auto.reason ? [auto.reason] : []),
      ...remediated.map(finding => `- Fixed ${finding.priority.toUpperCase()} — ${finding.title}\n  Verification: ${finding.remediation.state === 'fixed' ? finding.remediation.evidence ?? 'Not recorded' : ''}`),
      ...remaining.map(finding => `- Remaining ${finding.priority.toUpperCase()} — ${finding.title}`),
      `Local commits: ${auto.commits.join(', ') || 'none'}. No push or merge was performed.`,
      'No reply to the reviewer is needed.',
    ].join('\n');
  }
  if (remediated.length === 0) return headline;
  const summary = [headline,
    ...remediated.map((finding) => `- ${finding.priority.toUpperCase()} — ${finding.title.replace(/\s+/g, ' ').trim()}`)];
  return [...summary, 'No reply to the reviewer is needed.'].join('\n');
}

function reviewOutcomeSummary(session: CodeReviewSession, fixedCount: number, remaining: CodeReviewFinding[]): string {
  const auto = session.automation;
  const completed = !auto || auto.state === 'completed' || auto.state === 'manual';
  const parts = [auto
    ? auto.state === 'manual' ? 'Manual review completed.' : completed ? 'Automatic review completed.' : 'Automatic review paused; it is not an approval to ship.'
    : 'Independent review completed.'];
  if (fixedCount) parts.push(`${fixedCount} finding${fixedCount === 1 ? '' : 's'} fixed.`);
  if (remaining.length) {
    if (auto?.state === 'completed' && remaining.every(finding => finding.priority > auto.maxPriority)) {
      parts.push(`No ${auto.maxPriority === 'p0' ? 'P0' : `P0–${auto.maxPriority.toUpperCase()}`} findings.`);
    }
    const counts = (['p0', 'p1', 'p2', 'p3'] as const).flatMap(priority => {
      const count = remaining.filter(finding => finding.priority === priority).length;
      return count ? [`${count} ${priority.toUpperCase()} finding${count === 1 ? '' : 's'}`] : [];
    });
    parts.push(`${counts.join(', ')} ${remaining.length === 1 ? 'remains' : 'remain'}.`);
  } else if (completed) {
    parts.push(fixedCount ? 'No findings remain.' : 'No review findings to report.');
  }
  if (auto && auto.autoCommit !== true && fixedCount) parts.push('Fixes left uncommitted.');
  return parts.join(' ');
}

function reviewPrompt(session: CodeReviewSession): string {
  const mcpServerName = product.mcpServerName;
  const ledger = codeReviewLedger(session);
  const detailedScope = session.automation?.baseRef
    ? `all changes against the fixed baseline ${session.automation.baseRef}, including subsequent review commits and working changes (use git diff ${session.automation.baseRef} and inspect untracked files). Do not recalculate the baseline or review only the latest commit`
    : session.scope.type === 'branch'
    ? `the current branch against ${session.scope.baseRef}, including uncommitted changes`
    : 'only the current uncommitted changes (staged, unstaged, and untracked)';
  const visibleScope = session.scope.type === 'branch'
    ? `the current branch against ${session.scope.baseRef}`
    : 'the current uncommitted changes';
  return `<context>
Load korus-reviewer through read-skill before inspection. Cumulative review ledger:

${JSON.stringify(ledger, null, 2)}

Review ${detailedScope} independently. Do not report findings outside this scope.
${session.automation ? 'This is an automatic review inspection: do not modify files, commit, push, or merge. Report every actionable finding, including lower-priority findings; the review workflow owns priority selection and completion.' : ''}

Register all actionable findings with mcp__${mcpServerName}__report_finding and obtain accepted mcp__${mcpServerName}__finish_review_round({ findingCount }) before ending, including zero for a clean inspection. The skill supplies the reporting procedure; confirmation is not approval to ship.
</context>

Review ${visibleScope}.${session.instructions ? `\n\nAdditional instructions from the user:\n${session.instructions}` : ''}`;
}

function fixPrompt(session: CodeReviewSession, round: CodeReviewRound, findings: CodeReviewFinding[]): string {
  const noun = findings.length === 1 ? 'finding' : 'findings';
  const findingContext = findings.map((finding) => [
    `${finding.id}: ${finding.title}`,
    `  priority: ${finding.priority}`,
    `  body: ${finding.body}`,
    ...(finding.location ? [`  location: ${JSON.stringify(finding.location)}`] : []),
    ...(finding.discussion.length > 0 ? [`  discussion: ${JSON.stringify(finding.discussion)}`] : []),
  ].join('\n')).join('\n\n');
  return `Fix the ${findings.length} following ${noun}.

<context>
Review: ${session.id}
Round: ${round.number}

${findingContext}

Load korus-reviewer through read-skill for the remediation procedure. Fix only these selected findings and record each verified fix with update_finding.
${session.automation ? `Automatic remediation: run the relevant tests and checks. Every fixed finding MUST include evidence naming the commands and results (or a specific reason a check does not apply). If validation fails or a fix needs a product decision, leave the finding unresolved and explain the blocker. Do not commit, stage, push, merge, change branches, or discard changes. ${session.automation.autoCommit === true ? 'Auto-commit is enabled: the review workflow owns the local commit after validation.' : 'Auto-commit is disabled. Leave all fixes uncommitted; the review workflow will not stage or commit them.'} Preserve unrelated files; no background work may remain when this turn ends.` : ''}
</context>`;
}

function commitPrompt(): string {
  return `Commit the changes from this review to the current branch.

<context>
Run git status and git diff first. Stage and commit only the files that belong to the reviewed changes and their fixes; leave unrelated files untouched. Use a concise single-line message that follows the repository's commit conventions. Do not push, merge, rebase, change branches, amend existing commits, or bypass hooks. If a hook rejects the commit, fix the cause and retry; if you cannot, stop and explain. Do not call any review tools. End with one short sentence naming the commit.
</context>`;
}

function discussionPrompt(
  session: CodeReviewSession,
  round: CodeReviewRound,
  finding: CodeReviewFinding,
  question: string,
): string {
  const findingContext = {
    id: finding.id,
    priority: finding.priority,
    title: finding.title,
    body: finding.body,
    ...(finding.location ? { location: finding.location } : {}),
    ...(finding.discussion.length > 1 ? { priorDiscussion: finding.discussion.slice(0, -1) } : {}),
  };
  return `<context>
Review: ${session.id}
Round: ${round.id}
Finding: ${JSON.stringify(findingContext, null, 2)}

Load korus-reviewer through read-skill for finding discussion, then answer this specific question.
</context>

${question}`;
}

function requiredReviewerSession(round: CodeReviewRound): BackendSession {
  if (!round.reviewerSession) throw new Error('Review conversation is not available.');
  return round.reviewerSession;
}

function requiredText(value: string | null | undefined, message: string): string {
  const text = value?.trim();
  if (!text) throw new Error(message);
  return text;
}
