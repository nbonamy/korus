<template>
  <section
    class="mission-implementation"
    :aria-label="t('missions.implementationBoard')"
  >
    <header class="mission-implementation__summary">
      <div class="mission-implementation__summary-copy">
        <strong>{{ t("missions.executionBoard") }}</strong>
        <span>{{
          t("missions.executionProgress", {
            complete: completeCount,
            total: ticketItems.length,
          })
        }}</span>
      </div>
      <div
        class="mission-implementation__summary-statuses"
        :aria-label="t('missions.executionStatusSummary')"
      >
        <span v-if="activeCount" data-state="active">{{
          t("missions.activeTicketCount", { count: activeCount })
        }}</span>
        <span v-if="reviewCount" data-state="review">{{
          t("missions.reviewTicketCount", { count: reviewCount })
        }}</span>
        <span data-state="complete">{{
          t("missions.completeTicketCount", { count: completeCount })
        }}</span>
      </div>
      <div
        class="mission-implementation__progress"
        role="progressbar"
        :aria-valuenow="completeCount"
        aria-valuemin="0"
        :aria-valuemax="ticketItems.length"
      >
        <span :style="{ width: `${completionPercent}%` }" />
      </div>
      <div class="mission-implementation__summary-meta">
        <span>{{ t("missions.repositoryCount", { count: lanes.length }) }}</span>
      </div>
    </header>

    <div class="mission-implementation__lanes">
      <section
        v-for="lane in lanes"
        :key="lane.repositoryPath"
        class="mission-implementation__lane"
      >
        <header>
          <FolderIcon aria-hidden="true" />
          <div class="mission-implementation__repository-copy">
            <strong>{{ repositoryName(lane.repositoryPath) }}</strong>
            <span>{{ laneProgress(lane.tickets) }}</span>
          </div>
          <span
            v-if="workspaceBranch(lane.repositoryPath)"
            class="mission-implementation__workspace"
          >
            <GitBranchIcon aria-hidden="true" />{{
              workspaceBranch(lane.repositoryPath)
            }}
          </span>
          <MissionWorkspaceOpenIn
            v-if="laneAgent(lane.repositoryPath) && workspacePath(lane.repositoryPath)"
            :agent="laneAgent(lane.repositoryPath)!"
            :available="openInAvailable"
            :catalog="openInApplications"
            :workspace-path="workspacePath(lane.repositoryPath)!"
            @open="emit('open-worktree', $event)"
          />
        </header>
        <TransitionGroup name="mission-run-card" tag="ol" appear>
          <MissionImplementationTicketCard
            v-for="item in lane.tickets"
            :key="item.ticket.id ?? item.index"
            :all-tickets="mission.artifacts.tickets"
            :item="item"
            :repository-path="lane.repositoryPath"
            :selected="selectedIndex === item.index"
            :active="(item.ticket.id ?? item.index) === activeTicketKey && Boolean(item.run?.workerId && item.run.workerId === activeAgentId)"
            @open-conversation="openConversation(item)"
            @open-details="selectedIndex = item.index"
          />
        </TransitionGroup>
      </section>
    </div>

    <MissionTicketDialog
      :model-value="Boolean(selected)"
      :ticket="selected?.ticket"
      :ticket-key="selected?.ticket.id ?? ''"
      :ticket-number="selected ? ticketNumber(selected.index) : ''"
      @close="selectedIndex = -1"
    >
      <section
        v-if="selected?.run?.implementationResult"
        class="mission-implementation__evidence"
      >
        <div>
          <strong>{{ t("missions.changes") }}</strong>
          <p>{{ selected.run.implementationResult.changes }}</p>
        </div>
        <div>
          <strong>{{ t("missions.tests") }}</strong>
          <p>{{ selected.run.implementationResult.tests }}</p>
        </div>
      </section>
      <template #footer>
        <div v-if="selected" class="mission-implementation__dialog-footer">
          <span>{{ t(`missions.ticketRunStatus.${ticketStatus(selected)}`) }}</span>
          <button
            v-if="!readOnly && selected.run && ['preparing', 'running'].includes(selected.run.status)"
            type="button"
            class="app-button"
            :disabled="busy"
            @click="emit('stop', selected.run.id)"
          >
            {{ t("missions.stopTicket") }}
          </button>
          <button
            v-else-if="!readOnly && selected.run && ['failed', 'cancelled'].includes(selected.run.status)"
            type="button"
            class="app-button app-button--primary"
            :disabled="busy"
            @click="emit('retry', selected.index)"
          >
            {{ t("missions.retryTicket") }}
          </button>
        </div>
      </template>
    </MissionTicketDialog>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Agent, OpenInApplicationCatalog } from "@workspace/core/contracts";
import type { Mission } from "@workspace/core/missions";
import type { MissionRun } from "@workspace/core/mission-execution";
import { FolderIcon, GitBranchIcon } from "../shared/icons/app-icons";
import MissionImplementationTicketCard from "./MissionImplementationTicketCard.vue";
import MissionTicketDialog from "./MissionTicketDialog.vue";
import MissionWorkspaceOpenIn, { type MissionWorkspaceOpenRequest } from "./MissionWorkspaceOpenIn.vue";
import { implementationTicketStatus, missionRepositoryName, missionTicketNumber, type MissionImplementationTicketItem } from "./mission-implementation-model";

type TicketItem = MissionImplementationTicketItem;

const props = withDefaults(defineProps<{
  agents?: Agent[];
  activeAgentId?: string;
  mission: Mission;
  busy?: boolean;
  readOnly?: boolean;
  openInAvailable?: boolean;
  openInApplications?: OpenInApplicationCatalog;
}>(), {
  agents: () => [],
  openInApplications: () => ({ defaultApplication: "finder", applications: [] }),
});
const emit = defineEmits<{
  "open-conversation": [agentId: string];
  "open-worktree": [request: MissionWorkspaceOpenRequest];
  retry: [ticketIndex: number];
  stop: [runId: string];
}>();
const { t } = useI18n();
const selectedIndex = ref(-1);
const activeTicketKey = ref<string | number>();
const implementationRuns = computed(
  () =>
    props.mission.execution?.runs.filter(
      (run) => run.stage === "implementation",
    ) ?? [],
);
const lanes = computed(() => {
  const grouped = new Map<string, TicketItem[]>();
  for (const [index, ticket] of props.mission.artifacts.tickets.entries()) {
    const repositoryPath =
      ticket.repositoryPath ?? t("missions.repositoryUnassigned");
    const runs = implementationRuns.value.filter(
      (run) => (run.ticketId ? run.ticketId === ticket.id : run.ticketIndex === index)
        && (run.ticketRevision ?? 0) === (ticket.revision ?? 0),
    );
    const item = { ticket, index, run: runs.at(-1) };
    const lane = grouped.get(repositoryPath) ?? [];
    lane.push(item);
    grouped.set(repositoryPath, lane);
  }
  return [...grouped.entries()].map(([repositoryPath, tickets]) => ({
    repositoryPath,
    tickets,
  }));
});
const ticketItems = computed(() =>
  lanes.value.flatMap((lane) => lane.tickets),
);
const selected = computed(() =>
  ticketItems.value.find((item) => item.index === selectedIndex.value),
);
const completeCount = computed(
  () =>
    ticketItems.value.filter((item) => ticketStatus(item) === "accepted")
      .length,
);
const activeCount = computed(
  () =>
    ticketItems.value.filter((item) =>
      ["preparing", "running"].includes(ticketStatus(item)),
    ).length,
);
const reviewCount = computed(
  () =>
    ticketItems.value.filter(
      (item) => ticketStatus(item) === "awaitingReview",
    ).length,
);
const completionPercent = computed(() =>
  ticketItems.value.length
    ? Math.round((completeCount.value / ticketItems.value.length) * 100)
    : 0,
);

watch(ticketItems, () => {
  if (selectedIndex.value >= 0 && !selected.value) selectedIndex.value = -1;
});

function openConversation(item: TicketItem): void {
  if (!item.run?.workerId) return;
  activeTicketKey.value = item.ticket.id ?? item.index;
  emit("open-conversation", item.run.workerId);
}
function repositoryName(repositoryPath: string): string {
  return missionRepositoryName(repositoryPath);
}
function workspaceBranch(repositoryPath: string): string {
  return (
    props.mission.execution?.workspaces?.find(
      (workspace) => workspace.repositoryPath === repositoryPath,
    )?.branch ??
    (lanes.value.length === 1
      ? (props.mission.execution?.workspace?.branch ?? "")
      : "")
  );
}
function workspacePath(repositoryPath: string): string | undefined {
  return props.mission.execution?.workspaces?.find(
    (workspace) => workspace.repositoryPath === repositoryPath,
  )?.path ?? (lanes.value.length === 1 ? props.mission.execution?.workspace?.path : undefined);
}
function laneAgent(repositoryPath: string): Agent | undefined {
  const workerId = lanes.value
    .find((lane) => lane.repositoryPath === repositoryPath)
    ?.tickets.map((item) => item.run?.workerId)
    .filter((id): id is string => Boolean(id))
    .at(-1);
  return props.agents.find((agent) => agent.id === workerId);
}
function ticketNumber(index: number): string {
  return missionTicketNumber(index);
}
function ticketStatus(
  item: TicketItem,
): "queued" | "blocked" | MissionRun["status"] {
  return implementationTicketStatus(item, props.mission.artifacts.tickets);
}
function laneProgress(tickets: TicketItem[]): string {
  return t("missions.repositoryProgress", {
    complete: tickets.filter((item) => item.ticket.done).length,
    total: tickets.length,
  });
}
</script>

<style scoped src="./MissionImplementationBoard.css"></style>
