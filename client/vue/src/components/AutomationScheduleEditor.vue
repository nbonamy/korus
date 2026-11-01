<template>
  <div class="automation-schedule">
    <FormSection density="compact" :title="$t('promptAutomation.schedule')" title-id="automation-schedule">
      <FormGrid>
        <FormField density="compact" :label="$t('automationSchedule.repeat')" label-for="automation-repeat">
          <el-select id="automation-repeat" v-model="repeat" :aria-label="$t('automationSchedule.repeat')">
            <el-option v-for="kind in repeatKinds" :key="kind" :value="kind" :label="$t(`automationSchedule.${kind}`)" />
          </el-select>
        </FormField>
        <FormField density="compact" v-if="repeat === 'interval'" :label="$t('automationSchedule.every')">
          <div class="automation-schedule__pair">
            <el-input-number v-model="intervalAmount" :min="1" :max="525600" :aria-label="$t('automationSchedule.every')" />
            <el-select v-model="intervalUnit" :aria-label="$t('automationSchedule.unit')">
              <el-option :value="1" :label="$t('automationSchedule.minutes')" />
              <el-option :value="60" :label="$t('automationSchedule.hours')" />
            </el-select>
          </div>
        </FormField>
        <FormField density="compact" v-else-if="!(advanced && repeat === 'custom')" :label="$t('automationSchedule.time')" label-for="automation-time">
          <el-select id="automation-time" v-model="time" filterable allow-create default-first-option :aria-label="$t('automationSchedule.time')">
            <el-option v-for="option in times" :key="option.value" :value="option.value" :label="option.label" />
          </el-select>
        </FormField>

        <FormField density="compact" v-if="advanced && repeat === 'custom'" class="automation-schedule__wide" :label="$t('automationSchedule.rule')"
          :help="$t('automationSchedule.advancedHelp')">
          <el-input v-model="rawRule" type="textarea" :rows="3" :aria-label="$t('automationSchedule.rule')" />
        </FormField>
        <div v-if="showCustomFields" class="automation-schedule__wide automation-schedule__custom">
          <div v-if="repeat === 'custom'" class="automation-schedule__custom-row">
            <FormField density="compact" :label="$t('automationSchedule.every')">
              <el-input-number v-model="every" :min="1" :max="365" :aria-label="$t('automationSchedule.every')" />
            </FormField>
            <FormField density="compact" :label="$t('automationSchedule.frequency')" label-for="automation-frequency">
              <el-select id="automation-frequency" v-model="frequency" :aria-label="$t('automationSchedule.frequency')">
                <el-option v-for="freq in ['DAILY', 'WEEKLY', 'MONTHLY']" :key="freq" :value="freq" :label="$t(`automationSchedule.${freq.toLowerCase()}`)" />
              </el-select>
            </FormField>
            <FormField density="compact" v-if="frequency === 'MONTHLY'" :label="$t('automationSchedule.monthDay')">
              <el-input-number v-model="monthDay" :min="1" :max="31" :aria-label="$t('automationSchedule.monthDay')" />
            </FormField>
          </div>
          <FormField density="compact" v-if="repeat === 'weekly' || (repeat === 'custom' && frequency === 'WEEKLY')" :label="$t('automationSchedule.days')">
            <div class="automation-schedule__days" role="group" :aria-label="$t('automationSchedule.days')">
              <button v-for="day in weekdays" :key="day.code" type="button" class="automation-schedule__day"
                :aria-pressed="days.includes(day.code)" :aria-label="day.label" :title="day.label" @click="toggleDay(day.code)">{{ day.short }}</button>
            </div>
          </FormField>
        </div>
      </FormGrid>
      <p v-if="!valid" class="automation-schedule__next automation-schedule__next--invalid" role="alert">{{ $t('automationSchedule.invalid') }}</p>
      <p v-else class="automation-schedule__next">
        <IconCalendarClock :size="16" aria-hidden="true" />
        {{ $t('automationSchedule.nextRun', { time: nextLabel }) }}
      </p>
    </FormSection>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Automation, AutomationSchedule } from '@workspace/core/contracts';
import { nextAutomationRunAt, normalizeAutomationSchedule } from '@workspace/core/automation-schedule';
import { translate } from '../i18n';
import FormSection from '../shared/form/FormSection.vue';
import FormGrid from '../shared/form/FormGrid.vue';
import FormField from '../shared/form/FormField.vue';
import { IconCalendarClock } from '@tabler/icons-vue';

const props = defineProps<{ modelValue: AutomationSchedule; automation?: Automation | null }>();
const emit = defineEmits<{ 'update:modelValue': [schedule: AutomationSchedule] }>();
const original = props.modelValue;
const fields = 'rrule' in original ? Object.fromEntries(original.rrule.replace(/^RRULE:/i, '').split(';').map(part => part.split('='))) : {};
const repeatKinds = ['daily', 'weekdays', 'weekly', 'interval', 'custom'] as const;
type Repeat = typeof repeatKinds[number];
const advanced = ref('rrule' in original && (Object.keys(fields).some(key => !['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND'].includes(key))
  || !['DAILY', 'WEEKLY', 'MONTHLY'].includes(fields.FREQ ?? '') || !/^\d+$/.test(fields.BYHOUR ?? '') || !/^\d+$/.test(fields.BYMINUTE ?? '')
  || (fields.BYSECOND !== undefined && fields.BYSECOND !== '0')
  || (fields.BYDAY !== undefined && !/^(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*$/.test(fields.BYDAY))
  || (fields.BYMONTHDAY !== undefined && !/^([1-9]|[12]\d|3[01])$/.test(fields.BYMONTHDAY))
  || (fields.FREQ !== 'WEEKLY' && fields.BYDAY !== undefined) || (fields.FREQ !== 'MONTHLY' && fields.BYMONTHDAY !== undefined)
  || (fields.FREQ === 'WEEKLY' && fields.BYDAY === undefined) || (fields.FREQ === 'MONTHLY' && fields.BYMONTHDAY === undefined)));
const initialRepeat: Repeat = 'intervalMinutes' in original ? 'interval' : advanced.value ? 'custom'
  : fields.INTERVAL && fields.INTERVAL !== '1' ? 'custom'
  : fields.FREQ === 'DAILY' ? 'daily' : fields.FREQ === 'WEEKLY' && fields.BYDAY === 'MO,TU,WE,TH,FR' ? 'weekdays'
  : fields.FREQ === 'WEEKLY' ? 'weekly' : 'custom';
const repeat = ref<Repeat>(initialRepeat);
const frequency = ref(fields.FREQ ?? 'WEEKLY');
const every = ref(Number(fields.INTERVAL ?? 1));
const days = ref((fields.BYDAY ?? 'MO').split(','));
const monthDay = ref(Number(fields.BYMONTHDAY ?? 1));
const time = ref(`${String(fields.BYHOUR ?? 9).padStart(2, '0')}:${String(fields.BYMINUTE ?? 0).padStart(2, '0')}`);
const timeZone = ref('timeZone' in original ? original.timeZone : Intl.DateTimeFormat().resolvedOptions().timeZone);
const minutes = 'intervalMinutes' in original ? original.intervalMinutes : 60;
const intervalUnit = ref(minutes % 60 === 0 ? 60 : 1);
const intervalAmount = ref(minutes / intervalUnit.value);
const rawRule = ref('rrule' in original ? original.rrule : '');
const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((code, index) => {
  const date = new Date(Date.UTC(2026, 0, 5 + index));
  const format = (weekday: 'long' | 'short') => new Intl.DateTimeFormat(undefined, { weekday, timeZone: 'UTC' }).format(date);
  return { code, label: format('long'), short: format('short') };
});
const showCustomFields = computed(() => !(advanced.value && repeat.value === 'custom') && repeat.value !== 'interval'
  && (repeat.value === 'custom' || repeat.value === 'weekly'));
function toggleDay(code: string) {
  days.value = days.value.includes(code) ? days.value.filter((day: string) => day !== code) : [...days.value, code];
}
const times = computed(() => {
  let zone = '';
  try { zone = new Intl.DateTimeFormat(undefined, { timeZone: timeZone.value, timeZoneName: 'short' }).formatToParts().find(part => part.type === 'timeZoneName')?.value ?? ''; } catch { /* Invalid typed zone is reported below. */ }
  return Array.from({ length: 96 }, (_, index) => {
    const hour = Math.floor(index / 4), minute = (index % 4) * 15;
    const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return { value, label: `${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)))} ${zone}` };
  });
});
const schedule = computed<AutomationSchedule>(() => {
  if (repeat.value === 'interval') return { intervalMinutes: intervalAmount.value * intervalUnit.value };
  if (repeat.value === 'custom' && advanced.value) return { rrule: rawRule.value, timeZone: timeZone.value };
  const [hour, minute] = /^([01]\d|2[0-3]):[0-5]\d$/.test(time.value) ? time.value.split(':').map(Number) : [NaN, NaN];
  const freq = repeat.value === 'custom' ? frequency.value : repeat.value === 'daily' ? 'DAILY' : 'WEEKLY';
  const parts = [`FREQ=${freq}`];
  if (repeat.value === 'custom') parts.push(`INTERVAL=${every.value}`);
  if (freq === 'WEEKLY') parts.push(`BYDAY=${repeat.value === 'weekdays' ? 'MO,TU,WE,TH,FR' : days.value.join(',')}`);
  if (freq === 'MONTHLY') parts.push(`BYMONTHDAY=${monthDay.value}`);
  parts.push(`BYHOUR=${hour}`, `BYMINUTE=${minute}`, 'BYSECOND=0');
  return { rrule: parts.join(';'), timeZone: timeZone.value };
});
watch(schedule, value => emit('update:modelValue', value));
const valid = computed(() => normalizeAutomationSchedule(props.modelValue) !== null);
const openedAt = new Date().toISOString();
const nextLabel = computed(() => {
  const unchanged = props.automation && JSON.stringify(props.modelValue) === JSON.stringify(props.automation.schedule);
  const next = nextAutomationRunAt(unchanged ? props.automation! : { schedule: props.modelValue, createdAt: openedAt });
  if (!next) return translate('automationSchedule.noNext');
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short',
    ...('timeZone' in props.modelValue ? { timeZone: props.modelValue.timeZone } : {}) }).format(new Date(next));
});
</script>

<style scoped>
.automation-schedule__wide {
  grid-column: 1 / -1;
}

.automation-schedule__custom {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-top: var(--space-6);
  border-top: 1px solid var(--color-border);
}

.automation-schedule__custom-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
}

.automation-schedule__custom-row > * {
  flex: 1 1 140px;
}

.automation-schedule__pair {
  display: flex;
  gap: var(--space-4);
}

.automation-schedule__pair .el-select {
  flex: 1 1 auto;
}

.automation-schedule__days {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.automation-schedule__day {
  flex: 1 1 0;
  min-width: 44px;
  min-height: 36px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-lowest);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-13);
  cursor: pointer;
}

.automation-schedule__day[aria-pressed='true'] {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-on-primary);
}

.automation-schedule__day:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.automation-schedule__next {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin: 0 var(--space-6) var(--space-6);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-md);
  background: var(--color-primary-container);
  color: var(--color-on-primary-container);
  font-size: var(--font-size-13);
  line-height: var(--line-height-18);
}

.automation-schedule__next--invalid {
  background: var(--color-warning-container);
  color: var(--color-on-warning-container);
}
</style>
