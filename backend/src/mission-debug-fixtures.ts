import type { Agent, AppSnapshot } from '@workspace/core/contracts';
import { featureStages, type Mission, type MissionArtifacts, type MissionReviewDebugState, type MissionStage, type MissionTicket } from '@workspace/core/missions';
import type { MissionRun } from '@workspace/core/mission-execution';

export function applyMissionDebugFixture(snapshot: AppSnapshot, missionId: string, stage: MissionStage, now = new Date().toISOString(), reviewState: MissionReviewDebugState = 'identified'): Mission {
  const mission = snapshot.missions?.find(candidate => candidate.id === missionId);
  if (!mission) throw new Error('Mission not found.');
  if (!featureStages.includes(stage)) throw new Error('Invalid Mission debug stage.');
  const team = snapshot.teams.find(candidate => candidate.id === mission.teamId);
  const missionWorkerIds = [
    ...(mission.execution?.runs.flatMap(run => run.workerId ? [run.workerId] : []) ?? []),
    ...Object.values(mission.stageAgentIds),
  ];
  const memberIds = [...new Set(mission.execution?.memberIds?.length ? mission.execution.memberIds : (team?.agentIds ?? []))];
  const members = uniqueAgents(snapshot, memberIds);
  const workers = uniqueAgents(snapshot, missionWorkerIds.length ? missionWorkerIds : memberIds);
  if (!members.length || !workers.length) throw new Error('Add an agent to the Mission team before loading a debug fixture.');
  const repositories = [...new Set(members.flatMap(repositoryPath))].slice(0, 2);
  if (!repositories.length) repositories.push(`/debug/${mission.id}/repository`);
  const branch = `mission/debug-${slug(mission.outcome)}`;
  const tickets = debugTickets(repositories);
  const artifacts = debugArtifacts(tickets);
  const stageIndex = featureStages.indexOf(stage);
  if (stageIndex >= featureStages.indexOf('review')) artifacts.tickets = artifacts.tickets.map(ticket => ({ ...ticket, done: true }));
  const runs: MissionRun[] = [];
  const member = (index: number) => members[index % members.length]!;
  const worker = (index: number) => workers[index % workers.length]!;
  const addRun = (run: Omit<MissionRun, 'skills' | 'feedback' | 'startedAt'>): MissionRun => {
    const complete = { ...run, skills: [], feedback: '', startedAt: now };
    runs.push(complete);
    return complete;
  };

  if (stageIndex > 0) addRun({ id: `${mission.id}-debug-requirements`, stage: 'requirements', memberId: member(0).id, workerId: worker(0).id, status: 'accepted', finishedAt: now });
  if (stageIndex > 1) addRun({ id: `${mission.id}-debug-tickets`, stage: 'tickets', memberId: member(0).id, workerId: worker(0).id, status: 'accepted', finishedAt: now });

  if (stage === 'requirements') {
    const proposal = structuredClone(artifacts);
    proposal.tickets = [];
    proposal.implementation = { changes: '', tests: '' };
    proposal.review = { summary: '', pullRequestUrl: '' };
    addRun({ id: `${mission.id}-debug-requirements`, stage, memberId: member(0).id, workerId: worker(0).id, status: 'awaitingReview', proposal, summary: 'Requirements are ready for review.' });
  } else if (stage === 'tickets') {
    const proposal = structuredClone(artifacts);
    proposal.implementation = { changes: '', tests: '' };
    proposal.review = { summary: '', pullRequestUrl: '' };
    addRun({ id: `${mission.id}-debug-tickets`, stage, memberId: member(0).id, workerId: worker(0).id, status: 'awaitingReview', proposal, draftTickets: structuredClone(tickets), summary: 'The implementation backlog is ready for review.' });
  } else {
    const implementationStatuses: MissionRun['status'][] = stage === 'implementation'
      ? ['accepted', 'running', 'failed']
      : tickets.map(() => 'accepted');
    implementationStatuses.forEach((status, index) => {
      const assigned = worker(index);
      addRun({
        id: `${mission.id}-debug-implementation-${index + 1}`,
        stage: 'implementation',
        memberId: member(index).id,
        workerId: assigned.id,
        ticketIndex: index,
        repositoryPath: tickets[index]!.repositoryPath,
        status,
        ...(status === 'accepted' ? {
          implementationResult: {
            changes: `Implemented ${tickets[index]!.title.toLowerCase()} with repository-scoped changes.`,
            tests: `Focused verification for ticket ${index + 1} passes.`,
          },
          finishedAt: now,
        } : status === 'failed' ? {
          error: 'Focused verification failed in the debug fixture.',
          finishedAt: now,
        } : {}),
      });
    });
    if (stage === 'review') {
      const proposal = structuredClone(artifacts);
      addRun({ id: `${mission.id}-debug-review`, stage, memberId: member(0).id, workerId: worker(0).id, status: 'awaitingReview', proposal, summary: 'The implementation satisfies the approved Mission scope.' });
    } else if (stage === 'ship') {
      addRun({ id: `${mission.id}-debug-review`, stage: 'review', memberId: member(0).id, workerId: worker(0).id, status: 'accepted', finishedAt: now });
    }
  }

  const currentArtifacts = structuredClone(artifacts);
  if (stage === 'requirements') {
    currentArtifacts.requirements = { problem: '', acceptance: '' };
    currentArtifacts.tickets = [];
    currentArtifacts.implementation = { changes: '', tests: '' };
    currentArtifacts.review = { summary: '', pullRequestUrl: '', findings: [] };
  } else if (stage === 'tickets') {
    currentArtifacts.tickets = [];
    currentArtifacts.implementation = { changes: '', tests: '' };
    currentArtifacts.review = { summary: '', pullRequestUrl: '', findings: [] };
  } else if (stage === 'implementation') {
    currentArtifacts.tickets = currentArtifacts.tickets.map((ticket, index) => ({ ...ticket, done: index === 0 }));
    currentArtifacts.implementation = { changes: 'The first repository slice is implemented.', tests: 'Its focused tests pass.' };
    currentArtifacts.review = { summary: '', pullRequestUrl: '', findings: [] };
  } else if (stage === 'review') {
    currentArtifacts.tickets = currentArtifacts.tickets.map(ticket => ({ ...ticket, done: true }));
    currentArtifacts.review = {
      summary: '',
      pullRequestUrl: '',
      findings: [
        {
          id: 'mission-finding-debug-1', priority: 'p1', title: 'Restore the persisted review selection',
          body: 'Reloading the Mission currently loses which findings the user selected for remediation.', repositoryPath: repositories[0]!,
          location: { file: 'backend/src/mission-execution-service.ts', line: 112 }, selected: true,
          remediation: { state: 'open' }, createdAt: now, updatedAt: now,
        },
        {
          id: 'mission-finding-debug-2', priority: 'p2', title: 'Show verification evidence after remediation',
          body: 'Fixed findings should retain concise evidence so delivery approval is auditable.', repositoryPath: repositories[1] ?? repositories[0]!, selected: false,
          remediation: { state: 'open' }, createdAt: now, updatedAt: now,
        },
      ],
    };
    if (reviewState === 'remediated') {
      currentArtifacts.review.findings![0]!.remediation = { state: 'fixed', completedAt: now, evidence: 'Focused Mission workflow tests passed.' };
      currentArtifacts.review.findings![1]!.remediation = { state: 'skipped', startedAt: now };
    }
  } else if (stage === 'ship') {
    currentArtifacts.tickets = currentArtifacts.tickets.map(ticket => ({ ...ticket, done: true }));
  }

  const workspaces = stageIndex >= featureStages.indexOf('implementation')
    ? repositories.map(repositoryPath => ({ repositoryPath, path: repositoryPath, branch }))
    : [];
  mission.stage = stage;
  mission.status = 'active';
  mission.artifacts = currentArtifacts;
  mission.artifactFiles = {};
  mission.stageAgentIds = Object.fromEntries(runs.filter(run => run.workerId).map(run => [run.stage, run.workerId!])) as Mission['stageAgentIds'];
  mission.execution = {
    teamId: mission.teamId,
    debugFixture: true,
    memberIds,
    workspaceName: `debug-${slug(mission.outcome)}`,
    workspaces,
    runs,
    ...(stage === 'ship' ? {
      deliveries: repositories.map((repositoryPath, index) => index < repositories.length - 1
        ? { repositoryPath, agentId: worker(index).id, status: 'pullRequestCreated' as const, pullRequest: { number: 42 + index, url: `https://example.com/debug/pull/${42 + index}` } }
        : { repositoryPath, agentId: worker(index).id, status: 'pending' as const }),
    } : {}),
  };
  mission.revision += 1;
  mission.updatedAt = now;
  return mission;
}

function uniqueAgents(snapshot: AppSnapshot, ids: string[]): Agent[] {
  const seen = new Set<string>();
  return ids.flatMap(id => {
    if (seen.has(id)) return [];
    const agent = snapshot.agents.find(candidate => candidate.id === id);
    if (!agent) return [];
    seen.add(id);
    return [agent];
  });
}

function repositoryPath(agent: Agent): string[] {
  if (agent.workspace?.kind === 'git') return [agent.workspace.primaryWorktreeRoot];
  return agent.folder ? [agent.folder] : [];
}

function debugTickets(repositories: string[]): MissionTicket[] {
  const repo = (index: number) => repositories[index % repositories.length]!;
  return [
    { id: 'mission-ticket-debug-foundation', title: 'Persist the workflow state', body: 'Add the app-owned contracts and durable state transitions for the workflow.', repositoryPath: repo(0), done: false },
    { id: 'mission-ticket-debug-execution', title: 'Build the execution board', body: 'Render repository lanes, ticket progress, and agent ownership in the Mission workspace.', repositoryPath: repo(1), done: false },
    { id: 'mission-ticket-debug-review', title: 'Connect review evidence', body: 'Present implementation evidence and repository diffs for user review.', repositoryPath: repo(0), done: false, dependsOn: [0] },
    { id: 'mission-ticket-debug-ship', title: 'Deliver each repository', body: 'Track pull request or merge completion independently for every affected repository.', repositoryPath: repo(1), done: false, dependsOn: [1, 2] },
  ];
}

function debugArtifacts(tickets: MissionTicket[]): MissionArtifacts {
  return {
    requirements: {
      problem: [
        'Teams need a guided path from an initial feature idea to reviewed, repository-scoped delivery without losing decisions between stages.',
        '',
        '### Users and outcome',
        '',
        'A product owner describes an outcome once, shapes a clear brief with the Mission lead, and follows the work through requirements, tickets, implementation, review, and delivery. Contributors can inspect the same decisions without reconstructing them from several conversations.',
        '',
        'The workspace should make it clear what is proposed, what has been approved, what is still running, and what needs a decision. Reading the brief must remain comfortable even when it includes alternatives, diagrams, constraints, and detailed acceptance criteria.',
        '',
        '### Which surfaces belong in the first release?',
        '',
        '- [x] Desktop Mission workspace',
        '- [x] Repository review and delivery controls',
        '- [ ] Companion progress overview',
        '- [ ] External tracker publication',
        '',
        '### Workflow at a glance',
        '',
        '```mermaid',
        'flowchart TD',
        '  Requirements --> Tickets',
        '  Tickets --> Implementation',
        '  Implementation --> Review',
        '  Review -->|Changes requested| Implementation',
        '  Review -->|Approved| Delivery',
        '```',
        '',
        'Each stage retains its artifact beside the conversation. A user can return to the requirements while reviewing code without changing the active execution stage. Feedback belongs to the proposal being reviewed, and requesting a revision keeps the work in that stage.',
        '',
        '### Scope and boundaries',
        '',
        '- Preserve existing conversations, repository settings, and worktree ownership.',
        '- Keep each ticket associated with one represented repository and make dependencies explicit.',
        '- Show independent repository progress without implying that one completed ticket finishes the Mission.',
        '- Require an explicit delivery decision for every affected repository.',
        '',
        'Importing historical projects, automatically publishing tracker issues, and scheduling recurring Missions are outside this brief. A proposed option is not permission to create infrastructure, publish a release, or modify a repository.',
        '',
        '### How should stage approval work?',
        '',
        '- (x) Require approval at each reviewable stage',
        '- ( ) Approve requirements and tickets together',
        '- ( ) Let the Mission lead choose review checkpoints',
        '',
        'Initial selections are proposals for discussion. The owner confirms the desired policy before it becomes a settled requirement. Unconfirmed alternatives remain open questions rather than silently becoming agreement.',
        '',
        '### Recovery and interrupted work',
        '',
        'Restarting the application should restore the Mission stage, accepted artifacts, ticket ownership, and available evidence. An interrupted worker must be distinguishable from a completed one. Recovery must preserve worktrees and make the next safe action clear without replaying uncertain work.',
        '',
        'A failed operation should explain what failed near the affected control. Retrying must retain the conversation and useful evidence. If a repository cannot be delivered, the other repository results stay visible and independently reviewable.',
        '',
        '### Collaboration and evidence',
        '',
        '| Participant | Needs to understand | Evidence available |',
        '| --- | --- | --- |',
        '| Product owner | Whether the outcome and scope are correct | Requirements, confirmed choices, and review comments |',
        '| Contributor | Which repository and ticket they own | Ticket details, dependencies, and isolated worktree |',
        '| Reviewer | Whether implementation meets the brief | Approved artifacts, repository diffs, and test results |',
        '| Release owner | Which repositories are ready to deliver | Review decisions and individual delivery results |',
        '',
        'Evidence should be concise enough to scan and specific enough to verify. A summary links the user to the relevant work rather than replacing the original artifact. Comments on a diagram apply to the diagram as a whole and should reach the Mission lead with enough context to revise it.',
        '',
        '### Accessibility and long-document review',
        '',
        'Reviewers can navigate sections and choices with the keyboard, read diagrams alongside their surrounding explanation, and leave feedback without losing their place. The conversation and workflow rail remain available while the brief scrolls independently.',
        '',
        'The review actions remain reachable at the beginning, middle, and end of a long brief. Their placement must stay stable when a comment editor opens, a choice changes, or an approval warning appears. Reaching the end must reveal the final acceptance criteria in full.',
      ].join('\n'),
      acceptance: [
        '1. A new Mission starts with a reviewable brief containing the outcome, scope, constraints, open decisions, and observable acceptance criteria.',
        '2. Users can comment on sections and whole diagrams, confirm bounded choices, and request a revision without approving implementation.',
        '3. The workflow keeps visible progress across every stage, and accepted artifacts remain readable after it advances.',
        '4. Tickets identify their repositories and dependencies. Repository progress remains independent until the user decides that implementation is ready for review.',
        '5. Restart and retry preserve accepted decisions, conversations, worktrees, and verification evidence without claiming uncertain work succeeded.',
        '6. Keyboard users can reach review controls, warnings return them to the brief, and the final paragraphs are never hidden behind the action bar.',
        '7. Each affected repository has an explicit delivery result. The Mission completes only when all required deliveries are accounted for.',
      ].join('\n'),
    },
    tickets: structuredClone(tickets),
    implementation: {
      changes: 'Implemented the Mission state model, execution board, review surface, and repository delivery controls.',
      tests: 'Core transitions, backend persistence, protocol routing, and rendered Mission behavior pass focused tests.',
    },
    review: {
      summary: 'The implementation matches the approved requirements. Repository delivery remains explicit and independently retryable.',
      pullRequestUrl: '',
      findings: [],
    },
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 32) || 'mission';
}
