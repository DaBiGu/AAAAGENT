/**
 * 主动关心：决定「现在该不该开口、说什么」。
 *
 * AAAAGENT 原本只实现了配额存储（`InvitationStore`），事件生成与点击接线从未完成
 * —— 它的管理页自己标注为「实际事件生成与点击接线尚未完成」。这个模块补上决策层。
 *
 * 设计原则：
 *   * **少而准**。宁可一整天不开口，也不要在用户专注时打扰。
 *   * **时机优先于内容**。用户闲下来才是开口的窗口；打游戏/开会/离开一律沉默。
 *   * **有由头**。每次开口都要基于一个具体观察（时间、他的状态、刚聊过的事），
 *     不泛泛地问「在干嘛」。
 *   * 决策与文案都是纯本地规则，不花 API 钱、不读屏幕内容。
 */
import type { ActivityReading } from '../observer/classify.js';

export interface CareInputs {
  /** 本机观察到的用户活动；拿不到时不做主动关心。 */
  readonly activity: ActivityReading | null;
  readonly now: Date;
  /** 用户上一次说话的时间（ISO）。 */
  readonly lastInteractionAt: string | null;
  /** 上一次主动关心的展示时间（ISO）。 */
  readonly lastCareAt: string | null;
  /** 今天已经主动关心过几次。 */
  readonly careCountToday: number;
  /** 用户当前情绪标签（来自文字推测），没有则 null。 */
  readonly userEmotion: string | null;
}

export interface CarePlan {
  /** 关心的话。会被当作桌宠主动说出的一句展示出来。 */
  readonly text: string;
  /** 表现手势，取值必须在 PRESENTATION_GESTURES 内。 */
  readonly gesture: 'heart' | 'comfort' | 'hold_star' | 'lean';
  /** 为什么这时候开口（写进诊断，便于回看）。 */
  readonly reason: string;
}

/** 配额与安静时段。与 `confirmedInvitationPolicy` 的每日上限保持一致。 */
export const CARE_LIMITS = Object.freeze({
  /** 两次主动关心之间的最小间隔。 */
  minIntervalMs: 2 * 60 * 60 * 1000,
  /** 每天最多主动关心几次。 */
  dailyMax: 2,
  /** 深夜时段：只提醒休息，不闲聊。 */
  quietFromHour: 23,
  quietToHour: 7,
  /** 用户静置多久才算「闲下来」可以搭话。 */
  idleBeforeTalkMs: 10 * 60 * 1000,
});

/** 深夜关心语，按天轮换，避免每天同一句。 */
const LATE_NIGHT = [
  '这么晚了还在忙呀……要不要先歇一会儿？',
  '夜深了。我在这儿陪着，不过你也别太拼。',
  '已经很晚了哦。明天的事，明天再说也可以的。',
];

/** 很久没说话之后的招呼。 */
const LONG_SILENCE = [
  '好久没听到你的声音了，还在忙吗？',
  '我在这儿呢。你忙你的，想起来再跟我说话就好。',
  '有一阵子没聊了……今天还顺利吗？',
];

/** 用户情绪偏低时的关心。 */
const AFTER_SADNESS = [
  '刚才那件事……现在好一点了吗？',
  '我还记着你不开心。不用勉强，我陪着就好。',
  '如果你想说，我随时都在。',
];

/** 普通空闲时的搭话。 */
const IDLE_CHAT = [
  '歇一会儿吧，我看你忙了好久了。',
  '要不要起来动一动？我等你回来。',
  '刚好闲下来……今天过得怎么样？',
];

const pick = (pool: readonly string[], seed: number): string => pool[Math.abs(seed) % pool.length]!;

/**
 * 决定是否主动关心。返回 null 表示「现在不该开口」。
 *
 * 判定顺序即优先级：不打扰 > 配额 > 深夜 > 情绪 > 久未联系 > 普通空闲。
 */
export function planCare(inputs: CareInputs, limits = CARE_LIMITS): CarePlan | null {
  const { activity, now } = inputs;
  // 看不见用户在做什么时，宁可不开口。
  if (!activity || activity.kind === 'unknown') return null;
  // 打游戏 / 开会 / 离开座位：绝对不打扰。
  if (activity.disturb === 'silent') return null;
  if (inputs.careCountToday >= limits.dailyMax) return null;
  if (inputs.lastCareAt) {
    const since = now.getTime() - Date.parse(inputs.lastCareAt);
    if (!Number.isFinite(since) || since < limits.minIntervalMs) return null;
  }
  const seed = Math.floor(now.getTime() / 60_000);
  const hour = now.getHours();
  const lateNight = hour >= limits.quietFromHour || hour < limits.quietToHour;

  if (lateNight) {
    // 深夜只在他还醒着（不是离开）时提醒，而且不要求「闲下来」。
    if (activity.kind === 'away') return null;
    return { text: pick(LATE_NIGHT, seed), gesture: 'comfort', reason: `深夜 ${hour} 点仍在用电脑` };
  }

  // 白天/傍晚：只在他确实闲下来时开口。
  const idleEnough = activity.idleMs >= limits.idleBeforeTalkMs;
  if (activity.disturb === 'invite' || (activity.disturb === 'open' && idleEnough)) {
    if (inputs.userEmotion === 'sad' || inputs.userEmotion === 'angry' || inputs.userEmotion === 'fear') {
      return { text: pick(AFTER_SADNESS, seed), gesture: 'comfort', reason: `此前的文字线索显示他情绪偏低（${inputs.userEmotion}）` };
    }
    const silenceMs = inputs.lastInteractionAt ? now.getTime() - Date.parse(inputs.lastInteractionAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(silenceMs) && silenceMs >= 3 * 60 * 60 * 1000) {
      return { text: pick(LONG_SILENCE, seed), gesture: 'heart', reason: `已有 ${Math.round(silenceMs / 3600_000)} 小时没有对话，他闲下来了` };
    }
    if (activity.disturb === 'invite' || idleEnough) {
      return { text: pick(IDLE_CHAT, seed), gesture: 'hold_star', reason: `他${activity.label}，已有 ${Math.round(activity.idleMs / 60_000)} 分钟没有操作` };
    }
  }
  return null;
}
